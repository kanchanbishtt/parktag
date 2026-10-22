// Buying back a premium tag's callback for ₹20 once its free ten minutes are
// over.
//
// The rule being pinned down: a premium tag includes calling a scanner back for
// ten minutes from their contact. After that the owner may pay ₹20 to reopen
// it — for one contact, for ten minutes from the payment. Every test here is a
// way that could go wrong and take money for a call that never happens, sell
// something the tag already includes, or hand out more than was paid for.
//
// The ones that matter most:
//
//   A payment is scoped to the contact it was bought for. Without that, ₹20
//   buys ten minutes of ringing anyone who ever scanned the vehicle.
//
//   Confirming a payment twice must not restart its clock. The browser and the
//   webhook both settle an order, and they race by design.
//
//   Nothing is sold to a tag that is not premium, to a premium tag whose call
//   service has lapsed, or for a contact still inside its free window.

// Before the app is built. Placeholders are the safer choice AND the sufficient
// one: verifying a signature is a local HMAC that reaches no API, and every
// create-order test here is either refused before an order is minted or handed
// back an order already on file — nothing reaches anyone's Razorpay dashboard.
// (Assigned in the module body, after helpers.js has cleared the ambient
// RAZORPAY_* variables at import, and before startTestApp() reads them.)
process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "ci_placeholder_webhook_secret";

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, createTestOwner, uniqueAddress, TEST_ORIGIN } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import {
  CALLBACK_PASS_MAX_AGE_MS,
  CALLBACK_PASS_PAISE,
  CALLBACK_PASS_WINDOW_MS,
  callbackPassEndsAt,
  callbackPassOffer,
  isLiveCallbackPass,
  OFFER_AVAILABLE,
  OFFER_INCLUDED,
  OFFER_PREMIUM_REQUIRED,
  OFFER_SUBSCRIPTION_REQUIRED,
  OFFER_TOO_OLD
} from "../lib/core/callback-pass.js";

const FREE_WINDOW_MS = 10 * 60 * 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

let app;
let collections;

const ORIGIN = TEST_ORIGIN;
const OWNER_EMAIL = "cb-pass@example.invalid";
const OWNER_MOBILE = "+919000007710";
const SCANNER_A = "+919000007711";
const SCANNER_B = "+919000007712";
const PREMIUM_TOKEN = "pass-premium-tok";

// What callEntitlement() returns for the three kinds of tag this cares about.
const RUNNING = { premium: true, masking: true };
const LAPSED = { premium: true, masking: false };
const ETAG_UNUSED = { premium: false, masking: true };

let owner;
let cookie;

