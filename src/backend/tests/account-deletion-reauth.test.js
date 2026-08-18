// Deleting an owner account must cost more than holding a session cookie.
//
// DELETE /api/owner/account re-authenticated only when `owner.passwordHash`
// existed. OTP sign-up is the default path here and creates accounts with no
// password at all, so for most of the user base an empty request body plus a
// cookie was a complete, irreversible wipe — owner row, tags, contact requests,
// orders, addresses. A stale session on a shared machine, or a cookie lifted
// from one, was enough.
//
// The rule now: a password account re-enters its password, and a password-less
// account confirms with a fresh single-use code sent to the address ALREADY ON
// the account. What the tests below pin down is that the second path is really
// required, that the code cannot be redirected or substituted, and that the
// first path still behaves exactly as it did.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import { createOtpHash } from "../lib/auth/security.js";
import { OTP_PURPOSE_AUTH, OTP_PURPOSE_DELETE_ACCOUNT } from "../lib/auth/otp.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

// Every identifier here is an email on the .invalid TLD. The mobile branch of
// sendOtp calls the live Meta WhatsApp API from a developer .env, so a made-up
// number in a test messages whoever really owns it.
const OTP_OWNER_EMAIL = assertUndeliverableIdentifier("qa-delete-otp@parktag-test.invalid");
const PASSWORD_OWNER_EMAIL = assertUndeliverableIdentifier("qa-delete-pw@parktag-test.invalid");
const ATTACKER_EMAIL = assertUndeliverableIdentifier("qa-delete-attacker@parktag-test.invalid");
const PASSWORD = "QA-delete-account-password-3f81";
const KNOWN_CODE = "424242";

let app;
let env;
let collections;

before(async () => {
  ({ app, env, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
});

// A session for an owner who has no password — the account shape that could not
// be created by signing in, because there is no credential to sign in with.
async function sessionFor(owner) {
  return createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });
}

function deleteAccount(cookie, payload) {
  return app.inject({
    method: "DELETE",
    url: "/api/owner/account",
    remoteAddress: uniqueAddress(),
    ...(cookie ? { cookies: { wavetag_session: cookie } } : {}),
    ...(payload === undefined ? {} : { payload })
  });
}

function sendDeleteCode(cookie) {
  return app.inject({
    method: "POST",
    url: "/api/owner/account/send-delete-code",
    remoteAddress: uniqueAddress(),
    ...(cookie ? { cookies: { wavetag_session: cookie } } : {})
  });
}

// Codes are stored as bcrypt hashes and the plaintext only ever exists inside
// sendOtp and the message it sends, so a test cannot read one back. Overwrite
// the hash of the token that was really issued instead: the row, its purpose,
// its identifier and its single-use accounting all stay exactly as the route
// created them, and only the secret becomes known.
async function planKnownCode(identifier, purpose) {
  const token = await collections.otpTokens.findOne(
    { identifier, purpose, used: false },
    { sort: { createdAt: -1 } }
  );
  assert.ok(token, `no ${purpose} token was issued for ${identifier}`);
  await collections.otpTokens.updateOne(
    { _id: token._id },
    { $set: { codeHash: await createOtpHash(KNOWN_CODE) }, $unset: { code: "" } }
  );
  return token._id;
}

async function ownerCount(email) {
  return collections.owners.countDocuments({ email });
}

