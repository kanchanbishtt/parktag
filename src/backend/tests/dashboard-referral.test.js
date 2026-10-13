// A friend's referral link survives into the dashboard checkout.
//
// /api/shop/create-order (the signed-in owner's checkout) read `ref`, and the
// dashboard never sent one. A friend who opened a ?ref= link on /get and then
// tapped "Sign in", or who was already signed in and followed /shop?ref=, was
// charged full price, and the owner whose link it was earned nothing. The
// route also checked the code against the account only, never the delivery
// phone the guest route checks, and its reply never said why a code was not
// applied.
//
// The routes run against Mongo with only Razorpay's order mint replaced; the
// dashboard's own script runs in jsdom with the real referral-link.js.

// Before anything reads the environment. Verifying a signature is a local HMAC.
process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";
delete process.env.MIXPANEL_TOKEN;

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import Razorpay from "razorpay";
import { JSDOM } from "jsdom";

import { startTestApp, stopTestApp, uniqueAddress, TEST_ORIGIN } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import { createPremiumTagForVehicle } from "../lib/core/tag-issuance.js";
import { REFERRAL_DISCOUNT_PAISE } from "../lib/core/referrals.js";

const realAddResources = Razorpay.prototype.addResources;
Razorpay.prototype.addResources = function addResources() {
  realAddResources.call(this);
  this.orders.create = async (params) => ({
    id: `order_dashref_${crypto.randomBytes(6).toString("hex")}`,
    amount: params.amount,
    currency: params.currency
  });
};

const PACK = "pt-car-2";
const DAY = 24 * 60 * 60 * 1000;

let app;
let collections;
const ownerIds = [];

const withCookie = (cookie) => (cookie ? { cookies: { wavetag_session: cookie } } : {});
const post = (url, payload, cookie) => app.inject({
  method: "POST", url, payload, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN }, ...withCookie(cookie)
});
const get = (url, cookie) => app.inject({ method: "GET", url, remoteAddress: uniqueAddress(), ...withCookie(cookie) });

let seq = 0;
async function makeOwner({ premium = false, phone } = {}) {
  seq += 1;
  const mobile = phone || `+9197000${String(10000 + seq)}`;
  const { insertedId } = await collections.owners.insertOne({
    mobile, role: "owner", displayName: "Dashboard Referral QA", createdAt: new Date().toISOString()
  });
  ownerIds.push(insertedId);
  const owner = { id: insertedId, mobile };
  if (premium) {
    owner.tag = await createPremiumTagForVehicle(collections, insertedId, { plateNumber: "DL14QA7951", vehicleType: "car", vehicleLabel: "Car" });
  }
  owner.cookie = await createSession(app, { id: String(insertedId), role: "owner", email: mobile, displayName: "QA" });
  owner.code = (await get("/api/owner/dashboard?qr=0", owner.cookie)).json().referral.code;
  return owner;
}

// The dashboard checkout saves the delivery address before create-order.
async function shipTo(owner, phone) {
  await collections.addresses.insertOne({
    // Every field, as POST /api/owner/address saves it: create-order compares
    // the stored address whole before handing an unpaid order back.
    ownerId: owner.id, fullName: "Referral Buyer", phone, line1: "12 Test Street", line2: "",
    landmark: "", city: "Dehradun", state: "Uttarakhand", pincode: "248001"
  });
}

const createOrder = (buyer, ref) => post("/api/shop/create-order", { productId: PACK, variant: "Car", ...(ref === undefined ? {} : { ref }) }, buyer.cookie);

function pay(buyer, orderId) {
  const paymentId = `pay_${crypto.randomBytes(6).toString("hex")}`;
  const signature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  return post("/api/shop/verify-payment", { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature }, buyer.cookie);
}

async function wipe() {
  const ownerId = { $in: ownerIds.splice(0) };
  await collections.shopOrders.deleteMany({ ownerId }).catch(() => {});
  await collections.addresses.deleteMany({ ownerId }).catch(() => {});
  await collections.tags.deleteMany({ ownerId }).catch(() => {});
  await collections.owners.deleteMany({ _id: ownerId }).catch(() => {});
}

