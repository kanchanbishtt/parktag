// Checkout audit, HIGH: nothing on the server ever learned that a payment
// succeeded.
//
// The only thing that could mark an order paid was the buyer's browser calling
// /api/shop/verify-payment from Razorpay's success handler. Close the tab, lose
// signal, or let the phone sleep in the moment between the money being captured
// and that request going out, and the order stayed at "created" forever — no tag
// minted, no shipment booked, no confirmation sent, and nothing server-side
// aware that anything was owed. Returning to checkout then offered to charge
// them again.
//
// The webhook is the second, browser-independent path to fulfilment. What these
// tests pin down: it cannot be forged, it fulfils an order the browser never
// confirmed, and it cannot fulfil the same order twice — including when it
// races the browser callback.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Set here rather than read from the environment, matching
// shop-verify-payment.test.js. The signature check is HMAC over the raw body,
// so any secret exercises it — but it has to be PRESENT, or the route fails
// closed and every test below would skip on CI while looking green.
process.env.RAZORPAY_WEBHOOK_SECRET = "ci_placeholder_webhook_secret";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-webhook@parktag-test.invalid");
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const ORDER_ID = "order_QA_WEBHOOK_1";
const PAYMENT_ID = "pay_QA_WEBHOOK_1";

let app;
let collections;
let ownerId;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});

  const owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  ownerId = owner._id;
});

// The order row create-order writes, left at "created" — i.e. the buyer paid
// and their browser never came back.
async function seedUnconfirmedOrder(overrides = {}) {
  const doc = {
    orderId: ORDER_ID,
    orderNumber: "PT-260819-00001",
    paymentMethod: "online",
    ownerId,
    productId: "pt-car-1",
    productName: "ParkTag Car Tag (Pack of 1)",
    amount: 29900,
    currency: "INR",
    status: "created",
    shippingAddress: {
      fullName: "QA", phone: "+919812345678", line1: "1 Test St",
      city: "Delhi", state: "Delhi", pincode: "110001"
    },
    replaceTagId: null,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  await collections.shopOrders.insertOne(doc);
  return doc;
}

function orderPaidEvent(orderId = ORDER_ID, paymentId = PAYMENT_ID) {
  return {
    event: "order.paid",
    payload: {
      order: { entity: { id: orderId, amount: 29900, currency: "INR" } },
      payment: { entity: { id: paymentId, order_id: orderId, amount: 29900 } }
    }
  };
}

// Razorpay signs the exact bytes it sends, so the test has to sign the exact
// bytes it sends too — hence a pre-serialised string rather than letting the
// injector serialise the object.
function post(payloadObject, { signature, secret = WEBHOOK_SECRET } = {}) {
  const raw = JSON.stringify(payloadObject);
  const sig =
    signature !== undefined
      ? signature
      : crypto.createHmac("sha256", secret).update(raw).digest("hex");

  return app.inject({
    method: "POST",
    url: "/api/provider/razorpay/webhook",
    remoteAddress: uniqueAddress(),
    headers: {
      "content-type": "application/json",
      ...(sig === null ? {} : { "x-razorpay-signature": sig })
    },
    payload: raw
  });
}

describe("the webhook cannot be forged", () => {
  test("an unsigned callback is refused", async () => {
    await seedUnconfirmedOrder();

    const response = await post(orderPaidEvent(), { signature: null });

    assert.equal(
      response.statusCode,
      401,
      `unsigned callback was accepted: ${response.statusCode} ${response.body}`
    );
    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.equal(order.status, "created", "an unsigned callback marked the order paid");
  });

  test("a wrong signature is refused", async () => {
    await seedUnconfirmedOrder();

    const response = await post(orderPaidEvent(), { signature: "f".repeat(64) });

    assert.equal(response.statusCode, 401);
    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.equal(order.status, "created");
  });

  test("a signature over different bytes is refused", async () => {
    // The whole reason the raw body is used: signing a re-serialised payload, or
    // any other payload, must not verify.
    await seedUnconfirmedOrder();

    const otherBytes = JSON.stringify({ event: "order.paid", payload: {} });
    const wrongSig = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(otherBytes)
      .digest("hex");

    const response = await post(orderPaidEvent(), { signature: wrongSig });

    assert.equal(response.statusCode, 401);
    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.equal(order.status, "created");
  });

  test("a signature from the wrong secret is refused", async () => {
    await seedUnconfirmedOrder();

    const response = await post(orderPaidEvent(), { secret: "not-the-webhook-secret" });

    assert.equal(response.statusCode, 401);
    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.equal(order.status, "created");
  });
});

describe("a paid order the browser never confirmed still gets fulfilled", () => {
  test("order.paid marks it paid and records the payment", async () => {
    await seedUnconfirmedOrder();

    const response = await post(orderPaidEvent());

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().fulfilled, true);

    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.equal(order.status, "paid", "the order was left unfulfilled");
    assert.equal(order.paymentId, PAYMENT_ID);
    assert.ok(order.paidAt, "no paidAt was recorded");
  });

  test("payment.captured works too", async () => {
    // An account may be subscribed to either event; both must fulfil.
    await seedUnconfirmedOrder();

    const response = await post({
      event: "payment.captured",
      payload: { payment: { entity: { id: PAYMENT_ID, order_id: ORDER_ID, amount: 29900 } } }
    });

    assert.equal(response.statusCode, 200, response.body);
    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.equal(order.status, "paid");
  });

  test("a replaced free tag is still swapped for the premium one", async () => {
    // Fulfilment is more than a status flip. If the webhook only marked orders
    // paid, a customer buying a premium tag for an existing vehicle would be
    // charged and never receive it.

    const oldTag = await collections.tags.insertOne({
      ownerId, plateNumber: "QA01WH0001", vehicleType: "car",
      status: "active", premium: false, token: "qa-webhook-old",
      createdAt: new Date().toISOString()
    });
    await seedUnconfirmedOrder({ replaceTagId: String(oldTag.insertedId) });

    const response = await post(orderPaidEvent());
    assert.equal(response.statusCode, 200, response.body);

    const retired = await collections.tags.findOne({ _id: oldTag.insertedId });
    assert.ok(retired.deletedAt, "the spent free tag was not retired");

    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.ok(order.mintedTagId, "no premium tag was minted for a paid replacement order");

    await collections.tags.deleteMany({ ownerId });
  });
});

