// The admin Tags page API: no QR token in what the browser receives, search by
// owner name and spaced plates, the activation date, and a deleted tag that
// can never be activated again.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "admin-etags-page@parktag.test";
const PASSWORD = "test-password-123";
const MARK = `etpage${Date.now()}`;
const TOKEN = `${MARK}tok${"0".repeat(20)}`;
const DELETED_TOKEN = `${MARK}del${"0".repeat(20)}`;

let app;
let collections;
let adminCookie;
let ownerId;
let liveTagId;
let deletedTagId;

function call(method, url, payload) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, cookie: adminCookie },
    ...(payload ? { payload } : {})
  });
}
async function list(query) {
  const response = await call("GET", `/api/admin/etags${query}`);
  assert.equal(response.statusCode, 200);
  return response.json();
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.admins.insertOne({
    email: ADMIN_EMAIL, role: "admin", passwordHash: await createPasswordHash(PASSWORD), createdAt: new Date().toISOString()
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

  ownerId = (await collections.owners.insertOne({
    displayName: `Tagpage ${MARK}`, email: `${MARK}@parktag.test`, role: "owner", testMarker: MARK, createdAt: new Date().toISOString()
  })).insertedId;

  liveTagId = (await collections.tags.insertOne({
    token: TOKEN, ownerId, status: "active", premium: true,
    premiumSince: "2026-09-01T10:00:00.000Z", activatedAt: "2026-08-01T10:00:00.000Z",
    plateNumber: "KA09ZX4455", testMarker: MARK, createdAt: "2026-07-01T10:00:00.000Z"
  })).insertedId;
  deletedTagId = (await collections.tags.insertOne({
    token: DELETED_TOKEN, ownerId, status: "inactive", plateNumber: "KA09ZX4456",
    deletedAt: new Date().toISOString(), testMarker: MARK, createdAt: new Date().toISOString()
  })).insertedId;
});

after(async () => {
  await collections.tags.deleteMany({ testMarker: MARK });
  await collections.owners.deleteMany({ testMarker: MARK });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("the list and the detail never carry the QR token", async () => {
  const body = await list(`?q=${MARK}`);
  const row = body.etags.find((t) => t.id === String(liveTagId));
  assert.ok(row, "the tag is found by its owner's email");
  assert.equal(row.token, undefined);
  assert.ok(!JSON.stringify(body).includes(TOKEN), "token appears nowhere in the list response");

  const detail = await call("GET", `/api/admin/etags/${liveTagId}`);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().etag.token, undefined);
  assert.ok(!detail.body.includes(TOKEN), "token appears nowhere in the detail response");
});

test("an exact token still finds its tag, server-side", async () => {
  const body = await list(`?q=${TOKEN}`);
  assert.deepEqual(body.etags.map((t) => t.id), [String(liveTagId)]);
});

test("search matches the owner's name and a plate typed with spaces", async () => {
  const byName = await list(`?q=${encodeURIComponent(`tagpage ${MARK}`)}`);
  assert.ok(byName.etags.some((t) => t.id === String(liveTagId)), "owner name");
  const byPlate = await list(`?q=${encodeURIComponent("ka09 zx 4455")}`);
  assert.ok(byPlate.etags.some((t) => t.id === String(liveTagId)), "spaced plate");
});

test("a premium tag reports when it became premium as its activation date", async () => {
  const row = (await list(`?q=${MARK}`)).etags.find((t) => t.id === String(liveTagId));
  assert.equal(row.activatedAt, "2026-09-01T10:00:00.000Z");
});

test("a deleted tag can't be activated again, and stays inactive", async () => {
  const response = await call("POST", `/api/admin/etags/${deletedTagId}/status`, { status: "active" });
  assert.equal(response.statusCode, 409);
  const tag = await collections.tags.findOne({ _id: deletedTagId });
  assert.equal(tag.status, "inactive");
  assert.ok(tag.deletedAt, "still deleted");
});

test("a live tag can still be deactivated and activated", async () => {
  for (const status of ["inactive", "active"]) {
    const response = await call("POST", `/api/admin/etags/${liveTagId}/status`, { status });
    assert.equal(response.statusCode, 200);
    assert.equal((await collections.tags.findOne({ _id: liveTagId })).status, status);
  }
});

// ── Numbered pages: 100 tags a page, on the Tags list and the Activated list ──
const PAGED = `${MARK}pg`;
async function insertPagedTags(ownerOf) {
  const docs = [];
  for (let i = 0; i < 105; i++) {
    docs.push({
      token: `${PAGED}${String(i).padStart(3, "0")}${"0".repeat(16)}`,
      ownerId: ownerOf,
      status: "active",
      batchNumber: "77",
      serialNumber: 5000 + i,
      plateNumber: `PG${MARK.slice(-6).toUpperCase()}${String(i).padStart(3, "0")}`,
      testMarker: MARK,
      pagedMarker: PAGED,
      // Spread over time, so "newest first" is a real order.
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      activatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
    });
  }
  await collections.tags.insertMany(docs);
  return docs;
}

test("the Tags list comes 100 a page, every tag on exactly one page", async () => {
  const pagedOwner = (await collections.owners.insertOne({
    displayName: `Pager ${PAGED}`, email: `${PAGED}@parktag.test`, role: "owner", testMarker: MARK, createdAt: new Date().toISOString()
  })).insertedId;
  await insertPagedTags(pagedOwner);
  const q = `?q=${PAGED}`; // matches the owner's email: all 105 tags

  const one = await list(q);
  assert.equal(one.total, 105);
  assert.equal(one.pages, 2);
  assert.equal(one.page, 1);
  assert.equal(one.pageSize, 100);
  assert.equal(one.etags.length, 100);

  const two = await list(`${q}&page=2`);
  assert.equal(two.page, 2);
  assert.equal(two.etags.length, 5);

  const ids = [...one.etags, ...two.etags].map((t) => t.id);
  assert.equal(new Set(ids).size, 105, "no tag on two pages, none missing");

  // Newest first: page 1 starts with the newest, page 2 ends with the oldest.
  assert.ok(one.etags[0].plateNumber.endsWith("104"));
  assert.ok(two.etags[4].plateNumber.endsWith("000"));

  // Past the end → the last page; nonsense → page 1.
  for (const past of ["99", "9999999999"]) assert.equal((await list(`${q}&page=${past}`)).page, 2, `page=${past}`);
  for (const bad of ["0", "-3", "abc", ""]) assert.equal((await list(`${q}&page=${bad}`)).page, 1, `page=${bad}`);

  // Search reaches every page: the oldest tag sits on page 2 of the full list,
  // but searching its plate brings it up first.
  const oldest = two.etags[4];
  const found = await list(`?q=${encodeURIComponent(oldest.plateNumber)}`);
  assert.deepEqual(found.etags.map((t) => t.id), [oldest.id]);
  assert.equal(found.pages, 1);
});

test("the Activated list comes 100 a page as well", async () => {
  const q = `?q=${PAGED}`; // same owner, same 105 tags (inserted by the test above)
  const res1 = await call("GET", `/api/admin/activations/recent${q}`);
  assert.equal(res1.statusCode, 200);
  const one = res1.json();
  assert.equal(one.total, 105);
  assert.equal(one.pages, 2);
  assert.equal(one.activations.length, 100);

  const two = (await call("GET", `/api/admin/activations/recent${q}&page=2`)).json();
  assert.equal(two.activations.length, 5);
  const ids = [...one.activations, ...two.activations].map((t) => t.id);
  assert.equal(new Set(ids).size, 105, "no activation on two pages, none missing");
  assert.equal((await call("GET", `/api/admin/activations/recent${q}&page=50`)).json().page, 2);
});
