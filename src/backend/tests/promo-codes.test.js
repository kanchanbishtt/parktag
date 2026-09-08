// Discount codes, and the one rule that makes them safe.
//
// ── THE BROWSER SENDS A CODE. IT NEVER SENDS AN AMOUNT. ────────────────────
//
// referrals.js already says this at the top, and records what happened when it
// slipped: cod-prepay-order handed a ₹50 flash discount to anyone who called
// the endpoint directly, so a sixty-second offer was permanent. A promo code is
// the same hazard with a wider door, because these codes are handed out in
// WhatsApp groups on purpose.
//
// ── Why these exist at all ─────────────────────────────────────────────────
//
// Every offline and WhatsApp sale used to bypass the shop entirely: UPI to
// edittree@axl, sticker handed over, nothing written down. Four real customers
// were invisible to reporting. A negotiated price now goes through the ordinary
// checkout with a code, so there is one path, one ledger and one payment rail.
//
// ── The two-speed check, and why ───────────────────────────────────────────
//
// Minting an order GATES on everything: expiry, revocation, usage cap, and the
// phone a single-use code is bound to.
//
// Verifying a payment asks only "what is this code worth". It must NOT re-apply
// the gates, and that is not laziness. verify-payment runs the amount check on
// every arrival, and it arrives twice by design (the browser callback and the
// Razorpay webhook race, see order-fulfilment.js). Once fulfilment has consumed
// a single-use code, a gating re-check would call it exhausted, compute the
// full catalogue price, and reject a payment the customer has already made.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolvePromo,
  promoValueFor,
  consumePromo,
  PROMO_CODE_PATTERN
} from "../lib/core/promo-codes.js";
import { expectedOrderPaise, REFERRAL_DISCOUNT_PAISE } from "../lib/core/referrals.js";
import { ensureCoreIndexes } from "../lib/db/repositories.js";
import { startTestApp, stopTestApp } from "./helpers.js";

let app;
let collections;

const BUYER = "9812345678";

before(async () => {
  ({ app, collections } = await startTestApp());
  await ensureCoreIndexes(collections, null);
});

after(async () => {
  await collections.promoCodes.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.promoCodes.deleteMany({});
});

// A code exactly as the admin page would write it.
async function seedCode(overrides = {}) {
  const doc = {
    code: "AJNARA99",
    discountPaise: 9900,
    singleUse: false,
    boundPhone: null,
    maxUses: null,
    usedCount: 0,
    expiresAt: null,
    active: true,
    fulfilment: "ship",
    createdAt: new Date().toISOString(),
    ...overrides
  };
  await collections.promoCodes.insertOne(doc);
  return doc;
}

describe("minting an order gates on everything", () => {
  test("a good code returns its value", async () => {
    await seedCode();
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });

    assert.equal(got.ok, true);
    assert.equal(got.discountPaise, 9900);
    assert.equal(got.code, "AJNARA99");
  });

  // Read off a screen and typed into a phone, so it is matched case-insensitively
  // and with the spaces people add.
  test("case and surrounding spaces do not matter", async () => {
    await seedCode();
    const got = await resolvePromo(collections, "  ajnara99 ", { deliveryPhone: BUYER });
    assert.equal(got.ok, true);
  });

  // Every rejection below is a normal thing for a buyer to do, so each reports a
  // reason instead of throwing. The checkout drops the discount and carries on:
  // a mistyped code must never cost somebody a sale.
  test("a mistyped code is refused, not thrown", async () => {
    const got = await resolvePromo(collections, "NOPE!!", { deliveryPhone: BUYER });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "malformed");
  });

  test("an unknown code is refused", async () => {
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "unknown");
  });

  test("a revoked code is refused", async () => {
    await seedCode({ active: false });
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "revoked");
  });

  test("an expired code is refused", async () => {
    await seedCode({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "expired");
  });

  test("a code still inside its window is accepted", async () => {
    await seedCode({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });
    assert.equal(got.ok, true);
  });

  // The cap is what protects the margin once a code leaks out of the group chat
  // it was meant for.
  test("a code at its usage cap is refused", async () => {
    await seedCode({ maxUses: 3, usedCount: 3 });
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "exhausted");
  });

  test("a code below its cap is accepted", async () => {
    await seedCode({ maxUses: 3, usedCount: 2 });
    assert.equal((await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER })).ok, true);
  });
});

describe("a single-use code belongs to one buyer", () => {
  // The point of binding: a screenshot forwarded to a WhatsApp group is worth
  // nothing to anybody else.
  test("somebody else's phone is refused", async () => {
    await seedCode({ singleUse: true, boundPhone: BUYER });
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: "9999900000" });

    assert.equal(got.ok, false);
    assert.equal(got.reason, "not-yours");
  });

  // Stored formats differ by signup path, exactly as resolveReferral's
  // self-referral check found. A raw string compare would refuse the very buyer
  // the code was minted for.
  test("the same number in another format is still the same buyer", async () => {
    await seedCode({ singleUse: true, boundPhone: "+919812345678" });
    assert.equal((await resolvePromo(collections, "AJNARA99", { deliveryPhone: "9812345678" })).ok, true);
  });

  test("a bound code with no phone on the order is refused", async () => {
    await seedCode({ singleUse: true, boundPhone: BUYER });
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: null });
    assert.equal(got.ok, false);
  });

  test("a single-use code that has been used is refused", async () => {
    await seedCode({ singleUse: true, boundPhone: BUYER, usedCount: 1 });
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "exhausted");
  });
});

