// Regression tests for the security controls on the owner login path.
//
// These do not hunt for new vulnerabilities. Each one pins a property that a QA
// pass found already holding, so that a later refactor cannot quietly undo it.
// Every assertion here corresponds to a control that is cheap to break by
// accident and expensive to notice in production:
//
//   - an operator object reaching a Mongo filter (auth bypass)
//   - a failure response that distinguishes "no such account" from "wrong
//     password" (account enumeration)
//   - a session id echoed to client-side JavaScript (XSS → session theft)
//   - a login that reuses an attacker-supplied session id (fixation)
//   - an OTP that survives past its attempt cap or its expiry (brute force)
//   - a redirect parameter that will send a visitor off-site (phishing)
//
// Scope is the login path only: /api/auth/login, /api/auth/verify-otp,
// /api/session, and the /owner-login page itself.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  clearLoginLock,
  uniqueAddress
} from "./helpers.js";

const PASSWORD = "QA-fixture-password-9f3a";
const OWNER_EMAIL = "qa-login-fixture@parktag-test.invalid";

let app;
let collections;

before(async () => {
  ({ app, collections } = await startTestApp());
  // Start from a known-empty state as well as finishing at one, so a run that
  // was killed part-way through cannot leave fixtures that skew the next run.
  await purgeLoginCollections(collections);
  await createTestOwner(collections, { email: OWNER_EMAIL, password: PASSWORD });
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

function login(payload, { address = uniqueAddress() } = {}) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: address,
    payload
  });
}

describe("NoSQL operator injection is rejected, not evaluated", () => {
  // `email` and `password` reach a Mongo filter. If either is allowed through as
  // an object, `{"$ne": null}` matches the first document in the collection and
  // authenticates as somebody. The guard is isNonEmptyString() in
  // lib/auth/auth.js — this asserts the behaviour, not the implementation.
  const payloads = {
    "email as an operator object": {
      role: "owner",
      email: { $ne: null },
      password: PASSWORD
    },
    "password as an operator object": {
      role: "owner",
      email: OWNER_EMAIL,
      password: { $ne: null }
    },
    "role as an operator object": {
      role: { $ne: "nobody" },
      email: OWNER_EMAIL,
      password: { $ne: null }
    },
    "email as an array": {
      role: "owner",
      email: [OWNER_EMAIL],
      password: PASSWORD
    },
    "regex operator in email": {
      role: "owner",
      email: { $regex: ".*" },
      password: PASSWORD
    }
  };

  for (const [name, payload] of Object.entries(payloads)) {
    test(name, async () => {
      const response = await login(payload);

      assert.notEqual(
        response.statusCode,
        200,
        "operator object authenticated — NoSQL injection is reachable"
      );
      assert.equal(response.statusCode, 401);

      const setCookie = response.headers["set-cookie"];
      assert.equal(
        setCookie,
        undefined,
        "a rejected login must not issue a session cookie"
      );
    });
  }
});

describe("failed logins do not reveal whether an account exists", () => {
  test("unknown account and wrong password are byte-identical", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);

    const unknown = await login({
      role: "owner",
      email: "qa-no-such-account@parktag-test.invalid",
      password: "wrong-password"
    });
    const wrongPassword = await login({
      role: "owner",
      email: OWNER_EMAIL,
      password: "wrong-password"
    });

    assert.equal(unknown.statusCode, wrongPassword.statusCode);
    assert.equal(
      unknown.body,
      wrongPassword.body,
      "response body differs between an unknown account and a wrong password — " +
        "this enumerates registered users"
    );

    await clearLoginLock(collections, OWNER_EMAIL);
  });
});

describe("the session cookie stays out of reach of page scripts", () => {
  test("a successful login sets an httpOnly cookie", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await login({
      role: "owner",
      email: OWNER_EMAIL,
      password: PASSWORD
    });

    assert.equal(response.statusCode, 200, `login failed: ${response.body}`);

    const cookie = response.cookies.find((c) => c.name === "wavetag_session");
    assert.ok(cookie, "no session cookie was set on a successful login");
    assert.equal(cookie.httpOnly, true, "session cookie is readable by document.cookie");
    assert.equal(cookie.path, "/");
    assert.ok(cookie.sameSite, "session cookie has no SameSite attribute");
  });

  test("/api/session never returns the session id or the user id", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);

    const loggedIn = await login({
      role: "owner",
      email: OWNER_EMAIL,
      password: PASSWORD
    });
    const cookie = loggedIn.cookies.find((c) => c.name === "wavetag_session");
    assert.ok(cookie, "precondition failed: no session cookie to test with");

    const response = await app.inject({
      method: "GET",
      url: "/api/session",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie.value }
    });

    assert.equal(response.statusCode, 200);
    const { session } = response.json();
    assert.ok(session, "session should be readable with a valid cookie");

    // The cookie value IS the bearer token. Echoing it back to JavaScript
    // defeats the httpOnly flag entirely.
    assert.equal(session.id, undefined, "/api/session leaked the session id");
    assert.equal(session.userId, undefined, "/api/session leaked the user id");
    assert.ok(
      !response.body.includes(cookie.value),
      "the session id appears somewhere in the /api/session response body"
    );
  });
});

