// Tests for the MEDIUM findings from the login-page QA pass.
//
//   #5 one-time codes were persisted in the clear
//   #6 the auth pages carried no Cache-Control at all
//
// (#4 — an unconfigured reCAPTCHA leaving /api/auth/send-otp with no bot check —
// is a deployment setting, not a code path. What is testable is that the code
// notices and says so, which is asserted at the bottom.)
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import {
  startTestApp,
  stopTestApp,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";
import { sendOtp, verifyOtp } from "../lib/auth/otp.js";
import { createOtpHash, verifyOtpHash } from "../lib/auth/security.js";

// example.invalid can never resolve, and the email path is fire-and-forget, so
// nothing is dispatched anywhere by these tests.
const EMAIL = "qa-otp-storage@parktag-test.invalid";

let app;
let collections;
let env;

before(async () => {
  ({ app, collections, env } = await startTestApp());
  await purgeLoginCollections(collections);
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

async function issueCode(identifier = EMAIL) {
  assertUndeliverableIdentifier(identifier);
  await collections.otpTokens.deleteMany({ identifier });
  await sendOtp(env, identifier);
  return collections.otpTokens.findOne({ identifier }, { sort: { createdAt: -1 } });
}

describe("finding #5 — one-time codes are not stored in the clear", () => {
  test("a sent code leaves no recoverable plaintext behind", async () => {
    const record = await issueCode();

    assert.ok(record, "no OTP token was written");
    assert.equal(
      record.code,
      undefined,
      "the plaintext code is still being persisted — database read access is " +
        "enough to sign in as any account mid-login"
    );
    assert.ok(record.codeHash, "no codeHash was written");
    assert.match(
      record.codeHash,
      /^\$2[aby]?\$\d{2}\$/,
      `codeHash is not a bcrypt hash: ${record.codeHash}`
    );

    // Belt and braces: no six-digit run anywhere in the stored document.
    const serialised = JSON.stringify(record);
    const digitRuns = serialised.match(/\b\d{6}\b/g) || [];
    assert.equal(
      digitRuns.length,
      0,
      `a six-digit sequence survives in the stored token: ${digitRuns.join(", ")}`
    );
  });

  test("the stored hash verifies the code it was made from, and nothing else", async () => {
    const code = "417293";
    const hash = await createOtpHash(code);

    assert.equal(await verifyOtpHash(code, hash), true);
    assert.equal(await verifyOtpHash("417294", hash), false);
    assert.equal(await verifyOtpHash("", hash), false);
    // A number rather than a string, which is what verify-otp accepts on input.
    assert.equal(await verifyOtpHash(Number(code), hash), true);
  });

  test("an unusable hash never verifies", async () => {
    for (const hash of [undefined, null, "", "417293", "not-a-hash", {}]) {
      assert.equal(
        await verifyOtpHash("417293", hash),
        false,
        `hash ${JSON.stringify(hash)} should never verify`
      );
    }
  });

  test("a code issued before the change still verifies", async () => {
    // Tokens written by the previous deploy hold `code` and no `codeHash`, and
    // stay valid for ten minutes after the new one ships. Dropping the fallback
    // would tell everyone mid-login that their correct code is wrong.
    const identifier = "qa-otp-legacy@parktag-test.invalid";
    await collections.otpTokens.deleteMany({ identifier });

    const now = new Date();
    await collections.otpTokens.insertOne({
      identifier,
      code: "654321",
      used: false,
      attempts: 0,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    });

    const result = await verifyOtp(env, identifier, "654321");
    assert.equal(result.ok, true, "a pre-change token stopped verifying");

    await collections.otpTokens.deleteMany({ identifier });
  });

  test("a wrong code is still rejected and still counts against the attempt cap", async () => {
    const record = await issueCode();

    await assert.rejects(
      () => verifyOtp(env, EMAIL, "000000"),
      /Invalid code/,
      "a wrong code was not rejected"
    );

    const after = await collections.otpTokens.findOne({ _id: record._id });
    assert.equal(after.attempts, 1, "the failed attempt was not counted");
    assert.equal(after.used, false, "a single wrong guess should not burn the token");
  });

  test("the resend window still suppresses a second send", async () => {
    // sendOtp returns early when a live code was issued recently, rather than
    // reissuing. That path must not depend on reading the previous code back.
    await collections.otpTokens.deleteMany({ identifier: EMAIL });

    assertUndeliverableIdentifier(EMAIL);
    await sendOtp(env, EMAIL);
    await sendOtp(env, EMAIL);

    const count = await collections.otpTokens.countDocuments({ identifier: EMAIL });
    assert.equal(count, 1, "the resend window issued a second token");
  });
});

describe("finding #6 — auth pages are not stored by caches or history", () => {
  const pages = [
    "/owner-login",
    "/owner-verify",
    "/register-owner",
    "/forgot-password",
    "/reset-password",
    "/admin"
  ];

  for (const page of pages) {
    test(`${page} sends no-store`, async () => {
      const response = await app.inject({
        method: "GET",
        url: page,
        remoteAddress: uniqueAddress()
      });

      const cacheControl = response.headers["cache-control"];
      assert.ok(
        cacheControl,
        `${page} sends no Cache-Control at all — it is cacheable by default`
      );
      assert.match(
        cacheControl,
        /no-store/,
        `${page} sends "${cacheControl}" — without no-store the page can be ` +
          `replayed from the browser's back/forward history after sign-out`
      );
    });
  }

  test("an authenticated page's redirect is also uncacheable", async () => {
    // Signed out, /owner-welcome answers with a redirect rather than the page.
    // A cached redirect is harmless, but a cached *page* body would not be, and
    // the header has to be on the response that actually carries it.
    const response = await app.inject({
      method: "GET",
      url: "/owner-welcome",
      remoteAddress: uniqueAddress()
    });

    assert.match(
      response.headers["cache-control"] || "",
      /no-store/,
      "the signed-out response from an authenticated page is cacheable"
    );
  });

  test("pages outside the auth surface are left alone", async () => {
    // The hook must not quietly become a site-wide cache disable.
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      remoteAddress: uniqueAddress()
    });

    assert.ok(
      !/no-store/.test(response.headers["cache-control"] || ""),
      "no-store is being applied outside the pages it was scoped to"
    );
  });
});