describe("verifying a payment only asks what the code is worth", () => {
  // THE retry-safety property. verify-payment runs on both the browser callback
  // and the Razorpay webhook, and fulfilment consumes the code between them.
  // Gating here would reject the second arrival for a payment already taken.
  test("a consumed single-use code still reports its value", async () => {
    await seedCode({ singleUse: true, boundPhone: BUYER, usedCount: 1 });
    assert.equal(await promoValueFor(collections, "AJNARA99"), 9900);
  });

  test("an expired code still reports its value", async () => {
    await seedCode({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(await promoValueFor(collections, "AJNARA99"), 9900);
  });

  // A code that never existed is worth nothing, so a row naming one falls back
  // to the catalogue price and fails the amount check. That is the correct
  // direction to fail.
  test("an unknown code is worth nothing", async () => {
    assert.equal(await promoValueFor(collections, "MADEUPPP"), 0);
    assert.equal(await promoValueFor(collections, null), 0);
  });
});

describe("what the order is expected to cost", () => {
  test("the promo comes off the catalogue price", () => {
    assert.equal(expectedOrderPaise(49900, {}, 9900), 40000);
  });

  test("a promo and a referral stack", () => {
    assert.equal(expectedOrderPaise(49900, { referredBy: "someone" }, 9900), 49900 - REFERRAL_DISCOUNT_PAISE - 9900);
  });

  // Razorpay refuses a zero amount, and a discount that could exceed the price
  // would be a way to be paid for giving away stock.
  test("it never falls below one rupee", () => {
    assert.equal(expectedOrderPaise(29900, {}, 999999), 100);
  });

  // The property referrals.js was built around. The discount is derived from a
  // value looked up server-side, never from a number sitting on the order, so
  // an edited row still fails the check.
  test("a discount written onto the order is ignored", () => {
    const tampered = { promoDiscountPaise: 40000, referralDiscountPaise: 40000 };
    assert.equal(expectedOrderPaise(49900, tampered), 49900);
    assert.equal(expectedOrderPaise(49900, tampered, 9900), 40000);
  });

  test("no promo leaves the catalogue price alone", () => {
    assert.equal(expectedOrderPaise(29900, {}), 29900);
    assert.equal(expectedOrderPaise(29900, {}, 0), 29900);
  });
});

describe("a code is consumed when the money lands, not before", () => {
  test("consuming increments the count", async () => {
    await seedCode();
    await consumePromo(collections, "AJNARA99", "PT-260909-00001");

    const after = await collections.promoCodes.findOne({ code: "AJNARA99" });
    assert.equal(after.usedCount, 1);
    assert.deepEqual(after.usedByOrders, ["PT-260909-00001"]);
  });

  // Fulfilment is reached from two racing callers, and both may call this. The
  // conditional update in fulfilPaidOrder is what stops the second, but a code
  // burnt twice by a retry would deny a buyer a discount they were promised.
  test("consuming the same order twice counts once", async () => {
    await seedCode();
    await consumePromo(collections, "AJNARA99", "PT-260909-00001");
    await consumePromo(collections, "AJNARA99", "PT-260909-00001");

    assert.equal((await collections.promoCodes.findOne({ code: "AJNARA99" })).usedCount, 1);
  });

  test("a single use exhausts the code", async () => {
    await seedCode({ singleUse: true, boundPhone: BUYER });
    await consumePromo(collections, "AJNARA99", "PT-260909-00001");

    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });
    assert.equal(got.ok, false);
    assert.equal(got.reason, "exhausted");
  });

  test("consuming an unknown code is harmless", async () => {
    await consumePromo(collections, "NOSUCHCD", "PT-260909-00001");
  });
});

describe("the code says how the sticker gets there", () => {
  // A negotiated code is usually handed over face to face. Asking that buyer for
  // a shipping address is friction for a parcel nobody will ever post, and it
  // produces an order the stuck-parcel alert then chases for a missing waybill.
  //
  // Carrying the mode on the CODE rather than asking at checkout is what keeps
  // the buyer's side to name, phone and pay.
  test("a handover code says so", async () => {
    await seedCode({ fulfilment: "handover" });
    const got = await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER });

    assert.equal(got.ok, true);
    assert.equal(got.fulfilment, "handover");
  });

  // Anything else must keep posting parcels. A code that silently stopped
  // booking couriers would lose a customer their delivery.
  test("shipping is the default, and an unset field means shipping", async () => {
    await seedCode();
    assert.equal((await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER })).fulfilment, "ship");

    await collections.promoCodes.updateOne({ code: "AJNARA99" }, { $unset: { fulfilment: "" } });
    assert.equal((await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER })).fulfilment, "ship");
  });

  // A junk value must not be read as "skip the courier". Failing towards
  // shipping costs a wasted address field; failing the other way loses a parcel.
  test("an unrecognised mode falls back to shipping", async () => {
    await seedCode({ fulfilment: "teleport" });
    assert.equal((await resolvePromo(collections, "AJNARA99", { deliveryPhone: BUYER })).fulfilment, "ship");
  });
});

describe("the code alphabet", () => {
  // Same reasoning as referrals.js: these get read aloud, so O/0 and I/1 are
  // where it goes wrong.
  test("ambiguous characters are not accepted", () => {
    for (const bad of ["AJNARA0O", "AJNARA1I", "AJNARALL", "AJNARAUU"]) {
      assert.equal(PROMO_CODE_PATTERN.test(bad), false, `${bad} should be rejected`);
    }
  });

  test("a well-formed code is accepted", () => {
    assert.equal(PROMO_CODE_PATTERN.test("AJNARA99"), true);
  });
});
