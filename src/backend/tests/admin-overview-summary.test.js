// The overview is a summary of the other admin pages: every card links to one
// of them, so its number must be the number that page shows. These tests read
// each figure from the summary AND from the page's own endpoint and require the
// two to match, rather than pinning absolute values on a shared database.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "overview-summary-admin@parktag.test";
const PASSWORD = "test-password-123";
const BATCH = "overview-summary-test-batch";

let app;
let collections;
let adminCookie;

const tokens = [];
const ownerIds = [];
let nextSerial = 980001;

async function insertTag(overrides = {}) {
  const token = `ovsum${String(tokens.length + 1).padStart(4, "0")}${"0".repeat(12)}`;
  tokens.push(token);
  const doc = {
    token,
    serialNumber: nextSerial++,
    ownerId: null,
    status: "unclaimed",
    printStatus: "pending",
    batchNumber: BATCH,
    premium: true,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

async function insertOwner(overrides = {}) {
  const { insertedId } = await collections.owners.insertOne({
    email: `overview-summary-${ownerIds.length}-${Date.now()}@parktag.test`,
    displayName: "Overview Summary Owner",
    role: "owner",
    createdAt: new Date().toISOString(),
    ...overrides
  });
  ownerIds.push(insertedId);
  return insertedId;
}

function authed(url) {
  return app.inject({
    method: "GET",
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, cookie: adminCookie }
  });
}

async function summary() {
  const response = await authed("/api/admin/overview/summary");
  assert.equal(response.statusCode, 200);
  return response.json();
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
    headers: { origin: TEST_ORIGIN },
    payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200, "admin fixture must be able to sign in");
  adminCookie = login.headers["set-cookie"];

  // Something in every bucket, so a match of 0 against 0 proves little.
  const owner = await insertOwner();
  await insertTag();
  await insertTag({ printStatus: "printed" });
  await insertTag({ ownerId: owner, status: "active", premium: true });
  await insertTag({ ownerId: owner, status: "active", premium: false });
  await insertTag({ marketingStock: true, copiesPrinted: 2 });
});

after(async () => {
  await collections.tags.deleteMany({ token: { $in: tokens } });
  await collections.owners.deleteMany({ _id: { $in: ownerIds } });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("the summary is admin-only", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/overview/summary",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN }
  });
  assert.ok([401, 403].includes(response.statusCode), `expected 401/403, got ${response.statusCode}`);
});

test("each card matches the page it links to", async () => {
  const { summary: s } = await summary();

  const [activations, printQueue, printed, etagActivations, etags, batches, marketing, traffic, overview] =
    await Promise.all([
      authed("/api/admin/activations"),
      authed("/api/admin/print-queue"),
      authed("/api/admin/print-queue?printed=1"),
      authed("/api/admin/etag-activations"),
      authed("/api/admin/etags"),
      authed("/api/admin/tag-batches"),
      authed("/api/admin/marketing"),
      authed("/api/admin/traffic?days=7"),
      authed("/api/admin/overview")
    ]).then((responses) => responses.map((r) => r.json()));

  assert.equal(s.activations.awaiting, activations.counts.unactivated, "Sold, not activated");
  assert.equal(s.activations.awaiting, activations.unactivated.length);

  // The Activations page's list, by type, and the Tags page's stock filter.
  const [premiumList, etagList, stock] = await Promise.all([
    authed("/api/admin/activations/recent?type=premium"),
    authed("/api/admin/activations/recent?type=etag"),
    authed("/api/admin/etags?claim=unclaimed&category=premium")
  ]).then((responses) => responses.map((r) => r.json()));
  assert.equal(s.activations.premiumActivated, premiumList.total, "Premium tags activated");
  assert.ok(s.activations.premiumLive <= s.activations.premiumActivated);
  assert.equal(s.activations.etag, etagList.total, "E-Tag stickers activated, as the Activations page counts them");
  assert.equal(s.stock.premiumUnsold, stock.total, "Unsold premium stock");
  assert.equal(s.printQueue.unprinted, printQueue.tags.length, "Unprinted tags");
  assert.equal(s.printQueue.printedAwaitingClaim, printed.tags.length, "Printed, awaiting claim");
  assert.equal(s.activations.etag, etagActivations.total, "E-Tag stickers activated");
  assert.equal(s.tags.customer, etags.total, "Customer tags");
  assert.equal(s.batches.count, batches.batches.length, "Batches issued");
  assert.equal(s.batches.issued, batches.batches.reduce((n, b) => n + b.total, 0), "Tags issued");
  assert.equal(s.fieldDemo.units, marketing.summary.units, "Field demo stickers");
  assert.equal(s.fieldDemo.available, marketing.summary.available);
  assert.equal(s.fieldDemo.activated, marketing.summary.activated);
  assert.equal(s.fieldDemo.sold, marketing.summary.sold);
  assert.equal(s.traffic.visitors, traffic.totals.visitors, "Site visitors");
  assert.equal(s.traffic.views, traffic.totals.views, "Page views");
  assert.equal(s.owners.total, overview.counts.owners, "Owners (demo accounts excluded)");
  assert.equal(s.contacts.total, overview.counts.requests, "Contact requests all-time");
});

test("field-demo stock is not counted as unprinted, ordinary stock is", async () => {
  const before = (await summary()).summary.printQueue.unprinted;

  await insertTag({ marketingStock: true });
  assert.equal((await summary()).summary.printQueue.unprinted, before, "demo stock must not move the count");

  await insertTag();
  assert.equal((await summary()).summary.printQueue.unprinted, before + 1, "ordinary stock must be counted");
});

test("new owners in the window are counted, demo-created accounts are not", async () => {
  const before = (await summary()).summary.owners;

  await insertOwner({ demoCreatedOwner: true });
  const afterDemo = (await summary()).summary.owners;
  assert.deepEqual(afterDemo, before, "a demo-created owner must not count");

  await insertOwner();
  const afterReal = (await summary()).summary.owners;
  assert.equal(afterReal.total, before.total + 1);
  assert.equal(afterReal.new, before.new + 1);

  // Older rows carry a Date rather than an ISO string; they must still count.
  await insertOwner({ createdAt: new Date() });
  assert.equal((await summary()).summary.owners.new, before.new + 2);
});

test("the summary is numbers only: no activity list repeating other pages", async () => {
  const body = await summary();
  assert.equal(body.latest, undefined, "Latest activity lived on Activity Feed and Owners already");
  assert.ok(body.summary.contacts, "contacts are still counted");
});
