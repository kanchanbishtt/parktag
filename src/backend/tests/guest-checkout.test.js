// Buying a tag with no account.
//
// /get takes an order from someone who has never signed in: pack, delivery
// address, Razorpay. The account is created later, by the activation wizard,
// once the sticker has arrived and the buyer's number has actually been proven.
//
// Two properties are worth holding down hard, and they are what this file is
// mostly about.
//
// A guest order is attached to NO account. The only identifier a guest supplies
// is a delivery phone, and nothing has verified it is theirs — so looking an
// owner up by it, never mind issuing a session, would let anyone act as a
// stranger. `ownerId` is null and stays null.
//
// And the guest door only opens guest orders. The Razorpay signature proves a
// payment, not an identity, so a valid signature must not be enough to reach an
// order that belongs to a real owner: everything downstream of one touches
// their tags and their vault.

// Before importing anything that reads the environment. A fake pair is enough
// and is the safer choice: verifying a signature is a local HMAC that reaches
// no API, and creating an order is never exercised here — the rows are seeded
// directly, so no order is minted in anyone's Razorpay dashboard.
process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app;
let collections;

const ADDRESS = {
  fullName: "QA Guest",
  phone: "9812345678",
  line1: "12 Test Street",
  line2: "",
  landmark: "",
  city: "Dehradun",
  state: "Uttarakhand",
  pincode: "248001"
};

const post = (url, payload) =>
  app.inject({ method: "POST", url, payload, remoteAddress: uniqueAddress() });

const createOrder = (body) => post("/api/shop/guest/create-order", body);

// What Razorpay would send back. A local HMAC over `order_id|payment_id`.
function sign(orderId, paymentId) {
  return crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

// Seeded rather than created through the route: creating one would call the
// real Razorpay API with a placeholder key.
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
    shippingAddress: ADDRESS,
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
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.shopOrders.deleteMany({}).catch(() => {});
});

describe("placing a guest order", () => {
  test("the catalogue decides what exists, not the request", async () => {
    const res = await createOrder({ productId: "NOT-A-PRODUCT", address: ADDRESS });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /Unknown product/);
  });

  // The same validator an owner's saved address goes through, so a guest cannot
  // ship somewhere the dashboard would have refused.
  for (const [name, patch, expected] of [
    ["no name", { fullName: "" }, /full name/i],
    ["a phone that is not an Indian mobile", { phone: "1234567890" }, /10-digit mobile/i],
    ["no street", { line1: "" }, /house|street/i],
    ["a PIN starting with zero", { pincode: "048001" }, /6-digit PIN/i],
    ["a short PIN", { pincode: "2480" }, /6-digit PIN/i],
    ["no city", { city: "" }, /city/i],
    ["no state", { state: "" }, /state/i]
  ]) {
    test(`it refuses an address with ${name}`, async () => {
      const res = await createOrder({ productId: "pt-car-2", address: { ...ADDRESS, ...patch } });

      assert.equal(res.statusCode, 400);
      assert.match(res.json().error, expected);
    });
  }

  // Nothing is written before the address is known-good, so a rejected attempt
  // cannot leave a half-order behind.
  test("a refused address writes no order", async () => {
    await createOrder({ productId: "pt-car-2", address: { ...ADDRESS, pincode: "bad" } });

    assert.equal(await collections.shopOrders.countDocuments({}), 0);
  });
});

describe("confirming a guest payment", () => {
  test("it needs all three payment fields", async () => {
    const res = await post("/api/shop/guest/verify-payment", { razorpay_order_id: "order_x" });

    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /Missing payment details/);
  });

  test("a forged signature is refused", async () => {
    const orderId = await seedOrder();
    const res = await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: "pay_forged",
      razorpay_signature: "not-a-real-signature"
    });

    assert.equal(res.statusCode, 400);
    const after = await collections.shopOrders.findOne({ orderId });
    assert.equal(after.status, "created", "a forged signature marked an order paid");
  });

  test("a correct signature fulfils the order", async () => {
    const orderId = await seedOrder();
    const paymentId = "pay_guest_ok";

    const res = await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
    assert.equal(res.json().fulfilled, true);

    const after = await collections.shopOrders.findOne({ orderId });
    assert.equal(after.status, "paid");
    assert.equal(after.paymentId, paymentId);
  });

  // Razorpay retries its webhook, and the browser callback races it. Whichever
  // lands second must not fulfil a second time.
  test("confirming twice fulfils once", async () => {
    const orderId = await seedOrder();
    const paymentId = "pay_guest_twice";
    const body = {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    };

    const first = await post("/api/shop/guest/verify-payment", body);
    const second = await post("/api/shop/guest/verify-payment", body);

    assert.equal(first.json().fulfilled, true);
    assert.equal(second.json().fulfilled, false, "the second confirmation fulfilled again");
  });

  // The security property this endpoint exists inside of. The signature proves
  // a payment, not an identity — so it must not be a way to reach an order that
  // belongs to a real owner through the door that asks nobody who they are.
  test("it will not touch an order that belongs to an owner", async () => {
    const orderId = await seedOrder({ ownerId: new ObjectId(), guest: false });
    const paymentId = "pay_not_yours";

    const res = await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId) // a VALID signature
    });

    assert.equal(res.statusCode, 404);
    const after = await collections.shopOrders.findOne({ orderId });
    assert.equal(after.status, "created", "an owner's order was fulfilled through the guest door");
  });

  test("an order that does not exist says so without fulfilling anything", async () => {
    const orderId = "order_never_created";
    const paymentId = "pay_nothing";

    const res = await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    });

    assert.equal(res.statusCode, 404);
  });
});

describe("what a guest order is attached to", () => {
  // The whole safety argument in one assertion. An unverified phone number must
  // never be enough to bind an order to an account.
  test("a fulfilled guest order still belongs to no account", async () => {
    const orderId = await seedOrder();
    const paymentId = "pay_guest_owner_check";

    await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    });

    const after = await collections.shopOrders.findOne({ orderId });
    assert.equal(after.ownerId, null, "a guest order acquired an owner");
    assert.equal(after.guest, true);
  });

  // Paying does not create an account either. If it ever does, it must be
  // because somebody decided to — not as a side effect of a checkout that
  // never verified the number it was given.
  test("paying creates no owner", async () => {
    const before = await collections.owners.countDocuments({});
    const orderId = await seedOrder();
    const paymentId = "pay_guest_no_owner";

    await post("/api/shop/guest/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: sign(orderId, paymentId)
    });

    assert.equal(await collections.owners.countDocuments({}), before);
  });
});
