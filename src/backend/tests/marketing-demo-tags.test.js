// Field-demo stock: auto-detected activation, and the wipe that makes a unit
// reusable.
//
// The load-bearing claims, pinned here rather than left to code comments:
//
//   1. A demo sticker needs no unlocking. The customer scans it and runs the
//      real wizard, and the shelf notices by itself.
//
//   2. Deactivating removes every trace of that customer, including the account
//      the wizard created for them. That account has a passwordHash like any
//      other, so the cleanup rule cannot simply skip password-holding accounts.
//
//   3. Sold units stay listed as a record, and can no longer be wiped.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections } from "./helpers.js";
import { createPasswordHash, createOtpHash } from "../lib/auth/security.js";
import { OTP_PURPOSE_AUTH, normalizeIdentifier } from "../lib/auth/otp.js";
import {
  blockedFromDemo,
  demoOwnerIsDisposable,
  demoState,
  printedCopies
} from "../lib/core/marketing-stock.js";

const ADMIN_EMAIL = "marketing-suite-admin@parktag.test";
const PASSWORD = "test-password-123";
const ORIGIN = "http://localhost:3000";

let app;
let collections;
let adminCookie;

const tokens = [];
const customerEmails = [];
const customerMobiles = [];
let nextSerial = 900001;

function makeToken() {
  const token = `demotag${String(tokens.length + 1).padStart(4, "0")}${"0".repeat(12)}`;
  tokens.push(token);
  return token;
}

// A demo sticker at rest: unowned and unclaimed, exactly like a new one.
async function insertSticker(overrides = {}) {
  const doc = {
    token: makeToken(),
    serialNumber: nextSerial++,
    ownerId: null,
    marketingStock: true,
    copiesPrinted: 2,
    status: "unclaimed",
    demoCount: 0,
    premium: true,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

function authed(method, url, payload) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: ORIGIN, cookie: adminCookie },
    ...(payload === undefined ? {} : { payload })
  });
}

// Drive the genuine activation wizard, the way the customer in front of the
// salesperson would. The claim route needs a real OTP, so mint one.
async function customerActivates(token, { email, phone, plate = "DL01AB1234" }) {
  customerEmails.push(email);
  const code = "424242";
  await collections.otpTokens.insertOne({
    identifier: normalizeIdentifier(phone),
    purpose: OTP_PURPOSE_AUTH,
    codeHash: await createOtpHash(code),
    used: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });

  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/claim`,
    remoteAddress: uniqueAddress(),
    headers: { origin: ORIGIN },
    payload: {
      email,
      password: "customer-pass-1234",
      displayName: "Demo Customer",
      phone,
      plateNumber: plate,
      otp: code
    }
  });
}

// The scanner's step wizard: plate → vehicle type → mobile → OTP. This is what
// a customer actually runs after scanning the QR on the sticker, and it is a
// DIFFERENT route from /claim above — no email, no password, vehicleType
// mandatory. Both routes attach an owner to a tag, so both have to make the
// shelf notice; testing only /claim would leave the path used at the roadside
// unproven.
async function customerScansAndActivates(
  token,
  { phone, plate = "DL05CD5678", vehicleType = "bike", displayName = "Scanned Customer" }
) {
  customerMobiles.push(phone);
  const code = "515151";
  await collections.otpTokens.insertOne({
    identifier: normalizeIdentifier(phone),
    purpose: OTP_PURPOSE_AUTH,
    codeHash: await createOtpHash(code),
    used: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });

  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/activate`,
    remoteAddress: uniqueAddress(),
    headers: { origin: ORIGIN },
    payload: { displayName, phone, code, plateNumber: plate, vehicleType }
  });
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);

  await collections.admins.insertOne({
    email: ADMIN_EMAIL,
    role: "admin",
    passwordHash: await createPasswordHash(PASSWORD),
    createdAt: new Date().toISOString()
  });

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/admin/login",
    remoteAddress: uniqueAddress(),
    headers: { origin: ORIGIN },
    payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200, "admin fixture must be able to sign in");
  adminCookie = login.headers["set-cookie"];
});

