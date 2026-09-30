// A referral, end to end, through the routes a browser actually calls.
//
// referrals.test.js holds the rules down one function at a time. This file is
// the journey those functions are supposed to add up to, because that is where
// it was broken: every unit passed while a friend who closed the payment window
// was charged full price on the retry, the checkout sheet never showed the
// discount, and a referrer on a free tag was owed a month that nothing ever
// paid out.
//
//   the owner's dashboard hands out a code
//   a friend's page asks whether the code is real
//   the friend checks out with it, pays, and the owner's premium grows
//   the owner's card says so

// Before anything reads the environment. A fake pair is enough: verifying a
// signature is a local HMAC, and the one call that would reach Razorpay
// (minting an order) is replaced below.
process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Razorpay from "razorpay";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import { createPremiumTagForVehicle } from "../lib/core/tag-issuance.js";
import { REFERRAL_DISCOUNT_PAISE } from "../lib/core/referrals.js";

// Only the network call that mints an order at Razorpay. Everything else,
// including signature verification, is the real code.
const realAddResources = Razorpay.prototype.addResources;
Razorpay.prototype.addResources = function addResources() {
  realAddResources.call(this);
  this.orders.create = async (params) => ({
    id: `order_ref_${crypto.randomBytes(6).toString("hex")}`,
    amount: params.amount,
    currency: params.currency
  });
};

let app;
let collections;

const PACK = "pt-car-2";
const CATALOG = 49900;
const DAY = 24 * 60 * 60 * 1000;
const FRIEND = {
  fullName: "Kanchan Friend",
  phone: "9812345678",
  line1: "12 Test Street",
  line2: "",
  landmark: "",
  city: "Dehradun",
  state: "Uttarakhand",
  pincode: "248001"
};

const withCookie = (cookie) => (cookie ? { cookies: { wavetag_session: cookie } } : {});
const post = (url, payload, cookie) =>
  app.inject({ method: "POST", url, payload, remoteAddress: uniqueAddress(), ...withCookie(cookie) });
const get = (url, cookie) =>
  app.inject({ method: "GET", url, remoteAddress: uniqueAddress(), ...withCookie(cookie) });

const checkout = (body) => post("/api/shop/guest/create-order", { productId: PACK, address: FRIEND, ...body });
const dashboard = async (owner) => (await get("/api/owner/dashboard?qr=0", owner.cookie)).json();

async function pay(orderId) {
  const paymentId = `pay_${crypto.randomBytes(6).toString("hex")}`;
  const signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return post("/api/shop/guest/verify-payment", {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature
  });
}

let ownerSeq = 0;
async function makeOwner({ premium = true } = {}) {
  ownerSeq += 1;
  const mobile = `+9198000${String(10000 + ownerSeq)}`;
  const { insertedId } = await collections.owners.insertOne({
    mobile,
    role: "owner",
    displayName: "Girish Referrer",
    createdAt: new Date().toISOString()
  });
  const owner = { id: insertedId, mobile };
  if (premium) owner.tag = await givePremiumTag(owner);
  owner.cookie = await createSession(app, { id: String(insertedId), role: "owner", email: mobile, displayName: "Girish" });
  return owner;
}

// The real issuance path, so the tag has the shape a sold sticker has.
const givePremiumTag = (owner) =>
  createPremiumTagForVehicle(collections, owner.id, { plateNumber: "DL14SM7951", vehicleType: "bike", vehicleLabel: "Bike" });

const premiumEnd = async (tagId) =>
  new Date((await collections.tags.findOne({ _id: tagId })).subscription.currentPeriodEnd).getTime();

async function wipe() {
  for (const name of ["shopOrders", "owners", "tags"]) await collections[name].deleteMany({}).catch(() => {});
}

before(async () => { ({ app, collections } = await startTestApp()); });
beforeEach(wipe);
after(async () => { await wipe(); await stopTestApp(app); Razorpay.prototype.addResources = realAddResources; });