describe("a session cookie alone cannot delete a password-less account", () => {
  test("an empty body is refused and the account survives", async () => {
    const owner = await createTestOwner(collections, { email: OTP_OWNER_EMAIL });
    await collections.tags.insertOne({ ownerId: owner._id, plateNumber: "QA01AA0001" });
    const cookie = await sessionFor(owner);

    const response = await deleteAccount(cookie, {});

    assert.equal(response.statusCode, 400, `expected a refusal, got ${response.body}`);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.needsOtp, true, "the client is not told how to confirm");
    assert.equal(
      await ownerCount(OTP_OWNER_EMAIL),
      1,
      "the account was deleted by a session cookie and an empty body"
    );
    assert.equal(
      await collections.tags.countDocuments({ ownerId: owner._id }),
      1,
      "the owner's tags were deleted without any re-authentication"
    );
  });

  test("no body at all is refused too", async () => {
    // The original report used a bodyless DELETE. `request.body` is null there
    // rather than {}, so it has to be exercised separately from the {} case.
    const owner = await createTestOwner(collections, { email: OTP_OWNER_EMAIL });
    const cookie = await sessionFor(owner);

    const response = await deleteAccount(cookie);

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().needsOtp, true);
    assert.equal(await ownerCount(OTP_OWNER_EMAIL), 1);
  });

  test("a wrong code does not delete the account", async () => {
    const owner = await createTestOwner(collections, { email: OTP_OWNER_EMAIL });
    const cookie = await sessionFor(owner);

    assert.equal((await sendDeleteCode(cookie)).statusCode, 200);
    await planKnownCode(OTP_OWNER_EMAIL, OTP_PURPOSE_DELETE_ACCOUNT);

    const response = await deleteAccount(cookie, { otp: "000000" });

    assert.equal(response.statusCode, 400);
    assert.equal(await ownerCount(OTP_OWNER_EMAIL), 1);
  });

  test("both routes reject a caller with no session", async () => {
    const owner = await createTestOwner(collections, { email: OTP_OWNER_EMAIL });

    assert.equal((await sendDeleteCode(null)).statusCode, 401);
    assert.equal((await deleteAccount(null, { otp: KNOWN_CODE })).statusCode, 401);
    assert.equal(await ownerCount(OTP_OWNER_EMAIL), 1);
    assert.ok(owner._id);
  });
});