function minutesAgo(m) {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

// A premium tag inside its first year — masking running — unless `lapsed`,
// which dates it two years back with no subscription.
async function seedTag({ token = PREMIUM_TOKEN, premium = true, lapsed = false, extra = {} } = {}) {
  const doc = {
    _id: new ObjectId(),
    token,
    ownerId: owner._id,
    status: "active",
    premium,
    plateNumber: `DL9CP${Math.floor(1000 + Math.random() * 9000)}`,
    createdAt: lapsed ? new Date(Date.now() - 2 * YEAR_MS).toISOString() : new Date().toISOString(),
    ...(premium ? {} : { freeContactUsed: true }),
    ...extra
  };
  await collections.tags.insertOne(doc);
  return doc;
}

async function seedContact({ token = PREMIUM_TOKEN, phone = SCANNER_A, createdAt = minutesAgo(15), extra = {} } = {}) {
  const doc = {
    _id: new ObjectId(),
    tagId: new ObjectId(),
    token,
    ownerId: owner._id,
    phone,
    action: "call",
    status: "connecting",
    createdAt,
    ...extra
  };
  await collections.contactRequests.insertOne(doc);
  return doc;
}

// Seeded rather than created through create-order: minting one would call the
// real Razorpay API with a placeholder key.
async function seedOrder({ tag, contact, amount = CALLBACK_PASS_PAISE, ownerId = null, paidAt = null }) {
  const orderId = `order_cb_${crypto.randomBytes(6).toString("hex")}`;
  await collections.callbackOrders.insertOne({
    orderId,
    ownerId: ownerId || owner._id,
    tagId: tag._id,
    token: tag.token,
    requestId: contact._id,
    amount,
    currency: "INR",
    status: paidAt ? "paid" : "created",
    ...(paidAt ? { paidAt, paymentId: "pay_seeded" } : {}),
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
const createOrder = (contact) =>
  authed("/api/owner/callback/create-order", { requestId: String(contact._id) });

function verify(orderId, paymentId = "pay_cb_ok") {
  return authed("/api/owner/callback/verify-payment", {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: sign(orderId, paymentId)
  });
}

// Razorpay signs the exact bytes it sends, so this signs the exact bytes it
// sends too — a pre-serialised string rather than an object for the injector.
function webhook(orderId, paymentId = "pay_cb_webhook") {
  const raw = JSON.stringify({
    event: "order.paid",
    payload: {
      order: { entity: { id: orderId, amount: CALLBACK_PASS_PAISE, currency: "INR" } },
      payment: { entity: { id: paymentId, order_id: orderId, amount: CALLBACK_PASS_PAISE } }
    }
  });
  return app.inject({
    method: "POST",
    url: "/api/provider/razorpay/webhook",
    remoteAddress: uniqueAddress(),
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(raw)
        .digest("hex")
    },
    payload: raw
  });
}

async function dashboard() {
  const res = await app.inject({
    method: "GET",
    url: "/api/owner/dashboard",
    headers: { origin: ORIGIN, cookie: `wavetag_session=${cookie}` }
  });
  assert.equal(res.statusCode, 200);
  return res.json();
}

test.before(async () => {
  ({ app, collections } = await startTestApp());
  owner = await createTestOwner(collections, { email: OWNER_EMAIL, displayName: "Pass Owner" });
  await collections.owners.updateOne(
    { _id: owner._id },
    { $set: { mobile: OWNER_MOBILE, phone: OWNER_MOBILE, mobileVerified: true } }
  );
  cookie = await createSession(app, { id: String(owner._id), role: "owner", email: OWNER_EMAIL });
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
  await collections.owners.deleteMany({ email: OWNER_EMAIL });
  await collections.sessions.deleteMany({ userId: String(owner._id) });
  await collections.tags.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});
  await collections.callbackOrders.deleteMany({});
  await stopTestApp(app);
});

// ── the rules, on their own ────────────────────────────────────────────────

test("the offer opens only once the free window has closed", () => {
  const offer = (mins) =>
    callbackPassOffer(RUNNING, { contactCreatedAt: minutesAgo(mins), freeWindowMs: FREE_WINDOW_MS });

  assert.equal(offer(5), OFFER_INCLUDED, "inside the free window the call is included");
  assert.equal(
    callbackPassOffer(RUNNING, {
      contactCreatedAt: new Date(1_000_000).toISOString(),
      now: 1_000_000 + FREE_WINDOW_MS,
      freeWindowMs: FREE_WINDOW_MS
    }),
    OFFER_INCLUDED,
    "the boundary itself still belongs to the free window, as it does in register-call"
  );
  assert.equal(offer(11), OFFER_AVAILABLE, "just past it, the callback can be bought back");
  assert.equal(offer(47 * 60), OFFER_AVAILABLE, "for as long as the activity list shows the contact");
  assert.equal(offer(49 * 60), OFFER_TOO_OLD, "and not after");
  assert.equal(
    callbackPassOffer(RUNNING, { contactCreatedAt: "not a date", freeWindowMs: FREE_WINDOW_MS }),
    OFFER_TOO_OLD,
    "junk in, nothing sold"
  );
  assert.equal(CALLBACK_PASS_MAX_AGE_MS, 48 * 60 * 60 * 1000);
});

test("nothing is sold to an E-Tag or to a premium tag whose call service lapsed", () => {
  const opts = { contactCreatedAt: minutesAgo(30), freeWindowMs: FREE_WINDOW_MS };
  // An E-Tag whose free contact is unused reads masking: true — that is the
  // scanner's side — and must still not be sold the owner's callback.
  assert.equal(callbackPassOffer(ETAG_UNUSED, opts), OFFER_PREMIUM_REQUIRED);
  assert.equal(callbackPassOffer({ premium: false, masking: false }, opts), OFFER_PREMIUM_REQUIRED);
  assert.equal(callbackPassOffer(LAPSED, opts), OFFER_SUBSCRIPTION_REQUIRED);
  assert.equal(callbackPassOffer(null, opts), OFFER_PREMIUM_REQUIRED);
});

test("a paid callback runs ten minutes from the payment, and junk runs nothing", () => {
  const paidAt = new Date().toISOString();
  const order = { status: "paid", paidAt };

  assert.equal(callbackPassEndsAt(order), Date.parse(paidAt) + CALLBACK_PASS_WINDOW_MS);
  assert.equal(isLiveCallbackPass(order), true);
  assert.equal(isLiveCallbackPass({ status: "paid", paidAt: minutesAgo(11) }), false, "its ten minutes are over");
  assert.equal(isLiveCallbackPass({ status: "created", paidAt }), false, "an unpaid order is nothing");
  assert.equal(isLiveCallbackPass({ status: "paid", paidAt: "not-a-date" }), false, "never unlimited");
  assert.equal(isLiveCallbackPass(null), false);
});

// ── create-order: what may be sold ─────────────────────────────────────────

test("an E-Tag contact is not sold a callback", async () => {
  await seedTag({ token: "pass-etag-tok", premium: false });
  const contact = await seedContact({ token: "pass-etag-tok" });

  const res = await createOrder(contact);

  assert.equal(res.statusCode, 402);
  assert.equal(res.json().code, "PREMIUM_REQUIRED");
  assert.equal(await collections.callbackOrders.countDocuments({}), 0, "no order was minted");
});

test("a lapsed premium tag is told to renew, not sold a call", async () => {
  await seedTag({ lapsed: true });
  const contact = await seedContact();

  const res = await createOrder(contact);

  assert.equal(res.statusCode, 402);
  assert.equal(res.json().code, "CALL_SUBSCRIPTION_REQUIRED");
  assert.equal(await collections.callbackOrders.countDocuments({}), 0);
});

test("a contact still inside its free window is not charged for", async () => {
  await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(3) });

  const res = await createOrder(contact);

  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, "CALLBACK_INCLUDED", "the page answers this by placing the free call");
  assert.equal(await collections.callbackOrders.countDocuments({}), 0);
});

