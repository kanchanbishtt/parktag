// Admin sign-in log: sign-ins, sign-outs and failed attempts are recorded,
// cheaply and without ever getting in the way of signing in.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { browserLabel, recordAdminEvent, ADMIN_AUDIT_RETENTION_SECONDS } from "../lib/core/admin-audit.js";
import { ensureCoreIndexes } from "../lib/db/repositories.js";

const MARK = `audit${Date.now()}`;
const ADMIN_EMAIL = `${MARK}-admin@parktag.test`;
const PASSWORD = "test-password-123";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

let app;
let collections;
let adminId;

// The log is written without being awaited, so a test waits for the row.
async function waitFor(fn, what) {
  for (let i = 0; i < 50; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${what}`);
}

function login(password, remoteAddress = uniqueAddress()) {
  return app.inject({
    method: "POST",
    url: "/api/auth/admin/login",
    remoteAddress,
    headers: { origin: TEST_ORIGIN, "user-agent": CHROME_WINDOWS },
    payload: { email: ADMIN_EMAIL, password }
  });
}
function call(method, url, cookie) {
  return app.inject({ method, url, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) } });
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.adminAudit.deleteMany({ email: { $regex: `^${MARK}` } });
  adminId = (await collections.admins.insertOne({
    email: ADMIN_EMAIL, role: "admin", displayName: "Audit Admin",
    passwordHash: await createPasswordHash(PASSWORD), createdAt: new Date().toISOString()
  })).insertedId;
});

after(async () => {
  await collections.adminAudit.deleteMany({ email: { $regex: `^${MARK}` } });
  await collections.contactRequests.deleteMany({ testMarker: MARK });
  await collections.tags.deleteMany({ testMarker: MARK });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("a browser is named in a few words, never stored whole", () => {
  assert.equal(browserLabel(CHROME_WINDOWS), "Chrome · Windows");
  assert.equal(browserLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15"), "Safari · macOS");
  assert.equal(browserLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36 Edg/129.0"), "Edge · Windows");
  assert.equal(browserLabel("Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile Safari/537.36"), "Chrome · Android");
  assert.equal(browserLabel(""), null);
});

test("a sign-in is logged, and stamps the admin's last sign-in", async () => {
  const res = await login(PASSWORD);
  assert.equal(res.statusCode, 200);

  const row = await waitFor(() => collections.adminAudit.findOne({ email: ADMIN_EMAIL, event: "login" }), "login row");
  assert.equal(row.method, "password");
  assert.equal(row.browser, "Chrome · Windows");
  assert.ok(row.ip);
  assert.ok(row.at instanceof Date, "a real Date, so the 90-day TTL applies");
  assert.equal(row.userAgent, undefined, "the full user agent is not kept");

  const admin = await waitFor(async () => {
    const a = await collections.admins.findOne({ _id: adminId });
    return a.lastSignInAt ? a : null;
  }, "lastSignInAt");
  assert.ok(admin.lastSignInAt instanceof Date);
});

test("repeated failures from one address fold into one row with a count", async () => {
  const address = uniqueAddress();
  for (let i = 0; i < 3; i++) assert.equal((await login("wrong-password-1", address)).statusCode, 401);

  const rows = await waitFor(async () => {
    const found = await collections.adminAudit.find({ email: ADMIN_EMAIL, event: "login_failed", ip: address }).toArray();
    return found.reduce((n, r) => n + r.count, 0) === 3 ? found : null;
  }, "three failures counted");
  // One row, or two if the attempts straddled a minute boundary.
  assert.ok(rows.length <= 2);
  assert.equal(rows[0].reason, "invalid");
});

test("signing out is logged; a signed-out visitor signing out logs nothing", async () => {
  const res = await login(PASSWORD);
  const cookie = res.headers["set-cookie"];
  const before = await collections.adminAudit.countDocuments({ email: ADMIN_EMAIL, event: "logout" });

  assert.equal((await call("POST", "/api/auth/logout", cookie)).statusCode, 200);
  await waitFor(async () => (await collections.adminAudit.countDocuments({ email: ADMIN_EMAIL, event: "logout" })) === before + 1, "logout row");

  const total = await collections.adminAudit.countDocuments({});
  await call("POST", "/api/auth/logout");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await collections.adminAudit.countDocuments({}), total);
});

test("the log is admin-only, newest first, paged and filterable", async () => {
  const anon = await call("GET", "/api/admin/audit");
  assert.ok([401, 403].includes(anon.statusCode));

  const cookie = (await login(PASSWORD)).headers["set-cookie"];
  await waitFor(async () => (await collections.adminAudit.countDocuments({ email: ADMIN_EMAIL, event: "login" })) >= 3, "logins");

  const res = await call("GET", `/api/admin/audit?email=${encodeURIComponent(ADMIN_EMAIL.toUpperCase())}`, cookie);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.pageSize, 100);
  assert.equal(body.page, 1);
  assert.ok(body.events.length >= 3);
  assert.ok(body.events.every((e) => e.email === ADMIN_EMAIL), "the filter applies (case-insensitively)");
  const times = body.events.map((e) => new Date(e.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");
  assert.ok(body.events.every((e) => !("adminId" in e)));

  const admins = (await call("GET", "/api/admin/admins", cookie)).json().admins;
  assert.ok(admins.find((a) => a.email === ADMIN_EMAIL).lastSignInAt, "the admin list shows the last sign-in");
});

test("a failed log write never breaks or rejects", async () => {
  const broken = {
    adminAudit: { insertOne: () => Promise.reject(new Error("db down")), updateOne: () => Promise.reject(new Error("db down")) },
    admins: { updateOne: () => Promise.reject(new Error("db down")) }
  };
  const request = { ip: "10.0.0.1", headers: {}, log: { warn() {} } };
  await recordAdminEvent(broken, { event: "login", adminId: String(adminId), email: ADMIN_EMAIL, request });
  await recordAdminEvent(broken, { event: "login_failed", email: ADMIN_EMAIL, request });
  await recordAdminEvent({}, { event: "login", email: ADMIN_EMAIL, request });
  await recordAdminEvent(collections, { event: "not_an_event", email: ADMIN_EMAIL, request });
  assert.equal(await collections.adminAudit.countDocuments({ event: "not_an_event" }), 0);
});

test("rows expire after 90 days through a TTL index", async () => {
  await ensureCoreIndexes(collections, { info() {}, warn() {}, error() {}, debug() {} });
  const indexes = await collections.adminAudit.indexes();
  const ttl = indexes.find((i) => i.key.at === 1 && i.expireAfterSeconds != null);
  assert.ok(ttl, "TTL index on at");
  assert.equal(ttl.expireAfterSeconds, ADMIN_AUDIT_RETENTION_SECONDS);
  assert.equal(ADMIN_AUDIT_RETENTION_SECONDS, 90 * 24 * 60 * 60);
});

test("the Activity feed names a tag by plate and serial, never its QR token", async () => {
  const token = `${MARK}tok${"0".repeat(20)}`;
  await collections.tags.insertOne({
    token, status: "active", plateNumber: "KA05AU0001", batchNumber: "09", serialNumber: 42,
    testMarker: MARK, createdAt: new Date().toISOString()
  });
  await collections.contactRequests.insertOne({
    token, action: "call", status: "completed", testMarker: MARK, createdAt: new Date(Date.now() + 60_000).toISOString()
  });
  const cookie = (await login(PASSWORD)).headers["set-cookie"];
  const res = await call("GET", "/api/admin/activity?limit=5", cookie);
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes(token), "the token appears nowhere in the response");
  const row = res.json().activity.find((a) => a.plateNumber === "KA05AU0001");
  assert.ok(row, "the request is listed");
  assert.equal(row.serial, "PT-09-000042");
  assert.equal(row.token, undefined);
});
