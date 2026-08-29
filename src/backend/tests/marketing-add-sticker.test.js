// Adding an already-printed sticker to the shelf from the admin page.
//
// The CLI script needs the serial known in advance and a terminal. A sticker in
// someone's hand is neither, so POST /api/admin/marketing/add takes what is
// printed on it. Everything that makes that safe lives on the server:
//
//   1. It resolves a serial to exactly ONE tag, or refuses. Serials are unique
//      per BATCH, not globally, so a bare "1004" that matches two batches must
//      be an error asking for the full serial — never a guess.
//   2. It never takes a sticker away from a customer who owns it.
//   3. Re-adding one already on the shelf adjusts the copy count ONLY. Running
//      the full designation again would blank ownerId and status, which mid-demo
//      wipes the customer standing in front of the salesperson.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "marketing-add-admin@parktag.test";
const PASSWORD = "test-password-123";
const ORIGIN = "http://localhost:3000";

let app;
let collections;
let adminCookie;

const tokens = [];
const ownerIds = [];
let nextSerial = 980001;

function makeToken() {
  const token = `addtag${String(tokens.length + 1).padStart(4, "0")}${"0".repeat(14)}`;
  tokens.push(token);
  return token;
}

async function insertTag(overrides = {}) {
  const doc = {
    token: makeToken(),
    serialNumber: nextSerial++,
    batchNumber: "07",
    ownerId: null,
    status: "unclaimed",
    printStatus: "printed",
    premium: true,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

function add(payload) {
  return app.inject({
    method: "POST",
    url: "/api/admin/marketing/add",
    remoteAddress: uniqueAddress(),
    headers: { origin: ORIGIN, cookie: adminCookie, "content-type": "application/json" },
    payload
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
  if (ownerIds.length) await collections.owners.deleteMany({ _id: { $in: ownerIds } });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

describe("adding a printed sticker", () => {
  test("a full serial puts it on the shelf, unowned and available", async () => {
    const tag = await insertTag();
    const serial = `PT-07-${String(tag.serialNumber).padStart(6, "0")}`;

    const response = await add({ serial, copies: 1 });
    assert.equal(response.statusCode, 200, response.body);

    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.added, true);
    assert.equal(body.serial, serial);

    const after = await collections.tags.findOne({ _id: tag._id });
    assert.equal(after.marketingStock, true);
    assert.equal(after.copiesPrinted, 1);
    assert.equal(after.demoCount, 0, "a fresh unit starts with no exposure history");
    assert.equal(after.ownerId, null, "it must rest unowned so the customer's scan just works");
    assert.equal(after.status, "unclaimed");
  });

  test("the copy count is recorded as given", async () => {
    const tag = await insertTag();
    const response = await add({
      serial: `PT-07-${String(tag.serialNumber).padStart(6, "0")}`,
      copies: 24
    });
    assert.equal(response.statusCode, 200);

    const after = await collections.tags.findOne({ _id: tag._id });
    assert.equal(after.copiesPrinted, 24);
  });

  test("a bare unit number works when it is unambiguous", async () => {
    const tag = await insertTag();
    const response = await add({ serial: String(tag.serialNumber), copies: 1 });
    assert.equal(response.statusCode, 200, response.body);

    const after = await collections.tags.findOne({ _id: tag._id });
    assert.equal(after.marketingStock, true);
  });

  test("a bare unit number matching two batches is refused, not guessed", async () => {
    // The same unit number printed in two different batches: two physically
    // different stickers whose serials differ only by the batch half.
    const shared = nextSerial++;
    const inBatch7 = await insertTag({ serialNumber: shared, batchNumber: "07" });
    const inBatch9 = await insertTag({ serialNumber: shared, batchNumber: "09" });

    const response = await add({ serial: String(shared), copies: 1 });
    assert.equal(response.statusCode, 404);
    assert.match(response.json().error, /matches 2 stickers/i);

    for (const tag of [inBatch7, inBatch9]) {
      const after = await collections.tags.findOne({ _id: tag._id });
      assert.ok(!after.marketingStock, "an ambiguous add must change nothing at all");
    }

    // The full serial resolves it.
    const resolved = await add({ serial: `PT-09-${String(shared).padStart(6, "0")}`, copies: 1 });
    assert.equal(resolved.statusCode, 200, resolved.body);
    assert.equal((await collections.tags.findOne({ _id: inBatch9._id })).marketingStock, true);
    assert.ok(
      !(await collections.tags.findOne({ _id: inBatch7._id })).marketingStock,
      "only the batch that was named may be touched"
    );
  });

  test("a sticker that belongs to a customer is refused", async () => {
    const ownerId = (
      await collections.owners.insertOne({
        email: `add-real-customer-${Date.now()}@parktag.test`,
        displayName: "Paying Customer",
        createdAt: new Date().toISOString()
      })
    ).insertedId;
    ownerIds.push(ownerId);

    const tag = await insertTag({ ownerId, status: "active" });
    const response = await add({
      serial: `PT-07-${String(tag.serialNumber).padStart(6, "0")}`,
      copies: 1
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /already belongs to a customer/i);

    const after = await collections.tags.findOne({ _id: tag._id });
    assert.ok(!after.marketingStock, "the customer's tag must be untouched");
    assert.equal(String(after.ownerId), String(ownerId), "and must still be theirs");
  });

  test("a deleted sticker is refused", async () => {
    const tag = await insertTag({ deletedAt: new Date().toISOString() });
    const response = await add({
      serial: `PT-07-${String(tag.serialNumber).padStart(6, "0")}`,
      copies: 1
    });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /deleted/i);
  });

  test("an unknown serial is refused", async () => {
    const response = await add({ serial: "PT-07-999999", copies: 1 });
    assert.equal(response.statusCode, 404);
    assert.match(response.json().error, /no sticker found/i);
  });

  test("a nonsense copy count is refused before anything is written", async () => {
    const tag = await insertTag();
    const serial = `PT-07-${String(tag.serialNumber).padStart(6, "0")}`;

    for (const copies of [0, -3, 2.5, 100000, "many"]) {
      const response = await add({ serial, copies });
      assert.equal(response.statusCode, 400, `copies=${copies} should be rejected`);
    }

    const after = await collections.tags.findOne({ _id: tag._id });
    assert.ok(!after.marketingStock, "a rejected request must not half-apply");
  });

  test("a serial that is not a string is refused, not coerced", async () => {
    // `serial` decides WHICH sticker gets changed, so it is the last input that
    // should be loosely typed. An array used to String()-coerce to the same
    // text and be accepted.
    const tag = await insertTag();
    const serial = `PT-07-${String(tag.serialNumber).padStart(6, "0")}`;

    for (const bad of [[serial], { toString: () => serial }, 12345, true]) {
      const response = await add({ serial: bad, copies: 1 });
      assert.equal(response.statusCode, 404, `serial=${JSON.stringify(bad)} should be refused`);
    }

    const after = await collections.tags.findOne({ _id: tag._id });
    assert.ok(!after.marketingStock, "none of those may have taken effect");

    // ...and the plain string still works, so this is typing, not a blanket ban.
    assert.equal((await add({ serial, copies: 1 })).statusCode, 200);
  });

  test("an omitted copy count means one sticker", async () => {
    // Absent is not the same as invalid: the overwhelmingly common case is a
    // single printed sticker, so no count means one rather than an error.
    const tag = await insertTag();
    const serial = `PT-07-${String(tag.serialNumber).padStart(6, "0")}`;

    const response = await add({ serial });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal((await collections.tags.findOne({ _id: tag._id })).copiesPrinted, 1);
  });

  test("re-adding an ACTIVATED unit changes the count without wiping the customer", async () => {
    // The dangerous case. Someone corrects the copy count while a customer is
    // mid-demo; re-running the full designation would blank ownerId and status
    // and erase them.
    const ownerId = (
      await collections.owners.insertOne({
        email: `add-demo-customer-${Date.now()}@parktag.test`,
        displayName: "Mid Demo",
        demoCreatedOwner: true,
        createdAt: new Date().toISOString()
      })
    ).insertedId;
    ownerIds.push(ownerId);

    const tag = await insertTag({
      marketingStock: true,
      copiesPrinted: 2,
      demoCount: 3,
      ownerId,
      demoOwnerId: ownerId,
      demoActivatedAt: new Date().toISOString(),
      status: "active",
      plateNumber: "DL04MD1234"
    });

    const response = await add({
      serial: `PT-07-${String(tag.serialNumber).padStart(6, "0")}`,
      copies: 6
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().added, false, "this is an update, and says so");

    const after = await collections.tags.findOne({ _id: tag._id });
    assert.equal(after.copiesPrinted, 6, "the count is corrected");
    assert.equal(String(after.ownerId), String(ownerId), "the customer is still on it");
    assert.equal(String(after.demoOwnerId), String(ownerId));
    assert.equal(after.status, "active", "and the sticker is still activated");
    assert.equal(after.plateNumber, "DL04MD1234", "their plate survives");
    assert.equal(after.demoCount, 3, "exposure history is not reset");
  });

  test("signing in is required", async () => {
    const tag = await insertTag();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/marketing/add",
      remoteAddress: uniqueAddress(),
      headers: { origin: ORIGIN, "content-type": "application/json" },
      payload: { serial: `PT-07-${String(tag.serialNumber).padStart(6, "0")}`, copies: 1 }
    });
    assert.ok(response.statusCode === 401 || response.statusCode === 403, response.statusCode);

    const after = await collections.tags.findOne({ _id: tag._id });
    assert.ok(!after.marketingStock, "an unauthenticated call must change nothing");
  });
});
