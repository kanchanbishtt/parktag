// Selling an E-Tag one callback for ₹20.
//
// The rule being pinned down: an E-Tag has no callback at all, and this buys
// exactly one — for one vehicle, against one contact, spent by one dial. Every
// test here is a way that could go wrong and hand somebody a second call, or
// take money for a call that never happens.
//
// The two that matter most:
//
//   A pass is scoped to the contact it was bought for. Without that, ₹20 buys
//   ten minutes of ringing anyone who ever scanned the tag — which is not a
//   one-time callback, it is a very cheap subscription.
//
//   Verifying a payment twice must not yield two dials. The browser and the
//   webhook both credit a pass, and they race by design.

// Before importing anything that reads the environment. Placeholders are the
// safer choice AND the sufficient one: verifying a signature is a local HMAC
// that reaches no API, and the one test that calls create-order is refused
// before an order is minted, so nothing reaches anyone's Razorpay dashboard.
process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";
// register-call refuses without a caller id, and a runner has no telephony
// credentials. Nothing dials — this is the number handed back for the owner to
// ring, not a line anyone connects to.
process.env.EXOTEL_CALLER_ID = "08000000000";

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, createTestOwner, TEST_ORIGIN } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import {
  CALLBACK_PASS_PAISE,
  CALLBACK_PASS_WINDOW_MS,
  callbackPassState,
  canPurchaseCallbackPass,
  hasLiveCallbackPass,
  PASS_NOT_APPLICABLE,
  PASS_PURCHASABLE,
  PASS_READY,
  PASS_SPENT
} from "../lib/core/callback-pass.js";

const FREE_WINDOW_MS = 10 * 60 * 1000;

let app;
let collections;

const ORIGIN = TEST_ORIGIN;
const OWNER_MOBILE = "+919000007710";
const SCANNER_A = "+919000007711";
const SCANNER_B = "+919000007712";
const ETAG_TOKEN = "pass-etag-tok";

let owner;
let cookie;

function minutesAgo(m) {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

async function seedTag({ token = ETAG_TOKEN, premium = false, callbackPass = undefined } = {}) {
  const doc = {
    _id: new ObjectId(),
    token,
    ownerId: owner._id,
    status: "active",
    premium,
    plateNumber: "DL9CP7788",
    createdAt: new Date().toISOString()
  };
  if (callbackPass !== undefined) doc.callbackPass = callbackPass;
  await collections.tags.insertOne(doc);
  return doc;
}

async function seedContact({ token = ETAG_TOKEN, phone = SCANNER_A, createdAt = minutesAgo(1) } = {}) {
  const doc = {
    _id: new ObjectId(),
    tagId: new ObjectId(),
    token,
    ownerId: owner._id,
    phone,
    action: "call",
    status: "connecting",
    createdAt
  };
  await collections.contactRequests.insertOne(doc);
  return doc;
}

// Seeded rather than created through create-order: minting one would call the
// real Razorpay API with a placeholder key.
async function seedOrder({ tag, contact, amount = CALLBACK_PASS_PAISE, ownerId = null }) {
  const orderId = `order_cb_${crypto.randomBytes(6).toString("hex")}`;
  await collections.callbackOrders.insertOne({
    orderId,
    ownerId: ownerId || owner._id,
    tagId: tag._id,
    token: tag.token,
    requestId: contact._id,
    amount,
    currency: "INR",
    status: "created",
    createdAt: new Date().toISOString()
  });
  return orderId;
}

// What Razorpay would send back: a local HMAC over `order_id|payment_id`.
function sign(orderId, paymentId) {
  return crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

const authed = (url, payload) =>
  app.inject({
    method: "POST",
    url,
    headers: {
      origin: ORIGIN,
      cookie: `wavetag_session=${cookie}`,
      "content-type": "application/json"
    },
    payload
  });

const callBack = (body) => authed("/api/owner/callback/register-call", body);

function verify(orderId, paymentId = "pay_cb_ok") {
  return authed("/api/owner/callback/verify-payment", {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: sign(orderId, paymentId)
  });
}

test.before(async () => {
  ({ app, collections } = await startTestApp());
  owner = await createTestOwner(collections, {
    email: "cb-pass@example.invalid",
    displayName: "Pass Owner"
  });
  await collections.owners.updateOne(
    { _id: owner._id },
    { $set: { mobile: OWNER_MOBILE, phone: OWNER_MOBILE, mobileVerified: true } }
  );
  cookie = await createSession(app, {
    id: String(owner._id), role: "owner", email: "cb-pass@example.invalid"
  });
});

test.beforeEach(async () => {
  await collections.tags.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});
  await collections.callbackOrders.deleteMany({});
  // The routes are rate limited and the counters live in Mongo, so without this
  // the later tests read the earlier tests' 429s.
  await collections.rateLimits.deleteMany({});
});

