// The admin Owners page: search, demo accounts kept apart, and each tag shown
// by what a person can read (plate, serial, membership) rather than its token.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "admin-owners-page@parktag.test";
const PASSWORD = "test-password-123";
const MARK = `owpage${Date.now()}`;

let app;
let collections;
let adminCookie;
let realOwnerId;
let demoOwnerId;

function authed(url) {
  return app.inject({
    method: "GET",
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, cookie: adminCookie }
  });
}

async function owners(query = "") {
  const response = await authed(`/api/admin/owners${query}`);
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

  realOwnerId = (
    await collections.owners.insertOne({
      displayName: `Real ${MARK}`,
      email: `${MARK}@parktag.test`,
      mobile: "+919812300077",
      role: "owner",
      testMarker: MARK,
      createdAt: new Date().toISOString()
    })
  ).insertedId;
  demoOwnerId = (
    await collections.owners.insertOne({
      displayName: `Demo ${MARK}`,
      role: "owner",
      demoCreatedOwner: true,
      testMarker: MARK,
      createdAt: new Date().toISOString()
    })
  ).insertedId;

  await collections.tags.insertOne({
    token: `${MARK}tok${"0".repeat(20)}`,
    ownerId: realOwnerId,
    status: "active",
    premium: true,
    premiumSince: new Date().toISOString(),
    plateNumber: "KA05MN4321",
    vehicleLabel: "Car",
    batchNumber: "07",
    serialNumber: 4242,
    testMarker: MARK,
    createdAt: new Date().toISOString()
  });

  await collections.shopOrders.insertMany([
    { ownerId: realOwnerId, status: "paid", testMarker: MARK, createdAt: new Date().toISOString() },
    { ownerId: String(realOwnerId), status: "cod", testMarker: MARK, createdAt: new Date().toISOString() },
    // An abandoned checkout is not an order.
    { ownerId: realOwnerId, status: "created", testMarker: MARK, createdAt: new Date().toISOString() }
  ]);
});

after(async () => {
  await collections.tags.deleteMany({ testMarker: MARK });
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await collections.owners.deleteMany({ testMarker: MARK });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("the owners list is admin-only", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/owners",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN }
  });
  assert.ok([401, 403].includes(response.statusCode), `expected 401/403, got ${response.statusCode}`);
});

test("search finds an owner by name, phone and plate", async () => {
  for (const q of [MARK, "9812300077", "KA05MN4321", "ka 05 mn"]) {
    const data = await owners(`?q=${encodeURIComponent(q)}`);
    assert.ok(
      data.owners.some((o) => o.id === String(realOwnerId)),
      `searching "${q}" must find the owner`
    );
    assert.equal(data.total, data.owners.length);
  }

  const none = await owners(`?q=${encodeURIComponent(`${MARK}-nobody`)}`);
  assert.equal(none.owners.length, 0);
});

test("a pasted token or sticker link finds the owner, a partial token does not", async () => {
  const token = `${MARK}tok${"0".repeat(20)}`;
  for (const q of [token, `https://parktag.me/tag/${token}`, `https://app.parktag.me/tag/${token}?src=qr`]) {
    const data = await owners(`?q=${encodeURIComponent(q)}`);
    assert.ok(
      data.owners.some((o) => o.id === String(realOwnerId)),
      `searching "${q}" must find the owner`
    );
  }

  // The token is the tag's secret: a fragment of it must not narrow a tag down.
  const partial = await owners(`?q=${encodeURIComponent(token.slice(MARK.length, MARK.length + 15))}`);
  assert.ok(!partial.owners.some((o) => o.id === String(realOwnerId)));
});

test("the owners list never carries a tag's token", async () => {
  const data = await owners(`?q=${encodeURIComponent(MARK)}`);
  const owner = data.owners.find((o) => o.id === String(realOwnerId));
  assert.ok(owner);
  assert.ok(!("tagTokens" in owner));
  assert.ok(!JSON.stringify(data).includes(`${MARK}tok`), "no token anywhere in the response");
});

test("a regex-looking search is treated as text", async () => {
  const data = await owners(`?q=${encodeURIComponent("a(")}`);
  assert.ok(Array.isArray(data.owners));
});

test("demo-created accounts are hidden unless asked for", async () => {
  const hidden = await owners(`?q=${encodeURIComponent(MARK)}`);
  assert.ok(!hidden.owners.some((o) => o.id === String(demoOwnerId)));

  const shown = await owners(`?q=${encodeURIComponent(MARK)}&demo=include`);
  const demo = shown.owners.find((o) => o.id === String(demoOwnerId));
  assert.ok(demo, "demo=include must list the demo account");
  assert.equal(demo.demo, true);
});

test("each owner carries readable tags, membership and real order count", async () => {
  const data = await owners(`?q=${encodeURIComponent(MARK)}`);
  const owner = data.owners.find((o) => o.id === String(realOwnerId));

  assert.equal(owner.mobile, "+919812300077");
  assert.equal(owner.demo, false);
  assert.equal(owner.orders, 2, "paid and COD count, an abandoned checkout does not");

  assert.equal(owner.tagList.length, 1);
  const [tag] = owner.tagList;
  assert.equal(tag.serial, "PT-07-004242");
  assert.equal(tag.plateNumber, "KA05MN4321");
  assert.equal(tag.premium, true);
  assert.equal(tag.membership.state, "trial", "a premium tag activated today is in its free year");
  assert.ok(tag.membership.daysLeft > 300);
  assert.ok(!("token" in tag), "the QR secret is not part of a tag row");
});

test("owners come 100 a page, each on exactly one page, and search reaches every page", async () => {
  const docs = [];
  for (let i = 0; i < 105; i++) {
    docs.push({
      displayName: `Paged ${MARK} ${String(i).padStart(3, "0")}`,
      email: `${MARK}-paged-${i}@parktag.test`,
      role: "owner",
      testMarker: MARK,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
    });
  }
  await collections.owners.insertMany(docs);
  const q = `?q=${encodeURIComponent(`${MARK}-paged-`)}`;

  const one = await owners(q);
  assert.equal(one.total, 105);
  assert.equal(one.pages, 2);
  assert.equal(one.pageSize, 100);
  assert.equal(one.owners.length, 100);
  const two = await owners(`${q}&page=2`);
  assert.equal(two.owners.length, 5);
  const ids = [...one.owners, ...two.owners].map((o) => o.id);
  assert.equal(new Set(ids).size, 105, "no owner on two pages, none missing");
  assert.equal((await owners(`${q}&page=40`)).page, 2, "past the end → last page");
  assert.equal((await owners(`${q}&page=abc`)).page, 1, "nonsense → page 1");

  // The oldest is on page 2 of that list; searching its email finds it.
  const oldest = two.owners[4];
  assert.ok(oldest.displayName.endsWith("000"));
  const found = await owners(`?q=${encodeURIComponent(oldest.email)}`);
  assert.deepEqual(found.owners.map((o) => o.id), [oldest.id]);
});
