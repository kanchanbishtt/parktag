// Context Shop, findings MEDIUM #3, #4 and #5.
//
// #3 — COD takes no money up front and books a real courier shipment, and the
// only limit was @fastify/rate-limit's per-IP cap. One account placed 12 orders
// worth ₹14,976 in a single burst by rotating source addresses.
//
// #4 — /api/shop/* was the one signed-in surface the CSRF origin check never
// covered. That was my own omission when the check was widened: I excluded shop
// assuming a payment provider posted to it, and there is no Razorpay webhook in
// this app at all.
//
// #5 — cod-prepay-order overwrote prepayOrderId on every call while
// cod-prepay-verify only accepts the current one, so opening the flash offer
// twice and paying the first sheet meant Razorpay captured the money and the
// order stayed COD — the courier still collected cash. The buyer paid twice.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

// Pin Razorpay to a throwaway key pair for this process, before anything reads
// the environment.
//
// MEDIUM #5 below needs the key PRESENT: cod-prepay-order refuses without one,
// and the reuse path under test sits after that gate. The key used to come from
// the ambient environment — the developer .env locally, and nothing at all in
// CI, where the gate answered 500 and those tests failed on an environment
// difference rather than on behaviour.
//
// A fake pair is also the safer one. The reuse tests seed prepayOrderId so the
// route hands back the stored order without calling out — but that reuse is
// precisely what they assert, so a regression drops them through to
// createRazorpayOrder, which under the live credentials would mint a real order
// in the ParkTag account on every run. Compare shop-idempotency.test.js, which
// removes the key for the mirror-image reason.
process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-shop-med@parktag-test.invalid");
const PHONE = "+919812345678";
const EVIL_ORIGIN = "https://evil.example.com";

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

  const owner = await createTestOwner(collections, {
    email: OWNER_EMAIL,
    // Pre-trusted, so no OTP is ever requested and nothing is ever dispatched.
    codVerifiedPhone: PHONE
  });
  ownerId = owner._id;
  cookie = await createSession(app, {
    id: String(ownerId), role: "owner", email: owner.email, displayName: owner.displayName
  });
  await collections.addresses.insertOne({
    ownerId, fullName: "Shop QA", phone: PHONE, line1: "1 Test St",
    city: "Delhi", state: "Delhi", pincode: "110001"
  });
});

// A fresh source address every time, which is the whole point: it removes the
// per-IP rate limit from the picture so what is measured is the per-ACCOUNT cap.
function placeCod() {
  return app.inject({
    method: "POST",
    url: "/api/shop/place-cod",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    payload: { productId: "pt-car-4-bike" }
  });
}

describe("MEDIUM #3 — one account cannot open unlimited COD orders", () => {
  test("the burst that placed 12 orders is stopped", async () => {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await placeCod()).statusCode);

    const placed = codes.filter((c) => c === 200).length;
    const refused = codes.filter((c) => c === 429).length;

    assert.equal(placed, 3, `expected 3 orders then refusals, got: ${codes.join(",")}`);
    assert.equal(refused, 9);
    assert.equal(
      await collections.shopOrders.countDocuments({ ownerId, status: "cod" }),
      3,
      "more COD orders exist than the cap allows"
    );
  });

  test("the refusal says why, and is not a generic error", async () => {
    for (let i = 0; i < 3; i++) await placeCod();

    const response = await placeCod();

    assert.equal(response.statusCode, 429);
    assert.equal(response.json().code, "COD_LIMIT");
  });

  test("the cap is per account, not global", async () => {
    // Otherwise one busy customer would block the shop for everyone else.
    for (let i = 0; i < 3; i++) await placeCod();
    assert.equal((await placeCod()).statusCode, 429, "precondition: first owner is capped");

    const other = await createTestOwner(collections, {
      email: assertUndeliverableIdentifier("qa-shop-med2@parktag-test.invalid"),
      codVerifiedPhone: PHONE
    });
    await collections.addresses.insertOne({
      ownerId: other._id, fullName: "Other QA", phone: PHONE, line1: "2 Test St",
      city: "Delhi", state: "Delhi", pincode: "110001"
    });
    const otherCookie = await createSession(app, {
      id: String(other._id), role: "owner", email: other.email
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/shop/place-cod",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: otherCookie },
      payload: { productId: "pt-car-1" }
    });

    assert.equal(response.statusCode, 200, `a second owner was blocked: ${response.body}`);
  });

  test("orders outside the window do not count", async () => {
    // A rolling window, not a lifetime total — nothing ever moves a COD order
    // out of "cod" on delivery, so a lifetime cap would permanently lock out a
    // returning customer.
    for (let i = 0; i < 3; i++) await placeCod();
    assert.equal((await placeCod()).statusCode, 429, "precondition: capped");

    await collections.shopOrders.updateMany(
      { ownerId },
      { $set: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() } }
    );

    assert.equal(
      (await placeCod()).statusCode,
      200,
      "yesterday's orders still count, so a repeat customer is locked out for good"
    );
  });

  test("an order that got paid for stops counting", async () => {
    for (let i = 0; i < 3; i++) await placeCod();
    assert.equal((await placeCod()).statusCode, 429, "precondition: capped");

    // What cod-prepay-verify does on a successful conversion.
    const one = await collections.shopOrders.findOne({ ownerId, status: "cod" });
    await collections.shopOrders.updateOne(
      { _id: one._id },
      { $set: { status: "paid", paymentMethod: "online" } }
    );

    assert.equal(
      (await placeCod()).statusCode,
      200,
      "paying for an order does not free up its slot"
    );
  });
});

