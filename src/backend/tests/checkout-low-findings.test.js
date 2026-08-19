// Checkout audit, the four LOW findings.
//
// #1 — the flash offer's countdown existed only in the browser. The
//      confirmation screen ran a sixty-second timer and then hid the panel;
//      cod-prepay-order applied the ₹50 to any COD order it was handed,
//      however old. The "limited time" offer was permanent to anyone calling
//      the endpoint directly, and the deadline shown to every buyer was a
//      fiction.
//
// #2 — the checkout sent the buyer's chosen variant and the server dropped it,
//      so no order recorded whether someone picked "Car" or "Auto". Recorded
//      now, and against an allowlist: the value comes from the browser and ends
//      up on a document that admin views and order e-mails read back.
//
// #3 — the owner's name, e-mail and mobile sat on `window.__ptOwner` from
//      dashboard load until the tab closed, readable by every script on the
//      page, Razorpay's checkout.js included. They now ride back with the order
//      being paid for.
//
// #4 — the confirmation screen showed the figures the browser was still holding
//      from create-order: assembled before the payment, never reconciled with
//      it. The "you saved ₹50" toast said ₹50 whatever the discount was.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A throwaway pair, set before anything reads the environment.
//
// The key must be PRESENT: cod-prepay-order and cod-prepay-verify both refuse
// outright without one, and everything under test here sits after that gate.
// Verifying a signature is a local HMAC that reaches no API, so a fake secret
// is enough to mint one these routes accept — and a fake key id cannot create
// an order in the real ParkTag account if some path did try to call out.
process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";

import { createSession } from "../lib/auth/session.js";
import {
  FLASH_DISCOUNT_PAISE,
  FLASH_WINDOW_MS,
  FLASH_GRACE_MS,
  flashDiscountPaiseFor
} from "../routes/shop/index.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-checkout-low@parktag-test.invalid");
const SCRIPTS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/scripts/owner"
);
const PHONE = "+919812345678";
const OWNER_NAME = "Checkout QA";

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
    displayName: OWNER_NAME,
    mobile: PHONE,
    // Pre-trusted, so place-cod never asks for an OTP and nothing is dispatched.
    codVerifiedPhone: PHONE
  });
  ownerId = owner._id;
  cookie = await createSession(app, {
    id: String(ownerId), role: "owner", email: owner.email, displayName: OWNER_NAME
  });
  await collections.addresses.insertOne({
    ownerId, fullName: OWNER_NAME, phone: PHONE, line1: "1 Test St",
    city: "Delhi", state: "Delhi", pincode: "110001"
  });
});

