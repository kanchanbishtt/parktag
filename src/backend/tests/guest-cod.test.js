// Cash on Delivery on guest checkout (/shop, /get, /direct).
//
// The business rule: COD is the Duo Pack (pt-car-2) only, for a flat ₹30 on top
// of MRP. No code applies to COD, not even the auto-applied LAUNCH100: ₹529
// COD, ₹578 with the plate). No Razorpay: the order is written as "cod" at
// once, and the breakdown says what the courier will collect.
//
// What stands between a script and a stream of fake courier bookings is an OTP
// to the delivery phone (cod-otp/send, then cod-otp/verify for a single-use
// proof token that create-order burns), plus one open COD order per phone.

// Before anything reads the environment. Empty strings rather than deletes, so
// a developer .env cannot fill them back in: no courier, no Meta conversion,
// and no Razorpay — COD must not need it.
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";
process.env.DELHIVERY_API_KEY = "";
process.env.META_CAPI_ACCESS_TOKEN = "";
// sendOtp takes its dev console fallback instead of messaging a real number.
process.env.META_WHATSAPP_PHONE_NUMBER_ID = "";
process.env.META_WHATSAPP_ACCESS_TOKEN = "";

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import { createOtpHash } from "../lib/auth/security.js";
import { normalizeIdentifier, OTP_PURPOSE_AUTH, OTP_PURPOSE_COD_VERIFY } from "../lib/auth/otp.js";

let app, collections, previousPlate, previousLaunch;

const ADDRESS = {
  fullName: "COD QA", phone: "9812300001", line1: "1 QA Street",
  line2: "", landmark: "", city: "Noida", state: "Uttar Pradesh", pincode: "201301"
};

const createOrder = (body) =>
  app.inject({ method: "POST", url: "/api/shop/guest/create-order", remoteAddress: uniqueAddress(), payload: body });

const CODE = "424242";
const OTHER_PHONE = "9812300002";

const post = (url, payload) => app.inject({ method: "POST", url, remoteAddress: uniqueAddress(), payload });

// A live code for `phone`, as sendOtp would have written it. Planted rather
// than sent so no message leaves the building.
async function plantCode(phone, purpose = OTP_PURPOSE_COD_VERIFY) {
  await collections.otpTokens.insertOne({
    identifier: normalizeIdentifier(phone),
    purpose,
    codeHash: await createOtpHash(CODE),
    used: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
}

// What the sheet does before a COD order: prove the phone, get a proof token.
async function proveCodPhone(phone = ADDRESS.phone) {
  await plantCode(phone);
  const res = await post("/api/shop/guest/cod-otp/verify", { phone, otp: CODE });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().codToken;
}

const cod = async (overrides = {}) =>
  createOrder({ productId: "pt-car-2", address: ADDRESS, paymentMethod: "cod", codToken: await proveCodPhone(), ...overrides });

const purgeCodes = () => collections.otpTokens.deleteMany({
  identifier: { $in: [ADDRESS.phone, OTHER_PHONE].map(normalizeIdentifier) }
});

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
  await purgeCodes().catch(() => {});
  await collections.rateLimits.deleteMany({ _id: /^guest-cod(-otp|-proof)?:/ }).catch(() => {});
  if (previousPlate) await collections.storeSettings.replaceOne({ _id: "public-shop" }, previousPlate);
  else await collections.storeSettings.deleteOne({ _id: "public-shop" });
  await collections.promoCodes.deleteOne({ code: "LAUNCH100" });
  if (previousLaunch) await collections.promoCodes.insertOne(previousLaunch);
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.rateLimits.deleteMany({ _id: /^guest-cod(-otp|-proof)?:/ }).catch(() => {});
  await purgeCodes();
});