test.after(async () => {
  await collections.owners.deleteMany({});
  await collections.tags.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});
  await collections.callbackOrders.deleteMany({});
  await stopTestApp(app);
});

// ── the rules, on their own ────────────────────────────────────────────────

test("a premium tag is not in this market at all", () => {
  assert.equal(callbackPassState({ premium: true }), PASS_NOT_APPLICABLE);
  // Even carrying a stale pass field: callEntitlement decides for premium tags.
  assert.equal(
    callbackPassState({ premium: true, callbackPass: { paidAt: new Date().toISOString() } }),
    PASS_NOT_APPLICABLE
  );
});

test("an E-Tag starts purchasable and ends spent", () => {
  assert.equal(callbackPassState({ premium: false }), PASS_PURCHASABLE);

  const paidAt = new Date().toISOString();
  assert.equal(callbackPassState({ premium: false, callbackPass: { paidAt, usedAt: null } }), PASS_READY);

  assert.equal(
    callbackPassState({ premium: false, callbackPass: { paidAt, usedAt: new Date().toISOString() } }),
    PASS_SPENT
  );
});

test("a pass that was paid for and never used dies with its window", () => {
  const paidAt = new Date(Date.now() - CALLBACK_PASS_WINDOW_MS - 1000).toISOString();
  assert.equal(callbackPassState({ premium: false, callbackPass: { paidAt, usedAt: null } }), PASS_SPENT);
});

test("a malformed paid date reads as spent, never as unlimited", () => {
  assert.equal(
    callbackPassState({ premium: false, callbackPass: { paidAt: "not-a-date", usedAt: null } }),
    PASS_SPENT
  );
});

test("the offer is withdrawn near the end of the free window", () => {
  const tag = { premium: false };
  const opts = (mins) => ({
    contactCreatedAt: minutesAgo(mins),
    freeWindowMs: FREE_WINDOW_MS
  });

  assert.equal(canPurchaseCallbackPass(tag, opts(1)), true, "9 minutes left should be offered");
  assert.equal(canPurchaseCallbackPass(tag, opts(6)), true, "4 minutes left should be offered");
  assert.equal(canPurchaseCallbackPass(tag, opts(8)), false, "2 minutes left is too little to sell");
  assert.equal(canPurchaseCallbackPass(tag, opts(30)), false, "a closed window sells nothing");
});

test("a live pass authorises the contact it was bought for and no other", () => {
  const bought = new ObjectId();
  const other = new ObjectId();
  const tag = {
    premium: false,
    callbackPass: { paidAt: new Date().toISOString(), usedAt: null, requestId: bought }
  };

  assert.equal(hasLiveCallbackPass(tag, bought), true);
  assert.equal(hasLiveCallbackPass(tag, other), false);
});

// ── the routes ─────────────────────────────────────────────────────────────

test("an E-Tag with no pass still cannot call back", async () => {
  await seedTag();
  const contact = await seedContact();

  const res = await callBack({ requestId: String(contact._id) });

  assert.equal(res.statusCode, 402);
  assert.equal(res.json().code, "PREMIUM_REQUIRED");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("paying registers the call in the same request", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact });

  const res = await verify(orderId);

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.ok(body.virtualNumber, "the number to dial comes back with the payment");

  // The bridge exists, pointed at the right person.
  const pending = await collections.pendingCalls.findOne({});
  assert.ok(pending, "a pending call was registered");
  assert.equal(pending.targetPhone, SCANNER_A);
  assert.equal(pending.callerPhone, OWNER_MOBILE);

  // And the pass is spent by that dial.
  const after = await collections.tags.findOne({ _id: tag._id });
  assert.ok(after.callbackPass.paidAt, "the pass was stamped paid");
  assert.ok(after.callbackPass.usedAt, "the pass was spent by the dial");
  assert.equal(callbackPassState(after), PASS_SPENT);

  const order = await collections.callbackOrders.findOne({ orderId });
  assert.equal(order.status, "paid");
});

test("confirming the same payment twice does not buy a second call", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact });

  const first = await verify(orderId);
  const second = await verify(orderId);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 409, "the replay is refused");
  assert.equal(second.json().code, "PASS_SPENT");
  assert.equal(
    await collections.pendingCalls.countDocuments({}),
    1,
    "one payment, one bridge"
  );
});

test("a paid pass calls back the contact it was bought for", async () => {
  const tag = await seedTag({
    callbackPass: { paidAt: new Date().toISOString(), usedAt: null, requestId: null }
  });
  const contact = await seedContact();
  // Point the seeded pass at this contact.
  await collections.tags.updateOne(
    { _id: tag._id },
    { $set: { "callbackPass.requestId": contact._id } }
  );

  const res = await callBack({ requestId: String(contact._id) });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);

  const after = await collections.tags.findOne({ _id: tag._id });
  assert.ok(after.callbackPass.usedAt, "the dial spent the pass");
});

