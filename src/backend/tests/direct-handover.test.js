// A sale handed over face to face, through the ordinary checkout.
//
// ── Why this suite exists ──────────────────────────────────────────────────
//
// Every offline and WhatsApp sale used to go around the shop: UPI to
// edittree@axl, sticker handed over, nothing written down. /direct closes that
// by putting those sales through the SAME guest checkout with a discount code.
//
// Which means this file guards a live payment endpoint. Two things there are
// new and could fail quietly:
//
//   1. A handover code SKIPS ADDRESS VALIDATION. That gate must open for a
//      handover code and for nothing else, or the shop starts taking money for
//      parcels it has nowhere to send.
//   2. A handover order BOOKS NO COURIER. Otherwise it leaves a label nobody
//      posts, a pickup nobody hands anything to, and a stuck-order alert
//      chasing both forever.
//
// ── What these tests can and cannot reach ──────────────────────────────────
//
// create-order calls Razorpay, and the suite runs with a placeholder key, so no
// test here can carry an order all the way through minting. Validation runs
// BEFORE that call, so the address gate is reachable and is asserted on the
// error the route returns: seeing "Enter your house / flat and street" means
// the gate held; getting past it means the gate opened. That is the property
// under test, and it is checked directly rather than inferred from a success
// this environment cannot produce.
//
// The fulfilment half is reachable in full, because verify-payment's signature
// is a local HMAC and an order can be seeded.

process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app;
let collections;

// Name and phone only. This is the whole of what a handover buyer types.
const CONTACT = { fullName: "QA Handover", phone: "9812345678" };

const FULL_ADDRESS = {
  ...CONTACT,
  line1: "12 Test Street",
  line2: "",
  landmark: "",
  city: "Dehradun",
  state: "Uttarakhand",
  pincode: "248001"
};

// The message validateAddress returns when the postal half is missing. Asserting
// on it, rather than on a status code, is what tells the two gates apart: a
// handover request that still hits this has not skipped validation at all.
const ADDRESS_DEMANDED = /house \/ flat and street/i;

const post = (url, payload) =>
  app.inject({ method: "POST", url, payload, remoteAddress: uniqueAddress() });

const createOrder = (body) => post("/api/shop/guest/create-order", body);

function sign(orderId, paymentId) {
  return crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

async function seedCode(overrides = {}) {
  await collections.promoCodes.insertOne({
    code: "HANDOVER99",
    discountPaise: 9900,
    singleUse: false,
    boundPhone: null,
    maxUses: null,
    usedCount: 0,
    expiresAt: null,
    active: true,
    fulfilment: "handover",
    createdAt: new Date().toISOString(),
    ...overrides
  });
}

async function seedOrder(overrides = {}) {
  const orderId = `order_guest_${crypto.randomBytes(6).toString("hex")}`;
  await collections.shopOrders.insertOne({
    orderId,
    orderNumber: `PT-QA-${crypto.randomBytes(3).toString("hex")}`,
    paymentMethod: "online",
    ownerId: null,
    guest: true,
    productId: "pt-car-2",
    productName: "ParkTag Car Tag (Pack of 2)",
    variant: null,
    amount: 49900,
    currency: "INR",
    status: "created",
    shippingAddress: FULL_ADDRESS,
    replaceTagId: null,
    createdAt: new Date().toISOString(),
    ...overrides
  });
  return orderId;
}

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.promoCodes.deleteMany({}).catch(() => {});
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.promoCodes.deleteMany({}).catch(() => {});
  await collections.shopOrders.deleteMany({}).catch(() => {});
});

