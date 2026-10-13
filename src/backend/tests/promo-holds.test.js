// A capped promo code cannot ride on more unpaid orders than it has uses.
//
// The cap was checked when an order was created and counted only when it was
// paid. Nothing counted the orders in between, so a single-use code forwarded
// to a group chat, or opened in several tabs, priced every one of those orders
// at the discount, and every one of them could then be paid.
//
// An order route now takes a hold on a capped code before the order can be
// paid or placed, and the cap counts uses plus live holds. One hold per buyer
// (delivery phone): moving to another cart moves the hold. Paying turns the
// hold into the use; an abandoned checkout's hold lapses after PROMO_HOLD_MS.
process.env.META_WHATSAPP_PHONE_NUMBER_ID = "";
process.env.META_WHATSAPP_ACCESS_TOKEN = "";

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { createSession } from "../lib/auth/session.js";
import { getRazorpay } from "../lib/integrations/payments.js";
import { settleAfterReply } from "../lib/core/after-reply.js";
import { createOtpHash } from "../lib/auth/security.js";
import { normalizeIdentifier, OTP_PURPOSE_COD_VERIFY } from "../lib/auth/otp.js";
import { consumePromo, holdPromoForOrder, resolvePromo } from "../lib/core/promo-codes.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";

// Placeholder keys; the order call is replaced below, nothing reaches Razorpay.
const KEY_ID = "rzp_test_ci_placeholder";
const KEY_SECRET = "ci_placeholder_secret";
process.env.RAZORPAY_KEY_ID = KEY_ID;
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
delete process.env.MIXPANEL_TOKEN;

// pt-car-1: no website offer applies to it, so a refused code means list price.
const PRODUCT = "pt-car-1";
const LIST_PAISE = 29900;
const CODES = ["QAHOLD1", "QAHOLD2", "QAOPEN"];
const OWNER_PHONE = "+919812377001";
const OTP = "424242";

let app;
let collections;
let ownerCookie;
let minted = 0;

const guestAddress = (phone) => ({
  fullName: "Promo Hold QA", phone, line1: "1 QA Street", line2: "", landmark: "",
  city: "Noida", state: "Uttar Pradesh", pincode: "201301"
});

before(async () => {
  ({ app, collections } = await startTestApp());
  getRazorpay({ razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET }).orders.create =
    async ({ amount, currency }) => ({ id: `order_hold_qa_${++minted}`, amount, currency: currency || "INR" });
});

after(async () => {
  await settleAfterReply();
  await collections.promoCodes.deleteMany({ code: { $in: CODES } });
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  await settleAfterReply();
  await collections.promoCodes.deleteMany({ code: { $in: CODES } });
  await collections.shopOrders.deleteMany({});
  await collections.addresses.deleteMany({});
  await purgeLoginCollections(collections);

  const owner = await createTestOwner(collections, {
    email: "qa-promo-hold@parktag-test.invalid",
    codVerifiedPhone: OWNER_PHONE
  });
  ownerCookie = await createSession(app, { id: String(owner._id), role: "owner", email: owner.email });
  await collections.addresses.insertOne({ ownerId: owner._id, ...guestAddress(OWNER_PHONE) });
});

async function addCode(code, overrides = {}) {
  await collections.promoCodes.insertOne({
    code, discountMode: "flat", discountPaise: 5000, shippingFeePaise: 0, productIds: [],
    singleUse: false, boundPhone: null, maxUses: null, usedCount: 0, usedByOrders: [],
    expiresAt: null, fulfilment: "ship", autoApply: false, active: true,
    createdAt: new Date().toISOString(), ...overrides
  });
}

const row = (code) => collections.promoCodes.findOne({ code });

const post = (url, payload, cookie = null) => app.inject({
  method: "POST", url, remoteAddress: uniqueAddress(),
  ...(cookie ? { cookies: { wavetag_session: cookie } } : {}),
  headers: { origin: TEST_ORIGIN },
  payload
});