test("a pass bought for one contact cannot ring another", async () => {
  const tag = await seedTag();
  const paidFor = await seedContact({ phone: SCANNER_A, createdAt: minutesAgo(4) });
  // A newer contact on the same tag, which the pass was NOT bought for.
  const newer = await seedContact({ phone: SCANNER_B, createdAt: minutesAgo(1) });

  await collections.tags.updateOne(
    { _id: tag._id },
    { $set: { callbackPass: { paidAt: new Date().toISOString(), usedAt: null, requestId: paidFor._id } } }
  );

  // Naming the newer contact is refused outright: the pass is not theirs.
  const named = await callBack({ requestId: String(newer._id) });
  assert.equal(named.statusCode, 402);
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);

  // The id-less form (the banner's button) rings the person who was paid
  // for — not the newer contact, even though it is more recent.
  const idless = await callBack({});
  assert.equal(idless.statusCode, 200);
  const pending = await collections.pendingCalls.find({}).toArray();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].targetPhone, SCANNER_A, "the paid-for person, never the newer one");
});

test("a paid pass outlives the contact's own ten minutes", async () => {
  // The case that stranded money: the call could not be placed at payment
  // (or the webhook credited the pass after the tab closed), and the owner
  // comes back once the contact's free window has gone. The payment bought a
  // fresh ten minutes from when it was verified, and that is what counts.
  const tag = await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(12) });
  await collections.tags.updateOne(
    { _id: tag._id },
    { $set: { callbackPass: { paidAt: minutesAgo(2), usedAt: null, requestId: contact._id } } }
  );

  const res = await callBack({ requestId: String(contact._id) });

  assert.equal(res.statusCode, 200, "a live pass is honoured past the contact's own window");
  const after = await collections.tags.findOne({ _id: tag._id });
  assert.ok(after.callbackPass.usedAt, "and the dial spends it");
});

test("a newer contact on another vehicle does not void a paid callback", async () => {
  const etag = await seedTag();
  const premium = await seedTag({ token: "pass-premium-tok", premium: true });
  // Premium tags need an entitlement window; a fresh premiumSince gives one.
  await collections.tags.updateOne({ _id: premium._id }, { $set: { premiumSince: new Date().toISOString() } });

  const paidFor = await seedContact({ phone: SCANNER_A, createdAt: minutesAgo(4) });
  await seedContact({ token: premium.token, phone: SCANNER_B, createdAt: minutesAgo(1) });
  await collections.tags.updateOne(
    { _id: etag._id },
    { $set: { callbackPass: { paidAt: minutesAgo(1), usedAt: null, requestId: paidFor._id } } }
  );

  const res = await callBack({ requestId: String(paidFor._id) });

  assert.equal(res.statusCode, 200, "the paid contact is dialled as named");
  const pending = await collections.pendingCalls.findOne({});
  assert.equal(pending.targetPhone, SCANNER_A);
});

test("an older contact on the same vehicle cannot be bought", async () => {
  // Refused before any Razorpay order is minted, so this never reaches the
  // payments API.
  await seedTag();
  const older = await seedContact({ phone: SCANNER_A, createdAt: minutesAgo(4) });
  await seedContact({ phone: SCANNER_B, createdAt: minutesAgo(1) });

  const res = await authed("/api/owner/callback/create-order", { requestId: String(older._id) });

  assert.equal(res.statusCode, 410);
  assert.equal(res.json().code, "CALLBACK_NOT_LATEST");
  assert.equal(await collections.callbackOrders.countDocuments({}), 0, "no order was minted");
});

test("a spent pass sends them to premium, not to a second payment", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  await collections.tags.updateOne(
    { _id: tag._id },
    {
      $set: {
        callbackPass: {
          paidAt: minutesAgo(2),
          usedAt: minutesAgo(1),
          requestId: contact._id
        }
      }
    }
  );

  const res = await callBack({ requestId: String(contact._id) });

  assert.equal(res.statusCode, 402);
  assert.equal(res.json().code, "PREMIUM_REQUIRED");
});