describe("the friend's page asks before it promises", () => {
  test("a real code is confirmed with the amount the server will take off", async () => {
    const owner = await makeOwner();
    const { code } = (await dashboard(owner)).referral;

    const res = await post("/api/shop/referral/check", { code });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, discountPaise: REFERRAL_DISCOUNT_PAISE });
    // Typed by hand, in whatever case.
    assert.equal((await post("/api/shop/referral/check", { code: code.toLowerCase() })).json().ok, true);
  });

  test("a code nobody holds, junk and nothing at all are all refused without a reason", async () => {
    for (const code of ["ABCDEF", "not a code", "", null, undefined, 12345]) {
      const res = await post("/api/shop/referral/check", { code });
      assert.equal(res.statusCode, 200, `status for ${JSON.stringify(code)}`);
      assert.deepEqual(res.json(), { ok: false }, `answer for ${JSON.stringify(code)}`);
    }
  });
});

describe("the friend gets the discount", () => {
  test("the order is priced with it, says so, and shows it in the breakdown", async () => {
    const owner = await makeOwner();
    const { code } = (await dashboard(owner)).referral;

    const order = (await checkout({ ref: code })).json();
    assert.equal(order.ok, true);
    assert.equal(order.amount, CATALOG - REFERRAL_DISCOUNT_PAISE);
    assert.equal(order.referralDiscountPaise, REFERRAL_DISCOUNT_PAISE);
    assert.equal(order.referralRefused, null);
    assert.match(order.description, /Referral discount -₹50/);

    const stored = await collections.shopOrders.findOne({ orderId: order.orderId });
    assert.equal(String(stored.referredBy), String(owner.id));
    assert.equal(stored.referralCode, code);
  });

  // The page used to forget the code the moment an order was created, so this
  // retry arrived without it and minted a second order at the full price.
  test("closing the payment window and trying again keeps the discount, on the same order", async () => {
    const owner = await makeOwner();
    const { code } = (await dashboard(owner)).referral;

    const first = (await checkout({ ref: code })).json();
    const again = (await checkout({ ref: code })).json();

    assert.equal(again.orderId, first.orderId, "the unpaid order is handed back, not a new one");
    assert.equal(again.amount, CATALOG - REFERRAL_DISCOUNT_PAISE);
    // The reused response used to omit this, which the page reads as "refused".
    assert.equal(again.referralDiscountPaise, REFERRAL_DISCOUNT_PAISE);
    assert.equal(again.referralRefused, null);
    assert.equal(await collections.shopOrders.countDocuments({}), 1);
  });

  test("your own link is refused, and the response says why so the page can", async () => {
    const owner = await makeOwner();
    const { code } = (await dashboard(owner)).referral;

    // The referrer's own number as the delivery phone, in its other spelling.
    const order = (await checkout({ ref: code, address: { ...FRIEND, phone: owner.mobile.slice(3) } })).json();
    assert.equal(order.ok, true, "a refused code never costs anybody a checkout");
    assert.equal(order.amount, CATALOG);
    assert.equal(order.referralDiscountPaise, 0);
    assert.equal(order.referralRefused, "self");
  });

  test("no code sent means nothing refused", async () => {
    const order = (await checkout({})).json();
    assert.equal(order.amount, CATALOG);
    assert.equal(order.referralRefused, null);
  });
});