before(async () => { ({ app, collections } = await startTestApp()); });
beforeEach(wipe);
after(async () => { await wipe(); await stopTestApp(app); Razorpay.prototype.addResources = realAddResources; });

describe("the dashboard checkout honours a friend's code", () => {
  test("the order takes the discount, names the friend, verifies, and pays the friend a month", async () => {
    const friend = await makeOwner({ premium: true });
    const buyer = await makeOwner();
    await shipTo(buyer, "9811122233");

    const full = (await createOrder(buyer)).json();
    const res = await createOrder(buyer, friend.code);
    assert.equal(res.statusCode, 200, res.body);
    const order = res.json();
    assert.notEqual(order.orderId, full.orderId, "an order priced without the code was handed back");
    assert.equal(order.amount, full.amount - REFERRAL_DISCOUNT_PAISE);
    assert.equal(order.referralDiscountPaise, REFERRAL_DISCOUNT_PAISE);
    assert.equal(order.referralRefused, null);

    const stored = await collections.shopOrders.findOne({ orderId: order.orderId });
    assert.equal(String(stored.referredBy), String(friend.id));
    assert.equal(stored.referralCode, friend.code);

    const paid = await pay(buyer, order.orderId);
    assert.equal(paid.statusCode, 200, paid.body);
    assert.equal(paid.json().ok, true, "verify-payment refused the discounted amount");

    const rewarded = await collections.shopOrders.findOne({ orderId: order.orderId });
    assert.ok(rewarded.referralRewardedAt, "the friend was not rewarded");
    const end = new Date((await collections.tags.findOne({ _id: friend.tag._id })).subscription.currentPeriodEnd).getTime();
    // A fresh premium tag has its included year; the month lands after it.
    assert.ok(end > Date.now() + 390 * DAY && end < Date.now() + 400 * DAY, `the friend's premium ends ${new Date(end).toISOString()}`);
  });

  test("a retry with the same code gets the same order back, and says the discount is on it", async () => {
    const friend = await makeOwner();
    const buyer = await makeOwner();
    await shipTo(buyer, "9811122233");

    const first = (await createOrder(buyer, friend.code)).json();
    const again = (await createOrder(buyer, friend.code)).json();
    assert.equal(again.orderId, first.orderId);
    assert.equal(again.referralDiscountPaise, REFERRAL_DISCOUNT_PAISE, "a reused order read as refused");
    assert.equal(again.referralRefused, null);
  });

  test("an unpaid order on one friend's link is not reused for another friend's", async () => {
    const first = await makeOwner();
    const second = await makeOwner();
    const buyer = await makeOwner();
    await shipTo(buyer, "9811122233");

    const a = (await createOrder(buyer, first.code)).json();
    const b = (await createOrder(buyer, second.code)).json();
    assert.notEqual(b.orderId, a.orderId, "the second friend's order would have paid the first friend");
    const stored = await collections.shopOrders.findOne({ orderId: b.orderId });
    assert.equal(String(stored.referredBy), String(second.id));
  });
});

describe("a code that is not applied is charged in full, and the reply says why", () => {
  test("the owner's own code", async () => {
    const owner = await makeOwner();
    await shipTo(owner, "9811122233");
    const full = (await createOrder(owner)).json();
    const order = (await createOrder(owner, owner.code)).json();
    assert.equal(order.amount, full.amount);
    assert.equal(order.referralDiscountPaise, 0);
    assert.equal(order.referralRefused, "self");
  });

  test("another account shipping to the referrer's own number", async () => {
    const friend = await makeOwner({ phone: "+919822233344" });
    const buyer = await makeOwner();
    await shipTo(buyer, "9822233344");
    const order = (await createOrder(buyer, friend.code)).json();
    assert.equal(order.referralDiscountPaise, 0);
    assert.equal(order.referralRefused, "self");
    assert.equal((await collections.shopOrders.findOne({ orderId: order.orderId })).referredBy, null);
  });

  test("a code nobody holds, and no code at all", async () => {
    const buyer = await makeOwner();
    await shipTo(buyer, "9811122233");
    const unknown = (await createOrder(buyer, "ABCDEF")).json();
    assert.equal(unknown.referralRefused, "unknown");
    assert.equal(unknown.referralDiscountPaise, 0);
    const none = (await createOrder(buyer)).json();
    assert.equal(none.referralRefused, null);
  });
});