test("a contact older than the activity list is not sold", async () => {
  await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(49 * 60) });

  const res = await createOrder(contact);

  assert.equal(res.statusCode, 410);
  assert.equal(res.json().code, "CALLBACK_WINDOW_EXPIRED");
  assert.equal(await collections.callbackOrders.countDocuments({}), 0);
});

test("only the newest contact on a vehicle can be bought", async () => {
  await seedTag();
  const older = await seedContact({ phone: SCANNER_A, createdAt: minutesAgo(40) });
  await seedContact({ phone: SCANNER_B, createdAt: minutesAgo(20) });

  const res = await createOrder(older);

  assert.equal(res.statusCode, 410);
  assert.equal(res.json().code, "CALLBACK_NOT_LATEST");
  assert.equal(await collections.callbackOrders.countDocuments({}), 0);
});

test("a started checkout is handed back rather than a second one minted", async () => {
  // Also covers "newer" the way the page counts it: a newer contact that
  // ended in a conversation does not stop the one before it being bought.
  const tag = await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(40) });
  await seedContact({ phone: SCANNER_B, createdAt: minutesAgo(20), extra: { callOutcome: "answered" } });
  const orderId = await seedOrder({ tag, contact });

  const res = await createOrder(contact);

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.orderId, orderId, "the order already on file comes back");
  assert.equal(body.amount, CALLBACK_PASS_PAISE);
  assert.equal(body.keyId, process.env.RAZORPAY_KEY_ID);
  assert.equal(await collections.callbackOrders.countDocuments({}), 1, "and no second one is minted");
});

test("a contact already paid for is not charged twice", async () => {
  const tag = await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(40) });
  await seedOrder({ tag, contact, paidAt: minutesAgo(2) });
  // Checked before recency: a stale tab offering the price on a row the owner
  // has since paid for must hear "already paid", never "not the latest".
  await seedContact({ phone: SCANNER_B, createdAt: minutesAgo(1) });

  const res = await createOrder(contact);

  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, "PASS_ALREADY_PAID");
  assert.ok(res.json().expiresAt, "and says until when");
  assert.equal(await collections.callbackOrders.countDocuments({}), 1);
});