function placeCod(body = {}) {
  return app.inject({
    method: "POST",
    url: "/api/shop/place-cod",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    payload: { productId: "pt-car-2", ...body }
  });
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

describe("LOW #1 — the countdown means something now", () => {
  // The rule is tested directly. Everything downstream of it inside
  // cod-prepay-order is behind a call to Razorpay's API, so a route-level test
  // of the discount decision would be a test of the network.

  const order = (overrides) => ({ createdAt: new Date().toISOString(), ...overrides });

  test("an offer opened a moment ago still stands", () => {
    const now = Date.now();
    const doc = order({ flashOfferExpiresAt: new Date(now + FLASH_WINDOW_MS).toISOString() });

    assert.equal(flashDiscountPaiseFor(doc, now + 1000), FLASH_DISCOUNT_PAISE);
  });

  test("an offer from yesterday does not", () => {
    // The whole finding: this used to pay out regardless of age.
    const now = Date.now();
    const doc = order({
      flashOfferExpiresAt: new Date(now - 24 * 60 * 60 * 1000).toISOString()
    });

    assert.equal(
      flashDiscountPaiseFor(doc, now),
      0,
      "a day-old order still collected the flash discount"
    );
  });

  test("a tap just as the timer runs out is still honoured", () => {
    // The countdown runs in the browser and the request has to survive the
    // round trip. Expiring on the exact second would quote a discount and then
    // charge ₹50 more, which is the bug this is next to, not a fix for it.
    const now = Date.now();
    const doc = order({ flashOfferExpiresAt: new Date(now).toISOString() });

    assert.equal(
      flashDiscountPaiseFor(doc, now + FLASH_GRACE_MS - 1000),
      FLASH_DISCOUNT_PAISE,
      "someone who tapped in time was charged full price"
    );
  });

  test("the grace period is not a second window", () => {
    const now = Date.now();
    const doc = order({ flashOfferExpiresAt: new Date(now).toISOString() });

    assert.equal(flashDiscountPaiseFor(doc, now + FLASH_GRACE_MS + 1000), 0);
  });

  test("orders written before the deadline existed fall back to their age", () => {
    // Not a special case that keeps the old always-discounted behaviour alive
    // for them — the same rule, applied retroactively.
    const now = Date.now();

    const fresh = order({ createdAt: new Date(now).toISOString() });
    const stale = order({ createdAt: new Date(now - 60 * 60 * 1000).toISOString() });

    assert.equal(flashDiscountPaiseFor(fresh, now + 1000), FLASH_DISCOUNT_PAISE);
    assert.equal(flashDiscountPaiseFor(stale, now), 0, "an hour-old order was still discounted");
  });

  test("a date it cannot read earns nothing", () => {
    // This decides who gets money off, so it fails closed.
    assert.equal(flashDiscountPaiseFor({ flashOfferExpiresAt: "not a date" }, Date.now()), 0);
    assert.equal(flashDiscountPaiseFor({}, Date.now()), 0);
    assert.equal(flashDiscountPaiseFor(null, Date.now()), 0);
  });

  test("placing a COD order writes down when its offer ends", async () => {
    const before = Date.now();
    const placed = await placeCod();
    assert.equal(placed.statusCode, 200, placed.body);

    const stored = await collections.shopOrders.findOne({ orderNumber: placed.json().orderNumber });
    const expiresAt = Date.parse(stored.flashOfferExpiresAt);

    assert.ok(Number.isFinite(expiresAt), "no deadline was recorded against the order");
    assert.ok(
      expiresAt >= before + FLASH_WINDOW_MS && expiresAt <= Date.now() + FLASH_WINDOW_MS,
      "the recorded deadline is not one window from now"
    );
  });

  test("the screen is told how long it has, rather than assuming", async () => {
    // The timer was a hard-coded 60 that nothing on the server agreed to.
    const placed = await placeCod();

    assert.equal(placed.json().flashOfferSeconds, Math.round(FLASH_WINDOW_MS / 1000));
  });
});

describe("LOW #2 — the buyer's variant is recorded, and only if it is one", () => {
  test("a real variant is kept", async () => {
    const placed = await placeCod({ variant: "Auto" });
    assert.equal(placed.statusCode, 200, placed.body);

    const stored = await collections.shopOrders.findOne({ orderNumber: placed.json().orderNumber });
    assert.equal(stored.variant, "Auto", "the choice the UI presented was thrown away");
  });

  test("an injected string is not", async () => {
    // It ends up on a document admin views and order e-mails read back.
    const placed = await placeCod({ variant: "<img src=x onerror=alert(1)>" });
    assert.equal(placed.statusCode, 200, placed.body);

    const stored = await collections.shopOrders.findOne({ orderNumber: placed.json().orderNumber });
    assert.equal(stored.variant, null, "an arbitrary string was stored against the order");
  });

  test("a non-string is not", async () => {
    // JSON bodies can carry objects and arrays.
    const placed = await placeCod({ variant: { toString: "Car" } });
    assert.equal(placed.statusCode, 200, placed.body);

    const stored = await collections.shopOrders.findOne({ orderNumber: placed.json().orderNumber });
    assert.equal(stored.variant, null);
  });

  test("a bad variant never costs the buyer the order", async () => {
    // It is a label. Refusing the sale to fix a cosmetic field would be worse
    // than the thing being fixed.
    const placed = await placeCod({ variant: "Submarine" });

    assert.equal(placed.statusCode, 200, "a stray variant blocked a real purchase");
  });
});

describe("LOW #3 — the owner's details are not left lying on the page", () => {
  test("checkout gets them with the order instead", async () => {
    const placed = await placeCod();
    await collections.shopOrders.updateOne(
      { orderNumber: placed.json().orderNumber },
      { $set: { prepayOrderId: "order_QA_PREPAY", prepayAmount: placed.json().amount - FLASH_DISCOUNT_PAISE } }
    );

    const response = await prepayOrder(placed.json().orderNumber);
    assert.equal(response.statusCode, 200, response.body);

    const { prefill } = response.json();
    assert.ok(prefill, "the payment sheet has nothing to prefill from");
    assert.equal(prefill.name, OWNER_NAME);
    assert.equal(prefill.email, OWNER_EMAIL);
    assert.equal(prefill.contact, PHONE);
  });

  test("the dashboard no longer publishes them to window", async () => {
    const dashboard = await readFile(path.join(SCRIPTS, "welcome.js"), "utf8");

    assert.ok(
      !/window\.__ptOwner\s*=/.test(dashboard),
      "the owner's contact details are back on a global for the whole session"
    );
  });

  test("checkout no longer reads them from window", async () => {
    const checkout = await readFile(path.join(SCRIPTS, "welcome-shop.js"), "utf8");

    assert.ok(
      !/window\.__ptOwner\s*&&/.test(checkout),
      "checkout is back to prefilling from a page global"
    );
  });
});

describe("LOW #4 — the receipt says what the server recorded", () => {
  // cod-prepay-verify is reachable offline: the signature is a local HMAC over
  // orderId|paymentId, and seeding prepayOrderId skips the call to Razorpay.
  async function prepaidOrderReadyToVerify() {
    const placed = await placeCod();
    const orderNumber = placed.json().orderNumber;
    const prepayAmount = placed.json().amount - FLASH_DISCOUNT_PAISE;

    await collections.shopOrders.updateOne(
      { orderNumber },
      { $set: { prepayOrderId: "order_QA_RECEIPT", prepayAmount } }
    );
    return { orderNumber, codAmount: placed.json().amount, prepayAmount };
  }

  function sign(orderId, paymentId) {
    return crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
  }

  test("prepaying reports the amount charged and the saving, off the order", async () => {
    const { orderNumber, codAmount, prepayAmount } = await prepaidOrderReadyToVerify();

    const response = await app.inject({
      method: "POST",
      url: "/api/shop/cod-prepay-verify",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      payload: {
        orderNumber,
        razorpay_order_id: "order_QA_RECEIPT",
        razorpay_payment_id: "pay_QA_RECEIPT",
        razorpay_signature: sign("order_QA_RECEIPT", "pay_QA_RECEIPT")
      }
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.orderNumber, orderNumber);
    assert.equal(body.amountPaise, prepayAmount, "the receipt does not say what was charged");
    assert.equal(
      body.savedPaise,
      codAmount - prepayAmount,
      "the saving is not the one the order records — the toast used to say ₹50 regardless"
    );
  });

  test("the confirmation screen is not left to work the figures out itself", async () => {
    const checkout = await readFile(path.join(SCRIPTS, "welcome-shop.js"), "utf8");

    assert.ok(
      /showConfirmation\(\{[\s\S]{0,200}verifyData\.amountPaise/.test(checkout),
      "the online confirmation is back on the pre-payment figures the browser was holding"
    );
    assert.ok(
      !/you saved ₹50/.test(checkout),
      "the saving is hard-coded again"
    );
  });

  test("an expired offer does not open a payment sheet anyway", async () => {
    // The window is enforced on the server and can close between the countdown
    // running out and the request landing. Opening Razorpay for the full amount
    // under a button that promised a discount is the misquote this whole audit
    // has been about; the order just stays Cash on Delivery.
    const checkout = await readFile(path.join(SCRIPTS, "welcome-shop.js"), "utf8");

    assert.ok(
      /if \(!data\.discountPaise\)/.test(checkout),
      "checkout opens the sheet without checking the discount survived"
    );
  });
});