after(async () => {
  await collections.tags.deleteMany({ token: { $in: tokens } });
  if (customerEmails.length) {
    await collections.owners.deleteMany({ email: { $in: customerEmails } });
  }
  // The scanner wizard identifies people by mobile and never sets an email, so
  // those fixtures would survive an email-only cleanup.
  if (customerMobiles.length) {
    await collections.owners.deleteMany({ mobile: { $in: customerMobiles } });
  }
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

describe("activation is auto-detected — no unlocking step", () => {
  test("a listed sticker is immediately activatable, like any new one", async () => {
    const sticker = await insertSticker();

    const body = (
      await app.inject({ method: "GET", url: `/api/tags/${sticker.token}`, remoteAddress: uniqueAddress() })
    ).json();

    assert.equal(body.tag.claimable, true, "the customer must be able to just scan and activate");
  });

  test("activating through the real wizard flips the shelf to ACTIVATED by itself", async () => {
    const sticker = await insertSticker();
    const email = "demo-customer-1@parktag.test";

    // Nothing is done in the admin panel first — this is the whole point.
    const response = await customerActivates(sticker.token, { email, phone: "+919876500002" });
    assert.equal(response.statusCode, 200, "activation should succeed like any real one");

    const after = await collections.tags.findOne({ _id: sticker._id });
    assert.equal(demoState(after), "activated");
    assert.equal(after.demoCount, 1);
    assert.equal(after.demoOwnerCreated, true);

    const shelf = (await authed("GET", "/api/admin/marketing")).json();
    const row = shelf.items.find((i) => i.id === String(sticker._id));
    assert.equal(row.state, "activated");
    assert.equal(row.activatedBy, "Demo Customer", "the salesperson sees who is on it");
    assert.equal(row.plateNumber, "DL01AB1234");

    const owner = await collections.owners.findOne({ email });
    assert.equal(owner.demoCreatedOwner, true, "flagged so Deactivate can clean it up");
  });

  test("scanning the QR and running the step wizard also flips the shelf to ACTIVATED", async () => {
    // This is the route the roadside demo actually uses. It is a separate
    // handler from /claim with its own owner-creation branch, so the shelf
    // noticing on one proves nothing about the other.
    const sticker = await insertSticker();
    const phone = "+919876500010";

    const response = await customerScansAndActivates(sticker.token, {
      phone,
      plate: "DL07QR4321",
      vehicleType: "scooter",
      displayName: "Roadside Customer"
    });
    assert.equal(response.statusCode, 200, "the scanner wizard should activate like any real one");

    const after = await collections.tags.findOne({ _id: sticker._id });
    assert.equal(demoState(after), "activated", "the shelf must notice without any admin step");
    assert.equal(after.demoCount, 1);
    assert.equal(after.demoOwnerCreated, true);

    const shelf = (await authed("GET", "/api/admin/marketing")).json();
    const row = shelf.items.find((i) => i.id === String(sticker._id));
    assert.equal(row.state, "activated");
    assert.equal(row.activatedBy, "Roadside Customer", "the salesperson sees who is on it");
    assert.equal(row.plateNumber, "DL07QR4321");
  });

  test("a sticker activated by scanning can be wiped and reused, repeatedly", async () => {
    // The whole point of carrying copies: demo, wipe, demo again. Two full
    // cycles, because a single one would not catch a wipe that leaves the
    // previous customer's vehicleType behind for the next person to see.
    const sticker = await insertSticker();

    for (const [round, phone, plate, type] of [
      [1, "+919876500011", "DL08AA1111", "car"],
      [2, "+919876500012", "DL08BB2222", "truck"]
    ]) {
      const activated = await customerScansAndActivates(sticker.token, {
        phone,
        plate,
        vehicleType: type,
        displayName: `Customer ${round}`
      });
      assert.equal(activated.statusCode, 200, `round ${round} activation should succeed`);

      const live = await collections.tags.findOne({ _id: sticker._id });
      assert.equal(demoState(live), "activated", `round ${round} should show as activated`);
      assert.equal(live.plateNumber, plate);
      assert.equal(live.demoCount, round, "every demo is counted, including reuses");

      const wiped = await authed("POST", `/api/admin/marketing/${sticker._id}/deactivate`);
      assert.equal(wiped.statusCode, 200, `round ${round} deactivate should succeed`);

      const reset = await collections.tags.findOne({ _id: sticker._id });
      assert.equal(demoState(reset), "available", `round ${round} should return to available`);
      assert.equal(reset.plateNumber, undefined, "the customer's plate must not survive");
      assert.equal(reset.vehicleType, undefined, "nor their vehicle type");
      assert.equal(
        reset.demoCount,
        round,
        "the exposure counter survives the wipe — it is the sticker's history, not the customer's"
      );
    }
  });
});

describe("Deactivate Tag: wipe and reuse", () => {
  test("erases the customer from the sticker AND removes their account", async () => {
    const sticker = await insertSticker();
    const email = "demo-customer-2@parktag.test";
    await customerActivates(sticker.token, { email, phone: "+919876500003", plate: "DL09ZZ7777" });

    const response = await authed("POST", `/api/admin/marketing/${sticker._id}/deactivate`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().removedAccount, true);

    const after = await collections.tags.findOne({ _id: sticker._id });
    assert.equal(demoState(after), "available");
    assert.equal(after.status, "unclaimed", "back to a plain new sticker");
    assert.equal(after.ownerId, null);
    assert.equal(after.demoOwnerId, undefined);
    assert.equal(after.plateNumber, undefined, "the customer's plate must not survive");
    assert.equal(after.vehicleLabel, undefined);

    // The wizard's account has a passwordHash like any real one. If the cleanup
    // skipped password-holding accounts, this person's email, name and mobile
    // would be left behind after every demo.
    assert.equal(await collections.owners.findOne({ email }), null);
  });

  test("the same unit is then activatable by the next customer", async () => {
    const sticker = await insertSticker();

    await customerActivates(sticker.token, { email: "first@parktag.test", phone: "+919876500004" });
    await authed("POST", `/api/admin/marketing/${sticker._id}/deactivate`);

    const second = await customerActivates(sticker.token, {
      email: "second@parktag.test",
      phone: "+919876500005"
    });
    assert.equal(second.statusCode, 200, "the unit must be reusable");

    const after = await collections.tags.findOne({ _id: sticker._id });
    assert.equal(after.demoCount, 2, "both activations are counted against this unit");
    assert.equal(
      await collections.owners.countDocuments({ email: "first@parktag.test" }),
      0,
      "the first customer is gone"
    );
  });

  test("an account that existed before the demo is never deleted", async () => {
    // Someone who already has ParkTag activates a demo sticker with their own
    // account. Deactivating detaches the sticker and touches nothing else.
    const email = "already-a-customer@parktag.test";
    customerEmails.push(email);
    const existing = await collections.owners.insertOne({
      email,
      role: "owner",
      displayName: "Existing Customer",
      passwordHash: await createPasswordHash(PASSWORD),
      createdAt: new Date().toISOString()
    });

    const sticker = await insertSticker({
      status: "active",
      ownerId: existing.insertedId,
      demoOwnerId: existing.insertedId,
      demoOwnerCreated: false,
      plateNumber: "DL07QQ1111"
    });

    await authed("POST", `/api/admin/marketing/${sticker._id}/deactivate`);

    assert.ok(
      await collections.owners.findOne({ _id: existing.insertedId }),
      "a pre-existing account must outlive the demo"
    );

    const after = await collections.tags.findOne({ _id: sticker._id });
    assert.equal(after.plateNumber, undefined, "but their plate still comes off the sticker");
    assert.equal(after.ownerId, null);
  });

  test("is refused when the sticker was never activated", async () => {
    const sticker = await insertSticker();

    const response = await authed("POST", `/api/admin/marketing/${sticker._id}/deactivate`);
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /nothing to wipe/i);
  });
});

describe("Sold: the customer bought this unit", () => {
  test("stays listed as a record and keeps the tag on their account", async () => {
    const sticker = await insertSticker();
    const email = "buyer@parktag.test";
    await customerActivates(sticker.token, { email, phone: "+919876500007" });

    const response = await authed("POST", `/api/admin/marketing/${sticker._id}/sold`);
    assert.equal(response.statusCode, 200);

    const after = await collections.tags.findOne({ _id: sticker._id });
    assert.equal(demoState(after), "sold");
    assert.equal(after.marketingStock, true, "a sold unit stays on the shelf as a record");
    assert.equal(after.status, "active", "and stays live for the customer");
    assert.equal(after.soldBy, ADMIN_EMAIL);

    const owner = await collections.owners.findOne({ email });
    assert.equal(
      owner.demoCreatedOwner,
      undefined,
      "promoted to a real account, so no later wipe can delete a paying customer"
    );

    const shelf = (await authed("GET", "/api/admin/marketing")).json();
    assert.ok(shelf.items.some((i) => i.id === String(sticker._id) && i.state === "sold"));
  });

  test("a sold unit can no longer be wiped", async () => {
    const sticker = await insertSticker();
    await customerActivates(sticker.token, { email: "buyer2@parktag.test", phone: "+919876500008" });
    await authed("POST", `/api/admin/marketing/${sticker._id}/sold`);

    const response = await authed("POST", `/api/admin/marketing/${sticker._id}/deactivate`);
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /sold/i);

    const after = await collections.tags.findOne({ _id: sticker._id });
    assert.ok(after.demoOwnerId, "the customer is still on it");
  });

  test("is refused when nobody has activated the sticker", async () => {
    const sticker = await insertSticker();

    const response = await authed("POST", `/api/admin/marketing/${sticker._id}/sold`);
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /nobody has activated/i);
  });
});

