// GET /api/owner/dashboard must not hand the owner a scanner's number. The
// owner app and the web page only need to know a callback is possible and the
// last four digits to tell two scanners apart; the callback routes look the
// full number up server-side by request id.
//
// Scoped to requests[]: the owner's own mobile, backupMobile and each tag's
// emergencyContact are the owner reading back numbers they typed, and are
// legitimately returned in full.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-phone-mask@parktag-test.invalid");
const PASSWORD = "QA-phone-mask-password-77c2";
const TAG_TOKEN = "qa-phone-mask-token-0001";
const SCANNER = "+919876501234";

let app;
let collections;
let owner;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
  await collections.contactRequests.deleteMany({ token: TAG_TOKEN }).catch(() => {});
  await collections.pushTokens.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
  await collections.contactRequests.deleteMany({ token: TAG_TOKEN }).catch(() => {});

  owner = await createTestOwner(collections, {
    email: OWNER_EMAIL,
    password: PASSWORD,
    mobile: "+919812345678"
  });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });

  await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: "QA01PM0001",
    status: "active",
    token: TAG_TOKEN,
    createdAt: new Date().toISOString()
  });

  const base = { tagId: new ObjectId(), token: TAG_TOKEN, ownerId: owner._id, status: "connecting" };
  await collections.contactRequests.insertMany([
    { ...base, phone: SCANNER, action: "call", createdAt: new Date(Date.now() - 60e3).toISOString() },
    { ...base, phone: null, action: "message", createdAt: new Date(Date.now() - 120e3).toISOString() }
  ]);
});

function dashboard() {
  return app.inject({
    method: "GET",
    url: "/api/owner/dashboard",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie }
  });
}

test("requests[] carries phoneLast4 and hasPhone, never the number", async () => {
  const response = await dashboard();
  assert.equal(response.statusCode, 200, response.body);
  const { requests } = response.json();
  assert.equal(requests.length, 2);

  for (const item of requests) {
    assert.ok(!("phone" in item), "a request still has a phone key");
    assert.doesNotMatch(JSON.stringify(item), /\d{10,}/, "a run of 10+ digits is in a request");
  }

  const withPhone = requests.find((r) => r.action === "call");
  assert.equal(withPhone.hasPhone, true);
  assert.equal(withPhone.phoneLast4, "1234");

  const without = requests.find((r) => r.action === "message");
  assert.equal(without.hasPhone, false);
  assert.equal(without.phoneLast4, null);
});

test("account deletion removes the owner's push tokens", async () => {
  const other = new ObjectId();
  await collections.pushTokens.insertMany([
    { token: "qa-mask-push-mine", ownerId: owner._id, platform: "android", updatedAt: new Date() },
    { token: "qa-mask-push-other", ownerId: other, platform: "android", updatedAt: new Date() }
  ]);

  const response = await app.inject({
    method: "DELETE",
    url: "/api/owner/account",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    payload: { password: PASSWORD }
  });
  assert.equal(response.statusCode, 200, response.body);

  assert.equal(await collections.pushTokens.countDocuments({ ownerId: owner._id }), 0);
  assert.equal(await collections.pushTokens.countDocuments({ ownerId: other }), 1,
    "another owner's token was removed");
});
