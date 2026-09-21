// Cash on Delivery on guest checkout (/shop, /get, /direct).
//
// The business rule: COD is the Duo Pack (pt-car-2) only, for a flat ₹30 on top
// of whatever the online price is (LAUNCH100 still applies: ₹399 online, ₹429
// COD, ₹478 with the plate). No Razorpay: the order is written as "cod" at
// once, and the breakdown says what the courier will collect.
//
// Guest checkout does not OTP-verify the phone, so what stands between a
// script and a stream of fake courier bookings is one open COD order per phone.

// Before anything reads the environment. Empty strings rather than deletes, so
// a developer .env cannot fill them back in: no courier, no Meta conversion,
// and no Razorpay — COD must not need it.
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";
process.env.DELHIVERY_API_KEY = "";
process.env.META_CAPI_ACCESS_TOKEN = "";

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app, collections, previousPlate, previousLaunch;

const ADDRESS = {
  fullName: "COD QA", phone: "9812300001", line1: "1 QA Street",
  line2: "", landmark: "", city: "Noida", state: "Uttar Pradesh", pincode: "201301"
};

const createOrder = (body) =>
  app.inject({ method: "POST", url: "/api/shop/guest/create-order", remoteAddress: uniqueAddress(), payload: body });

const cod = (overrides = {}) =>
  createOrder({ productId: "pt-car-2", address: ADDRESS, paymentMethod: "cod", ...overrides });

before(async () => {
  ({ app, collections } = await startTestApp());
  previousPlate = await collections.storeSettings.findOne({ _id: "public-shop" });
  previousLaunch = await collections.promoCodes.findOne({ code: "LAUNCH100" });
  await collections.storeSettings.updateOne(
    { _id: "public-shop" },
    { $set: { dashboardPlate: { enabled: true, pricePaise: 4900 } } },
    { upsert: true }
  );
  await collections.promoCodes.deleteOne({ code: "LAUNCH100" });
  await collections.promoCodes.insertOne({
    code: "LAUNCH100", discountPaise: 10000, productIds: ["pt-car-2"], singleUse: false,
    boundPhone: null, maxUses: null, usedCount: 0, expiresAt: null, active: true,
    createdAt: new Date().toISOString()
  });
});

after(async () => {
  await collections.shopOrders.deleteMany({}).catch(() => {});
  if (previousPlate) await collections.storeSettings.replaceOne({ _id: "public-shop" }, previousPlate);
  else await collections.storeSettings.deleteOne({ _id: "public-shop" });
  await collections.promoCodes.deleteOne({ code: "LAUNCH100" });
  if (previousLaunch) await collections.promoCodes.insertOne(previousLaunch);
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.rateLimits.deleteMany({ _id: /^guest-cod:/ }).catch(() => {});
});

describe("guest Cash on Delivery", () => {
  test("Duo Pack with the launch offer: ₹399 + ₹30 = ₹429, written as a COD order", async () => {
    const res = await cod({ promo: "LAUNCH100" });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.paymentMethod, "cod");
    assert.equal(body.amount, 42900);

    const order = await collections.shopOrders.findOne({ orderNumber: body.orderNumber });
    assert.equal(order.status, "cod");
    assert.equal(order.paymentMethod, "cod");
    assert.equal(order.guest, true);
    assert.equal(order.ownerId, null);
    assert.equal(order.amount, 42900);
    assert.equal(order.codSurchargePaise, 3000);
    assert.equal(order.orderId, undefined, "a COD order has no Razorpay order");

    assert.deepEqual(
      body.breakdown.map(({ label, text }) => [label, text]),
      [
        ["MRP", "₹499"], ["Discount (LAUNCH100)", "-₹100"], ["Delivery", "Free"],
        ["Cash on delivery fee", "+₹30"], ["Total to pay on delivery", "₹429"]
      ]
    );
  });

  test("with the Clear Dashboard Plate: ₹399 + ₹49 + ₹30 = ₹478", async () => {
    const res = await cod({ promo: "LAUNCH100", addOnId: "dashboard-plate" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().amount, 47800);
    assert.ok(res.json().breakdown.some((row) => row.label === "Clear Dashboard Plate" && row.text === "₹49"));
  });

  test("without a code: catalogue price + ₹30", async () => {
    const res = await cod();
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().amount, 49900 + 3000);
  });

  for (const productId of ["pt-car-1", "pt-bike-1", "pt-combo"]) {
    test(`${productId} is online-only`, async () => {
      const res = await cod({ productId });
      assert.equal(res.statusCode, 400, res.body);
      assert.match(res.json().error, /only available on the Duo Pack/);
      assert.equal(await collections.shopOrders.countDocuments({}), 0);
    });
  }

  test("an unknown payment method is refused", async () => {
    const res = await cod({ paymentMethod: "upi-later" });
    assert.equal(res.statusCode, 400, res.body);
  });

  test("online stays the default when no payment method is sent", async () => {
    // Razorpay is unconfigured, so reaching its guard proves the online path.
    const res = await createOrder({ productId: "pt-car-2", address: ADDRESS });
    assert.equal(res.statusCode, 500, res.body);
    assert.equal(res.json().error, "Razorpay not configured.");
  });

  test("one open COD order per phone; the same checkout sent again gets it back", async () => {
    const first = await cod();
    assert.equal(first.statusCode, 200, first.body);

    const retry = await cod();
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(retry.json().orderNumber, first.json().orderNumber);

    const another = await cod({ addOnId: "dashboard-plate" });
    assert.equal(another.statusCode, 429, another.body);
    assert.equal(another.json().code, "COD_LIMIT");
    assert.equal(await collections.shopOrders.countDocuments({ status: "cod" }), 1);
  });

  test("the public catalogue offers COD exactly where create-order takes it", async () => {
    const res = await app.inject({ method: "GET", url: "/api/shop/public-catalogue", remoteAddress: uniqueAddress() });
    assert.equal(res.json().codSurchargePaise, 3000);
    assert.deepEqual(res.json().codProductIds, ["pt-car-2"]);
  });
});