test("an owner with no mobile is not charged for a call that cannot be placed", async () => {
  await seedTag();
  const contact = await seedContact();
  await collections.owners.updateOne({ _id: owner._id }, { $unset: { mobile: "" } });

  try {
    const res = await createOrder(contact);
    assert.equal(res.statusCode, 402);
    assert.equal(res.json().code, "NO_PHONE");
    assert.equal(await collections.callbackOrders.countDocuments({}), 0);
  } finally {
    await collections.owners.updateOne({ _id: owner._id }, { $set: { mobile: OWNER_MOBILE } });
  }
});

// ── verify-payment: the money and the call, together ───────────────────────

test("paying places the call in the same request", async () => {
  const tag = await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(25) });
  const orderId = await seedOrder({ tag, contact });

  const res = await verify(orderId);

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.ok(body.virtualNumber, "the number to dial comes back with the payment");
  const ends = Date.parse(body.expiresAt);
  assert.ok(Math.abs(ends - (Date.now() + CALLBACK_PASS_WINDOW_MS)) < 5000, "ten minutes from now");

  // The bridge exists, pointed at the right person, from the right handset.
  const pending = await collections.pendingCalls.find({}).toArray();
  assert.equal(pending.length, 1, "a pending call was registered");
  assert.equal(pending[0].targetPhone, SCANNER_A);
  assert.equal(pending[0].callerPhone, OWNER_MOBILE);
  assert.equal(pending[0].type, "owner_to_scanner");

  const order = await collections.callbackOrders.findOne({ orderId });
  assert.equal(order.status, "paid");
  assert.equal(order.paymentId, "pay_cb_ok");
  assert.ok(order.paidAt);
});

test("confirming the same payment twice does not restart its ten minutes", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact });

  const first = await verify(orderId);
  const paidAt = (await collections.callbackOrders.findOne({ orderId })).paidAt;
  const second = await verify(orderId);

  assert.equal(first.statusCode, 200);
  // A replay inside the paid window is the owner pressing Call Back again:
  // harmless, and what a dropped connection's retry looks like.
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().expiresAt, first.json().expiresAt, "the same ten minutes");
  const order = await collections.callbackOrders.findOne({ orderId });
  assert.equal(order.paidAt, paidAt, "paidAt did not move");
});

test("a replay after the ten minutes is refused", async () => {
  const tag = await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(40) });
  const orderId = await seedOrder({ tag, contact, paidAt: minutesAgo(11) });

  const res = await verify(orderId);

  assert.equal(res.statusCode, 410);
  assert.equal(res.json().code, "PASS_EXPIRED");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("a signature valid for somebody else's order is refused", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact, ownerId: new ObjectId() });

  const res = await verify(orderId);

  assert.equal(res.statusCode, 403);
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
  assert.equal((await collections.callbackOrders.findOne({ orderId })).status, "created");
});

test("an order minted at the wrong price is not settled", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact, amount: 100 });

  const res = await verify(orderId);

  assert.equal(res.statusCode, 400);
  assert.equal((await collections.callbackOrders.findOne({ orderId })).status, "created");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
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
  assert.equal((await collections.callbackOrders.findOne({ orderId })).status, "created");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

// ── the webhook: the payment the browser never confirmed ───────────────────

test("the webhook settles a payment the browser never confirmed, and the row can call", async () => {
  const tag = await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(30) });
  const orderId = await seedOrder({ tag, contact });

  const hook = await webhook(orderId);

  assert.equal(hook.statusCode, 200);
  assert.equal(hook.json().fulfilled, true);
  const order = await collections.callbackOrders.findOne({ orderId });
  assert.equal(order.status, "paid");
  assert.equal(order.paymentId, "pay_cb_webhook");
  // It settles the payment and nothing more: ringing an owner who has walked
  // away from the tab is not something a retrying webhook should do.
  assert.equal(await collections.pendingCalls.countDocuments({}), 0, "no call is placed by the webhook");

  // The owner comes back: the row carries the paid callback, and it dials.
  const dash = await dashboard();
  const row = dash.requests.find((r) => r.id === String(contact._id));
  assert.ok(row.callbackPassExpiresAt, "the row carries the paid callback");

  const res = await callBack({ requestId: String(contact._id) });
  assert.equal(res.statusCode, 200);
});

