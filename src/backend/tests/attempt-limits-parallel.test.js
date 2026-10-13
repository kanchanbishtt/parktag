// Attempt limits hold against guesses sent in parallel.
//
// Three checks used the same shape: read the count, compare the secret (a
// bcrypt call, ~100ms+), then write the failure. Every guess in a parallel
// burst read the count before any of them had written, so the burst got as
// many comparisons as it had requests:
//
//   - a one-time code (5 attempts),
//   - the per-account sign-in lockout (10 failures),
//   - the vault PIN and the login-PIN change check (same lockout module).
//
// Each now takes the attempt first, in one atomic update, and compares only
// once it is allowed. These tests fire bursts larger than the allowance and
// count how many got a comparison.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { verifyOtp, OTP_PURPOSE_AUTH } from "../lib/auth/otp.js";
import { createOtpHash } from "../lib/auth/security.js";
import { setVaultPin, verifyVaultPin } from "../lib/core/vault.js";
import { setLoginPin, verifyLoginPinForChange } from "../lib/auth/login-pin.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress
} from "./helpers.js";

// .invalid never resolves; nothing is sent by these tests in any case.
const EMAIL = "qa-parallel-limits@parktag-test.invalid";
const PASSWORD = "parallel-QA-Password-1";
const CODE = "582913";

let app;
let collections;
let env;

before(async () => {
  ({ app, collections, env } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
});

async function plantCode() {
  const { insertedId } = await collections.otpTokens.insertOne({
    identifier: EMAIL,
    purpose: OTP_PURPOSE_AUTH,
    codeHash: await createOtpHash(CODE),
    used: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  return insertedId;
}

const settle = (promises) => Promise.allSettled(promises);
const messages = (results) => results.map((r) => (r.status === "fulfilled" ? "ok" : r.reason.message));

describe("one-time codes", () => {
  test("twelve wrong codes at once get five comparisons, not twelve", async () => {
    const id = await plantCode();

    const results = messages(await settle(
      Array.from({ length: 12 }, (_, i) => verifyOtp(env, EMAIL, String(100000 + i)))
    ));

    const compared = results.filter((m) => m.startsWith("Invalid code."));
    assert.equal(compared.length, 5, `comparisons made: ${compared.length}\n${results.join("\n")}`);
    assert.equal((await collections.otpTokens.findOne({ _id: id })).attempts, 5);

    // The allowance is spent, so the right code no longer works either.
    await assert.rejects(verifyOtp(env, EMAIL, CODE));
  });

  test("the right code sent twice at once signs in once", async () => {
    await plantCode();

    const results = messages(await settle([verifyOtp(env, EMAIL, CODE), verifyOtp(env, EMAIL, CODE)]));
    assert.equal(results.filter((m) => m === "ok").length, 1, results.join("\n"));
    assert.ok(results.includes("Invalid or expired code. Please try again."), results.join("\n"));
  });

  test("a wrong code still says how many attempts are left", async () => {
    await plantCode();
    await assert.rejects(verifyOtp(env, EMAIL, "000001"), /Invalid code\. 4 attempts remaining\./);
    await assert.rejects(verifyOtp(env, EMAIL, "000002"), /Invalid code\. 3 attempts remaining\./);
    assert.equal((await verifyOtp(env, EMAIL, CODE)).ok, true);
  });
});

describe("the per-account sign-in lockout", () => {
  const login = (secret) => app.inject({
    method: "POST",
    url: "/api/auth/login",
    // A fresh address per request, so neither the per-IP rate limit nor the
    // spray lock is what stops the burst: only the per-account lockout.
    remoteAddress: uniqueAddress(),
    payload: { email: EMAIL, password: secret }
  });

  test("fifteen wrong passwords at once: ten are checked, five are locked out", async () => {
    await createTestOwner(collections, { email: EMAIL, password: PASSWORD });

    const responses = await Promise.all(Array.from({ length: 15 }, (_, i) => login(`wrong-${i}`)));
    const codes = responses.map((r) => r.statusCode);

    assert.equal(codes.filter((c) => c === 401).length, 10, `status codes: ${codes.join(",")}`);
    assert.equal(codes.filter((c) => c === 429).length, 5, `status codes: ${codes.join(",")}`);

    // Locked: the right password is not even checked now.
    assert.equal((await login(PASSWORD)).statusCode, 429);
  });

  test("the right password inside the allowance signs in and clears the count", async () => {
    await createTestOwner(collections, { email: EMAIL, password: PASSWORD });

    for (let i = 0; i < 9; i += 1) assert.equal((await login(`wrong-${i}`)).statusCode, 401);
    assert.equal((await login(PASSWORD)).statusCode, 200, "the tenth attempt is still allowed");
    // The account's own row; the spray lockout keeps per-address rows here too.
    const accountRow = crypto.createHash("sha256").update(`owner|${EMAIL}`).digest("hex");
    assert.equal(await collections.loginAttempts.countDocuments({ _id: accountRow }), 0, "a success clears the counter");
    assert.equal((await login("wrong-again")).statusCode, 401, "a fresh allowance after signing in");
  });

  test("an account that does not exist locks the same way", async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => login(`wrong-${i}`)));
    const codes = responses.map((r) => r.statusCode);
    assert.equal(codes.filter((c) => c === 401).length, 10, `status codes: ${codes.join(",")}`);
    assert.equal(codes.filter((c) => c === 429).length, 2, `status codes: ${codes.join(",")}`);
  });
});

describe("the vault PIN and the login PIN change check", () => {
  test("vault: fifteen wrong PINs at once get ten comparisons", async () => {
    const owner = await createTestOwner(collections, { email: EMAIL });
    await setVaultPin(collections, owner._id, "583920");

    const results = await Promise.all(Array.from({ length: 15 }, (_, i) =>
      verifyVaultPin(collections, owner._id, String(700000 + i))
    ));
    assert.equal(results.filter((r) => !r.ok && !r.locked).length, 10);
    assert.equal(results.filter((r) => r.locked).length, 5);

    assert.equal((await verifyVaultPin(collections, owner._id, "583920")).locked, true);
  });

  test("vault: the right PIN clears the count", async () => {
    const owner = await createTestOwner(collections, { email: EMAIL });
    await setVaultPin(collections, owner._id, "583920");

    assert.equal((await verifyVaultPin(collections, owner._id, "111112")).ok, false);
    assert.equal((await verifyVaultPin(collections, owner._id, "583920")).ok, true);
    assert.equal(await collections.loginAttempts.countDocuments({}), 0);
  });

  test("login PIN change: fifteen wrong PINs at once get ten comparisons", async () => {
    const owner = await createTestOwner(collections, { email: EMAIL });
    await setLoginPin(collections, owner._id, "583920");

    const results = await Promise.all(Array.from({ length: 15 }, (_, i) =>
      verifyLoginPinForChange(collections, owner._id, String(700000 + i))
    ));
    assert.equal(results.filter((r) => !r.ok && !r.locked).length, 10);
    assert.equal(results.filter((r) => r.locked).length, 5);
  });
});
