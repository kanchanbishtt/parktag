// Saving an emergency contact from the owner dashboard.
//
// The route called toE164 without importing it, so every save threw a
// ReferenceError and the owner saw "Something went wrong. Please try again."
// Nothing caught it: the only test that touched this route sent a cross-origin
// request, which the CSRF hook refuses before the handler ever runs. These go
// all the way through.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress
} from "./helpers.js";

let app;
let collections;
let owner;
let cookie;
let tagId;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});

  owner = await createTestOwner(collections, {
    email: "qa-sos-owner@parktag-test.invalid",
    mobile: "+919812300000"
  });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });

  const tag = await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: "QA01SO0001",
    status: "active",
    token: "qa-sos-token-0001",
    createdAt: new Date().toISOString()
  });
  tagId = String(tag.insertedId);
});

function save(emergencyContact) {
  return app.inject({
    method: "POST",
    url: `/api/owner/tags/${tagId}/emergency-contact`,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: "http://localhost" },
    payload: { emergencyContact }
  });
}

test("a bare ten-digit mobile saves, normalised to E.164", async () => {
  const response = await save("9462772959");

  assert.equal(response.statusCode, 200, `save failed: ${response.body}`);
  assert.equal(response.json().emergencyContact, "+919462772959");

  const stored = await collections.tags.findOne({ ownerId: owner._id });
  assert.equal(stored.emergencyContact, "+919462772959");
});

test("the owner's own number is refused", async () => {
  const response = await save("9812300000");

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /other than your own/);
});

test("a number that cannot be normalised is refused, not stored as null", async () => {
  await collections.tags.updateOne(
    { ownerId: owner._id },
    { $set: { emergencyContact: "+919462772959" } }
  );

  // Seven digits clears the length check but is not a number toE164 will read.
  const response = await save("1234567");

  assert.equal(response.statusCode, 400, `unexpected: ${response.body}`);
  const stored = await collections.tags.findOne({ ownerId: owner._id });
  assert.equal(stored.emergencyContact, "+919462772959", "a bad save wiped the existing number");
});