test("a webhook arriving after the browser changes nothing", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact });

  await verify(orderId);
  const settled = await collections.callbackOrders.findOne({ orderId });
  const hook = await webhook(orderId);

  assert.equal(hook.statusCode, 200);
  assert.equal(hook.json().fulfilled, false);
  const after = await collections.callbackOrders.findOne({ orderId });
  assert.equal(after.paidAt, settled.paidAt, "the clock did not restart");
  assert.equal(after.paymentId, settled.paymentId);
});

test("a verify after the webhook runs on the webhook's clock", async () => {
  const tag = await seedTag();
  const contact = await seedContact();
  const orderId = await seedOrder({ tag, contact });

  await webhook(orderId);
  const settled = await collections.callbackOrders.findOne({ orderId });
  const res = await verify(orderId);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().expiresAt, new Date(callbackPassEndsAt(settled)).toISOString());
  assert.equal(await collections.pendingCalls.countDocuments({}), 1, "and it still places the call");
});

// ── register-call: honouring what was paid for ─────────────────────────────

test("without a payment, a premium contact past its window is refused with the code that brings up ₹20", async () => {
  await seedTag();
  await seedTag({ token: "pass-second-tok" });
  const old = await seedContact({ createdAt: minutesAgo(30) });
  // Something else IS callable right now. Naming the old row must still be
  // told its window is over, not that it is "not the latest".
  await seedContact({ token: "pass-second-tok", phone: SCANNER_B, createdAt: minutesAgo(2) });

  const res = await callBack({ requestId: String(old._id) });

  assert.equal(res.statusCode, 410);
  assert.equal(res.json().code, "CALLBACK_WINDOW_EXPIRED");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("a paid callback is honoured past the contact's own window, redial included", async () => {
  const tag = await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(45) });
  await seedOrder({ tag, contact, paidAt: minutesAgo(2) });

  const first = await callBack({ requestId: String(contact._id) });
  const again = await callBack({ requestId: String(contact._id) });

  assert.equal(first.statusCode, 200);
  assert.equal(again.statusCode, 200, "redialling inside the paid ten minutes is part of what was bought");
  const pending = await collections.pendingCalls.find({}).toArray();
  assert.ok(pending.every((p) => p.targetPhone === SCANNER_A));
});

test("a paid callback ends with its ten minutes", async () => {
  const tag = await seedTag();
  const contact = await seedContact({ createdAt: minutesAgo(45) });
  await seedOrder({ tag, contact, paidAt: minutesAgo(11) });

  const res = await callBack({ requestId: String(contact._id) });

  assert.equal(res.statusCode, 410);
  assert.equal(res.json().code, "CALLBACK_WINDOW_EXPIRED");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("a payment for one contact cannot ring another", async () => {
  const tag = await seedTag();
  const paidFor = await seedContact({ phone: SCANNER_A, createdAt: minutesAgo(40) });
  const other = await seedContact({ phone: SCANNER_B, createdAt: minutesAgo(30) });
  await seedOrder({ tag, contact: paidFor, paidAt: minutesAgo(1) });

  // Naming the other contact is refused: the payment is not theirs.
  const named = await callBack({ requestId: String(other._id) });
  assert.equal(named.statusCode, 410);
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);

  // The id-less form rings the person who was paid for, never anyone else.
  const idless = await callBack({});
  assert.equal(idless.statusCode, 200);
  const pending = await collections.pendingCalls.find({}).toArray();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].targetPhone, SCANNER_A);
});

test("a newer contact on another vehicle does not void a paid callback", async () => {
  const tag = await seedTag();
  await seedTag({ token: "pass-second-tok" });
  const paidFor = await seedContact({ phone: SCANNER_A, createdAt: minutesAgo(40) });
  await seedContact({ token: "pass-second-tok", phone: SCANNER_B, createdAt: minutesAgo(1) });
  await seedOrder({ tag, contact: paidFor, paidAt: minutesAgo(1) });

  const res = await callBack({ requestId: String(paidFor._id) });

  assert.equal(res.statusCode, 200, "the paid contact is dialled as named");
  const pending = await collections.pendingCalls.findOne({});
  assert.equal(pending.targetPhone, SCANNER_A);
});