describe("before the order", () => {
  test("the referral check does not quote a signed-in owner their own code", async () => {
    const owner = await makeOwner();
    assert.deepEqual((await post("/api/shop/referral/check", { code: owner.code }, owner.cookie)).json(), { ok: false });
    assert.equal((await post("/api/shop/referral/check", { code: owner.code })).json().ok, true, "signed out it is a real code");
    const other = await makeOwner();
    assert.equal((await post("/api/shop/referral/check", { code: owner.code }, other.cookie)).json().ok, true);
  });

  test("/shop carries the code to the dashboard for a signed-in owner, and drops junk", async () => {
    const owner = await makeOwner();
    const carried = await get(`/shop?sku=${PACK}&ref=${owner.code.toLowerCase()}`, owner.cookie);
    assert.equal(carried.statusCode, 302);
    assert.equal(carried.headers.location, `/owner-welcome?shop=1&sku=${PACK}&ref=${owner.code}`);

    const junk = await get("/shop?ref=%0D%0ASet-Cookie:x", owner.cookie);
    assert.equal(junk.headers.location, "/owner-welcome?shop=1");
  });
});

// ── The dashboard page, in jsdom ─────────────────────────────────────────────

const read = (path) => fs.readFileSync(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
const welcomeSrc = read("scripts/owner/welcome.js");
// The two lines welcome.js uses to hand the code to the classic shop script.
const bridgeSrc = welcomeSrc.slice(welcomeSrc.indexOf("window.ptReferralCode ="), welcomeSrc.indexOf("\n", welcomeSrc.indexOf("window.ptClearReferralCode =")));
const linkSrc = read("scripts/referral-link.js").replace(/^export /gm, "");
const shopSrc = read("scripts/owner/welcome-shop.js");
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const windows = [];
after(() => windows.forEach((w) => w.close()));

const CODE = "X237XC";
const PRICES = { "pt-car-1": 29900, "pt-car-2": 49900, "pt-car-4": 89900, "pt-bike-1": 49900 };

// `check` is the referral check's answer; `order` builds create-order's reply
// from the body the page sent.
async function openDashboard({ url = "https://x.test/owner-welcome", parked = null, check = { ok: true, discountPaise: 5000 }, order } = {}) {
  const html = read("pages/owner/welcome.html").replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  windows.push(w);
  if (parked) w.sessionStorage.setItem("pt_ref", parked);
  w.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.sent = [];
  w.opened = [];
  w.Razorpay = function Razorpay(options) { w.opened.push(options); this.open = () => {}; };
  w.ptLoadRazorpay = async () => true;
  w.fetch = async (input, opts = {}) => {
    const u = String(input);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.endsWith("/api/shop/pricing")) {
      const products = Object.fromEntries(Object.entries(PRICES).map(([id, amountPaise]) => [id, { name: id, amountPaise }]));
      return json({ ok: true, products, offers: {}, codSurchargePaise: 4900 });
    }
    if (u.endsWith("/api/shop/referral/check")) return json(check);
    if (u.endsWith("/api/shop/create-order")) {
      const body = JSON.parse(opts.body);
      w.sent.push(body);
      const applied = body.ref === CODE;
      return json(order ? order(body) : {
        ok: true, orderId: "order_page_1", orderNumber: "PT-1", currency: "INR",
        amount: PRICES[body.productId] - (applied ? 5000 : 0),
        referralDiscountPaise: applied ? 5000 : 0, referralRefused: null
      });
    }
    if (u.endsWith("/api/shop/razorpay-key")) return json({ keyId: "rzp_test_page" });
    if (u.endsWith("/api/shop/verify-payment")) return json({ ok: true, orderNumber: "PT-1", amountPaise: 44900 });
    return { ok: false, status: 404, json: async () => ({ ok: false }) };
  };
  w.eval(`(() => { ${linkSrc}\n${bridgeSrc} })()`);
  w.eval(shopSrc);
  await tick();
  w.eval("openPackSheet('pt-car-2', 'Car')");
  await tick();
  return w;
}