describe("logging in does not adopt an attacker-supplied session", () => {
  test("a pre-set cookie value is replaced, not reused", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);
    const planted = "a".repeat(48);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: planted },
      payload: { role: "owner", email: OWNER_EMAIL, password: PASSWORD }
    });

    assert.equal(response.statusCode, 200, `login failed: ${response.body}`);
    const cookie = response.cookies.find((c) => c.name === "wavetag_session");
    assert.ok(cookie, "login did not issue a fresh session cookie");
    assert.notEqual(
      cookie.value,
      planted,
      "login adopted the session id supplied by the caller — session fixation"
    );
  });

  test("two logins never share a session id", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);
    const first = await login({ role: "owner", email: OWNER_EMAIL, password: PASSWORD });
    await clearLoginLock(collections, OWNER_EMAIL);
    const second = await login({ role: "owner", email: OWNER_EMAIL, password: PASSWORD });

    const a = first.cookies.find((c) => c.name === "wavetag_session")?.value;
    const b = second.cookies.find((c) => c.name === "wavetag_session")?.value;

    assert.ok(a && b, "expected a session cookie from both logins");
    assert.notEqual(a, b, "two logins produced the same session id");
    assert.ok(a.length >= 32, `session id is only ${a.length} chars — too little entropy`);
  });
});

// OTP tokens are seeded straight into the collection rather than requested
// through /api/auth/send-otp. Going through the real endpoint would dispatch an
// actual WhatsApp message or email on every test run, and the properties under
// test — the attempt cap and the expiry — belong to verification, not delivery.
const OTP_IDENTIFIER = "qa-otp-fixture@parktag-test.invalid";
const EXPIRED_IDENTIFIER = "qa-otp-expired@parktag-test.invalid";

async function seedOtp(identifier, code, { expiresInMs = 10 * 60 * 1000 } = {}) {
  await collections.otpTokens.deleteMany({ identifier });
  const now = new Date();
  await collections.otpTokens.insertOne({
    identifier,
    code,
    used: false,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInMs).toISOString()
  });
}

function verifyOtpRequest(identifier, code) {
  return app.inject({
    method: "POST",
    url: "/api/auth/verify-otp",
    remoteAddress: uniqueAddress(),
    payload: { identifier, code }
  });
}

describe("OTP verification is bounded", () => {
  test("the attempt cap burns the token before the code space is searchable", async () => {
    await seedOtp(OTP_IDENTIFIER, "123456");

    // Five wrong guesses are allowed; the sixth must not be evaluated at all.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await verifyOtpRequest(OTP_IDENTIFIER, "000000");
      assert.equal(
        response.statusCode,
        400,
        `attempt ${attempt} should be rejected as a bad code`
      );
    }

    // The correct code must now fail too — the token is spent, not merely
    // rate limited. If this passes, the cap can be reset by guessing correctly.
    const withCorrectCode = await verifyOtpRequest(OTP_IDENTIFIER, "123456");
    assert.notEqual(
      withCorrectCode.statusCode,
      200,
      "the correct code still worked after the attempt cap was exhausted"
    );

    const record = await collections.otpTokens.findOne({ identifier: OTP_IDENTIFIER });
    assert.equal(record.used, true, "the exhausted token was left usable");
  });

  test("an expired code is refused", async () => {
    await seedOtp(EXPIRED_IDENTIFIER, "654321", { expiresInMs: -1000 });

    const response = await verifyOtpRequest(EXPIRED_IDENTIFIER, "654321");

    assert.notEqual(response.statusCode, 200, "an expired OTP was accepted");
    assert.equal(response.statusCode, 400);
    assert.equal(
      response.headers["set-cookie"],
      undefined,
      "an expired OTP issued a session cookie"
    );
  });

  test("a malformed identifier is a 400, not a 500", async () => {
    // A 500 here means the operator object reached string handling. The
    // distinction matters: 400 is a rejection, 500 is an unhandled path.
    for (const identifier of [{ $ne: null }, ["a"], 12345, null]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/verify-otp",
        remoteAddress: uniqueAddress(),
        payload: { identifier, code: "123456" }
      });
      assert.equal(
        response.statusCode,
        400,
        `identifier ${JSON.stringify(identifier)} produced ${response.statusCode}`
      );
    }
  });
});

describe("the login page does not redirect off-site", () => {
  test("?next= cannot drive a redirect to another origin", async () => {
    const hostile = [
      "https://evil.example.com",
      "//evil.example.com",
      "/\\evil.example.com",
      "javascript:alert(1)"
    ];

    for (const next of hostile) {
      const response = await app.inject({
        method: "GET",
        url: `/owner-login?next=${encodeURIComponent(next)}`,
        remoteAddress: uniqueAddress()
      });

      assert.ok(
        response.statusCode < 300 || response.statusCode >= 400,
        `next=${next} produced a ${response.statusCode} redirect`
      );

      const location = response.headers.location;
      if (location) {
        assert.ok(
          !/^([a-z]+:)?\/\//i.test(location) && !location.startsWith("javascript:"),
          `next=${next} redirected off-origin to ${location}`
        );
      }
    }
  });
});
