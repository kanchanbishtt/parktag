// The owner's two switches on a tag (owner's rule, 5 Oct 2026):
//
//   Tag Active   (status)      off → no masked call, no WhatsApp alert, no
//                                    Emergency call; the scanner sees "inactive".
//   Calls Active (callsPaused) off → the masked owner call only. The alert and
//                                    the Emergency call carry on.
//
// These tests drive the owner endpoint and the three scanner routes, so they
// pin the thing the switches promise rather than the field they write.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";

// register-call refuses with 503 without a virtual number; nothing dials.
process.env.EXOTEL_CALLER_ID = "08000000000";

const PLATE = "DL09QA5150";
const RIGHT = "5150";
const OWNER_MOBILE = "+919000005150";
const EMERGENCY_NUMBER = "+919000005151";

let app;
let collections;
let owner;
let cookie;
let token;
let tagId;
let counter = 0;

function nextScannerPhone() {
  counter += 1;
  return `9150${String(counter).padStart(6, "0")}`;
}

async function grantFor(address) {
  const res = await app.inject({
    method: "POST",
    url: `/api/tags/${token}/verify`,
    remoteAddress: address,
    payload: { lastFour: RIGHT }
  });
  assert.equal(res.statusCode, 200, "fixture verify should succeed");
  return res.json();
}

async function registerCall() {
  const address = uniqueAddress();
  const { grant } = await grantFor(address);
  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/register-call`,
    remoteAddress: address,
    payload: { phone: nextScannerPhone(), grant }
  });
}

async function sendMessage() {
  const address = uniqueAddress();
  const { grant } = await grantFor(address);
  return app.inject({
    method: "POST",
    url: "/api/contact-requests",
    remoteAddress: address,
    payload: { token, grant, action: "message", messageChannel: "whatsapp" }
  });
}

async function emergencyCall() {
  const address = uniqueAddress();
  const { grant } = await grantFor(address);
  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/register-emergency-call`,
    remoteAddress: address,
    payload: { phone: nextScannerPhone(), grant }
  });
}

function setCalls(active, sessionCookie = cookie) {
  return app.inject({
    method: "POST",
    url: `/api/owner/tags/${tagId}/calls`,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: sessionCookie },
    headers: { origin: TEST_ORIGIN },
    payload: { active }
  });
}

function dashboardTag() {
  return app
    .inject({
      method: "GET",
      url: "/api/owner/dashboard?qr=0",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie }
    })
    .then((res) => res.json().tags.find((t) => t.id === tagId));
}

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.tags.deleteMany({ token }).catch(() => {});
  await collections.contactRequests.deleteMany({ token }).catch(() => {});
  await collections.pendingCalls.deleteMany({ token }).catch(() => {});
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  counter += 1;
  await purgeLoginCollections(collections);
  if (token) {
    await collections.tags.deleteMany({ token });
    await collections.contactRequests.deleteMany({ token });
    await collections.pendingCalls.deleteMany({ token });
  }
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE });

  owner = await createTestOwner(collections, {
    email: "qa-calls-switch@parktag-test.invalid",
    mobile: OWNER_MOBILE
  });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });

  token = `qacalls${String(counter).padStart(3, "0")}${"c1d2e3f4".repeat(6)}`;
  const { insertedId } = await collections.tags.insertOne({
    ownerId: owner._id,
    token,
    plateNumber: PLATE,
    vehicleLabel: "QA Switch Car",
    vehicleType: "car",
    status: "active",
    premium: false,
    freeContactUsed: false,
    emergencyContact: EMERGENCY_NUMBER,
    createdAt: new Date().toISOString()
  });
  tagId = String(insertedId);
});

