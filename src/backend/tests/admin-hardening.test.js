// Admin sign-in hardening: a bot check on the password sign-in, a 12-character
// minimum for new admin passwords, admin sessions that end after 12 hours
// (including ones issued before the limit), and admins added or removed
// showing up in the sign-in log.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const HOUR = 60 * 60 * 1000;
const PASSWORD = "Hardening-Test-Pass-1";
const ACTOR = "hardening-actor-admin@parktag.test";
const CREATED = "hardening-created-admin@parktag.test";
const SHORT = "hardening-short-admin@parktag.test";
const OWNER_EMAIL = "hardening-owner@parktag.test";
const EMAILS = [ACTOR, CREATED, SHORT];
const OLD_SESSION_IDS = ["hardeningoldadminsession", "hardeningoldownersession"];

// Google's verify endpoint, stubbed: the token names the answer.
const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const VERDICTS = {
  human: { success: true, score: 0.9, action: "admin_login" },
  bot: { success: true, score: 0.1, action: "admin_login" },
  replayed: { success: true, score: 0.9, action: "send_otp" }
};
const realFetch = globalThis.fetch;

let app;
let collections;
let actorId;
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

function adminLogin(payload) {
  return call("POST", "/api/auth/admin/login", { payload });
}

before(async () => {
  // Configured keys for this app only (the helpers clear ambient ones on import).
  process.env.RECAPTCHA_SITE_KEY = "test-site-key";
  process.env.RECAPTCHA_SECRET = "test-secret";
  globalThis.fetch = async (url, options) => {
    if (String(url) === VERIFY_URL) {
      const token = new URLSearchParams(String(options?.body || "")).get("response");
      return new Response(JSON.stringify(VERDICTS[token] || { success: false, "error-codes": ["invalid-input-response"] }), {
        headers: { "content-type": "application/json" }
      });
    }
    return realFetch(url, options);
  };

  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.admins.deleteMany({ email: { $in: EMAILS } });
  await collections.owners.deleteMany({ email: OWNER_EMAIL });

  const { insertedId } = await collections.admins.insertOne({
    email: ACTOR,
    passwordHash: await createPasswordHash(PASSWORD),
    displayName: "Hardening Actor",
    role: "admin",
    createdAt: new Date().toISOString()
  });
  actorId = String(insertedId);
  ({ insertedId: ownerId } = await collections.owners.insertOne({
    email: OWNER_EMAIL,
    displayName: "Hardening Owner",
    role: "owner",
    createdAt: new Date().toISOString()
  }));
});