test("a premium member past the first year can still call back inside the window", async () => {
  // A paid membership is written to `tag.subscription`. register-call used to
  // project only `callSubscription`, read the member as lapsed, and refuse the
  // callback the dashboard was offering.
  await seedTag({
    lapsed: true,
    extra: { subscription: { status: "active", currentPeriodEnd: new Date(Date.now() + YEAR_MS).toISOString() } }
  });
  const contact = await seedContact({ createdAt: minutesAgo(2) });

  const res = await callBack({ requestId: String(contact._id) });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});

// ── the dashboard and the page ─────────────────────────────────────────────

test("the dashboard carries each paid callback's end on its own row", async () => {
  const tag = await seedTag();
  const paidFor = await seedContact({ createdAt: minutesAgo(40) });
  const lapsedPay = await seedContact({ phone: SCANNER_B, createdAt: minutesAgo(90) });
  const unpaid = await seedContact({ phone: SCANNER_B, createdAt: minutesAgo(120) });
  const paidAt = minutesAgo(3);
  await seedOrder({ tag, contact: paidFor, paidAt });
  await seedOrder({ tag, contact: lapsedPay, paidAt: minutesAgo(30) });

  const dash = await dashboard();
  const row = (c) => dash.requests.find((r) => r.id === String(c._id));

  assert.equal(
    row(paidFor).callbackPassExpiresAt,
    new Date(Date.parse(paidAt) + CALLBACK_PASS_WINDOW_MS).toISOString()
  );
  assert.equal(row(lapsedPay).callbackPassExpiresAt, null, "a finished payment is not carried");
  assert.equal(row(unpaid).callbackPassExpiresAt, null);

  assert.equal(dash.callbackWindowMs, FREE_WINDOW_MS);
  assert.equal(dash.callbackPassPaise, CALLBACK_PASS_PAISE);
  assert.equal(dash.callbackPassMaxAgeMs, CALLBACK_PASS_MAX_AGE_MS);
  assert.equal("callbackPassMinRemainingMs" in dash, false, "the E-Tag threshold is gone");
  assert.equal("callbackPass" in dash.tags[0], false, "nothing about the paid callback lives on the tag");
});

// The ₹20 button once shipped invisible: the server published its numbers, the
// rule module handled them correctly, and every route test passed — but the
// dashboard script declared them with fail-closed defaults and never assigned
// them from the payload. So this checks the seam that broke, generically:
// every callback number the dashboard publishes must actually be read by the
// page. A field added to one side and not the other fails here instead of on
// somebody's phone.
test("the page reads every callback number the dashboard publishes", async () => {
  const dash = await dashboard();

  const published = Object.keys(dash).filter((key) => /^callback/.test(key));
  assert.ok(
    published.includes("callbackPassMaxAgeMs") && published.includes("callbackPassPaise"),
    `the dashboard should publish the paid callback's horizon and price, got: ${published.join(", ")}`
  );

  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });
  assert.equal(js.statusCode, 200);
  for (const field of published) {
    assert.match(js.body, new RegExp(String.raw`data\.${field}\b`), `the page never reads ${field}`);
  }
});

// The first version reloaded the list after a payment with loadDashboard(), a
// function the page has never had. Every payment ended in a ReferenceError and
// the row never switched to its paid Call Back button — invisible to every
// route test, because the server had done its part. So: every bare function
// the payment flow calls must be one the page actually defines.
test("the payment flow only calls functions the page defines", async () => {
  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });
  const src = js.body;

  const start = src.indexOf("async function payForCallback");
  const end = src.indexOf("window.payForCallback", start);
  assert.ok(start >= 0 && end > start, "the payment flow must ship");
  // Whole-line comments dropped, so a function named in prose is not read as
  // a call.
  const flow = src.slice(start, end).replace(/^\s*\/\/.*$/gm, "");

  // Keywords that take parentheses, and the browser globals the flow uses.
  const notCalls = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof"]);
  const globals = new Set(["fetch", "setTimeout", "Razorpay"]);

  const called = new Set(
    [...flow.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])
  );
  for (const name of called) {
    if (notCalls.has(name) || globals.has(name)) continue;
    const defined = new RegExp(String.raw`(?:function\s+${name}\s*\(|(?:const|let|var)\s+${name}\s*=)`).test(src);
    assert.ok(defined, `the payment flow calls ${name}(), which the page never defines`);
  }
});