describe("the owner endpoint", () => {
  test("switching calls off writes callsPaused and the dashboard reports it", async () => {
    const off = await setCalls(false);
    assert.equal(off.statusCode, 200);
    assert.deepEqual(off.json().tag, { id: tagId, callsActive: false });

    const stored = await collections.tags.findOne({ token });
    assert.equal(stored.callsPaused, true);
    assert.equal(stored.status, "active", "Calls Active must not touch Tag Active");
    assert.equal((await dashboardTag()).callsPaused, true);

    const on = await setCalls(true);
    assert.equal(on.statusCode, 200);
    assert.equal(on.json().tag.callsActive, true);
    assert.equal((await collections.tags.findOne({ token })).callsPaused, false);
    assert.equal((await dashboardTag()).callsPaused, false);
  });

  test("a tag that predates the field reads as calls on", async () => {
    const tag = await dashboardTag();
    assert.equal(tag.callsPaused, false);
  });

  test("anything but a boolean is refused", async () => {
    const res = await setCalls("no");
    assert.equal(res.statusCode, 400);
    assert.equal((await collections.tags.findOne({ token })).callsPaused, undefined);
  });

  test("another owner's tag cannot be switched", async () => {
    const other = await createTestOwner(collections, {
      email: "qa-calls-switch-other@parktag-test.invalid",
      mobile: "+919000005152"
    });
    const otherCookie = await createSession(app, {
      id: String(other._id),
      role: "owner",
      email: other.email,
      displayName: other.displayName
    });
    const res = await setCalls(false, otherCookie);
    assert.equal(res.statusCode, 404);
    assert.equal((await collections.tags.findOne({ token })).callsPaused, undefined);
    await collections.owners.deleteOne({ _id: other._id });
  });
});

describe("Calls Active off", () => {
  beforeEach(async () => {
    assert.equal((await setCalls(false)).statusCode, 200);
  });

  test("the masked call is refused before anything is written", async () => {
    const res = await registerCall();
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, "CALLS_PAUSED");
    assert.equal(await collections.contactRequests.countDocuments({ token }), 0);
    assert.equal(await collections.pendingCalls.countDocuments({ token }), 0);
  });

  test("the WhatsApp alert still goes through", async () => {
    const res = await sendMessage();
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await collections.contactRequests.countDocuments({ token, action: "message" }), 1);
  });

  test("the Emergency call still goes through", async () => {
    const res = await emergencyCall();
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await collections.contactRequests.countDocuments({ token, action: "emergency_call" }), 1);
  });

  test("the scanner is told before and after verifying, and nothing else changes", async () => {
    const load = await app.inject({ method: "GET", url: `/api/tags/${token}` });
    assert.equal(load.statusCode, 200);
    assert.equal(load.json().tag.callsPaused, true);
    assert.equal(load.json().tag.status, "active");
    assert.equal(load.json().tag.emergencyAvailable, true);

    const verified = await grantFor(uniqueAddress());
    assert.equal(verified.callsPaused, true);
    assert.equal(verified.contactAvailable, true, "the pause is not an entitlement block");
    assert.equal(verified.messageAlwaysOn, true);
  });

  test("switching calls back on lets the masked call through again", async () => {
    assert.equal((await setCalls(true)).statusCode, 200);
    const res = await registerCall();
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((await app.inject({ method: "GET", url: `/api/tags/${token}` })).json().tag.callsPaused, false);
  });
});

describe("Tag Active off", () => {
  beforeEach(async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/owner/tags/${tagId}/status`,
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      headers: { origin: TEST_ORIGIN },
      payload: { status: "inactive" }
    });
    assert.equal(res.statusCode, 200);
  });

  test("every channel is closed and the scanner sees an inactive tag", async () => {
    const load = await app.inject({ method: "GET", url: `/api/tags/${token}` });
    assert.equal(load.json().tag.status, "inactive");
    assert.equal(load.json().tag.maskedPlateNumber, null);
    assert.equal(load.json().tag.emergencyAvailable, false);
    assert.equal(load.json().tag.callsPaused, false, "an inactive tag reports nothing finer than inactive");

    const verify = await app.inject({
      method: "POST",
      url: `/api/tags/${token}/verify`,
      remoteAddress: uniqueAddress(),
      payload: { lastFour: RIGHT }
    });
    assert.equal(verify.statusCode, 404);
    assert.equal(await collections.contactRequests.countDocuments({ token }), 0);
  });
});
