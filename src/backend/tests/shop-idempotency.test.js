// Context Shop, finding LOW #7.
//
// #7 — create-order minted a fresh Razorpay order, a fresh row and a fresh
// order number on every call, so reloading the checkout burnt order numbers and
// left abandoned orders behind.
//
// LOW #6 lives in shop-verify-payment.test.js instead: verifying a signature
// needs the Razorpay secret, and this file deliberately removes it.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

// Disarm the live Razorpay API for this process before anything reads the
// environment. A create-order that does NOT reuse falls through to
// createRazorpayOrder, and these credentials are live — so the "must not reuse"
// tests below would each leave a real abandoned order in the account.
//
// With the key gone, minting is refused at the gate that now sits immediately
// before it, while everything above — including handing back a checkout already
// started — still runs. That is what keeps these tests discriminating: if reuse
// matched when it should not, the route would answer 200 with the seeded order
// instead of the configuration error.
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-shop-low@parktag-test.invalid");
const PHONE = "+919812345678";
const ADDRESS = {
  fullName: "Shop QA",
  phone: PHONE,
  line1: "1 Test St",
  line2: undefined,
  landmark: undefined,
  city: "Delhi",
  state: "Delhi",
  pincode: "110001"
};

let app;
let collections;
let ownerId;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await collections.counters.deleteMany({ _id: "shopOrder" }).catch(() => {});

  const owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  ownerId = owner._id;
  cookie = await createSession(app, {
    id: String(ownerId), role: "owner", email: owner.email, displayName: owner.displayName
  });
  await collections.addresses.insertOne({ ownerId, ...ADDRESS });
});

function createOrder(payload) {
  return app.inject({
    method: "POST",
    url: "/api/shop/create-order",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: "http://localhost" },
    payload
  });
}

// The row create-order would have written, seeded directly so the test never
// calls the live Razorpay API.
async function seedCreatedOrder(overrides = {}) {
  const doc = {
    orderId: "order_QA_EXISTING",
    orderNumber: "PT-260818-00001",
    paymentMethod: "online",
    ownerId,
    productId: "pt-car-1",
    productName: "ParkTag Car Tag (Pack of 1)",
    amount: 29900,
    currency: "INR",
    status: "created",
    shippingAddress: ADDRESS,
    replaceTagId: null,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  await collections.shopOrders.insertOne(doc);
  return doc;
}

describe("LOW #7 — reloading checkout does not mint a second order", () => {
  test("an identical request returns the order already started", async () => {
    const seeded = await seedCreatedOrder();

    const response = await createOrder({ productId: "pt-car-1" });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.orderId, seeded.orderId, "a second Razorpay order was minted");
    assert.equal(body.orderNumber, seeded.orderNumber, "a second order number was burnt");
    assert.equal(
      await collections.shopOrders.countDocuments({ ownerId }),
      1,
      "a duplicate order row was written"
    );
  });

  // There is deliberately no "the counter did not advance" test. The counter is
  // only touched after a successful Razorpay call, which this file cannot make,
  // so such a test would pass whether or not reuse worked — it could not fail,
  // and a test that cannot fail is worse than no test. The reuse assertion above
  // covers the same ground honestly: it checks the returned orderNumber is the
  // one already issued, which is what "no number was burnt" actually means.

  test("a different product is not served someone else's order", async () => {
    // Reuse must be exact, or the buyer is handed a payment for the wrong thing.
    await seedCreatedOrder();

    const response = await createOrder({ productId: "pt-combo" });

    // Reaching Razorpay is out of scope here; what matters is that the seeded
    // order was NOT returned as if it were a combo pack.
    assert.notEqual(
      response.statusCode,
      200,
      `the seeded order was reused: ${response.body}`
    );
    assert.ok(
      !response.body.includes("order_QA_EXISTING"),
      "a car-tag order was handed back for a combo pack"
    );
  });

  test("a paid order is never reused", async () => {
    await seedCreatedOrder({ status: "paid" });

    const response = await createOrder({ productId: "pt-car-1" });

    assert.notEqual(
      response.statusCode,
      200,
      `the seeded order was reused: ${response.body}`
    );
    assert.ok(
      !response.body.includes("order_QA_EXISTING"),
      "an already-paid order was handed back to be paid again"
    );
  });

  test("an order priced at a stale catalog rate is not reused", async () => {
    // verify-payment rejects an amount that no longer matches the catalog, so
    // handing such an order back would strand the buyer at the payment sheet.
    await seedCreatedOrder({ amount: 19900 });

    const response = await createOrder({ productId: "pt-car-1" });

    assert.notEqual(
      response.statusCode,
      200,
      `the seeded order was reused: ${response.body}`
    );
    assert.ok(
      !response.body.includes("order_QA_EXISTING"),
      "an order at an outdated price was reused"
    );
  });

  test("an order for a different address is not reused", async () => {
    // The address is snapshotted onto the order and is what the courier gets.
    await seedCreatedOrder({
      shippingAddress: { ...ADDRESS, line1: "99 Somewhere Else", pincode: "560001" }
    });

    const response = await createOrder({ productId: "pt-car-1" });

    assert.notEqual(
      response.statusCode,
      200,
      `the seeded order was reused: ${response.body}`
    );
    assert.ok(
      !response.body.includes("order_QA_EXISTING"),
      "an order addressed elsewhere was reused, so the parcel would ship to the old address"
    );
  });
});
