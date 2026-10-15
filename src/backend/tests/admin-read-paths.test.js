// M2: the admin read paths. Credential hashes never leave the database on the
// owner lists, the print queue can be bounded, and the landing totals are
// counted by the database.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { istDayKey } from "../routes/system/analytics.js";

const ADMIN_EMAIL = "admin-read-paths@parktag.test";
const PASSWORD = "test-password-123";
const BATCH = "admin-hardening-batch";
const SECRET_PASSWORD_HASH = "$2b$12$SECRETPASSWORDHASHMARKERxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const SECRET_PIN_HASH = "$2b$12$SECRETPINHASHMARKERxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

let app;
let collections;
let adminCookie;
const tagIds = [];
const ownerIds = [];
const visitIds = [];
let serial = 970001;

const authed = (url) =>
  app.inject({
    method: "GET",
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, cookie: adminCookie }
  });

async function insertOwner(extra = {}) {
  const { insertedId } = await collections.owners.insertOne({
    email: `admin-hardening-${ownerIds.length}-${Date.now()}@parktag.test`,
    displayName: "Hardening Owner",
    role: "owner",
    createdAt: new Date().toISOString(),
    passwordHash: SECRET_PASSWORD_HASH,
    loginPinHash: SECRET_PIN_HASH,
    ...extra
  });
  ownerIds.push(insertedId);
  return insertedId;
}

async function insertTag(extra = {}) {
  const { insertedId } = await collections.tags.insertOne({
    token: `adminhard${String(tagIds.length).padStart(4, "0")}${"0".repeat(12)}`,
    serialNumber: serial++,
    ownerId: null,
    status: "unclaimed",
    printStatus: "pending",
    batchNumber: BATCH,
    premium: true,
    createdAt: new Date().toISOString(),
    ...extra
  });
  tagIds.push(insertedId);
  return insertedId;
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
});

after(async () => {
  await collections.tags.deleteMany({ _id: { $in: tagIds } });
  await collections.owners.deleteMany({ _id: { $in: ownerIds } });
  await collections.landingVisits.deleteMany({ _id: { $in: visitIds } });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("owner lists never carry a credential hash", async () => {
  await insertOwner({ mobile: "+919800011122" });

  for (const url of ["/api/admin/overview", "/api/admin/owners", "/api/admin/overview/summary"]) {
    const response = await authed(url);
    assert.equal(response.statusCode, 200, `${url}: ${response.body.slice(0, 200)}`);
    assert.ok(!response.body.includes(SECRET_PASSWORD_HASH), `${url} leaks passwordHash`);
    assert.ok(!response.body.includes(SECRET_PIN_HASH), `${url} leaks loginPinHash`);
    assert.ok(!/passwordHash|loginPinHash/.test(response.body), `${url} names a credential field`);
  }

  // The fixture is only meaningful if the owner really is in those responses.
  const owners = (await authed("/api/admin/owners")).json().owners;
  assert.ok(owners.some((o) => o.mobile === "+919800011122"));
  const overview = (await authed("/api/admin/overview")).json();
  assert.ok(overview.owners.some((o) => o.displayName === "Hardening Owner"));
});

test("the print queue reports whether it was cut short, and honours ?limit", async () => {
  for (let i = 0; i < 4; i += 1) await insertTag({ printStatus: "pending" });

  const full = (await authed("/api/admin/print-queue")).json();
  assert.equal(full.hasMore, false);
  assert.ok(full.tags.length >= 4);

  const cut = (await authed("/api/admin/print-queue?limit=3")).json();
  assert.equal(cut.hasMore, true);
  assert.equal(cut.tags.length, 3);
  assert.equal(cut.limit, 3);

  // Shape is what the admin page already reads.
  const [tag] = full.tags;
  for (const key of [
    "id", "token", "batchNumber", "batchLabel", "printStatus", "premium", "claimUrl",
    "issuanceRunId", "issuedAt", "serial", "mountType", "runSerialStart", "runSerialEnd", "createdAt"
  ]) {
    assert.ok(key in tag, `print-queue tag lost \`${key}\``);
  }
  assert.match(tag.serial, /^PT-/);
  assert.equal(full.exportMaxPerRequest, 250);
});

test("landing totals are counted in the database and match the traffic page", async () => {
  const day = istDayKey(new Date());
  const base = { day, site: "landing", path: "/", country: "India", countryCode: "IN" };
  const beforeSummary = (await authed("/api/admin/overview/summary")).json().summary.traffic;

  const docs = [
    { ...base, visitorHash: "ah-visitor-a" },
    { ...base, visitorHash: "ah-visitor-a" },
    { ...base, visitorHash: "ah-visitor-b" },
    { ...base },
    { ...base, visitorHash: "" },
    { ...base, site: "app", visitorHash: "ah-visitor-app" }
  ];
  const { insertedIds } = await collections.landingVisits.insertMany(docs);
  visitIds.push(...Object.values(insertedIds));

  const { summary } = (await authed("/api/admin/overview/summary")).json();
  const traffic = (await authed("/api/admin/traffic?days=7")).json();

  // The app row is not a landing view; blank hashes are views, not visitors.
  assert.equal(summary.traffic.views - beforeSummary.views, 5);
  assert.equal(summary.traffic.visitors - beforeSummary.visitors, 2);
  assert.equal(summary.traffic.views, traffic.totals.views);
  assert.equal(summary.traffic.visitors, traffic.totals.visitors);
});