// /direct: a typed code at list price, the page that carries negotiated codes.
async function directOrder(phone, code, extra = {}) {
  const res = await post("/api/shop/guest/create-order", {
    productId: PRODUCT, address: guestAddress(phone), promo: code, listPrice: true, ...extra
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

async function proveCodPhone(phone) {
  await collections.otpTokens.insertOne({
    identifier: normalizeIdentifier(phone), purpose: OTP_PURPOSE_COD_VERIFY,
    codeHash: await createOtpHash(OTP), used: false, attempts: 0,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString()
  });
  const res = await post("/api/shop/guest/cod-otp/verify", { phone, otp: OTP });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().codToken;
}

describe("a single-use code holds for one unpaid order at a time", () => {
  test("a second buyer is quoted list price while the first has it", async () => {
    await addCode("QAHOLD1", { singleUse: true });

    const first = await directOrder("9812377101", "QAHOLD1");
    assert.equal(first.promoCode, "QAHOLD1");
    assert.equal(first.amount, LIST_PAISE - 5000);

    const second = await directOrder("9812377102", "QAHOLD1");
    assert.equal(second.promoCode, null, "two unpaid orders carry a single-use code");
    assert.equal(second.amount, LIST_PAISE);

    const holds = (await row("QAHOLD1")).holds;
    assert.equal(holds.length, 1);
    assert.equal(holds[0].orderNumber, first.orderNumber);
    assert.doesNotMatch(JSON.stringify(holds), /9812377101/, "the hold must not store the phone");
  });

  test("buyers racing for it in parallel: exactly one gets it", async () => {
    await addCode("QAHOLD1", { singleUse: true });

    const phones = ["9812377111", "9812377112", "9812377113", "9812377114", "9812377115", "9812377116"];
    const responses = await Promise.all(phones.map((phone) => post("/api/shop/guest/create-order", {
      productId: PRODUCT, address: guestAddress(phone), promo: "QAHOLD1", listPrice: true
    })));

    // Each is either quoted list price (it saw the hold) or told the offer
    // went while it was being priced (it lost the race for the slot). Never
    // a second order at the discount.
    const won = [];
    for (const res of responses) {
      const body = res.json();
      if (res.statusCode === 409) {
        assert.equal(body.code, "PROMO_TAKEN", res.body);
        continue;
      }
      assert.equal(res.statusCode, 200, res.body);
      if (body.promoCode === "QAHOLD1") won.push(body);
      else assert.equal(body.amount, LIST_PAISE);
    }
    assert.equal(won.length, 1);
    assert.equal((await row("QAHOLD1")).holds.length, 1);
    assert.equal(await collections.shopOrders.countDocuments({ promoCode: "QAHOLD1" }), 1);
  });

  test("a cap of two holds for two buyers and refuses the third", async () => {
    await addCode("QAHOLD2", { maxUses: 2 });

    const a = await directOrder("9812377121", "QAHOLD2");
    const b = await directOrder("9812377122", "QAHOLD2");
    const c = await directOrder("9812377123", "QAHOLD2");
    assert.deepEqual([a.promoCode, b.promoCode, c.promoCode], ["QAHOLD2", "QAHOLD2", null]);
  });

  test("a code with no cap takes no holds", async () => {
    await addCode("QAOPEN");

    for (const phone of ["9812377131", "9812377132"]) {
      assert.equal((await directOrder(phone, "QAOPEN")).promoCode, "QAOPEN");
    }
    assert.equal((await row("QAOPEN")).holds, undefined);
  });
});

describe("the buyer's own checkouts", () => {
  test("a reloaded checkout comes back as the same order, still holding", async () => {
    await addCode("QAHOLD1", { singleUse: true });

    const first = await directOrder("9812377141", "QAHOLD1");
    const again = await directOrder("9812377141", "QAHOLD1");
    assert.equal(again.orderNumber, first.orderNumber);
    assert.equal(again.promoCode, "QAHOLD1");
    assert.equal((await row("QAHOLD1")).holds.length, 1);
  });

  test("changing the cart moves the hold instead of refusing their own code", async () => {
    await addCode("QAHOLD1", { singleUse: true });

    const one = await directOrder("9812377151", "QAHOLD1");
    const two = await directOrder("9812377151", "QAHOLD1", { quantity: 2 });
    assert.notEqual(two.orderNumber, one.orderNumber);
    assert.equal(two.promoCode, "QAHOLD1", "the buyer was refused their own code");

    const holds = (await row("QAHOLD1")).holds;
    assert.deepEqual(holds.map((h) => h.orderNumber), [two.orderNumber]);
    assert.equal((await directOrder("9812377152", "QAHOLD1")).promoCode, null);
  });

  test("switching from paying online to cash on delivery takes the code along", async () => {
    await addCode("QAHOLD1", { singleUse: true });
    const phone = "9812377161";

    await directOrder(phone, "QAHOLD1");
    const cod = await post("/api/shop/guest/create-order", {
      productId: PRODUCT, address: guestAddress(phone), promo: "QAHOLD1", listPrice: true,
      paymentMethod: "cod", codToken: await proveCodPhone(phone)
    });
    assert.equal(cod.statusCode, 200, cod.body);
    assert.equal(cod.json().promoCode, "QAHOLD1");

    // Burnt after the reply; the hold kept the slot until then.
    await settleAfterReply();
    const after = await row("QAHOLD1");
    assert.equal(after.usedCount, 1);
    assert.deepEqual(after.holds, []);
  });

  test("cash on delivery from another buyer while it is held: placed at list price", async () => {
    await addCode("QAHOLD1", { singleUse: true });
    await directOrder("9812377171", "QAHOLD1");

    const phone = "9812377172";
    const cod = await post("/api/shop/guest/create-order", {
      productId: PRODUCT, address: guestAddress(phone), promo: "QAHOLD1", listPrice: true,
      paymentMethod: "cod", codToken: await proveCodPhone(phone)
    });
    assert.equal(cod.statusCode, 200, cod.body);
    assert.equal(cod.json().promoCode, null);
    assert.equal((await row("QAHOLD1")).usedCount, 0);
  });
});

describe("paying, abandoning, and the signed-in shop", () => {
  test("a paid order turns its hold into the use", async () => {
    await addCode("QAHOLD1", { singleUse: true });

    const created = await post("/api/shop/create-order", { productId: PRODUCT, promo: "QAHOLD1" }, ownerCookie);
    assert.equal(created.statusCode, 200, created.body);
    const { orderId, orderNumber, promoCode } = created.json();
    assert.equal(promoCode, "QAHOLD1");
    assert.equal((await row("QAHOLD1")).holds[0].orderNumber, orderNumber);

    const paymentId = "pay_hold_qa_1";
    const signature = crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
    const verified = await post("/api/shop/verify-payment", {
      razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature
    }, ownerCookie);
    assert.equal(verified.statusCode, 200, verified.body);

    const after = await row("QAHOLD1");
    assert.equal(after.usedCount, 1);
    assert.deepEqual(after.usedByOrders, [orderNumber]);
    assert.deepEqual(after.holds, []);
    assert.equal((await directOrder("9812377181", "QAHOLD1")).promoCode, null);
  });

  test("an abandoned checkout's hold lapses and frees the slot", async () => {
    await addCode("QAHOLD1", { singleUse: true });
    await directOrder("9812377191", "QAHOLD1");

    await collections.promoCodes.updateOne(
      { code: "QAHOLD1" },
      { $set: { "holds.0.until": new Date(Date.now() - 1000).toISOString() } }
    );
    assert.equal((await directOrder("9812377192", "QAHOLD1")).promoCode, "QAHOLD1");
    assert.equal((await row("QAHOLD1")).holds.length, 1, "the lapsed hold was not cleared out");
  });

  test("signed-in cash on delivery holds the code, then burns it after the reply", async () => {
    await addCode("QAHOLD1", { singleUse: true });

    const placed = await post("/api/shop/place-cod", { productId: PRODUCT, promo: "QAHOLD1" }, ownerCookie);
    assert.equal(placed.statusCode, 200, placed.body);
    assert.equal(placed.json().promoCode, "QAHOLD1");
    // Until the burn lands, the hold is what keeps another buyer out.
    assert.equal((await directOrder("9812377221", "QAHOLD1")).promoCode, null);

    await settleAfterReply();
    const after = await row("QAHOLD1");
    assert.equal(after.usedCount, 1);
    assert.deepEqual(after.usedByOrders, [placed.json().orderNumber]);
    assert.deepEqual(after.holds, []);
  });

  test("the signed-in shop is refused a code another buyer is holding", async () => {
    await addCode("QAHOLD1", { singleUse: true });
    await directOrder("9812377201", "QAHOLD1");

    const created = await post("/api/shop/create-order", { productId: PRODUCT, promo: "QAHOLD1" }, ownerCookie);
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().promoCode, null);
    assert.equal(created.json().promoRefused, "exhausted");
    assert.equal(created.json().amount, LIST_PAISE);
  });
});

describe("the pieces underneath", () => {
  test("holdPromoForOrder: parallel holds for the last slot, one wins", async () => {
    await addCode("QAHOLD1", { singleUse: true });
    const promo = await resolvePromo(collections, "QAHOLD1", { productId: PRODUCT, forOrder: true });
    assert.equal(promo.cap, 1);

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      holdPromoForOrder(collections, promo, { orderNumber: `PT-QA-${i}`, deliveryPhone: `98123772${String(i).padStart(2, "0")}` })
    ));
    assert.equal(results.filter(Boolean).length, 1);
  });

  test("a price preview ignores holds: it quotes, it does not reserve", async () => {
    await addCode("QAHOLD1", { singleUse: true });
    await directOrder("9812377211", "QAHOLD1");

    const preview = await post("/api/shop/promo/check", { code: "QAHOLD1", productId: PRODUCT });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().ok, true);
  });

  test("a payment past the cap is recorded and logged, never refused", async () => {
    await addCode("QAHOLD1", { singleUse: true, usedCount: 1, usedByOrders: ["PT-QA-PAID"] });
    const warnings = [];
    await consumePromo(collections, "QAHOLD1", "PT-QA-LATE", { warn: (obj) => warnings.push(obj) });

    assert.equal((await row("QAHOLD1")).usedCount, 2);
    assert.equal(warnings[0]?.event, "promo-over-cap");
  });
});