describe("the confirmation code is scoped, targeted and single-use", () => {
  test("a sign-in code cannot stand in for a deletion code", async () => {
    // The two are both six digits and arrive by the same channel. If they were
    // interchangeable, a code talked out of an owner under a "confirm your
    // sign-in" pretext would delete their account instead.
    const owner = await createTestOwner(collections, { email: OTP_OWNER_EMAIL });
    const cookie = await sessionFor(owner);

    await collections.otpTokens.insertOne({
      identifier: OTP_OWNER_EMAIL,
      purpose: OTP_PURPOSE_AUTH,
      codeHash: await createOtpHash(KNOWN_CODE),
      used: false,
      attempts: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });

    const response = await deleteAccount(cookie, { otp: KNOWN_CODE });

    assert.equal(response.statusCode, 400, "a sign-in code was accepted as a deletion code");
    assert.equal(await ownerCount(OTP_OWNER_EMAIL), 1);
  });

  test("the code goes to the account's own address, not one the caller names", async () => {
    // The attack this blocks: a caller holding a stolen session asks for the
    // code to be sent somewhere they can read.
    const owner = await createTestOwner(collections, { email: OTP_OWNER_EMAIL });
    const cookie = await sessionFor(owner);

    const response = await app.inject({
      method: "POST",
      url: "/api/owner/account/send-delete-code",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      payload: { email: ATTACKER_EMAIL, identifier: ATTACKER_EMAIL, mobile: "+919000000123" }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      await collections.otpTokens.countDocuments({ identifier: ATTACKER_EMAIL }),
      0,
      "a code was issued for an address supplied in the request body"
    );
    assert.equal(
      await collections.otpTokens.countDocuments({
        identifier: OTP_OWNER_EMAIL,
        purpose: OTP_PURPOSE_DELETE_ACCOUNT
      }),
      1,
      "the code was not issued for the address on the account"
    );
    // The hint may identify an address the owner already knows, never a new one.
    assert.ok(!response.json().hint.includes(ATTACKER_EMAIL));
  });

  test("the right code deletes the account and is consumed", async () => {
    const owner = await createTestOwner(collections, { email: OTP_OWNER_EMAIL });
    await collections.tags.insertOne({ ownerId: owner._id, plateNumber: "QA01AA0002" });
    const cookie = await sessionFor(owner);

    assert.equal((await sendDeleteCode(cookie)).statusCode, 200);
    const tokenId = await planKnownCode(OTP_OWNER_EMAIL, OTP_PURPOSE_DELETE_ACCOUNT);

    const response = await deleteAccount(cookie, { otp: KNOWN_CODE });

    assert.equal(response.statusCode, 200, `deletion was refused: ${response.body}`);
    assert.equal(response.json().ok, true);
    assert.equal(await ownerCount(OTP_OWNER_EMAIL), 0, "the account was not deleted");
    assert.equal(
      await collections.tags.countDocuments({ ownerId: owner._id }),
      0,
      "the owner's tags outlived the account"
    );

    const token = await collections.otpTokens.findOne({ _id: tokenId });
    assert.equal(token.used, true, "the code was left live and could be replayed");

    // The cookie must not survive its account (see the clearSession note on the
    // route — it was once fired unawaited and the header never went out).
    const cleared = response.cookies.find((c) => c.name === "wavetag_session");
    assert.ok(cleared, "no Set-Cookie was sent, so the browser keeps a dead session");
    assert.equal(cleared.value, "");
  });
});

describe("password accounts are unchanged", () => {
  test("the password is still required and still checked", async () => {
    const owner = await createTestOwner(collections, {
      email: PASSWORD_OWNER_EMAIL,
      password: PASSWORD
    });
    const cookie = await sessionFor(owner);

    const missing = await deleteAccount(cookie, {});
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().needsOtp, undefined, "a password account was offered the OTP path");

    const wrong = await deleteAccount(cookie, { password: "not-the-password" });
    assert.equal(wrong.statusCode, 401);
    assert.equal(await ownerCount(PASSWORD_OWNER_EMAIL), 1);

    const right = await deleteAccount(cookie, { password: PASSWORD });
    assert.equal(right.statusCode, 200, `deletion was refused: ${right.body}`);
    assert.equal(await ownerCount(PASSWORD_OWNER_EMAIL), 0);
  });

  test("an OTP cannot be used in place of the password", async () => {
    // Otherwise the new path would be a way around the stronger one.
    const owner = await createTestOwner(collections, {
      email: PASSWORD_OWNER_EMAIL,
      password: PASSWORD
    });
    const cookie = await sessionFor(owner);

    await collections.otpTokens.insertOne({
      identifier: PASSWORD_OWNER_EMAIL,
      purpose: OTP_PURPOSE_DELETE_ACCOUNT,
      codeHash: await createOtpHash(KNOWN_CODE),
      used: false,
      attempts: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });

    const response = await deleteAccount(cookie, { otp: KNOWN_CODE });

    assert.equal(response.statusCode, 400);
    assert.equal(await ownerCount(PASSWORD_OWNER_EMAIL), 1);
  });

  test("no code is issued for an account that has a password", async () => {
    const owner = await createTestOwner(collections, {
      email: PASSWORD_OWNER_EMAIL,
      password: PASSWORD
    });
    const cookie = await sessionFor(owner);

    const response = await sendDeleteCode(cookie);

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "PASSWORD_REQUIRED");
    assert.equal(
      await collections.otpTokens.countDocuments({ identifier: PASSWORD_OWNER_EMAIL }),
      0,
      "a deletion code was mailed to an account that re-authenticates by password"
    );
  });
});

describe("an unverified phone number is not a destination", () => {
  test("a legacy unverified mobile is skipped in favour of the email", async () => {
    // Legacy rows hold phone numbers typed at signup and never proven — they may
    // belong to a stranger. Sending there would be both useless and a nuisance.
    const owner = await createTestOwner(collections, {
      email: OTP_OWNER_EMAIL,
      mobile: "+919000000123",
      phone: "+919000000123"
      // deliberately no mobileVerified
    });
    const cookie = await sessionFor(owner);

    const response = await sendDeleteCode(cookie);

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().channel, "email");
    assert.equal(
      await collections.otpTokens.countDocuments({ identifier: "+919000000123" }),
      0,
      "a code was sent to an unverified phone number"
    );
  });

  test("an account with no usable destination is refused, not wiped", async () => {
    const owner = await createTestOwner(collections, { email: undefined });
    const cookie = await sessionFor(owner);

    const sent = await sendDeleteCode(cookie);
    assert.equal(sent.statusCode, 409);
    assert.equal(sent.json().code, "NO_DESTINATION");

    const deleted = await deleteAccount(cookie, { otp: KNOWN_CODE });
    assert.equal(deleted.statusCode, 409, "an unreachable account was deletable by session alone");
    assert.equal(await collections.owners.countDocuments({ _id: owner._id }), 1);
  });
});
