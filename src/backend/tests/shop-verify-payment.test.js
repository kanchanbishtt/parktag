// Context Shop, finding LOW #6.
//
// #6 — verify-payment wrapped every order check in `if (collections)` and still
// answered `{ ok: true }` when there was no database: the order was never
// located, its amount never re-checked, its ownership never confirmed. A valid
// signature was still needed to get that far, so it was not directly
// exploitable, but "cannot check" must not resolve to "checked out fine".
//
// LOW #7 lives in shop-idempotency.test.js, which must remove the Razorpay key.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

// Razorpay stays configured here, deliberately and safely: verifying a
// signature is a local HMAC against the secret and reaches no API, and
// verify-payment refuses outright without the key. Nothing in this file mints
// an order.

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

describe("LOW #6 — no database means the payment is not confirmed", () => {
  test("a bad signature is still refused, and says nothing about an order", async () => {
    // The guard sits after the signature check, so this is the path an ordinary
    // forged request takes and it must be unchanged.
    const response = await app.inject({
      method: "POST",
      url: "/api/shop/verify-payment",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      headers: { origin: "http://localhost" },
      payload: {
        razorpay_order_id: "order_QA_EXISTING",
        razorpay_payment_id: "pay_QA",
        razorpay_signature: "not-a-real-signature"
      }
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().ok, false);
    assert.match(response.json().error, /verification failed/i);
  });

  test("the route never answers ok:true without checking the order", async () => {
    // Read as a contract on the source: there must be no path that returns a
    // success for a payment the database was never consulted about. The
    // unreachable-database case cannot be produced from a test without tearing
    // down the connection the rest of the suite shares, so the guard is asserted
    // where it lives.
    const source = await app.inject({
      method: "GET",
      url: "/api/health",
      remoteAddress: uniqueAddress()
    });
    assert.equal(source.statusCode, 200, "precondition: app is up");

    const { readFile } = await import("node:fs/promises");
    const route = await readFile(
      new URL("../routes/shop/index.js", import.meta.url),
      "utf8"
    );
    const verifyBlock = route.slice(
      route.indexOf('app.post("/api/shop/verify-payment"'),
      route.indexOf('app.post("/api/shop/cod-otp/send"')
    );

    assert.ok(verifyBlock.length > 0, "could not locate the verify-payment route");
    assert.ok(
      /if \(!collections\)/.test(verifyBlock),
      "verify-payment no longer refuses when there is no database"
    );
    assert.ok(
      !/if \(collections\) \{/.test(verifyBlock),
      "the order checks are wrapped in `if (collections)` again, so a missing " +
        "database silently skips them and the route still reports success"
    );
  });
});


