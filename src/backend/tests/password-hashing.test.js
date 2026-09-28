// Password and one-time-code hashing must (a) keep verifying every hash already
// stored, (b) never lower the bcrypt cost, and (c) not stall the event loop:
// pure-JS bcryptjs at cost 12 starved every other request for ~400ms a hash.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcryptjs from "bcryptjs";

import {
  HASHING_BACKEND,
  createPasswordHash,
  verifyPassword,
  createOtpHash,
  verifyOtpHash,
  burnHashComparison
} from "../lib/auth/security.js";

test("uses the native, off-thread bcrypt binding", () => {
  assert.equal(HASHING_BACKEND, "native");
});

test("a hash written by bcryptjs (every existing account) still verifies", async () => {
  const legacy = await bcryptjs.hash("correct horse", 12);
  assert.deepEqual(await verifyPassword("correct horse", legacy), { valid: true, needsUpgrade: false });
  assert.equal((await verifyPassword("wrong horse", legacy)).valid, false);
  assert.equal(await verifyOtpHash("123456", await bcryptjs.hash("123456", 12)), true);
});

test("new hashes are bcrypt at cost 12 and verify, including under bcryptjs", async () => {
  const hash = await createPasswordHash("battery staple");
  assert.match(hash, /^\$2b\$12\$/);
  assert.equal((await verifyPassword("battery staple", hash)).valid, true);
  assert.equal((await verifyPassword("battery stapl", hash)).valid, false);
  assert.equal(await bcryptjs.compare("battery staple", hash), true);
});

test("one-time codes: right code verifies, wrong or malformed fails", async () => {
  const hash = await createOtpHash("417293");
  assert.match(hash, /^\$2b\$12\$/);
  assert.equal(await verifyOtpHash("417293", hash), true);
  assert.equal(await verifyOtpHash(417293, hash), true);
  assert.equal(await verifyOtpHash("417294", hash), false);
  assert.equal(await verifyOtpHash("417293", undefined), false);
  assert.equal(await verifyOtpHash("417293", "not-a-hash"), false);
});

test("a legacy SHA-256 password still verifies and is flagged for upgrade", async () => {
  const sha = crypto.createHash("sha256").update("old-pass").digest("hex");
  assert.deepEqual(await verifyPassword("old-pass", sha), { valid: true, needsUpgrade: true });
  assert.deepEqual(await verifyPassword("other", sha), { valid: false, needsUpgrade: false });
});

test("a missing or malformed hash fails closed instead of throwing", async () => {
  assert.deepEqual(await verifyPassword("x", undefined), { valid: false, needsUpgrade: false });
  assert.deepEqual(await verifyPassword("x", null), { valid: false, needsUpgrade: false });
  assert.deepEqual(await verifyPassword("x", "$2b$garbage"), { valid: false, needsUpgrade: false });
});

test("the event loop keeps running while a hash comparison is in flight", async () => {
  const hash = await createPasswordHash("timer-check");
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 1);
  const started = performance.now();
  await Promise.all([verifyPassword("timer-check", hash), burnHashComparison("x")]);
  const elapsed = performance.now() - started;
  clearInterval(timer);

  // A blocked loop fires a handful of ticks (measured: 5 in 460ms with
  // bcryptjs). A free one fires a large fraction of elapsed milliseconds.
  assert.ok(ticks > elapsed / 10, `only ${ticks} timer ticks in ${elapsed.toFixed(0)}ms`);
});