const sheet = (w) => w.document.getElementById("ptPackSheetBody");
const totalShown = (w) => sheet(w).querySelector(".pt-pack-total-amt").textContent;
const tapPayOnline = async (w) => { w.eval("packProceed()"); await tick(); };

describe("the dashboard pack sheet", () => {
  test("a code parked before signing in is quoted, sent, and forgotten once paid", async () => {
    const w = await openDashboard({ parked: CODE });
    assert.match(sheet(w).textContent, /Friend's link applied: ₹50 off when you pay online\./);
    assert.equal(totalShown(w), "₹449");
    assert.match(sheet(w).querySelector(".pt-pack-cod").textContent, /₹548/, "Cash on Delivery is priced without the referral");

    await tapPayOnline(w);
    assert.equal(w.sent[0].ref, CODE, "create-order was sent without the friend's code");
    assert.equal(w.opened.length, 1);
    assert.equal(w.opened[0].amount, 44900);

    await w.opened[0].handler({ razorpay_order_id: "order_page_1", razorpay_payment_id: "pay_1", razorpay_signature: "sig" });
    await tick();
    assert.equal(w.sessionStorage.getItem("pt_ref"), null, "a spent code is carried into the next order");
  });

  test("a ?ref= on the dashboard's own address (from /shop) is parked and sent", async () => {
    const w = await openDashboard({ url: `https://x.test/owner-welcome?shop=1&ref=${CODE.toLowerCase()}` });
    assert.equal(w.sessionStorage.getItem("pt_ref"), CODE);
    await tapPayOnline(w);
    assert.equal(w.sent[0].ref, CODE);
  });

  test("refused at create-order: no payment window, the reason, and the full price from then on", async () => {
    const w = await openDashboard({
      parked: CODE,
      order: () => ({ ok: true, orderId: "order_page_2", orderNumber: "PT-2", currency: "INR", amount: 49900, referralDiscountPaise: 0, referralRefused: "self" })
    });
    await tapPayOnline(w);
    assert.equal(w.opened.length, 0, "Razorpay opened at a price the sheet did not show");
    assert.match(w.document.getElementById("pt-toast").textContent, /own account or number, so this order is ₹499/);
    assert.equal(w.sessionStorage.getItem("pt_ref"), null);
    assert.equal(totalShown(w), "₹499");
    assert.doesNotMatch(sheet(w).textContent, /Friend's link applied/);
  });

  test("a code nobody holds is forgotten and nothing is quoted", async () => {
    const w = await openDashboard({ parked: CODE, check: { ok: false } });
    assert.doesNotMatch(sheet(w).textContent, /Friend's link applied/);
    assert.equal(totalShown(w), "₹499");
    assert.equal(w.sessionStorage.getItem("pt_ref"), null);
    await tapPayOnline(w);
    assert.equal("ref" in w.sent[0], false);
  });

  test("no code: nothing quoted and none sent", async () => {
    const w = await openDashboard();
    assert.doesNotMatch(sheet(w).textContent, /Friend's link/);
    assert.equal(totalShown(w), "₹499");
    await tapPayOnline(w);
    assert.equal("ref" in w.sent[0], false);
    assert.equal(w.opened[0].amount, 49900);
  });
});
