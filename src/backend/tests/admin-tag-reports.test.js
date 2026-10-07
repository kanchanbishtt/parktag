// The admin Tag Reports page: what a scanner reported through the public form
// is listed for an admin with the sticker and owner it concerns, filtered by
// status, searchable, and can be resolved (with a note) or reopened. Nothing
// is deleted. The overview counts the open ones.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "admin-tag-reports@parktag.test";
const PASSWORD = "test-password-123";
const MARK = `tagrep${Date.now()}`;

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

function anon(method, url, payload) {
  return app.inject({ method, url, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN }, ...(payload ? { payload } : {}) });
}

async function insertOwner(overrides = {}) {
  const { insertedId } = await collections.owners.insertOne({
    displayName: `Owner ${MARK}`,
    email: `${MARK}-${seq++}@parktag.test`,
    mobile: `+9198${String(seq).padStart(8, "0")}`,
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
    serialNumber: 660000 + seq,
    batchNumber: `${MARK}-batch`,
    ownerId: null,
    status: "active",
    premium: true,
    plateNumber: `DL14${MARK.slice(-4).toUpperCase()}${seq}`,
    vehicleLabel: "Car",
    testMarker: MARK,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

async function insertReport(tag, overrides = {}) {
  const { insertedId } = await collections.tagReports.insertOne({
    token: tag.token,
    tagId: tag._id,
    ownerId: tag.ownerId || null,
    reason: "wrong_number",
    details: null,
    reporterName: `Reporter ${MARK}`,
    reporterPhone: "+919700000001",
    status: "open",
    ipHash: "x",
    createdAt: new Date(Date.now() - seq++ * 1000).toISOString(),
    testMarker: MARK,
    ...overrides
  });
  return insertedId;
}

async function list(query = "") {
  const response = await authed("GET", `/api/admin/tag-reports${query}`);
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  return { ...body, mine: body.reports.filter((r) => String(r.reporterName || "").includes(MARK) || (r.tag && String(r.tag.plateNumber || "").includes(MARK.slice(-4).toUpperCase()))) };
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
  assert.equal(login.statusCode, 200);
  adminCookie = login.headers["set-cookie"];
});

after(async () => {
  await collections.tagReports.deleteMany({ testMarker: MARK });
  await collections.tagReports.deleteMany({ reporterName: `Form ${MARK}` });
  await collections.tags.deleteMany({ testMarker: MARK });
  await collections.owners.deleteMany({ testMarker: MARK });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("the reports endpoints are admin-only", async () => {
  for (const [method, url, payload] of [
    ["GET", "/api/admin/tag-reports"],
    ["POST", `/api/admin/tag-reports/${new ObjectId()}/status`, { status: "resolved" }]
  ]) {
    const response = await anon(method, url, payload);
    assert.ok([401, 403].includes(response.statusCode), `${method} ${url} must refuse, got ${response.statusCode}`);
  }
  const page = await anon("GET", "/admin/tag-reports");
  assert.equal(page.statusCode, 302, "the page itself redirects a stranger to the sign-in");
});

test("a report submitted through the public form appears on the admin page with its sticker and owner", async () => {
  const owner = await insertOwner({ displayName: `Priya ${MARK}`, mobile: "+919811000777" });
  const tag = await insertTag({ ownerId: owner, plateNumber: `HR26${MARK.slice(-4).toUpperCase()}9` });

  const submitted = await anon("POST", `/api/tags/${tag.token}/report`, {
    reason: "sold",
    details: "I bought this car last month, the old owner's number is on it.",
    name: `Form ${MARK}`,
    phone: "9876501234"
  });
  assert.equal(submitted.statusCode, 200, submitted.body);

  const stored = await collections.tagReports.findOne({ reporterName: `Form ${MARK}` });
  assert.ok(stored, "the report is in MongoDB");
  assert.equal(stored.status, "open");
  assert.equal(stored.reporterPhone, "+919876501234");

  const body = await list();
  const row = body.reports.find((r) => r.id === String(stored._id));
  assert.ok(row, "and on the admin page");
  assert.equal(row.reason, "sold");
  assert.equal(row.reasonLabel, "Vehicle sold on");
  assert.equal(row.reporterName, `Form ${MARK}`);
  assert.equal(row.reporterPhone, "+919876501234");
  assert.equal(row.status, "open");
  assert.equal(row.tag.plateNumber, tag.plateNumber);
  assert.equal(row.tag.id, String(tag._id));
  assert.equal(row.owner.name, `Priya ${MARK}`);
  assert.equal(row.owner.mobile, "+919811000777");
  assert.ok(body.counts.open >= 1);
});

test("open first; resolved and all are their own views; search finds plate, reporter and text", async () => {
  const owner = await insertOwner();
  const tagA = await insertTag({ ownerId: owner, plateNumber: `UP16${MARK.slice(-4).toUpperCase()}1` });
  const tagB = await insertTag({ ownerId: owner, plateNumber: `KA05${MARK.slice(-4).toUpperCase()}2` });
  const openId = await insertReport(tagA, { reason: "no_answer", details: `never picks up ${MARK}-needle` });
  const resolvedId = await insertReport(tagB, { reason: "abuse", status: "resolved", resolvedAt: new Date().toISOString(), resolvedBy: "someone@parktag.test", reporterName: `Other ${MARK}`, reporterPhone: "+919700000099" });

  const open = await list("?status=open");
  assert.ok(open.reports.some((r) => r.id === String(openId)));
  assert.ok(!open.reports.some((r) => r.id === String(resolvedId)), "a resolved report is not in the open view");

  const resolved = await list("?status=resolved");
  assert.ok(resolved.reports.some((r) => r.id === String(resolvedId)));
  assert.ok(!resolved.reports.some((r) => r.id === String(openId)));

  const all = await list("?status=all");
  assert.ok(all.reports.some((r) => r.id === String(openId)) && all.reports.some((r) => r.id === String(resolvedId)));
  assert.equal(all.counts.total, all.counts.open + all.counts.resolved);

  const byPlate = await list(`?status=all&q=${encodeURIComponent(tagB.plateNumber)}`);
  assert.deepEqual(byPlate.reports.map((r) => r.id), [String(resolvedId)], "search by the reported plate");
  const byText = await list(`?status=all&q=${encodeURIComponent(`${MARK}-needle`)}`);
  assert.deepEqual(byText.reports.map((r) => r.id), [String(openId)], "search in the free text");
  const byReporter = await list(`?status=all&q=${encodeURIComponent("9700000099")}`);
  assert.ok(byReporter.reports.some((r) => r.id === String(resolvedId)), "search by the reporter's number");
});

test("resolving records who, when and a note; reopening clears them; the overview counts the open ones", async () => {
  const owner = await insertOwner();
  const tag = await insertTag({ ownerId: owner });
  const id = await insertReport(tag, { reason: "other" });

  const before = (await authed("GET", "/api/admin/overview/summary")).json().summary.reports.open;

  const resolve = await authed("POST", `/api/admin/tag-reports/${id}/status`, { status: "resolved", note: "Called the reporter; sticker belongs to the previous owner, paused it." });
  assert.equal(resolve.statusCode, 200, resolve.body);
  assert.equal(resolve.json().resolvedBy, ADMIN_EMAIL);

  let stored = await collections.tagReports.findOne({ _id: id });
  assert.equal(stored.status, "resolved");
  assert.equal(stored.resolvedBy, ADMIN_EMAIL);
  assert.ok(stored.resolvedAt);
  assert.equal(stored.note, "Called the reporter; sticker belongs to the previous owner, paused it.");

  const after = (await authed("GET", "/api/admin/overview/summary")).json().summary.reports.open;
  assert.equal(before - after, 1, "one fewer open report on the overview");

  const reopen = await authed("POST", `/api/admin/tag-reports/${id}/status`, { status: "open" });
  assert.equal(reopen.statusCode, 200);
  stored = await collections.tagReports.findOne({ _id: id });
  assert.equal(stored.status, "open");
  assert.equal(stored.resolvedAt, null);
  assert.equal(stored.note, "Called the reporter; sticker belongs to the previous owner, paused it.", "the note is kept as history");

  const bad = await authed("POST", `/api/admin/tag-reports/${id}/status`, { status: "deleted" });
  assert.equal(bad.statusCode, 400);
  const missing = await authed("POST", `/api/admin/tag-reports/${new ObjectId()}/status`, { status: "resolved" });
  assert.equal(missing.statusCode, 404);
  assert.ok(await collections.tagReports.findOne({ _id: id }), "nothing is ever deleted");
});