describe("fulfilment happens once, whoever gets there first", () => {
  test("a retried webhook does not fulfil twice", async () => {
    // Razorpay retries until it gets a 2xx, so duplicates are normal traffic.
    await seedUnconfirmedOrder();

    const first = await post(orderPaidEvent());
    const second = await post(orderPaidEvent());

    assert.equal(first.json().fulfilled, true);
    assert.equal(second.statusCode, 200, "a retry must be acknowledged, not error");
    assert.equal(second.json().fulfilled, false, "the same order was fulfilled twice");
  });

  test("concurrent callbacks cannot both win", async () => {
    // The browser callback and the webhook can land at the same instant. The
    // created → paid flip is one conditional update precisely so the database
    // picks a single winner rather than both minting.
    await seedUnconfirmedOrder();

    const results = await Promise.all([
      post(orderPaidEvent()),
      post(orderPaidEvent()),
      post(orderPaidEvent())
    ]);

    const fulfilled = results.filter((r) => r.statusCode === 200 && r.json().fulfilled);
    assert.equal(fulfilled.length, 1, `${fulfilled.length} callers fulfilled the same order`);
  });

  test("an order already paid by the browser is left alone", async () => {
    await seedUnconfirmedOrder({
      status: "paid",
      paymentId: "pay_FROM_BROWSER",
      paidAt: new Date().toISOString()
    });

    const response = await post(orderPaidEvent());

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().fulfilled, false);
    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.equal(order.paymentId, "pay_FROM_BROWSER", "the webhook overwrote the browser's record");
  });
});

describe("events it should not act on", () => {
  test("an unrelated event is acknowledged, not retried", async () => {
    // A non-2xx would have Razorpay retry an event with no handler forever.
    await seedUnconfirmedOrder();

    const response = await post({
      event: "payment.failed",
      payload: { payment: { entity: { id: PAYMENT_ID, order_id: ORDER_ID } } }
    });

    assert.equal(response.statusCode, 200);
    const order = await collections.shopOrders.findOne({ orderId: ORDER_ID });
    assert.equal(order.status, "created", "a failed payment fulfilled the order");
  });

  test("an unknown order is acknowledged, not retried", async () => {

    const response = await post(orderPaidEvent("order_DOES_NOT_EXIST"));

    assert.equal(response.statusCode, 200, "retrying would never succeed");
    assert.equal(response.json().ignored, "unknown-order");
  });
});
