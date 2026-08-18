// Tests for the three HIGH findings from the login-page QA pass.
//
// Separate from login-security.test.js on purpose: that file pins behaviour
// that was already correct, this one pins behaviour that was changed. Keeping
// them apart means a revert of the fixes fails here and leaves the other suite
// green, which localises the breakage.
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
import { createPasswordHash, verifyPassword } from "../lib/auth/security.js";
import { loginUser } from "../lib/auth/auth.js";

const PASSWORD = "QA-hardening-password-4c81";
const OWNER_EMAIL = "qa-hardening-owner@parktag-test.invalid";
const ADMIN_EMAIL = "qa-hardening-admin@parktag-test.invalid";
// Registered through the OTP flow, so the record has no passwordHash at all.
const OTP_ONLY_EMAIL = "qa-hardening-otponly@parktag-test.invalid";
const UNKNOWN_EMAIL = "qa-hardening-nobody@parktag-test.invalid";

let app;
let collections;
let env;

before(async () => {
  ({ app, collections, env } = await startTestApp());
  await purgeLoginCollections(collections);

  await createTestOwner(collections, { email: OWNER_EMAIL, password: PASSWORD });
  await collections.owners.insertOne({
    email: OTP_ONLY_EMAIL,
    role: "owner",
    mobileVerified: true,
    createdAt: new Date().toISOString()
  });
  await collections.admins.insertOne({
    email: ADMIN_EMAIL,
    role: "admin",
    passwordHash: await createPasswordHash(PASSWORD),
    createdAt: new Date().toISOString()
  });
});

