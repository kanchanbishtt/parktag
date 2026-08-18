// Tests for the second QA pass.
//
//   #1 an email address resolves to one account, whatever case it is typed in
//   #2 OTP verification does not reveal whether a code is outstanding
//   #3 the credential pages allow no inline script or inline <style>
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
import { canonicalEmail, findByCanonicalEmail } from "../lib/auth/identity.js";
import { createOtpHash } from "../lib/auth/security.js";
import { verifyOtp } from "../lib/auth/otp.js";

const PASSWORD = "QA-identity-password-3d9f";
const MIXED_CASE = "QA.Identity.Fixture@parktag-test.invalid";
const LOWERCASE = canonicalEmail(MIXED_CASE);

let app;
let collections;
let env;

before(async () => {
  ({ app, collections, env } = await startTestApp());
  await purgeLoginCollections(collections);
  // Stored exactly as typed, the way rows written before the canonicalisation
  // look. The fix has to cope with these, not just with new ones.
  await createTestOwner(collections, { email: MIXED_CASE, password: PASSWORD });
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

function login(email, password = PASSWORD) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: uniqueAddress(),
    payload: { email, password }
  });
}

describe("finding #1 — one address is one account", () => {
  test("an account stored mixed-case signs in with any casing", async () => {
    for (const spelling of [MIXED_CASE, LOWERCASE, MIXED_CASE.toUpperCase()]) {
      await clearLoginLock(collections, spelling);
      const response = await login(spelling);
      assert.equal(
        response.statusCode,
        200,
        `sign-in failed for "${spelling}": ${response.body}`
      );
    }
  });

  test("surrounding whitespace does not make a different account", async () => {
    await clearLoginLock(collections, MIXED_CASE);
    const response = await login(`  ${LOWERCASE}  `);
    assert.equal(response.statusCode, 200, `sign-in failed: ${response.body}`);
  });

  test("signing in with a code does not fork a second account", async () => {
    // The regression this whole finding is about: verify-otp creates an owner
    // whenever the lookup returns nothing, so a case-insensitive miss produced
    // a second, empty account and the user's tags stayed on the first.
    const before = await collections.owners.countDocuments({});

    await collections.otpTokens.deleteMany({ identifier: LOWERCASE });
    const now = new Date();
    await collections.otpTokens.insertOne({
      identifier: LOWERCASE,
      codeHash: await createOtpHash("135790"),
      used: false,
      attempts: 0,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/verify-otp",
      remoteAddress: uniqueAddress(),
      payload: { identifier: LOWERCASE, code: "135790" }
    });

    assert.equal(response.statusCode, 200, `verify failed: ${response.body}`);
    assert.equal(
      response.json().isNewUser,
      false,
      "the OTP sign-in treated an existing owner as a new user"
    );

    const after = await collections.owners.countDocuments({});
    assert.equal(
      after,
      before,
      `a duplicate account was created: ${before} owners before, ${after} after`
    );
  });

  test("the lookup costs one query whether or not the account exists", async () => {
    // Not cosmetic. A two-step lookup — canonical first, case-insensitive
    // fallback second — costs an extra round trip only when the address is
    // unknown, which reopens exactly the enumeration gap that the padded
    // password comparison closes.
    const calls = [];
    const probe = {
      findOne(filter, options) {
        calls.push({ filter, options });
        return Promise.resolve(null);
      }
    };

    await findByCanonicalEmail(probe, "nobody@parktag-test.invalid");
    assert.equal(calls.length, 1, `a miss issued ${calls.length} queries, expected 1`);
    assert.ok(
      calls[0].options?.collation,
      "the single query must be the case-insensitive one, or mixed-case rows are missed"
    );
  });

  test("canonicalEmail refuses non-strings rather than coercing them", async () => {
    for (const value of [undefined, null, {}, [], 42]) {
      assert.equal(canonicalEmail(value), "", `${JSON.stringify(value)} should canonicalise to ""`);
    }
  });
});

describe("finding #2 — OTP verification hides whether a code is outstanding", () => {
  test("a wrong code costs the same whether or not a token exists", async () => {
    const live = "qa-identity-live@parktag-test.invalid";
    const absent = "qa-identity-absent@parktag-test.invalid";

    await collections.otpTokens.deleteMany({ identifier: live });
    const now = new Date();
    await collections.otpTokens.insertOne({
      identifier: live,
      codeHash: await createOtpHash("246813"),
      used: false,
      attempts: 0,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    });

    // Per-sample setup runs OUTSIDE the timed window. Resetting the attempt
    // counter is a database write, and leaving it inside the measurement added a
    // whole round trip to one side only — which made this test fail on its own
    // scaffolding rather than on a regression.
    const median = async (setup, run) => {
      const t = [];
      for (let i = 0; i < 7; i += 1) {
        await setup();
        const s = process.hrtime.bigint();
        try { await run(); } catch { /* both sides throw */ }
        t.push(Number(process.hrtime.bigint() - s) / 1e6);
      }
      t.sort((a, b) => a - b);
      return t[3];
    };

    const withToken = await median(
      () => collections.otpTokens.updateOne(
        { identifier: live },
        { $set: { attempts: 0, used: false } }
      ),
      () => verifyOtp(env, live, "000000")
    );
    const withoutToken = await median(async () => {}, () => verifyOtp(env, absent, "000000"));

    // A residual gap of roughly one write (~40ms) is expected and fine: the
    // live path increments the attempt counter and the absent path has nothing
    // to increment. What must not come back is a gap the size of a bcrypt
    // comparison (~190ms), which is what skipping the padded compare looks like.
    assert.ok(
      Math.abs(withToken - withoutToken) < 120,
      `live token=${withToken.toFixed(0)}ms no token=${withoutToken.toFixed(0)}ms — ` +
        `a bcrypt-sized gap reveals whether that address is part-way through signing in`
    );

    await collections.otpTokens.deleteMany({ identifier: live });
  });
});

describe("finding #3 — credential pages carry no inline script or style", () => {
  const pages = [
    "/owner-login",
    "/owner-verify",
    "/register-owner",
    "/forgot-password",
    "/reset-password"
  ];

  for (const page of pages) {
    test(`${page} sends a tightened policy its markup satisfies`, async () => {
      const response = await app.inject({
        method: "GET",
        url: page,
        remoteAddress: uniqueAddress()
      });
      const csp = response.headers["content-security-policy"] || "";

      const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
      assert.ok(!scriptSrc.includes("'unsafe-inline'"), `${page}: ${scriptSrc}`);

      // The page must not reference origins it does not use — Razorpay and the
      // Google sign-in host were inherited from the app-wide policy.
      assert.ok(
        !scriptSrc.includes("razorpay") && !scriptSrc.includes("accounts.google.com"),
        `${page} still allows script origins it never loads: ${scriptSrc}`
      );

      const styleSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("style-src "));
      assert.ok(
        styleSrc && !styleSrc.includes("'unsafe-inline'"),
        `${page} still permits an injected <style> element: ${styleSrc}`
      );
      // The markup keeps style="..." attributes, so those must stay allowed or
      // every one of these pages loses its layout.
      assert.match(csp, /style-src-attr 'unsafe-inline'/, `${page} would lose its inline style attributes`);

      // And the markup has to actually satisfy what the header promises.
      assert.ok(
        !/<style[^>]*>/i.test(response.body),
        `${page} contains a <style> element that its own CSP now blocks`
      );
      assert.ok(
        !/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/i.test(response.body),
        `${page} contains an inline <script> that its own CSP now blocks`
      );
    });
  }
});