describe("the address gate opens for a handover code and nothing else", () => {
  test("a handover code lets name and phone through on their own", async () => {
    await seedCode();
    const res = await createOrder({ productId: "pt-car-2", address: CONTACT, promo: "HANDOVER99" });

    assert.doesNotMatch(
      String(res.json().error || ""),
      ADDRESS_DEMANDED,
      "a handover code should not be asked for a postal address"
    );
  });

  // The default, and the one that must not regress: /shop and /get send no code
  // at all and have to keep demanding somewhere to ship to.
  test("no code still demands a full address", async () => {
    const res = await createOrder({ productId: "pt-car-2", address: CONTACT });

    assert.equal(res.statusCode, 400);
    assert.match(String(res.json().error || ""), ADDRESS_DEMANDED);
  });

  // A discount is not permission to skip the address. Most codes will be
  // ordinary money-off codes on parcels that still have to be posted.
  test("a shipping code still demands a full address", async () => {
    await seedCode({ code: "SHIPME99", fulfilment: "ship" });
    const res = await createOrder({ productId: "pt-car-2", address: CONTACT, promo: "SHIPME99" });

    assert.equal(res.statusCode, 400);
    assert.match(String(res.json().error || ""), ADDRESS_DEMANDED);
  });

  // The gate is opened by a code the SERVER resolved, never by the word the
  // browser sent. An invented code must fall back to the strict path.
  test("an unknown code does not open the gate", async () => {
    const res = await createOrder({ productId: "pt-car-2", address: CONTACT, promo: "MADEUPPP" });

    assert.equal(res.statusCode, 400);
    assert.match(String(res.json().error || ""), ADDRESS_DEMANDED);
  });

  test("a revoked handover code does not open the gate", async () => {
    await seedCode({ active: false });
    const res = await createOrder({ productId: "pt-car-2", address: CONTACT, promo: "HANDOVER99" });

    assert.equal(res.statusCode, 400);
    assert.match(String(res.json().error || ""), ADDRESS_DEMANDED);
  });

  // Skipping the postal fields is not skipping identity. The phone is what
  // later links the activated sticker back to this order, which is the entire
  // reason these sales come through the checkout at all.
  test("a handover sale still needs a real phone number", async () => {
    await seedCode();
    const res = await createOrder({
      productId: "pt-car-2",
      address: { fullName: "QA Handover", phone: "123" },
      promo: "HANDOVER99"
    });

    assert.equal(res.statusCode, 400);
    assert.match(String(res.json().error || ""), /10-digit mobile/i);
  });

  test("a handover sale still needs a name", async () => {
    await seedCode();
    const res = await createOrder({
      productId: "pt-car-2",
      address: { fullName: "", phone: CONTACT.phone },
      promo: "HANDOVER99"
    });

    assert.equal(res.statusCode, 400);
    assert.match(String(res.json().error || ""), /full name/i);
  });
});

describe("a handover order books no courier", () => {
  // The whole point. Booking one would create a label nobody posts and a
  // pickup nobody hands anything to, and the stuck-order alert would then
  // report a parcel that was never going to move.
  test("no waybill is booked and no shipment error is recorded", async () => {
    const orderId = await seedOrder({ fulfilment: "handover", deliveredInPerson: true });
    const paymentId = `pay_${crypto.randomBytes(6).toString("hex")}`;

    const res = await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    });
    assert.equal(res.statusCode, 200);

    const order = await collections.shopOrders.findOne({ orderId });
    assert.equal(order.status, "paid");
    assert.equal(order.waybill, undefined, "a handover order should have no waybill");
    // The tell if the skip ever regresses. A shipping order in this suite hits
    // refuseInTestRun and records the refusal here, so an error appearing on a
    // handover order means Delhivery was called when it should not have been.
    assert.equal(order.shipmentError, undefined, "Delhivery was called for a handover order");
  });

  // The counterpart, so the test above cannot pass by Delhivery simply being
  // switched off in this environment.
  test("an ordinary order still tries to book one", async () => {
    const orderId = await seedOrder();
    const paymentId = `pay_${crypto.randomBytes(6).toString("hex")}`;

    await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    });

    const order = await collections.shopOrders.findOne({ orderId });
    assert.ok(
      order.shipmentError || order.waybill,
      "a shipping order should have attempted a booking"
    );
  });
});

describe("the code is burnt when the money lands", () => {
  test("paying consumes one use", async () => {
    await seedCode({ code: "BURNME99", maxUses: 2 });
    const orderId = await seedOrder({
      promoCode: "BURNME99",
      fulfilment: "handover",
      deliveredInPerson: true
    });
    const paymentId = `pay_${crypto.randomBytes(6).toString("hex")}`;

    await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    });

    assert.equal((await collections.promoCodes.findOne({ code: "BURNME99" })).usedCount, 1);
  });

  // verify-payment arrives twice by design: the browser callback and the
  // Razorpay webhook race each other. A code burnt twice would deny somebody a
  // discount they were promised.
  test("a second arrival for the same order does not burn it again", async () => {
    await seedCode({ code: "BURNME99", maxUses: 2 });
    const orderId = await seedOrder({
      promoCode: "BURNME99",
      fulfilment: "handover",
      deliveredInPerson: true
    });
    const paymentId = `pay_${crypto.randomBytes(6).toString("hex")}`;
    const body = {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    };

    await post("/api/shop/guest/verify-payment", body);
    await post("/api/shop/guest/verify-payment", body);

    assert.equal((await collections.promoCodes.findOne({ code: "BURNME99" })).usedCount, 1);
  });

  // An abandoned checkout must not cost the buyer their code. Nothing is
  // consumed until fulfilment, which only runs once money has arrived.
  test("an unpaid order has not burnt anything", async () => {
    await seedCode({ code: "BURNME99", maxUses: 2 });
    await seedOrder({ promoCode: "BURNME99" });

    assert.equal((await collections.promoCodes.findOne({ code: "BURNME99" })).usedCount, 0);
  });
});
