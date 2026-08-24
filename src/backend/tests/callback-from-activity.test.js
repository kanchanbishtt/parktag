// Calling a scanner back from the activity list.
//
// A scanner rang the owner, the owner missed it, and by the time they opened
// the dashboard the only way to reach that person was to wait for them to scan
// the sticker again. The callback existed; it expired after 60 minutes and only
// ever targeted the single most recent contact.
//
// The window is now 48 hours and each row names its own contact, which means
// the route accepts an id from the client — so the test that matters most here
// is the one proving an id belonging to somebody else is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, createTestOwner } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";

let app;
let env;
let collections;

const ORIGIN = "http://localhost:3000";
const OWNER_MOBILE = "+919000005510";
const SCANNER_A = "+919000005511";
const SCANNER_B = "+919000005512";

let owner;
let intruder;
let cookie;

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

async function seedContact(forOwnerId, { phone, createdAt, action = "call", token = "cb-tok" }) {
  const doc = {
    _id: new ObjectId(),
    tagId: new ObjectId(),
    token,
    ownerId: forOwnerId,
    phone,
    action,
    status: "connecting",
    createdAt
  };
  await collections.contactRequests.insertOne(doc);
  return doc;
}

test.before(async () => {
  ({ app, env, collections } = await startTestApp());
  await collections.owners.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});

  owner = await createTestOwner(collections, {
    email: "cb-owner@example.invalid",
    displayName: "Callback Owner"
  });
  await collections.owners.updateOne(
    { _id: owner._id },
    { $set: { mobile: OWNER_MOBILE, phone: OWNER_MOBILE, mobileVerified: true } }
  );

  intruder = await createTestOwner(collections, {
    email: "cb-intruder@example.invalid",
    displayName: "Someone Else"
  });
  await collections.owners.updateOne(
    { _id: intruder._id },
    { $set: { mobile: "+919000005599", mobileVerified: true } }
  );

  cookie = await createSession(app, {
    id: String(owner._id), role: "owner", email: "cb-owner@example.invalid"
  });
});

test.beforeEach(async () => {
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});
  // The route allows 5 callbacks per 5 minutes and the counters live in Mongo
  // (see lib/auth/rate-limit-store.js), so without this the later tests in the
  // file get a 429 from the earlier ones rather than the answer they assert.
  await collections.rateLimits.deleteMany({});
});

test.after(async () => {
  await collections.owners.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});
  await stopTestApp(app);
});

function callBack(body, sessionCookie = cookie) {
  return app.inject({
    method: "POST",
    url: "/api/owner/callback/register-call",
    headers: {
      origin: ORIGIN,
      cookie: `wavetag_session=${sessionCookie}`,
      "content-type": "application/json"
    },
    payload: body
  });
}

test("a call missed hours ago can still be returned", async (t) => {
  if (!env.exotelCallerId) {
    t.skip("EXOTEL_CALLER_ID not configured in this environment");
    return;
  }

  const contact = await seedContact(owner._id, { phone: SCANNER_A, createdAt: hoursAgo(6) });

  const response = await callBack({ requestId: String(contact._id) });
  assert.equal(response.statusCode, 200, "six hours old must still be callable");
  assert.equal(response.json().ok, true);

  const routed = await collections.pendingCalls.findOne({ requestId: contact._id });
  assert.ok(routed, "a pending call should be registered");
  assert.equal(routed.targetPhone, SCANNER_A, "it must dial the scanner who called");
  assert.equal(routed.type, "owner_to_scanner");
});

test("an older contact can be picked, not just the newest", async (t) => {
  if (!env.exotelCallerId) {
    t.skip("EXOTEL_CALLER_ID not configured in this environment");
    return;
  }

  const older = await seedContact(owner._id, { phone: SCANNER_A, createdAt: hoursAgo(10) });
  await seedContact(owner._id, { phone: SCANNER_B, createdAt: hoursAgo(1) });

  const response = await callBack({ requestId: String(older._id) });
  assert.equal(response.statusCode, 200);

  const routed = await collections.pendingCalls.findOne({ requestId: older._id });
  assert.ok(routed, "the row the owner chose should be the one routed");
  assert.equal(routed.targetPhone, SCANNER_A,
    "picking the older row must not silently dial the newer caller");
});