describe("MEDIUM #4 — the origin check reaches the shop", () => {
  const forgeable = [
    ["/api/shop/place-cod", { productId: "pt-car-1" }],
    ["/api/shop/create-order", { productId: "pt-car-1" }],
    ["/api/shop/cod-otp/send", {}],
    ["/api/shop/cod-prepay-order", { orderNumber: "PT-260818-00001" }],
    ["/api/shop/verify-payment", {}]
  ];

  for (const [url, payload] of forgeable) {
    test(`${url} is refused from another origin`, async () => {
      const response = await app.inject({
        method: "POST",
        url,
        remoteAddress: uniqueAddress(),
        cookies: { wavetag_session: cookie },
        headers: { origin: EVIL_ORIGIN },
        payload
      });

      assert.equal(
        response.statusCode,
        403,
        `cross-origin call allowed: ${response.statusCode} ${response.body}`
      );
      assert.match(response.json().error, /did not come from the ParkTag site/);
    });
  }

  test("the same call from the site itself still works", async () => {
    // Proves the 403s above are the origin check and not a broken route.
    const response = await app.inject({
      method: "POST",
      url: "/api/shop/place-cod",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      headers: { origin: "http://localhost" },
      payload: { productId: "pt-car-1" }
    });

    assert.equal(response.statusCode, 200, `the shop blocked itself: ${response.body}`);
  });

  test("a caller sending no Origin is still allowed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/shop/place-cod",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      payload: { productId: "pt-car-1" }
    });

    assert.equal(response.statusCode, 200, `a headerless call was blocked: ${response.body}`);
  });

  test("the provider webhooks are still outside it", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/provider/exotel/webhook",
      remoteAddress: uniqueAddress(),
      headers: { origin: EVIL_ORIGIN },
      payload: {}
    });

    assert.notEqual(response.statusCode, 403, "the origin check reached a webhook");
  });
});

describe("MEDIUM #5 — reopening the flash offer cannot strand a payment", () => {
  async function codOrder() {
    const placed = await app.inject({
      method: "POST",
      url: "/api/shop/place-cod",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      payload: { productId: "pt-car-1" }
    });
    assert.equal(placed.statusCode, 200, placed.body);
    return placed.json().orderNumber;
  }

  function prepayOrder(orderNumber) {
    return app.inject({
      method: "POST",
      url: "/api/shop/cod-prepay-order",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      payload: { orderNumber }
    });
  }

  test("asking twice returns the same payment order", async () => {
    const orderNumber = await codOrder();

    // Seed the first prepay order directly. Creating one for real would call the
    // live Razorpay API, and what is under test is the second call's behaviour,
    // not Razorpay's.
    await collections.shopOrders.updateOne(
      { orderNumber, ownerId },
      { $set: { prepayOrderId: "order_QA_FIRST_SHEET", prepayAmount: 29900 } }
    );

    const second = await prepayOrder(orderNumber);

    assert.equal(second.statusCode, 200, second.body);
    const body = second.json();
    assert.equal(
      body.orderId,
      "order_QA_FIRST_SHEET",
      "a second payment order was minted; paying the first sheet would now be rejected"
    );
    assert.equal(body.amount, 29900);

    const stored = await collections.shopOrders.findOne({ orderNumber, ownerId });
    assert.equal(
      stored.prepayOrderId,
      "order_QA_FIRST_SHEET",
      "the stored payment order was overwritten"
    );
  });

  test("reopening does not reach Razorpay at all", async () => {
    // Beyond correctness: every reopen used to mint a throwaway order in the
    // Razorpay account. Asserted by using an amount no catalog product maps to —
    // if the route recomputed instead of returning what was stored, the reply
    // would carry the discounted catalog price rather than this sentinel.
    const orderNumber = await codOrder();
    await collections.shopOrders.updateOne(
      { orderNumber, ownerId },
      { $set: { prepayOrderId: "order_QA_FIRST_SHEET", prepayAmount: 12345 } }
    );

    const reopened = await prepayOrder(orderNumber);

    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.equal(
      reopened.json().amount,
      12345,
      "the route recomputed the price, so it created a fresh Razorpay order"
    );
  });
});
