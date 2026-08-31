// What Deactivate leaves behind.
//
// Deactivating a field-demo sticker deletes the throwaway account the
// activation wizard created. Deleting the row is not the whole job: the wizard
// SIGNED THAT PERSON IN, and a session is keyed by session id, not by user, so
// the cookie outlived the account it belonged to.
//
// The claims pinned here:
//
//   1. The customer's session stops working once their account is deleted.
//      Until it did, that cookie kept answering /api/session with their name
//      and phone number — on whichever phone ran the demo, which may be the
//      salesperson's.
//   2. A customer who already had an account keeps BOTH the account and the
//      session. Only the sticker is detached from them.
//   3. A live session whose account is gone gets 401, not a 500. Every owner
//      route below the lookup dereferences the owner document.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash, createOtpHash } from "../lib/auth/security.js";
import { OTP_PURPOSE_AUTH, normalizeIdentifier } from "../lib/auth/otp.js";

const ADMIN_EMAIL = "marketing-aftermath-admin@parktag.test";
const PASSWORD = "test-password-123";
const ORIGIN = TEST_ORIGIN;

let app;
let collections;
let adminCookie;

const tokens = [];
const mobiles = [];
let nextSerial = 990001;

function makeToken() {
  const token = `aftertag${String(tokens.length + 1).padStart(4, "0")}${"0".repeat(12)}`;
  tokens.push(token);
  return token;
}

async function insertSticker(overrides = {}) {
  const doc = {
    token: makeToken(),
    serialNumber: nextSerial++,
    batchNumber: "11",
    ownerId: null,
    marketingStock: true,
    copiesPrinted: 1,
    status: "unclaimed",
    demoCount: 0,
    premium: true,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

// Drive the scanner wizard the way a customer at the roadside does. Returns the
// session cookie it hands back, which is the whole point of these tests.
async function customerActivates(token, { phone, displayName = "Demo Prospect" }) {
  mobiles.push(phone);
  const code = "606060";
  await collections.otpTokens.insertOne({
    identifier: normalizeIdentifier(phone),
    purpose: OTP_PURPOSE_AUTH,
    codeHash: await createOtpHash(code),
    used: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/tags/${token}/activate`,
    remoteAddress: uniqueAddress(),
    headers: { origin: ORIGIN },
    payload: {
      displayName,
      phone,
      code,
      plateNumber: "DL11AF0001",
      vehicleType: "car"
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.headers["set-cookie"];
}

function asCustomer(cookie, url) {
  return app.inject({ method: "GET", url, remoteAddress: uniqueAddress(), headers: { cookie } });
}

function authed(method, url) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: ORIGIN, cookie: adminCookie }
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
  if (mobiles.length) await collections.owners.deleteMany({ mobile: { $in: mobiles } });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

describe("Deactivate leaves nothing usable behind", () => {
  test("the customer's session dies with the account it belonged to", async () => {
    const sticker = await insertSticker();
    const cookie = await customerActivates(sticker.token, {
      phone: "+919870000101",
      displayName: "Walked Away"
    });

    // Signed in by the wizard, before anything is deactivated.
    const before = await asCustomer(cookie, "/api/session");
    assert.equal(before.statusCode, 200, "the wizard signs the customer in");
    assert.equal(before.json().session.displayName, "Walked Away");

    const wiped = await authed("POST", `/api/admin/marketing/${sticker._id}/deactivate`);
    assert.equal(wiped.statusCode, 200, wiped.body);
    assert.equal(wiped.json().removedAccount, true, "the throwaway account is deleted");

    // /api/session always answers 200; an unauthenticated caller gets a null
    // session rather than an error, so THAT is what has to be asserted here.
    const after = await asCustomer(cookie, "/api/session");
    assert.equal(after.statusCode, 200);
    assert.equal(
      after.json().session,
      null,
      "their cookie must stop working — it was still returning their name and phone"
    );

    const rows = await collections.sessions.countDocuments({ email: "+919870000101" });
    assert.equal(rows, 0, "and the session row itself is gone, not merely ignored");
  });

  test("a deleted account's cookie gets 401 from the dashboard, not a 500", async () => {
    const sticker = await insertSticker();
    const cookie = await customerActivates(sticker.token, { phone: "+919870000102" });

    await authed("POST", `/api/admin/marketing/${sticker._id}/deactivate`);

    const response = await asCustomer(cookie, "/api/owner/dashboard");
    assert.equal(
      response.statusCode,
      401,
      "the route dereferenced a null owner and threw a TypeError instead"
    );
  });

  test("a customer who already had an account keeps it, and stays signed in", async () => {
    // The sticker is detached from them; nothing else about them is touched.
    // Their session must survive, or deactivating a demo would sign a real
    // customer out of their own dashboard.
    const phone = "+919870000103";
    const existing = await insertSticker({ marketingStock: false, copiesPrinted: undefined });
    const cookie = await customerActivates(existing.token, { phone, displayName: "Returning" });

    const ownerId = (await collections.owners.findOne({ mobile: phone }))._id;
    // They are not a demo-created account: they owned a tag before this demo.
    await collections.owners.updateOne({ _id: ownerId }, { $unset: { demoCreatedOwner: "" } });

    const demo = await insertSticker();
    await collections.tags.updateOne(
      { _id: demo._id },
      {
        $set: {
          ownerId,
          demoOwnerId: ownerId,
          demoOwnerCreated: false,
          status: "active",
          plateNumber: "DL11AF0002"
        }
      }
    );

    const wiped = await authed("POST", `/api/admin/marketing/${demo._id}/deactivate`);
    assert.equal(wiped.statusCode, 200, wiped.body);
    assert.equal(wiped.json().removedAccount, false, "their account must not be deleted");

    assert.ok(await collections.owners.findOne({ _id: ownerId }), "the account still exists");

    const after = await asCustomer(cookie, "/api/session");
    assert.equal(after.statusCode, 200);
    assert.ok(after.json().session, "and they are still signed in");
  });
});
