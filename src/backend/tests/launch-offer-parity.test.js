// The launch offer is one price, wherever the buyer pays.
//
// The landing page reads LAUNCH100 off /api/shop/public-catalogue and says
// "Duo Pack · 2 tags · ₹399". Its button goes to /shop, which sends a
// signed-in owner to the dashboard shop. That shop had its own price list and
// its order routes never applied the code, so the same tap charged ₹499 online
// and ₹548 on Cash on Delivery. The public pages had been aligned with the
// offer more than once; the dashboard was the copy nobody updated.
//
// These tests hold every owner route to the figure the landing page quotes,
// read from the same endpoint the landing page reads. If a route stops
// applying the offer, or a page goes back to its own numbers, they fail.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSession } from "../lib/auth/session.js";
import { getRazorpay } from "../lib/integrations/payments.js";
import { settleAfterReply } from "../lib/core/after-reply.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

// Placeholder keys, and the client they build has its order call replaced
// below: nothing here reaches Razorpay. Set after helpers.js has swept the
// ambient credentials (imports run first), the same way shop-verify-payment does.
const KEY_ID = "rzp_test_ci_placeholder";
const KEY_SECRET = "ci_placeholder_secret";
process.env.RAZORPAY_KEY_ID = KEY_ID;
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
// Not in helpers.js's sweep; a paid order reports to Mixpanel.
delete process.env.MIXPANEL_TOKEN;

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-launch-offer@parktag-test.invalid");
const PHONE = "+919812345678";
const ADDRESS = {
  fullName: "Launch Offer QA", phone: PHONE, line1: "1 Test St",
  city: "Delhi", state: "Delhi", pincode: "110001"
};

let app;
let collections;
let ownerId;
let cookie;
let previousLaunch;
let minted = 0;

before(async () => {
  ({ app, collections } = await startTestApp());

  // The row commerce-defaults.js creates in every environment.
  previousLaunch = await collections.promoCodes.findOne({ code: "LAUNCH100" });
  await collections.promoCodes.deleteOne({ code: "LAUNCH100" });
  await collections.promoCodes.insertOne({
    code: "LAUNCH100", discountMode: "flat", discountPaise: 10000, shippingFeePaise: 0,
    productIds: ["pt-car-2"], singleUse: false, boundPhone: null, maxUses: null,
    usedCount: 0, usedByOrders: [], expiresAt: null, fulfilment: "ship", active: true,
    createdAt: new Date().toISOString()
  });

  // Same key pair, so the same cached client the route will use.
  getRazorpay({ razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET }).orders.create =
    async ({ amount, currency }) => ({ id: `order_launch_qa_${++minted}`, amount, currency: currency || "INR" });
});

after(async () => {
  await settleAfterReply();
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await collections.promoCodes.deleteOne({ code: "LAUNCH100" });
  if (previousLaunch) await collections.promoCodes.insertOne(previousLaunch);
  await stopTestApp(app);
});

beforeEach(async () => {
  await settleAfterReply();
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await collections.promoCodes.updateOne(
    { code: "LAUNCH100" },
    { $set: { active: true, usedCount: 0, usedByOrders: [] } }
  );

  const owner = await createTestOwner(collections, {
    email: OWNER_EMAIL,
    // Pre-trusted, so place-cod never asks for an OTP and nothing is sent.
    codVerifiedPhone: PHONE
  });
  ownerId = owner._id;
  cookie = await createSession(app, {
    id: String(ownerId), role: "owner", email: owner.email, displayName: owner.displayName
  });
  await collections.addresses.insertOne({ ownerId, ...ADDRESS });
});

const get = (url, withCookie = false) => app.inject({
  method: "GET", url, remoteAddress: uniqueAddress(),
  ...(withCookie ? { cookies: { wavetag_session: cookie } } : {})
});

const post = (url, payload) => app.inject({
  method: "POST", url, remoteAddress: uniqueAddress(),
  cookies: { wavetag_session: cookie },
  headers: { origin: "http://localhost" },
  payload
});

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

// What the landing page reads, and so what it advertises.
async function landingOffer() {
  const res = await get("/api/shop/public-catalogue");
  assert.equal(res.statusCode, 200, res.body);
  return res.json().launchOffer;
}

describe("the dashboard shop quotes what the landing page advertises", () => {
  test("its price list carries the same offer, read the same way", async () => {
    const landing = await landingOffer();
    assert.ok(landing, "LAUNCH100 is live but the landing page would show no offer");
    assert.equal(landing.offerPaise, 39900);

    const pricing = await get("/api/shop/pricing", true);
    assert.equal(pricing.statusCode, 200, pricing.body);
    assert.deepEqual(pricing.json().launchOffer, landing, "the dashboard and the landing page quote different offers");
  });
});