describe("guest Cash on Delivery", () => {
  test("Duo Pack at MRP with no launch offer: ₹499 + ₹30 = ₹529, written as a COD order", async () => {
    const res = await cod({ promo: "LAUNCH100" });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.paymentMethod, "cod");
    assert.equal(body.amount, 52900);

    const order = await collections.shopOrders.findOne({ orderNumber: body.orderNumber });
    assert.equal(order.status, "cod");
    assert.equal(order.paymentMethod, "cod");
    assert.equal(order.guest, true);
    assert.equal(order.ownerId, null);
    assert.equal(order.amount, 52900);
    assert.equal(order.promoCode, null, "no code on COD");
    assert.equal(order.codSurchargePaise, 3000);
    assert.equal(order.orderId, undefined, "a COD order has no Razorpay order");

    assert.deepEqual(
      body.breakdown.map(({ label, text }) => [label, text]),
      [
        ["MRP", "₹499"], ["Delivery", "Free"],
        ["Cash on delivery fee", "+₹30"], ["Total to pay on delivery", "₹529"]
      ]
    );
  });

  test("with the Clear Dashboard Plate: ₹499 + ₹49 + ₹30 = ₹578", async () => {
    const res = await cod({ promo: "LAUNCH100", addOnId: "dashboard-plate" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().amount, 57800);
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

  test("COD without a verified phone is refused and places nothing", async () => {
    const res = await createOrder({ productId: "pt-car-2", address: ADDRESS, paymentMethod: "cod" });
    assert.equal(res.statusCode, 401, res.body);
    assert.equal(res.json().code, "COD_OTP_REQUIRED");

    const forged = await createOrder({ productId: "pt-car-2", address: ADDRESS, paymentMethod: "cod", codToken: "f".repeat(64) });
    assert.equal(forged.statusCode, 401, forged.body);
    assert.equal(await collections.shopOrders.countDocuments({}), 0);
  });

  test("send puts a COD-scoped code, never a sign-in code, on the number", async () => {
    const res = await post("/api/shop/guest/cod-otp/send", { phone: ADDRESS.phone });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().phoneHint, "••••0001");
    const token = await collections.otpTokens.findOne({ identifier: normalizeIdentifier(ADDRESS.phone) });
    assert.equal(token.purpose, OTP_PURPOSE_COD_VERIFY);

    const junk = await post("/api/shop/guest/cod-otp/send", { phone: { $ne: null } });
    assert.equal(junk.statusCode, 400, junk.body);
  });

  test("a wrong code or a sign-in code does not verify", async () => {
    await plantCode(ADDRESS.phone);
    const wrong = await post("/api/shop/guest/cod-otp/verify", { phone: ADDRESS.phone, otp: "000000" });
    assert.equal(wrong.statusCode, 401, wrong.body);
    assert.match(wrong.json().error, /attempts? remaining/);
    assert.equal(wrong.json().codToken, undefined);

    await purgeCodes();
    await plantCode(ADDRESS.phone, OTP_PURPOSE_AUTH);
    const signIn = await post("/api/shop/guest/cod-otp/verify", { phone: ADDRESS.phone, otp: CODE });
    assert.equal(signIn.statusCode, 401, signIn.body);
  });

  test("a token proven for a different phone does not place the order", async () => {
    const codToken = await proveCodPhone(OTHER_PHONE);
    const res = await createOrder({ productId: "pt-car-2", address: ADDRESS, paymentMethod: "cod", codToken });
    assert.equal(res.statusCode, 401, res.body);
    assert.equal(res.json().code, "COD_OTP_REQUIRED");
    assert.equal(await collections.shopOrders.countDocuments({}), 0);
  });

  test("the proof token is single-use", async () => {
    const codToken = await proveCodPhone();
    const first = await createOrder({ productId: "pt-car-2", address: ADDRESS, paymentMethod: "cod", codToken });
    assert.equal(first.statusCode, 200, first.body);
    // Clear the one-open-order rule so only the token stands in the way.
    await collections.shopOrders.deleteMany({});
    const replay = await createOrder({ productId: "pt-car-2", address: ADDRESS, paymentMethod: "cod", codToken });
    assert.equal(replay.statusCode, 401, replay.body);
    assert.equal(await collections.shopOrders.countDocuments({}), 0);
  });

  test("online checkout needs no OTP and sends none", async () => {
    const res = await createOrder({ productId: "pt-car-2", address: ADDRESS, paymentMethod: "online" });
    assert.equal(res.statusCode, 500, res.body);
    assert.equal(res.json().error, "Razorpay not configured.");
    assert.equal(await collections.otpTokens.countDocuments({ identifier: normalizeIdentifier(ADDRESS.phone) }), 0);
  });

  test("the public catalogue offers COD exactly where create-order takes it", async () => {
    const res = await app.inject({ method: "GET", url: "/api/shop/public-catalogue", remoteAddress: uniqueAddress() });
    assert.equal(res.json().codSurchargePaise, 3000);
    assert.deepEqual(res.json().codProductIds, ["pt-car-2"]);
  });
});
