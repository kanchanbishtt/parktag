// Owners stay signed in. Every owner sign-in sets a cookie that survives the
// browser closing (it used to end with the browser unless "Remember me" was
// ticked, and only the PIN form had that box), and the server keeps the
// session 30 days from its last use, never past 180 days from sign-in.
// Admin sessions are untouched: 12 hours, a browser-session cookie, no slide.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, createTestOwner, TEST_ORIGIN } from "./helpers.js";
import { createOtpHash } from "../lib/auth/security.js";

const DAY = 24 * 60 * 60 * 1000;
const PIN = "Stay-Signed-In-Pin-1";
const OWNER_EMAIL = "stay-signed-in-owner@parktag.invalid";
const ROW = {
  idle: "staysignedinidleownersession",
  nearCap: "staysignedinnearcapsession",
  pastCap: "staysignedinpastcapsession",
  fresh: "staysignedinfreshsession",
  admin: "staysignedinadminsession",
  noCreated: "staysignedinnocreatedsession"
};

let app;
let collections;
let ownerId;

function call(method, url, { cookie, payload } = {}) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
    ...(payload ? { payload } : {})
  });
}

function sessionCookie(response) {
  return [].concat(response.headers["set-cookie"] || []).find((c) => c.startsWith("wavetag_session="));
}

// The slide is fire-and-forget; give it a moment to land.
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

async function expiryOf(id) {
  const row = await collections.sessions.findOne({ _id: id });
  return row ? new Date(row.expiresAt).getTime() : null;
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  ({ _id: ownerId } = await createTestOwner(collections, { email: OWNER_EMAIL, password: PIN }));
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("a PIN sign-in keeps the owner signed in after the browser closes", async () => {
  const response = await call("POST", "/api/auth/login", { payload: { identifier: OWNER_EMAIL, pin: PIN } });
  assert.equal(response.statusCode, 200, response.body);

  const cookie = sessionCookie(response);
  assert.match(cookie, /Max-Age=15552000/, "the cookie lasts as long as the 180-day cap");
  assert.match(cookie, /HttpOnly/);

  const id = cookie.match(/wavetag_session=([^;]+)/)[1];
  const row = await collections.sessions.findOne({ _id: id });
  const lifetime = row.expiresAt.getTime() - new Date(row.createdAt).getTime();
  assert.ok(Math.abs(lifetime - 30 * DAY) < 5000, `owner session lifetime was ${lifetime}ms`);
});

test("a rememberMe: false from an older page does not shorten the cookie", async () => {
  const response = await call("POST", "/api/auth/login", { payload: { identifier: OWNER_EMAIL, pin: PIN, rememberMe: false } });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(sessionCookie(response), /Max-Age=15552000/);
});

test("a code sign-in keeps the owner signed in too", async () => {
  const now = new Date();
  await collections.otpTokens.deleteMany({ identifier: OWNER_EMAIL });
  await collections.otpTokens.insertOne({
    identifier: OWNER_EMAIL,
    codeHash: await createOtpHash("482916"),
    used: false,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
  });

  const response = await call("POST", "/api/auth/verify-otp", { payload: { identifier: OWNER_EMAIL, code: "482916" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(sessionCookie(response), /Max-Age=15552000/);
});

test("using the dashboard pushes the session out to 30 days from now", async () => {
  await collections.sessions.insertOne({
    _id: ROW.idle, userId: String(ownerId), role: "owner", email: OWNER_EMAIL,
    createdAt: new Date(Date.now() - 10 * DAY), expiresAt: new Date(Date.now() + 20 * DAY)
  });

  const response = await call("GET", "/api/session", { cookie: `wavetag_session=${ROW.idle}` });
  assert.equal(response.json().session?.role, "owner");

  await settle();
  const remaining = (await expiryOf(ROW.idle)) - Date.now();
  assert.ok(Math.abs(remaining - 30 * DAY) < 60 * 1000, `expiry is ${remaining / DAY} days away`);
});

test("the slide stops at 180 days from sign-in", async () => {
  const createdAt = new Date(Date.now() - 175 * DAY);
  await collections.sessions.insertOne({
    _id: ROW.nearCap, userId: String(ownerId), role: "owner", email: OWNER_EMAIL,
    createdAt, expiresAt: new Date(Date.now() + 2 * DAY)
  });

  await call("GET", "/api/session", { cookie: `wavetag_session=${ROW.nearCap}` });
  await settle();
  assert.equal(await expiryOf(ROW.nearCap), createdAt.getTime() + 180 * DAY);
});

test("a session older than 180 days is over, whatever its expiry says", async () => {
  await collections.sessions.insertOne({
    _id: ROW.pastCap, userId: String(ownerId), role: "owner", email: OWNER_EMAIL,
    createdAt: new Date(Date.now() - 181 * DAY), expiresAt: new Date(Date.now() + 5 * DAY)
  });

  const response = await call("GET", "/api/session", { cookie: `wavetag_session=${ROW.pastCap}` });
  assert.equal(response.json().session, null);

  await settle();
  assert.equal(await collections.sessions.countDocuments({ _id: ROW.pastCap }), 0, "the dead row is cleared");
});

test("a session renewed under a day ago is not written again", async () => {
  const expiresAt = new Date(Date.now() + 30 * DAY - 60 * 60 * 1000);
  await collections.sessions.insertOne({
    _id: ROW.fresh, userId: String(ownerId), role: "owner", email: OWNER_EMAIL,
    createdAt: new Date(Date.now() - 60 * 60 * 1000), expiresAt
  });

  await call("GET", "/api/session", { cookie: `wavetag_session=${ROW.fresh}` });
  await settle();
  assert.equal(await expiryOf(ROW.fresh), expiresAt.getTime());
});

test("admin sessions and rows with no sign-in time never slide", async () => {
  const adminExpiry = new Date(Date.now() + 11 * 60 * 60 * 1000);
  const legacyExpiry = new Date(Date.now() + 2 * DAY);
  await collections.sessions.insertMany([
    { _id: ROW.admin, userId: "stay-signed-in-admin", role: "admin", email: "a@parktag.invalid",
      createdAt: new Date(Date.now() - 60 * 60 * 1000), expiresAt: adminExpiry },
    { _id: ROW.noCreated, userId: String(ownerId), role: "owner", email: OWNER_EMAIL, expiresAt: legacyExpiry }
  ]);

  await call("GET", "/api/session", { cookie: `wavetag_session=${ROW.admin}` });
  const legacy = await call("GET", "/api/session", { cookie: `wavetag_session=${ROW.noCreated}` });
  assert.equal(legacy.json().session?.role, "owner", "the legacy row still works until its own expiry");

  await settle();
  assert.equal(await expiryOf(ROW.admin), adminExpiry.getTime());
  assert.equal(await expiryOf(ROW.noCreated), legacyExpiry.getTime());
});

test("signing out still ends the session", async () => {
  const login = await call("POST", "/api/auth/login", { payload: { identifier: OWNER_EMAIL, pin: PIN } });
  const cookie = sessionCookie(login).split(";")[0];

  await call("POST", "/api/auth/logout", { cookie });
  const after = await call("GET", "/api/session", { cookie });
  assert.equal(after.json().session, null);
});