describe("a signed-in owner is charged the advertised price", () => {
  test("paying online for the Duo Pack charges the offer price, and the payment verifies", async () => {
    const landing = await landingOffer();

    const created = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car" });
    assert.equal(created.statusCode, 200, created.body);
    const { orderId, amount } = created.json();
    assert.equal(amount, landing.offerPaise, "the dashboard charged a different price from the one the landing page advertised");

    const order = await collections.shopOrders.findOne({ orderId });
    assert.equal(order.amount, landing.offerPaise);
    assert.equal(order.promoCode, "LAUNCH100");
    assert.equal(order.mrpPaise, landing.mrpPaise);
    assert.equal(order.promoDiscountPaise, landing.discountPaise);

    // verify-payment re-prices from the stored code; a discounted order it does
    // not recognise is refused as a mismatch after the buyer has paid.
    const paymentId = "pay_launch_qa_1";
    const verified = await post("/api/shop/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json().ok, true, verified.body);
    assert.equal((await collections.shopOrders.findOne({ orderId })).status, "paid");
  });

  test("Cash on Delivery on the Duo Pack collects the offer price plus the fee, as guest COD does", async () => {
    const landing = await landingOffer();
    const pricing = (await get("/api/shop/pricing", true)).json();

    const placed = await post("/api/shop/place-cod", { productId: "pt-car-2", variant: "Car" });
    assert.equal(placed.statusCode, 200, placed.body);
    assert.equal(placed.json().amount, landing.offerPaise + pricing.codSurchargePaise);

    const order = await collections.shopOrders.findOne({ orderNumber: placed.json().orderNumber });
    assert.equal(order.amount, landing.offerPaise + pricing.codSurchargePaise, "the courier would collect more than the advertised price plus the fee");
    assert.equal(order.promoCode, "LAUNCH100");

    // The confirmation's "pay online now" offer lands back on the offer price.
    assert.equal(order.amount - pricing.flashDiscountPaise, landing.offerPaise);
  });

  test("a pack the code does not cover stays at its catalogue price", async () => {
    const created = await post("/api/shop/create-order", { productId: "pt-car-1", variant: "Car" });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().amount, 29900);
    const order = await collections.shopOrders.findOne({ orderId: created.json().orderId });
    assert.equal(order.promoCode, null);
  });

  test("an unpaid Duo order from before the offer is not handed back at the old price", async () => {
    await collections.shopOrders.insertOne({
      orderId: "order_launch_qa_stale", orderNumber: "PT-261007-09999", paymentMethod: "online",
      ownerId, productId: "pt-car-2", productName: "ParkTag Car Tag (Pack of 2)", variant: "Car",
      amount: 49900, currency: "INR", status: "created", shippingAddress: ADDRESS,
      replaceTagId: null, createdAt: new Date().toISOString()
    });

    const created = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car" });
    assert.equal(created.statusCode, 200, created.body);
    assert.notEqual(created.json().orderId, "order_launch_qa_stale");
    assert.equal(created.json().amount, 39900);
  });
});

describe("revoking the code takes it off everywhere at once", () => {
  test("no offer on the landing page or the dashboard, and the Duo Pack is charged in full", async () => {
    await collections.promoCodes.updateOne({ code: "LAUNCH100" }, { $set: { active: false } });

    assert.equal(await landingOffer(), null);
    assert.equal((await get("/api/shop/pricing", true)).json().launchOffer, null);

    const created = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car" });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().amount, 49900);
  });
});

describe("the dashboard shop shows the server's offer", () => {
  // Coarse, like checkout-pricing's page checks: there is no DOM harness here.
  // What this catches is the page going back to printing its own price table.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const SHOP_SCRIPT = path.join(here, "../../frontend/scripts/owner/welcome-shop.js");

  test("it reads the launch offer from the price list", async () => {
    const page = await readFile(SHOP_SCRIPT, "utf8");
    assert.ok(page.includes("launchOffer"), "the dashboard shop no longer reads the launch offer");
  });

  test("no card or sheet prints the hard-coded price directly", async () => {
    const page = await readFile(SHOP_SCRIPT, "utf8");
    assert.doesNotMatch(page, /₹\$\{p\.(price|orig)\}/, "a card prints PRODUCTS' own price instead of the server's");
  });
});