after(async () => {
  globalThis.fetch = realFetch;
  delete process.env.RECAPTCHA_SITE_KEY;
  delete process.env.RECAPTCHA_SECRET;
  await collections.admins.deleteMany({ email: { $in: EMAILS } });
  await collections.owners.deleteMany({ _id: ownerId });
  await collections.sessions.deleteMany({ $or: [{ userId: actorId }, { _id: { $in: OLD_SESSION_IDS } }] });
  await collections.adminAudit.deleteMany({ $or: [{ email: { $in: EMAILS } }, { target: { $in: EMAILS } }] });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("admin sign-in: a low bot score or a token minted for another action is refused", async () => {
  for (const token of ["bot", "replayed", "forged"]) {
    const response = await adminLogin({ email: ACTOR, password: PASSWORD, recaptchaToken: token });
    assert.equal(response.statusCode, 400, `token "${token}"`);
    assert.match(response.json().error, /Continue with Google/);
    assert.equal(response.headers["set-cookie"], undefined, "no session for a refused sign-in");
  }

  // Awaited indirectly: the log write is fire-and-forget.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const row = await collections.adminAudit.findOne({ event: "login_failed", email: ACTOR, reason: "bot_check" });
  assert.ok(row, "a refused bot check is in the sign-in log");
});

test("admin sign-in: a human score signs in, and the password is still checked", async () => {
  const wrong = await adminLogin({ email: ACTOR, password: "not-the-password", recaptchaToken: "human" });
  assert.equal(wrong.statusCode, 401, "passing the bot check does not skip the password");

  const right = await adminLogin({ email: ACTOR, password: PASSWORD, recaptchaToken: "human" });
  assert.equal(right.statusCode, 200);
});

test("admin sessions last 12 hours; the cookie ends with the browser even with rememberMe", async () => {
  const response = await adminLogin({ email: ACTOR, password: PASSWORD, recaptchaToken: "human", rememberMe: true });
  assert.equal(response.statusCode, 200);
  const setCookie = String(response.headers["set-cookie"]);
  assert.doesNotMatch(setCookie, /Max-Age|Expires/i, "an admin cookie is never persistent");

  const sessionId = setCookie.match(/wavetag_session=([^;]+)/)[1];
  const doc = await collections.sessions.findOne({ _id: sessionId });
  const lifetime = doc.expiresAt.getTime() - new Date(doc.createdAt).getTime();
  assert.ok(Math.abs(lifetime - 12 * HOUR) < 5000, `admin session lifetime was ${lifetime}ms`);
});

test("an admin session issued before the limit ends 12 hours after it began; an owner's does not", async () => {
  const thirteenHoursAgo = new Date(Date.now() - 13 * HOUR);
  const sixDaysAhead = new Date(Date.now() + 6 * 24 * HOUR);
  await collections.sessions.insertMany([
    { _id: OLD_SESSION_IDS[0], userId: actorId, role: "admin", email: ACTOR, createdAt: thirteenHoursAgo, expiresAt: sixDaysAhead },
    { _id: OLD_SESSION_IDS[1], userId: String(ownerId), role: "owner", email: OWNER_EMAIL, createdAt: thirteenHoursAgo, expiresAt: sixDaysAhead }
  ]);

  const admin = await call("GET", "/api/admin/me", { cookie: `wavetag_session=${OLD_SESSION_IDS[0]}` });
  assert.equal(admin.statusCode, 401);

  const owner = await call("GET", "/api/session", { cookie: `wavetag_session=${OLD_SESSION_IDS[1]}` });
  assert.equal(owner.json().session?.role, "owner", "owners keep theirs");

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await collections.sessions.countDocuments({ _id: OLD_SESSION_IDS[0] }), 0, "the expired admin row is cleared");
});

test("new admin passwords need 12 characters", async () => {
  const cookie = (await adminLogin({ email: ACTOR, password: PASSWORD, recaptchaToken: "human" })).headers["set-cookie"];

  const short = await call("POST", "/api/admin/admins", {
    cookie,
    payload: { email: SHORT, password: "elevenchars", displayName: "Short" }
  });
  assert.equal(short.statusCode, 400);
  assert.match(short.json().error, /at least 12 characters/);
  assert.equal(await collections.admins.countDocuments({ email: SHORT }), 0);

  const ok = await call("POST", "/api/admin/admins", {
    cookie,
    payload: { email: CREATED, password: "twelve-chars", displayName: "Created" }
  });
  assert.equal(ok.statusCode, 200);
});

test("adding and removing an admin is in the sign-in log, with who did it", async () => {
  const cookie = (await adminLogin({ email: ACTOR, password: PASSWORD, recaptchaToken: "human" })).headers["set-cookie"];
  const created = await collections.admins.findOne({ email: CREATED });
  assert.ok(created, "created by the previous test");

  const removal = await call("DELETE", `/api/admin/admins/${created._id}`, { cookie });
  assert.equal(removal.statusCode, 200);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const events = (await call("GET", `/api/admin/audit?email=${encodeURIComponent(ACTOR)}`, { cookie })).json().events;
  const added = events.find((e) => e.event === "admin_created" && e.target === CREATED);
  const removed = events.find((e) => e.event === "admin_removed" && e.target === CREATED);
  assert.ok(added, "admin_created with the new admin's email");
  assert.ok(removed, "admin_removed with the removed admin's email");
  assert.equal(added.email, ACTOR);
  assert.equal(removed.email, ACTOR);
});