test("beyond the window it is refused", async () => {
  const stale = await seedContact(owner._id, { phone: SCANNER_A, createdAt: hoursAgo(60) });

  const response = await callBack({ requestId: String(stale._id) });
  assert.equal(response.statusCode, 410);
  assert.equal(response.json().code, "CALLBACK_WINDOW_EXPIRED");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("another owner's contact cannot be dialled", async () => {
  // The id is real and inside the window — the only thing wrong with it is
  // whose it is. Scoping the lookup by session owner is what refuses it; taking
  // the id on trust would let any signed-in account ring a stranger's scanner.
  const theirs = await seedContact(intruder._id, { phone: SCANNER_B, createdAt: hoursAgo(1) });

  const response = await callBack({ requestId: String(theirs._id) });
  assert.equal(response.statusCode, 410, "must not resolve another owner's contact");
  assert.equal(
    await collections.pendingCalls.countDocuments({}), 0,
    "and must not register a route to their scanner"
  );
});

test("a malformed id is a 400, not a 500", async () => {
  const response = await callBack({ requestId: "not-an-object-id" });
  assert.equal(response.statusCode, 400);
});

test("an id-less call still resolves the most recent contact", async (t) => {
  if (!env.exotelCallerId) {
    t.skip("EXOTEL_CALLER_ID not configured in this environment");
    return;
  }

  // The banner button has never sent one, and must keep working.
  await seedContact(owner._id, { phone: SCANNER_A, createdAt: hoursAgo(10) });
  const newest = await seedContact(owner._id, { phone: SCANNER_B, createdAt: hoursAgo(1) });

  const response = await callBack({});
  assert.equal(response.statusCode, 200);

  const routed = await collections.pendingCalls.findOne({});
  assert.equal(String(routed.requestId), String(newest._id));
  assert.equal(routed.targetPhone, SCANNER_B);
});

test("a WhatsApp report that left a number is callable too", async (t) => {
  if (!env.exotelCallerId) {
    t.skip("EXOTEL_CALLER_ID not configured in this environment");
    return;
  }

  // The case that prompted this: the owner is told somebody contacted them and
  // has nothing to act on. A message row carrying a number is exactly the row
  // that most needs a way back.
  const contact = await seedContact(owner._id, {
    phone: SCANNER_B,
    createdAt: hoursAgo(20),
    action: "message"
  });

  const response = await callBack({ requestId: String(contact._id) });
  assert.equal(response.statusCode, 200, "a message contact with a number must be callable");

  const routed = await collections.pendingCalls.findOne({ requestId: contact._id });
  assert.ok(routed, "it should register a masked route like any other callback");
  assert.equal(routed.targetPhone, SCANNER_B);
});

test("a scanner who stayed anonymous cannot be dialled", async () => {
  // No number was left, so there is nobody to call. The route must refuse
  // rather than resolve some other contact and quietly ring the wrong person.
  const anonymous = {
    _id: new ObjectId(),
    tagId: new ObjectId(),
    token: "cb-tok",
    ownerId: owner._id,
    phone: null,
    action: "message",
    status: "read",
    createdAt: hoursAgo(2)
  };
  await collections.contactRequests.insertOne(anonymous);

  const response = await callBack({ requestId: String(anonymous._id) });
  assert.equal(response.statusCode, 410, "no number means no callback");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("the dashboard publishes the window it enforces", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/owner/dashboard",
    headers: { cookie: `wavetag_session=${cookie}` }
  });
  const body = response.json();

  assert.equal(typeof body.callbackWindowMs, "number");
  assert.equal(body.callbackWindowMs, 48 * 60 * 60 * 1000,
    "the page must not have to guess this — it decides which buttons to draw");
});