describe("the shelf", () => {
  test("finds a unit by its printed serial", async () => {
    const sticker = await insertSticker();
    const serial = String(sticker.serialNumber);

    for (const q of [
      serial,
      `PT-01-${serial.padStart(6, "0")}`,
      serial.slice(-3), // reading the last few digits off the sticker
      sticker.token
    ]) {
      const body = (await authed("GET", `/api/admin/marketing?q=${encodeURIComponent(q)}`)).json();
      assert.ok(
        body.items.some((i) => i.id === String(sticker._id)),
        `search "${q}" should find the sticker`
      );
    }
  });

  test("a serial that matches nothing returns an empty list, not everything", async () => {
    await insertSticker();

    const body = (await authed("GET", "/api/admin/marketing?q=99999999")).json();
    assert.equal(body.items.length, 0);
    assert.ok(body.summary.units > 0, "counts still describe the whole shelf");
  });

  test("counts stay over the whole shelf while searching", async () => {
    await insertSticker();
    const target = await insertSticker();

    const body = (await authed("GET", `/api/admin/marketing?q=${target.serialNumber}`)).json();
    assert.equal(body.items.length, 1, "the list is filtered");
    assert.ok(body.summary.units > 1, "but the counts still reconcile against the bag");
  });

  test("a tag that is not demo stock cannot be acted on", async () => {
    const sticker = await insertSticker({ marketingStock: false, status: "active" });

    for (const path of ["deactivate", "sold"]) {
      const response = await authed("POST", `/api/admin/marketing/${sticker._id}/${path}`);
      assert.equal(response.statusCode, 409);
      assert.match(response.json().error, /not in field demo stock/i);
    }
  });

  test("every endpoint requires an admin session", async () => {
    const sticker = await insertSticker();

    for (const [method, url] of [
      ["GET", "/api/admin/marketing"],
      ["POST", `/api/admin/marketing/${sticker._id}/deactivate`],
      ["POST", `/api/admin/marketing/${sticker._id}/sold`]
    ]) {
      const response = await app.inject({
        method,
        url,
        remoteAddress: uniqueAddress(),
        headers: { origin: ORIGIN },
        ...(method === "POST" ? { payload: {} } : {})
      });
      assert.equal(response.statusCode, 401, `${method} ${url} must require a session`);
    }
  });
});

