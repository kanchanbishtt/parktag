// H4: the dashboard no longer has to render a PNG data URL per tag on every
// call. Each tag carries a `qrUrl` that serves the QR as a cacheable SVG, and
// `?qr=0` leaves the inline `qrDataUrl` out. The default still includes it so
// callers that have not moved over keep working.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-qr-owner@parktag-test.invalid");
const OTHER_EMAIL = assertUndeliverableIdentifier("qa-qr-other@parktag-test.invalid");
const TOKEN = "qa-qr-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_TOKEN = "qa-qr-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

let app;
let collections;
let owner;
let other;
let cookie;
let tagId;
let otherTagId;

async function signIn(user) {
  return createSession(app, {
    id: String(user._id),
    role: "owner",
    email: user.email,
    displayName: user.displayName
  });
}

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

  owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  other = await createTestOwner(collections, { email: OTHER_EMAIL });
  cookie = await signIn(owner);

  const now = new Date().toISOString();
  ({ insertedId: tagId } = await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: "QA01QR0001",
    vehicleType: "car",
    status: "active",
    token: TOKEN,
    premium: true,
    premiumSince: now,
    serialNumber: 7,
    batchNumber: 3,
    emergencyContact: "+919800000000",
    // Not read by the payload, so the projection must be free to drop it.
    internalNote: "should never be loaded",
    createdAt: now
  }));
  ({ insertedId: otherTagId } = await collections.tags.insertOne({
    ownerId: other._id,
    plateNumber: "QA01QR0002",
    status: "active",
    token: OTHER_TOKEN,
    createdAt: now
  }));
});

const get = (url, sessionCookie = cookie) =>
  app.inject({
    method: "GET",
    url,
    remoteAddress: uniqueAddress(),
    ...(sessionCookie ? { cookies: { wavetag_session: sessionCookie } } : {})
  });

describe("GET /api/owner/tags/:tagId/qr.svg", () => {
  test("needs a session", async () => {
    const response = await get(`/api/owner/tags/${tagId}/qr.svg`, null);
    assert.equal(response.statusCode, 401);
  });

  test("returns the owner's QR as a privately cached SVG", async () => {
    const response = await get(`/api/owner/tags/${tagId}/qr.svg`);

    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers["content-type"], /^image\/svg\+xml/);
    assert.equal(response.headers["cache-control"], "private, max-age=86400");
    assert.match(response.body, /<svg[\s>]/);
    assert.ok(!response.body.includes(TOKEN), "the raw token must not be readable in the markup");
  });

  test("another owner's tag is a 404, not their QR", async () => {
    const response = await get(`/api/owner/tags/${otherTagId}/qr.svg`);
    assert.equal(response.statusCode, 404);
    assert.ok(!(response.headers["content-type"] || "").includes("svg"));
  });

  test("a deleted tag and an unknown id are 404, a malformed id is 400", async () => {
    await collections.tags.updateOne({ _id: tagId }, { $set: { deletedAt: new Date().toISOString() } });
    assert.equal((await get(`/api/owner/tags/${tagId}/qr.svg`)).statusCode, 404);
    assert.equal((await get("/api/owner/tags/000000000000000000000000/qr.svg")).statusCode, 404);
    assert.equal((await get("/api/owner/tags/not-an-id-at-all-x/qr.svg")).statusCode, 400);
  });

  test("an admin session is refused", async () => {
    const adminCookie = await createSession(app, { id: String(owner._id), role: "admin", email: OWNER_EMAIL });
    const response = await get(`/api/owner/tags/${tagId}/qr.svg`, adminCookie);
    assert.ok([401, 403].includes(response.statusCode), String(response.statusCode));
  });
});

describe("GET /api/owner/dashboard qr handling", () => {
  test("default payload keeps qrDataUrl and adds qrUrl", async () => {
    const [tag] = (await get("/api/owner/dashboard")).json().tags;

    assert.match(tag.qrDataUrl, /^data:image\/png;base64,/);
    assert.match(tag.qrUrl, new RegExp(`^/api/owner/tags/${tagId}/qr\\.svg\\?v=[0-9a-f]{8}$`));
    assert.ok(!tag.qrUrl.includes(TOKEN));
  });

  test("qr=0 drops qrDataUrl and keeps qrUrl", async () => {
    const [tag] = (await get("/api/owner/dashboard?qr=0")).json().tags;

    assert.equal(tag.qrDataUrl, undefined);
    assert.ok(tag.qrUrl);
  });

  test("the qrUrl the dashboard hands out is fetchable by the same session", async () => {
    const [tag] = (await get("/api/owner/dashboard?qr=0")).json().tags;
    const response = await get(tag.qrUrl);
    assert.equal(response.statusCode, 200);
  });

  test("the projection still yields every field the payload derives from", async () => {
    const body = (await get("/api/owner/dashboard?qr=0")).json();
    const [tag] = body.tags;

    assert.equal(tag.id, String(tagId));
    assert.equal(tag.token, TOKEN);
    assert.equal(tag.plateNumber, "QA01QR0001");
    assert.equal(tag.vehicleType, "car");
    assert.equal(tag.vehicleLabel, "Car");
    assert.equal(tag.status, "active");
    assert.equal(tag.premium, true);
    assert.equal(tag.emergencyContact, "+919800000000");
    // serialNumber + batchNumber
    assert.equal(tag.serial, "PT-03-000007");
    // premiumSince drives both derived blocks
    assert.equal(tag.callAccess.tier, "premium-trial");
    assert.equal(tag.membership.state, "trial");
    assert.ok(tag.membership.daysLeft > 300);
    assert.equal(body.owner.email, OWNER_EMAIL);
    assert.ok(Array.isArray(body.requests));
    assert.equal(typeof body.referral.code, "string");
  });

  test("a stale session for a deleted owner still gets a clean 401", async () => {
    await collections.owners.deleteOne({ _id: owner._id });
    const response = await get("/api/owner/dashboard");
    assert.equal(response.statusCode, 401);
  });
});
