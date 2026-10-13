// Changing the owner's number moves both fields that hold it.
//
// `mobile` is the sign-in identity and `phone` the older contact field; every
// signup path writes both with the same value. The change-number route wrote
// only `mobile`, so `phone` kept the number the owner had just given up, and
// the scan alerts, which read `phone` first, went on messaging the old number
// with the plate and the car's location.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import { createOtpHash } from "../lib/auth/security.js";
import { normalizeIdentifier, OTP_PURPOSE_LINK_MOBILE } from "../lib/auth/otp.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";

const OLD_MOBILE = "+919000007320";
const NEW_MOBILE = "+919000007321";
const KNOWN_CODE = "482913";

let app;
let collections;
let owner;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  // As every signup path leaves it: both fields hold the same number.
  owner = await createTestOwner(collections, {
    email: "qa-mobile-change@parktag-test.invalid",
    mobile: OLD_MOBILE,
    phone: OLD_MOBILE,
    mobileVerified: true
  });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });
  // The code the send-otp step would have delivered to the new number.
  await collections.otpTokens.insertOne({
    identifier: normalizeIdentifier(NEW_MOBILE),
    purpose: OTP_PURPOSE_LINK_MOBILE,
    codeHash: await createOtpHash(KNOWN_CODE),
    used: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
});

const changeMobile = (otp) =>
  app.inject({
    method: "POST",
    url: "/api/owner/mobile",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: TEST_ORIGIN },
    payload: { mobile: NEW_MOBILE, otp }
  });

test("a verified change moves `phone` along with `mobile`", async () => {
  const res = await changeMobile(KNOWN_CODE);
  assert.equal(res.statusCode, 200, res.body);

  const stored = await collections.owners.findOne({ _id: owner._id });
  assert.equal(stored.mobile, NEW_MOBILE);
  assert.equal(stored.phone, NEW_MOBILE, "`phone` still holds the number the owner gave up");
  assert.equal(stored.mobileVerified, true);
});

test("a wrong code changes neither field", async () => {
  const res = await changeMobile("000000");
  assert.equal(res.statusCode, 400);

  const stored = await collections.owners.findOne({ _id: owner._id });
  assert.equal(stored.mobile, OLD_MOBILE);
  assert.equal(stored.phone, OLD_MOBILE);
});