describe("domain rules", () => {
  test("demoState reads the three states off a tag", () => {
    assert.equal(demoState({ marketingStock: true }), "available");
    assert.equal(demoState({ marketingStock: true, demoOwnerId: 1 }), "activated");
    assert.equal(demoState({ marketingStock: true, demoOwnerId: 1, soldAt: "x" }), "sold");
    assert.equal(demoState({ marketingStock: true, soldAt: "x" }), "sold");
  });

  test("blockedFromDemo explains each refusal", () => {
    assert.match(blockedFromDemo(null), /not found/i);
    assert.match(blockedFromDemo({ marketingStock: false }), /not in field demo stock/i);
    assert.match(blockedFromDemo({ marketingStock: true, deletedAt: "x" }), /deleted/i);
    assert.equal(blockedFromDemo({ marketingStock: true }), null);
  });

  test("only demo-created accounts with nothing left on them are disposable", () => {
    assert.equal(demoOwnerIsDisposable({ demoCreatedOwner: true }, 0), true);
    assert.equal(
      demoOwnerIsDisposable({ demoCreatedOwner: true, passwordHash: "x" }, 0),
      true,
      "the wizard always sets a password — skipping those would leak every demo customer"
    );
    assert.equal(demoOwnerIsDisposable({ demoCreatedOwner: true }, 1), false, "still owns a tag");
    assert.equal(demoOwnerIsDisposable({ demoCreatedOwner: false }, 0), false, "not ours to delete");
    assert.equal(demoOwnerIsDisposable(null, 0), false);
  });

  test("printedCopies defaults to 1 for records that predate the field", () => {
    assert.equal(printedCopies({ copiesPrinted: 2 }), 2);
    assert.equal(printedCopies({}), 1);
    assert.equal(printedCopies({ copiesPrinted: 0 }), 1);
    assert.equal(printedCopies(null), 1);
  });
});