test("a pass whose own window has closed no longer dials", async () => {
  const tag = await seedTag();
  // Inside the FREE window, so only the pass's own expiry can refuse this.
  const contact = await seedContact({ createdAt: minutesAgo(2) });
  await collections.tags.updateOne(
    { _id: tag._id },
    {
      $set: {
        callbackPass: {
          paidAt: new Date(Date.now() - CALLBACK_PASS_WINDOW_MS - 1000).toISOString(),
          usedAt: null,
          requestId: contact._id
        }
      }
    }
  );

  const res = await callBack({ requestId: String(contact._id) });

  assert.equal(res.statusCode, 402);
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("a signature valid for somebody else's order is refused", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact, ownerId: new ObjectId() });

  const res = await verify(orderId);

  assert.equal(res.statusCode, 403);
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("an order minted at the wrong price is not settled", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact, amount: 100 });

  const res = await verify(orderId);

  assert.equal(res.statusCode, 400);
  const after = await collections.tags.findOne({ _id: tag._id });
  assert.equal(after.callbackPass, undefined, "no pass was granted");
});

test("a forged signature grants nothing", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact });

  const res = await authed("/api/owner/callback/verify-payment", {
    razorpay_order_id: orderId,
    razorpay_payment_id: "pay_forged",
    razorpay_signature: "0".repeat(64)
  });

  assert.equal(res.statusCode, 400);
  const after = await collections.tags.findOne({ _id: tag._id });
  assert.equal(after.callbackPass, undefined);
});

// ── the page ───────────────────────────────────────────────────────────────

// The ₹20 button first shipped invisible. The server published the threshold
// and the price, the rule module handled them correctly, and every test above
// passed — but the dashboard script declared both with fail-closed defaults and
// never assigned them from the payload. The threshold stayed at Infinity, so
// every E-Tag row resolved to not-callable and drew nothing at all.
//
// So this checks the seam that broke, generically: every callback number the
// dashboard publishes must actually be read by the page. A field added to one
// side and not the other fails here instead of on somebody's phone.
test("the page reads every callback number the dashboard publishes", async () => {
  const dash = await app.inject({
    method: "GET",
    url: "/api/owner/dashboard",
    headers: { origin: ORIGIN, cookie: `wavetag_session=${cookie}` }
  });
  assert.equal(dash.statusCode, 200);

  const published = Object.keys(dash.json()).filter((key) => /^callback/.test(key));
  assert.ok(
    published.includes("callbackPassMinRemainingMs") && published.includes("callbackPassPaise"),
    `the dashboard should publish the pass threshold and price, got: ${published.join(", ")}`
  );

  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });
  assert.equal(js.statusCode, 200);
  for (const field of published) {
    assert.match(js.body, new RegExp(String.raw`data\.${field}\b`), `the page never reads ${field}`);
  }
});

// ── what each row shows, from the module the page itself loads ─────────────

test("each E-Tag row draws the right control at every point in its life", async () => {
  const rules = await import("../../frontend/scripts/owner/callback-eligibility.js");
  const WINDOW = 10 * 60 * 1000;
  const MIN_LEFT = 3 * 60 * 1000;
  const now = Date.now();

  const etag = (pass) => ({
    token: "t",
    premium: false,
    callAccess: { tier: "etag-used", masking: false, premium: false },
    callbackPass: pass
  });
  const row = (minutesOld) => ({
    id: "row-1",
    token: "t",
    phone: "+919999999994",
    callOutcome: null,
    createdAt: new Date(now - minutesOld * 60e3).toISOString()
  });
  const state = (tag, r, passMinRemainingMs = MIN_LEFT) =>
    rules.callbackState(r, { tags: [tag], now, windowMs: WINDOW, passMinRemainingMs });
  const purchasable = { state: "purchasable", requestId: null, expiresAt: null };

  assert.equal(state(etag(purchasable), row(1)), rules.NEEDS_PAYMENT, "early in the window: offer ₹20");
  assert.equal(state(etag(purchasable), row(8)), rules.NEEDS_PREMIUM,
    "under the threshold: back to the premium nudge, not an empty row");
  assert.equal(state(etag(purchasable), row(1), Infinity), rules.NEEDS_PREMIUM,
    "threshold never received: the nudge, not an empty row (the production bug)");
  assert.equal(state(etag(purchasable), row(30)), rules.NOT_CALLABLE, "past the window: nothing");

  const live = { state: "ready", requestId: "row-1", expiresAt: new Date(now + 8 * 60e3).toISOString() };
  assert.equal(state(etag(live), row(12)), rules.CALLABLE,
    "a live pass is callable past the contact's own window");
  assert.equal(state(etag(live), { ...row(2), id: "someone-else" }), rules.NEEDS_PREMIUM,
    "but only for the row it was bought for");

  const lapsed = { state: "ready", requestId: "row-1", expiresAt: new Date(now - 1000).toISOString() };
  assert.equal(state(etag(lapsed), row(2)), rules.PASS_SPENT,
    "a pass whose clock ran out while the page sat open reads as spent");

  assert.equal(state(etag({ state: "spent", requestId: null, expiresAt: null }), row(1)), rules.PASS_SPENT);
});