describe("the owner gets the month", () => {
  test("paying extends their premium by a month and the card reports it", async () => {
    const owner = await makeOwner();
    const before = await dashboard(owner);
    assert.deepEqual(
      { friends: before.referral.friends, earned: before.referral.monthsEarned, waiting: before.referral.monthsWaiting },
      { friends: 0, earned: 0, waiting: 0 }
    );

    const order = (await checkout({ ref: before.referral.code })).json();
    const paid = await pay(order.orderId);
    assert.equal(paid.statusCode, 200);
    assert.equal(paid.json().fulfilled, true);

    const stored = await collections.shopOrders.findOne({ orderId: order.orderId });
    assert.equal(stored.status, "paid");
    assert.ok(stored.referralRewardedAt, "the order records that it paid a reward");
    assert.equal(stored.referralRewardTagId, String(owner.tag._id));

    // A fresh premium tag has its free year; the month lands after it.
    const end = await premiumEnd(owner.tag._id);
    assert.ok(end > Date.now() + 390 * DAY && end < Date.now() + 400 * DAY, `ends ${new Date(end).toISOString()}`);

    const after = await dashboard(owner);
    assert.deepEqual(
      { friends: after.referral.friends, earned: after.referral.monthsEarned, waiting: after.referral.monthsWaiting },
      { friends: 1, earned: 1, waiting: 0 }
    );
  });

  test("an order that was never paid earns nothing", async () => {
    const owner = await makeOwner();
    const { code } = (await dashboard(owner)).referral;
    await checkout({ ref: code });

    const tag = await collections.tags.findOne({ _id: owner.tag._id });
    assert.equal(tag.subscription, undefined);
    assert.equal((await dashboard(owner)).referral.friends, 0);
  });

  test("the confirmation arriving twice pays the reward once", async () => {
    const owner = await makeOwner();
    const { code } = (await dashboard(owner)).referral;
    const order = (await checkout({ ref: code })).json();

    await pay(order.orderId);
    const end = await premiumEnd(owner.tag._id);
    const replay = await pay(order.orderId);

    assert.equal(replay.json().fulfilled, false);
    assert.equal(await premiumEnd(owner.tag._id), end);
    assert.equal((await dashboard(owner)).referral.monthsEarned, 1);
  });

  // The promise on the card is "a month for each friend who buys". For an owner
  // on a free tag that month was banked and then never spent by anything.
  test("with no premium tag the month waits, and lands when they get one", async () => {
    const owner = await makeOwner({ premium: false });
    const { code } = (await dashboard(owner)).referral;
    const order = (await checkout({ ref: code })).json();
    await pay(order.orderId);

    const held = await dashboard(owner);
    assert.deepEqual(
      { friends: held.referral.friends, earned: held.referral.monthsEarned, waiting: held.referral.monthsWaiting },
      { friends: 1, earned: 1, waiting: 1 }
    );
    const stored = await collections.shopOrders.findOne({ orderId: order.orderId });
    assert.ok(stored.referralRewardedAt, "a held reward is recorded on its order too");
    assert.equal(stored.referralRewardHeld, true);

    // They buy a premium tag. The next dashboard load spends what was waiting.
    const tag = await givePremiumTag(owner);
    const spent = await dashboard(owner);
    assert.deepEqual(
      { friends: spent.referral.friends, earned: spent.referral.monthsEarned, waiting: spent.referral.monthsWaiting },
      { friends: 1, earned: 1, waiting: 0 }
    );
    const end = await premiumEnd(tag._id);
    assert.ok(end > Date.now() + 390 * DAY && end < Date.now() + 400 * DAY, `ends ${new Date(end).toISOString()}`);
    assert.equal((await collections.owners.findOne({ _id: owner.id })).referralCreditMonths, 0);
    // The payload the page draws from already carries the extended date.
    assert.equal(new Date(spent.tags.find((t) => t.premium).membership.endsAt).getTime(), end);

    // And it is spent once: another load adds nothing.
    await dashboard(owner);
    assert.equal(await premiumEnd(tag._id), end);
  });

  test("two dashboard loads at the same moment spend a waiting month once", async () => {
    const owner = await makeOwner({ premium: false });
    await collections.owners.updateOne({ _id: owner.id }, { $set: { referralCreditMonths: 1 } });
    const tag = await givePremiumTag(owner);

    await Promise.all([dashboard(owner), dashboard(owner), dashboard(owner)]);

    const end = await premiumEnd(tag._id);
    assert.ok(end < Date.now() + 400 * DAY, `one month, not several: ${new Date(end).toISOString()}`);
    assert.equal((await collections.owners.findOne({ _id: owner.id })).referralCreditMonths, 0);
  });
});
