// The admin overview counts customers, not us: our own stickers, accounts and
// test calls are left out of the customer figures and reported apart ("N
// ours"), and the Tags and Owners pages mark those rows. Also: a call the
// provider could not place counts as a failed contact.
//
// INTERNAL_TEST_PHONES is read from the environment when the app is built, so
// it is set here before startTestApp and restored after.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "admin-overview-internal@parktag.test";
const PASSWORD = "test-password-123";
const MARK = `ovint${Date.now()}`;
const OUR_PHONE = "9876500854";
const PREVIOUS_LIST = process.env.INTERNAL_TEST_PHONES;

let app;
let collections;
let adminCookie;
let seq = 0;

function authed(method, url, payload) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, cookie: adminCookie },
    ...(payload ? { payload } : {})
  });
}

async function insertOwner(overrides = {}) {
  const { insertedId } = await collections.owners.insertOne({
    displayName: `Owner ${MARK} ${seq++}`,
    email: `${MARK}-${seq}@parktag.test`,
    role: "owner",
    testMarker: MARK,
    createdAt: new Date().toISOString(),
    ...overrides
  });
  return insertedId;
}

async function insertTag(overrides = {}) {
  const doc = {
    token: `${MARK}t${String(seq++).padStart(4, "0")}${"0".repeat(12)}`,
    serialNumber: 880000 + seq,
    batchNumber: `${MARK}-batch`,
    ownerId: null,
    status: "active",
    premium: true,
    testMarker: MARK,
    createdAt: new Date().toISOString(),
    activatedAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

async function insertRequest(overrides = {}) {
  const { insertedId } = await collections.contactRequests.insertOne({
    action: "call",
    status: "connecting",
    provider: "exotel",
    testMarker: MARK,
    createdAt: new Date().toISOString(),
    ...overrides
  });
  return insertedId;
}

async function summary() {
  const response = await authed("GET", "/api/admin/overview/summary?days=7");
  assert.equal(response.statusCode, 200);
  return response.json().summary;
}

before(async () => {
  process.env.INTERNAL_TEST_PHONES = OUR_PHONE;
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
    headers: { origin: TEST_ORIGIN },
    payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200);
  adminCookie = login.headers["set-cookie"];
});

after(async () => {
  await collections.tags.deleteMany({ testMarker: MARK });
  await collections.owners.deleteMany({ testMarker: MARK });
  await collections.contactRequests.deleteMany({ testMarker: MARK });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
  if (PREVIOUS_LIST === undefined) delete process.env.INTERNAL_TEST_PHONES;
  else process.env.INTERNAL_TEST_PHONES = PREVIOUS_LIST;
});

test("our own stickers, accounts and calls are counted apart from customers", async () => {
  const before = await summary();

  // A customer with one live premium sticker and one contact request.
  const customer = await insertOwner({ mobile: "+919811000001" });
  const customerTag = await insertTag({ ownerId: customer });
  await insertRequest({ token: customerTag.token });

  // One of us: the number is on the internal list, stored in the legacy
  // spelling to prove the match is not on the +91 form alone.
  const us = await insertOwner({ mobile: OUR_PHONE, displayName: `Kanchan ${MARK}` });
  const ourTag = await insertTag({ ownerId: us });
  await insertRequest({ token: ourTag.token });
  await insertRequest({ token: ourTag.token });
  // A sticker from the internal batch, owned by a stranger, is ours too.
  const other = await insertOwner({ mobile: "+919811000002" });
  const batchTag = await insertTag({ ownerId: other, batchNumber: "Batch-002", premium: false });

  const s = await summary();
  assert.equal(s.owners.total - before.owners.total, 2, "the customer and the stranger count; our account does not");
  assert.equal(s.tags.customer - before.tags.customer, 1, "only the customer's sticker is a customer tag");
  assert.equal(s.activations.premiumActivated - before.activations.premiumActivated, 1, "our premium sticker is not an activation");
  assert.equal(s.contacts.total - before.contacts.total, 1, "test calls against our sticker are not contact requests");
  assert.equal(s.contacts.new - before.contacts.new, 1);
  assert.equal(s.internal.owners - before.internal.owners, 1);
  assert.equal(s.internal.tags - before.internal.tags, 2, "our sticker and the internal-batch sticker");
  assert.equal(s.internal.contacts - before.internal.contacts, 2);

  // The pages still list everything, with our rows marked.
  const tags = await authed("GET", `/api/admin/etags?q=${encodeURIComponent(MARK)}`);
  assert.equal(tags.statusCode, 200);
  const byId = Object.fromEntries(tags.json().etags.map((t) => [t.id, t]));
  assert.equal(byId[String(customerTag._id)]?.internal, false);
  assert.equal(byId[String(ourTag._id)]?.internal, true);
  assert.equal(byId[String(batchTag._id)]?.internal, true);

  const owners = await authed("GET", `/api/admin/owners?q=${encodeURIComponent(MARK)}`);
  assert.equal(owners.statusCode, 200);
  const ownerById = Object.fromEntries(owners.json().owners.map((o) => [o.id, o]));
  assert.equal(ownerById[String(customer)]?.internal, false);
  assert.equal(ownerById[String(us)]?.internal, true);
});

test("a call the provider could not place is a failed contact, like a refused message", async () => {
  const before = await summary();
  const customer = await insertOwner({ mobile: "+919811000003" });
  const tag = await insertTag({ ownerId: customer });
  // What the Exotel webhook writes for a call it could not place.
  await insertRequest({ token: tag.token, status: "failed", callResult: "failed", callOutcome: "failed" });
  // What a refused WhatsApp message lands as.
  await insertRequest({ token: tag.token, action: "message", status: "provider_failed", provider: "meta" });
  // A call that rang out is not a failure of ours.
  await insertRequest({ token: tag.token, status: "no-answer", callOutcome: "missed" });
  // Our own failed test call does not count.
  const us = await insertOwner({ mobile: `+91${OUR_PHONE}` });
  const ourTag = await insertTag({ ownerId: us });
  await insertRequest({ token: ourTag.token, status: "failed", callOutcome: "failed" });

  const s = await summary();
  assert.equal(s.contacts.failed - before.contacts.failed, 2);
});
