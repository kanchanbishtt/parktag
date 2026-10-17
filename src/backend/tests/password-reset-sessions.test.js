// What a password reset does to the account's sessions.
//
// A reset is the standard answer to "someone else may be in my account", so
// every session the account had must stop working, including one this very
// instance still holds in its cache. The device that did the reset is the one
// device to trust: it proved it owns the email, so it is signed in on the spot
// with a session that did not exist before the reset. Any other reset link
// still outstanding for the address is burnt at the same time, and the owner
// is told by email.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import {
  startTestApp, stopTestApp, createTestOwner, purgeLoginCollections, uniqueAddress, TEST_ORIGIN
} from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import { buildPasswordChangedEmail } from "../lib/integrations/email.js";

const EMAIL = "reset-sessions@parktag-test.invalid";
const OLD_PASSWORD = "Old-password-9f21";
const NEW_PASSWORD = "New-password-4c77";

let app;
let env;
let collections;
let owner;

before(async () => {
  ({ app, env, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.owners.deleteMany({ email: EMAIL });
  await collections.passwordResetTokens.deleteMany({ email: EMAIL });
  owner = await createTestOwner(collections, { email: EMAIL, password: OLD_PASSWORD, displayName: "Reset QA" });
});

after(async () => {
  await collections.passwordResetTokens.deleteMany({ email: EMAIL });
  await collections.owners.deleteMany({ email: EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

async function mintResetToken(suffix) {
  const token = `qa-reset-token-${suffix}-${Date.now()}`;
  const now = new Date();
  await collections.passwordResetTokens.insertOne({
    email: EMAIL,
    token,
    used: false,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString()
  });
  return token;
}

function sessionFor(cookie) {
  return app.inject({
    method: "GET",
    url: "/api/session",
    remoteAddress: uniqueAddress(),
    ...(cookie ? { cookies: { wavetag_session: cookie } } : {})
  });
}

function reset(token, password) {
  return app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    headers: { origin: TEST_ORIGIN },
    remoteAddress: uniqueAddress(),
    payload: { token, password }
  });
}

function login(password) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: TEST_ORIGIN },
    remoteAddress: uniqueAddress(),
    payload: { identifier: EMAIL, password }
  });
}

function sessionCookieFrom(response) {
  const header = [].concat(response.headers["set-cookie"] || []).find((c) => c.startsWith("wavetag_session="));
  assert.ok(header, "a session cookie was set");
  return { value: header.split(";")[0].split("=")[1], header };
}

test("a reset signs out every other device and signs this one in afresh", async () => {
  const user = { id: String(owner._id), role: "owner", email: EMAIL, displayName: owner.displayName };
  const phone = await createSession(app, { ...user, signInMethod: "password" });
  const laptop = await createSession(app, { ...user, signInMethod: "password" });
  assert.equal((await sessionFor(phone)).json().session?.role, "owner", "the phone was signed in");
  assert.equal((await sessionFor(laptop)).json().session?.role, "owner", "the laptop was signed in");

  const token = await mintResetToken("one");
  const response = await reset(token, NEW_PASSWORD);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().signedIn, true);

  // This device: a new session, not one of the old ids, with the owner cookie
  // (HttpOnly, kept for the 180-day cap like every other owner sign-in).
  const fresh = sessionCookieFrom(response);
  assert.notEqual(fresh.value, phone);
  assert.notEqual(fresh.value, laptop);
  assert.match(fresh.header, /HttpOnly/i);
  assert.match(fresh.header, /Max-Age=15552000/);
  const mine = (await sessionFor(fresh.value)).json().session;
  assert.equal(mine?.role, "owner");
  assert.equal(mine?.email, EMAIL);

  // Every other device: out, immediately, even though this instance had both
  // sessions warm in its cache a moment ago.
  assert.equal((await sessionFor(phone)).json().session, null, "the phone is signed out");
  assert.equal((await sessionFor(laptop)).json().session, null, "the laptop is signed out");
  assert.equal(await collections.sessions.countDocuments({ userId: String(owner._id) }), 1, "one session row remains: this device");

  // The password really changed.
  assert.equal((await login(OLD_PASSWORD)).statusCode, 401, "the old password is refused");
  assert.equal((await login(NEW_PASSWORD)).statusCode, 200, "the new password works");
});

test("a second reset link requested before the reset is burnt by it", async () => {
  const first = await mintResetToken("first");
  const second = await mintResetToken("second");

  assert.equal((await reset(first, "Another-password-1a2b")).statusCode, 200);

  const refused = await reset(second, "Yet-another-password-3c4d");
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().error, /already been used/);
  assert.equal(
    await collections.passwordResetTokens.countDocuments({ email: EMAIL, used: false }),
    0,
    "no live reset link survives a reset"
  );
});

test("the reset does not add a session for anyone but this device", async () => {
  // Belt and braces for the test above: after a reset the only row for the
  // account is the one whose id is in the cookie that came back.
  const token = await mintResetToken("only");
  const response = await reset(token, "Final-password-5e6f");
  assert.equal(response.statusCode, 200);
  const { value } = sessionCookieFrom(response);
  const rows = await collections.sessions.find({ userId: String(owner._id) }).toArray();
  assert.deepEqual(rows.map((r) => r._id), [value]);
});

test("the changed-password email says what happened and how to undo it", () => {
  const { subject, html } = buildPasswordChangedEmail(env, { name: "Asha <b>Rao</b>" });
  assert.equal(subject, "Your ParkTag password was changed");
  assert.match(html, /Asha &lt;b&gt;Rao&lt;\/b&gt;/, "the name is escaped, not rendered");
  assert.match(html, /Every other device was signed out/);
  assert.match(html, /If this was not you, reset your password again/);
  assert.match(html, new RegExp(`${env.appBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/forgot-password`), "the undo button goes to forgot-password");
  assert.doesNotMatch(html, /undefined/);
});