after(async () => {
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

function post(url, payload, address = uniqueAddress()) {
  return app.inject({ method: "POST", url, remoteAddress: address, payload });
}

// Timing assertions are measured at the layer the invariant lives in, NOT over
// HTTP. A request to /api/auth/login makes about four database round trips (the
// lockout read, the account lookup, the failure write, the rate-limit counter),
// and this database is a remote Atlas cluster whose latency has a long tail —
// measured at a 53ms median against a 327ms worst case. That tail is larger
// than the ~190ms signal being tested, so an end-to-end timing assertion is
// flaky by construction: it fails on a slow network rather than on a
// regression, which is worse than having no test at all.
//
// verifyPassword is pure CPU and shows a spread of a couple of milliseconds.
// loginUser adds exactly one lookup to each side, so their medians stay
// comparable. Both are stable enough to assert on honestly.
//
// The candidates are INTERLEAVED — one sample of each per round — rather than
// measured one group after another. Measuring in blocks silently attributes CPU
// frequency drift to whichever path happens to be timed last: on a machine warm
// from a long test run, that produced bcrypt=185ms legacy=186ms none=255ms, a
// 70ms "oracle" that reversed when the blocks were reversed and vanished to 5ms
// when interleaved. Interleaving spreads any drift evenly across every
// candidate, so what is left is the difference between the code paths, which is
// the only thing this is meant to assert. The thresholds below are unchanged;
// this makes the measurement honest, not the test easier.
async function medianDurations(samples, runs) {
  const timings = new Map(Object.keys(runs).map((name) => [name, []]));

  for (let i = 0; i < samples; i += 1) {
    for (const [name, run] of Object.entries(runs)) {
      const started = process.hrtime.bigint();
      await run();
      timings.get(name).push(Number(process.hrtime.bigint() - started) / 1e6);
    }
  }

  const medians = {};
  for (const [name, values] of timings) {
    values.sort((a, b) => a - b);
    medians[name] = values[Math.floor(values.length / 2)];
  }
  return medians;
}

describe("finding #2 — a failed sign-in does not reveal whether the account exists", () => {
  test("every hash shape costs the same to verify", async () => {
    // The invariant, measured with no database in the way: whether the account
    // has a bcrypt hash, a legacy SHA-256 hash, or no usable hash at all, one
    // comparison's worth of work is done. Pure CPU, so the spread here is a
    // couple of milliseconds and the threshold can be tight.
    const bcryptHash = await createPasswordHash("some-password");
    const sha256Hash = "a".repeat(64);
    const samples = 7;

    const { withBcrypt, withLegacy, withNothing } = await medianDurations(samples, {
      withBcrypt: () => verifyPassword("guess", bcryptHash),
      withLegacy: () => verifyPassword("guess", sha256Hash),
      withNothing: () => verifyPassword("guess", undefined)
    });

    const slowest = Math.max(withBcrypt, withLegacy, withNothing);
    const fastest = Math.min(withBcrypt, withLegacy, withNothing);

    assert.ok(
      slowest - fastest < 60,
      `bcrypt=${withBcrypt.toFixed(0)}ms legacy=${withLegacy.toFixed(0)}ms ` +
        `none=${withNothing.toFixed(0)}ms — a hash shape that skips the ` +
        `comparison identifies which accounts have passwords`
    );
  });

  test("an unknown account costs the same as a registered one", async () => {
    // One database lookup on each side, so the remaining difference is the
    // password comparison and nothing else.
    const samples = 7;

    const { unknown, registered, passwordless } = await medianDurations(samples, {
      unknown: () => loginUser(env, "owner", UNKNOWN_EMAIL, "wrong-password"),
      registered: () => loginUser(env, "owner", OWNER_EMAIL, "wrong-password"),
      passwordless: () => loginUser(env, "owner", OTP_ONLY_EMAIL, "wrong-password")
    });

    const slowest = Math.max(unknown, registered, passwordless);
    const fastest = Math.min(unknown, registered, passwordless);

    assert.ok(
      slowest - fastest < 120,
      `unknown=${unknown.toFixed(0)}ms registered=${registered.toFixed(0)}ms ` +
        `passwordless=${passwordless.toFixed(0)}ms — a gap approaching one ` +
        `bcrypt comparison (~190ms) means a path is skipping the hash check, ` +
        `which enumerates accounts`
    );
  });

  test("signing in to a password-less account is a 401, not a 500", async () => {
    // bcrypt.compare(password, undefined) throws rather than returning false, so
    // before the isBcryptHash guard this path produced an unhandled rejection
    // and a 500 — which is itself an existence oracle.
    await clearLoginLock(collections, OTP_ONLY_EMAIL);

    const response = await post("/api/auth/login", {
      email: OTP_ONLY_EMAIL,
      password: "any-password"
    });

    assert.equal(
      response.statusCode,
      401,
      `expected 401, got ${response.statusCode}: ${response.body}`
    );
    assert.equal(response.json().error, "Invalid credentials");

    await clearLoginLock(collections, OTP_ONLY_EMAIL);
  });

  test("verifyPassword tolerates every unusable hash shape", async () => {
    for (const hash of [undefined, null, "", "not-a-hash", 12345, {}]) {
      const result = await verifyPassword("guess", hash);
      assert.equal(
        result.valid,
        false,
        `hash ${JSON.stringify(hash)} should not verify`
      );
      assert.equal(result.needsUpgrade, false);
    }
  });

  test("a correct password still signs in", async () => {
    // The equaliser must not have broken the path it pads.
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await post("/api/auth/login", {
      email: OWNER_EMAIL,
      password: PASSWORD
    });

    assert.equal(response.statusCode, 200, `login failed: ${response.body}`);
    assert.ok(response.cookies.find((c) => c.name === "wavetag_session"));
  });
});

describe("finding #3 — the role is fixed by the route, not the request body", () => {
  test("the owner endpoint cannot authenticate an admin", async () => {
    await clearLoginLock(collections, ADMIN_EMAIL);

    // Correct admin credentials, posted to the owner endpoint.
    const response = await post("/api/auth/login", {
      email: ADMIN_EMAIL,
      password: PASSWORD
    });

    assert.notEqual(
      response.statusCode,
      200,
      "admin credentials authenticated against the owner endpoint"
    );
    assert.equal(
      response.headers["set-cookie"],
      undefined,
      "the owner endpoint issued a session for an admin account"
    );

    await clearLoginLock(collections, ADMIN_EMAIL);
  });

  test("a role in the body is rejected, not honoured", async () => {
    await clearLoginLock(collections, ADMIN_EMAIL);

    const response = await post("/api/auth/login", {
      role: "admin",
      email: ADMIN_EMAIL,
      password: PASSWORD
    });

    assert.equal(
      response.statusCode,
      400,
      `a contradictory body role should be a loud 400, got ${response.statusCode}`
    );
    assert.equal(response.headers["set-cookie"], undefined);

    await clearLoginLock(collections, ADMIN_EMAIL);
  });

  test("the admin endpoint authenticates an admin and issues an admin session", async () => {
    await clearLoginLock(collections, ADMIN_EMAIL, "admin");

    const response = await post("/api/auth/admin/login", {
      email: ADMIN_EMAIL,
      password: PASSWORD
    });

    assert.equal(response.statusCode, 200, `admin login failed: ${response.body}`);
    const cookie = response.cookies.find((c) => c.name === "wavetag_session");
    assert.ok(cookie, "admin login issued no session cookie");

    const session = await app.inject({
      method: "GET",
      url: "/api/session",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie.value }
    });
    assert.equal(session.json().session.role, "admin");
  });

  test("the admin endpoint cannot authenticate an owner", async () => {
    await clearLoginLock(collections, OWNER_EMAIL, "admin");

    const response = await post("/api/auth/admin/login", {
      email: OWNER_EMAIL,
      password: PASSWORD
    });

    assert.notEqual(
      response.statusCode,
      200,
      "owner credentials authenticated against the admin endpoint"
    );

    await clearLoginLock(collections, OWNER_EMAIL, "admin");
  });

  test("owner and admin lockouts are independent", async () => {
    // Same address on both endpoints must not share a failure counter, or
    // failed owner sign-ins would lock the admin account and vice versa.
    await clearLoginLock(collections, OWNER_EMAIL, "owner");
    await clearLoginLock(collections, OWNER_EMAIL, "admin");

    for (let i = 0; i < 3; i += 1) {
      await post("/api/auth/admin/login", { email: OWNER_EMAIL, password: "wrong" });
    }

    const ownerLogin = await post("/api/auth/login", {
      email: OWNER_EMAIL,
      password: PASSWORD
    });

    assert.equal(
      ownerLogin.statusCode,
      200,
      "failed admin sign-ins locked the owner account of the same address"
    );

    await clearLoginLock(collections, OWNER_EMAIL, "owner");
    await clearLoginLock(collections, OWNER_EMAIL, "admin");
  });
});

describe("finding #1 — the rate-limit key comes from the trusted proxy hop", () => {
  // This one was NOT a production vulnerability: with trustProxy:1 and an edge
  // that appends the real client address, request.ip is the rightmost
  // X-Forwarded-For entry and the caller's own entries are ignored. The test
  // exists because the obvious "fix" — trustProxy:true — would make the
  // leftmost, fully attacker-controlled entry authoritative and silently turn
  // every IP-keyed control (this rate limit, the plate-verification lockout)
  // into a no-op.
  test("caller-supplied X-Forwarded-For entries do not change the key", async () => {
    const trustedHop = "9.9.9.9";
    const seen = new Set();

    for (let i = 1; i <= 6; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-forwarded-for": `10.0.0.${i}, ${trustedHop}` },
        remoteAddress: trustedHop,
        payload: { email: UNKNOWN_EMAIL, password: "wrong" }
      });
      seen.add(response.statusCode);
    }

    assert.ok(
      seen.has(429),
      "six requests varying only the caller-supplied X-Forwarded-For entry were " +
        "never rate limited — they are being keyed on a spoofable value"
    );

    await clearLoginLock(collections, UNKNOWN_EMAIL);
  });

  test("the trusted hop still separates genuinely different clients", async () => {
    // The mirror of the above: if everything collapsed into one bucket the
    // first test would pass for the wrong reason.
    const statuses = [];

    for (let i = 20; i <= 24; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-forwarded-for": `1.1.1.1, 8.8.8.${i}` },
        remoteAddress: `8.8.8.${i}`,
        payload: { email: UNKNOWN_EMAIL, password: "wrong" }
      });
      statuses.push(response.statusCode);
    }

    assert.ok(
      statuses.every((code) => code !== 429),
      `distinct trusted hops shared a rate-limit bucket: ${statuses.join(", ")}`
    );

    await clearLoginLock(collections, UNKNOWN_EMAIL);
  });
});
