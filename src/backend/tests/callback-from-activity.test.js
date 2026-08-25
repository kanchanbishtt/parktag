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

function minutesAgo(m) {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

// Callback is premium-only, and premium lives on the tag, so a contact is only
// callable when the tag it arrived on exists and is premium. Every contact in
// this file therefore needs a tag behind it.
async function seedTag(forOwnerId, { token, premium = true, deletedAt = null }) {
  const doc = {
    _id: new ObjectId(),
    token,
    ownerId: forOwnerId,
    status: "active",
    premium,
    plateNumber: "DL5CB1234",
    createdAt: new Date().toISOString()
  };
  if (deletedAt) doc.deletedAt = deletedAt;
  await collections.tags.insertOne(doc);
  return doc;
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
  await collections.tags.deleteMany({});

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
  // Rebuilt per test so the premium cases can replace it without leaking into
  // the next one.
  await collections.tags.deleteMany({});
  await seedTag(owner._id, { token: "cb-tok", premium: true });
  await seedTag(intruder._id, { token: "cb-tok-intruder", premium: true });
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
  await collections.tags.deleteMany({});
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

test("a call from minutes ago can be returned", async (t) => {
  if (!env.exotelCallerId) {
    t.skip("EXOTEL_CALLER_ID not configured in this environment");
    return;
  }

  const contact = await seedContact(owner._id, { phone: SCANNER_A, createdAt: minutesAgo(4) });

  const response = await callBack({ requestId: String(contact._id) });
  assert.equal(response.statusCode, 200, "four minutes old is inside the window");
  assert.equal(response.json().ok, true);

  const routed = await collections.pendingCalls.findOne({ requestId: contact._id });
  assert.ok(routed, "a pending call should be registered");
  assert.equal(routed.targetPhone, SCANNER_A, "it must dial the scanner who called");
  assert.equal(routed.type, "owner_to_scanner");
});

test("only the newest contact can be returned", async () => {
  // Both are inside the ten minutes, so the window is not what refuses this —
  // being second is. Ringing the earlier reporter leaves the person still
  // waiting on the newer call with no priority at all.
  const older = await seedContact(owner._id, { phone: SCANNER_A, createdAt: minutesAgo(8) });
  await seedContact(owner._id, { phone: SCANNER_B, createdAt: minutesAgo(1) });

  const response = await callBack({ requestId: String(older._id) });
  assert.equal(response.statusCode, 410);
  assert.equal(response.json().code, "CALLBACK_NOT_LATEST");
  assert.equal(
    await collections.pendingCalls.countDocuments({}), 0,
    "and nothing may be routed to the older caller"
  );
});

test("beyond ten minutes it is refused", async () => {
  const stale = await seedContact(owner._id, { phone: SCANNER_A, createdAt: minutesAgo(11) });

  const response = await callBack({ requestId: String(stale._id) });
  assert.equal(response.statusCode, 410);
  assert.equal(response.json().code, "CALLBACK_WINDOW_EXPIRED");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("another owner's contact cannot be dialled", async () => {
  // The id is real and inside the window — the only thing wrong with it is
  // whose it is. Scoping the lookup by session owner is what refuses it; taking
  // the id on trust would let any signed-in account ring a stranger's scanner.
  const theirs = await seedContact(intruder._id, {
    phone: SCANNER_B, createdAt: minutesAgo(1), token: "cb-tok-intruder"
  });

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
  await seedContact(owner._id, { phone: SCANNER_A, createdAt: minutesAgo(8) });
  const newest = await seedContact(owner._id, { phone: SCANNER_B, createdAt: minutesAgo(1) });

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
    createdAt: minutesAgo(3),
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
    createdAt: minutesAgo(2)
  };
  await collections.contactRequests.insertOne(anonymous);

  const response = await callBack({ requestId: String(anonymous._id) });
  assert.equal(response.statusCode, 410, "no number means no callback");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("the number reaches the screen, not just the dialer", async () => {
  // The desktop half of this feature. `tel:` does nothing in most desktop
  // browsers, so a success that ONLY navigated there left the button reading
  // "Opening dialer…" while the number it wanted dialled was never shown --
  // and the route had already registered a route that expired ten minutes
  // later, unused and unexplained.
  const page = await app.inject({
    method: "GET",
    url: "/owner-welcome",
    headers: { cookie: `wavetag_session=${cookie}` }
  });
  assert.equal(page.statusCode, 200);
  for (const id of ["ptCallBackdrop", "ptCallSheet", "ptCallBody"]) {
    assert.match(page.body, new RegExp(`id="${id}"`), `${id} must ship in the page`);
  }

  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });
  assert.match(js.body, /function openCallSheet/, "the sheet opener must ship");
  assert.match(js.body, /window\.closeCallSheet/, "close must be reachable from its inline onclick");
  assert.match(js.body, /window\.copyCallNumber/, "copy must be reachable from its inline onclick");
  assert.match(js.body, /openCallSheet\(data\.virtualNumber\)/,
    "a successful callback must put the number on screen");
  assert.match(js.body, /if \(deviceCanDial\(\)\)/,
    "tel: must be gated on the device actually having a dialer");
  assert.doesNotMatch(js.body, /textContent = "Opening dialer…"/,
    "the button must not be parked on a state that never resolves without a dialer");
});

test("seen for 48 hours, callable for ten minutes", async () => {
  // The rule, stated as one test. These are two different permissions and the
  // gap between them is deliberate: knowing who rang about your car is a log,
  // ringing a stranger back is an intrusion with a short shelf life.
  const old = await seedContact(owner._id, { phone: SCANNER_A, createdAt: hoursAgo(30) });

  const dash = await app.inject({
    method: "GET",
    url: "/api/owner/dashboard",
    headers: { cookie: `wavetag_session=${cookie}` }
  });
  const row = dash.json().requests.find((r) => r.id === String(old._id));
  assert.ok(row, "a contact from 30 hours ago must still appear in the log");
  assert.ok(row.createdAt, "and must carry its timestamp");

  const response = await callBack({ requestId: String(old._id) });
  assert.equal(response.statusCode, 410, "but it must not be callable");
  assert.equal(response.json().code, "CALLBACK_WINDOW_EXPIRED");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("the page offers one button and takes it away on time", async () => {
  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });

  assert.match(js.body, /const callbackTarget = recent\.find\(isReturnable\) \|\| null/,
    "exactly one contact may be offered");
  assert.match(js.body, /r\.id === callbackTarget\.id/,
    "and the button must be pinned to that row");
  assert.match(js.body, /function scheduleCallbackExpiry/,
    "the button must remove itself when the window closes");
  assert.match(js.body, /function callbackTimeLeft/,
    "and say how long is left, so it expires rather than vanishes");
});

test("the dashboard publishes the window it enforces", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/owner/dashboard",
    headers: { cookie: `wavetag_session=${cookie}` }
  });
  const body = response.json();

  assert.equal(typeof body.callbackWindowMs, "number");
  assert.equal(body.callbackWindowMs, 10 * 60 * 1000,
    "the page must not have to guess this — it decides which buttons to draw");
});