// Found in local QA: after a paid callback was answered, the row read
// "Answered 42s" and still offered Call Back, because the page let a live
// payment put a button on a row without asking the shared rule first. The rule
// already says an answered row is not returnable; the page must defer to it.
test("a paid row only gets a button when the shared rule calls it returnable", async () => {
  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });
  assert.match(js.body, /const canCallBack = \(r\) =>\s*isReturnable\(r\) &&/,
    "canCallBack must require isReturnable before a live payment can add a button");
});

test("each premium row draws the right control at every point in its life", async () => {
  const rules = await import("../../frontend/scripts/owner/callback-eligibility.js");
  const now = Date.now();
  const MAX_AGE = CALLBACK_PASS_MAX_AGE_MS;

  const tagWith = (callAccess) => ({ token: "t", premium: callAccess.premium, callAccess });
  const row = (minutesOld, extra = {}) => ({
    id: "row-1",
    token: "t",
    hasPhone: true,
    phoneLast4: "9994",
    callOutcome: null,
    createdAt: new Date(now - minutesOld * 60e3).toISOString(),
    ...extra
  });
  const state = (tag, r, passMaxAgeMs = MAX_AGE) =>
    rules.callbackState(r, { tags: [tag], now, windowMs: FREE_WINDOW_MS, passMaxAgeMs });

  const running = tagWith({ tier: "premium-trial", masking: true, premium: true });
  assert.equal(state(running, row(2)), rules.CALLABLE, "inside the free window: Call Back");
  assert.equal(state(running, row(10)), rules.CALLABLE, "the boundary is still free");
  assert.equal(state(running, row(11)), rules.NEEDS_PAYMENT, "past it: ₹20");
  assert.equal(state(running, row(47 * 60)), rules.NEEDS_PAYMENT, "for as long as the list shows it");
  assert.equal(state(running, row(49 * 60)), rules.NOT_CALLABLE, "and not after");
  assert.equal(state(running, row(11), 0), rules.NOT_CALLABLE,
    "a page never told the horizon offers nothing rather than inventing one");
  assert.equal(state(running, row(30, { callOutcome: "answered" })), rules.NOT_CALLABLE,
    "a conversation that happened is not sold again");
  assert.equal(state(running, row(30, { hasPhone: false, phoneLast4: null })), rules.NOT_CALLABLE, "nobody to dial");

  const paidRow = row(40, { callbackPassExpiresAt: new Date(now + 6 * 60e3).toISOString() });
  assert.equal(state(running, paidRow), rules.CALLABLE, "paid: Call Back again, on the payment's clock");
  assert.equal(rules.hasLivePass(paidRow, now), true);
  const endedRow = row(40, { callbackPassExpiresAt: new Date(now - 1000).toISOString() });
  assert.equal(state(running, endedRow), rules.NEEDS_PAYMENT, "and once its ten minutes end, ₹20 again");
  assert.equal(rules.hasLivePass(row(40, { callbackPassExpiresAt: "junk" }), now), false);

  const lapsed = tagWith({ tier: "premium-lapsed", masking: false, premium: true });
  assert.equal(state(lapsed, row(2)), rules.NEEDS_SUBSCRIPTION, "lapsed, in the window: renew");
  assert.equal(state(lapsed, row(30)), rules.NOT_CALLABLE, "lapsed, past it: nothing is sold");

  const etag = tagWith({ tier: "etag-free", masking: true, premium: false });
  assert.equal(state(etag, row(2)), rules.NEEDS_PREMIUM,
    "an E-Tag's unused free contact is the scanner's, not a callback");
  assert.equal(state(etag, row(30)), rules.NOT_CALLABLE, "and an E-Tag is never offered ₹20");
});
