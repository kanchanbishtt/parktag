// Referrals: ₹50 off for the friend, one month of premium for the referrer.
//
// WHY THIS SUITE IS ADVERSARIAL RATHER THAN HAPPY-PATH.
//
// A referral code is public by design. It goes in a message, on a screenshot,
// into a WhatsApp group. So the interesting question is never "does a valid
// code work" — it is what happens when somebody points one at themselves, or
// edits a stored order, or reloads a checkout twenty times.
//
// The properties pinned here:
//
//   1. The server decides the price. A code buys a fixed discount; nothing the
//      browser sends can change the number.
//   2. `expectedOrderPaise` derives the discount from `referredBy`, NOT from
//      the discount stored beside it, so a tampered row still fails
//      verify-payment.
//   3. You cannot refer yourself, by account or by delivery phone. The phone
//      check is the only one a guest order has.
//   4. A month is added to the tag closest to LAPSING, and it lands after a
//      running trial rather than on top of it.
//   5. A referrer with no premium tag holds a credit rather than losing it.
//   6. The reward cannot be granted twice for one order.

import test, { describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { assertDisposableDatabase } from "./helpers.js";
import { getEnv } from "../lib/env.js";
import { getCollections, ensureCoreIndexes } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import {
  REFERRAL_DISCOUNT_PAISE,
  REFERRAL_REWARD_MONTHS,
  MAX_REWARDS_PER_WINDOW,
  expectedOrderPaise,
  ALPHABET,
  referralCodeFor,
  resolveReferral,
  grantReferralReward
} from "../lib/core/referrals.js";

assertDisposableDatabase();

const env = getEnv();
let collections;
const MARK = `ref-${Date.now()}`;
const CATALOG = 49900; // ₹499 in paise

const iso = (ms) => new Date(ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

async function makeOwner(extra = {}) {
  const { insertedId } = await collections.owners.insertOne({
    email: `${MARK}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    role: "owner",
    testMarker: MARK,
    ...extra
  });
  return insertedId;
}

async function makeTag(ownerId, extra = {}) {
  const { insertedId } = await collections.tags.insertOne({
    token: `${MARK}-${Math.random().toString(36).slice(2, 10)}`,
    ownerId,
    premium: true,
    status: "active",
    testMarker: MARK,
    ...extra
  });
  return insertedId;
}

before(async () => {
  collections = await getCollections(env);
  await ensureCoreIndexes(collections, null);
});

beforeEach(async () => {
  for (const c of ["owners", "tags", "shopOrders"]) {
    await collections[c].deleteMany({ testMarker: MARK });
  }
});

after(async () => {
  for (const c of ["owners", "tags", "shopOrders"]) {
    await collections[c].deleteMany({ testMarker: MARK });
  }
  await closeMongoConnection();
});

describe("the server decides the price", () => {
  test("a referred order is exactly ₹50 below catalog", () => {
    assert.equal(expectedOrderPaise(CATALOG, { referredBy: new ObjectId() }), CATALOG - REFERRAL_DISCOUNT_PAISE);
    assert.equal(REFERRAL_DISCOUNT_PAISE, 5000, "the offer is ₹50; changing it changes what customers were promised");
  });

  test("no referrer, no discount", () => {
    assert.equal(expectedOrderPaise(CATALOG, {}), CATALOG);
    assert.equal(expectedOrderPaise(CATALOG, null), CATALOG);
  });

  test("a tampered discount on the row changes nothing", () => {
    // THE property that keeps verify-payment honest. Someone with write access
    // to an order (or a future bug that copies a client value onto it) sets a
    // ₹400 discount. The expected price is derived from `referredBy` alone, so
    // the order still has to be catalog minus ₹50 or the payment is refused.
    const tampered = { referredBy: new ObjectId(), referralDiscountPaise: 40000 };
    assert.equal(expectedOrderPaise(CATALOG, tampered), CATALOG - REFERRAL_DISCOUNT_PAISE);
  });

  test("the price can never fall to zero or below", () => {
    // A discount larger than the item would be a way to be paid for taking
    // stock, and Razorpay refuses a zero amount outright.
    assert.equal(expectedOrderPaise(100, { referredBy: new ObjectId() }), 100);
    assert.ok(expectedOrderPaise(1, { referredBy: new ObjectId() }) > 0);
  });
});

describe("codes", () => {
  test("a code is minted once and then stable", async () => {
    const ownerId = await makeOwner();
    const first = await referralCodeFor(collections, ownerId);
    const second = await referralCodeFor(collections, ownerId);

    assert.equal(first.length, 6);
    assert.equal(first, second, "a second call minted a different code, invalidating links already shared");
  });

  test("concurrent callers agree on one code", async () => {
    // Two tabs opening the referral card at once. A read-then-write would race
    // them into different codes and leave one of them shared but dead.
    const ownerId = await makeOwner();
    const codes = await Promise.all([
      referralCodeFor(collections, ownerId),
      referralCodeFor(collections, ownerId),
      referralCodeFor(collections, ownerId)
    ]);
    assert.equal(new Set(codes).size, 1, `three callers minted ${new Set(codes).size} codes`);
  });

  test("the alphabet excludes every character people mistype", () => {
    // Asserted on the ALPHABET itself, deterministically.
    //
    // Two earlier versions of this were worse. The first compared one
    // hand-written regex against another and proved only that they agreed. The
    // second minted forty codes against a remote database to sample a random
    // draw, which was slow and could only ever be probabilistic.
    for (const banned of ["0", "1", "I", "L", "O", "U"]) {
      assert.ok(!ALPHABET.includes(banned), `${banned} is in the code alphabet and should not be`);
    }
    assert.equal(new Set(ALPHABET).size, ALPHABET.length, "the alphabet repeats a character, skewing the draw");
  });

  test("a minted code is drawn from that alphabet", async () => {
    const ownerId = await makeOwner();
    const code = await referralCodeFor(collections, ownerId);
    for (const ch of code) {
      assert.ok(ALPHABET.includes(ch), `minted code ${code} contains ${ch}, which is not in the alphabet`);
    }
  });

  test("a code containing an ambiguous character is refused", async () => {
    // The validator must not be looser than the generator. It was: the
    // hand-written range admitted L and U, so it accepted codes that could
    // never exist.
    for (const impossible of ["ABCDEL", "ABCDEU", "ABCDEO", "ABCDEI"]) {
      const r = await resolveReferral(collections, impossible, {});
      assert.equal(r.reason, "malformed", `${impossible} passed validation`);
    }
  });
});

describe("you cannot refer yourself", () => {
  test("not by account", async () => {
    const ownerId = await makeOwner();
    const code = await referralCodeFor(collections, ownerId);

    const r = await resolveReferral(collections, code, { buyerOwnerId: ownerId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self");
  });

  test("not by delivery phone, which is all a guest order has", async () => {
    // The one that matters. A guest checkout has no account to compare, so
    // without this anybody could take ₹50 off every order they ever place and
    // mint themselves a month each time.
    const ownerId = await makeOwner({ mobile: "+919812345678" });
    const code = await referralCodeFor(collections, ownerId);

    const r = await resolveReferral(collections, code, { deliveryPhone: "+919812345678" });
    assert.equal(r.ok, false, "a guest used their own code on their own number");
    assert.equal(r.reason, "self");
  });

  test("phone matching survives a different stored format", async () => {
    // Signup wrote bare digits for years and E.164 now. A raw string compare
    // would let the oldest accounts self-refer.
    const ownerId = await makeOwner({ phone: "9812345678" });
    const code = await referralCodeFor(collections, ownerId);

    const r = await resolveReferral(collections, code, { deliveryPhone: "+919812345678" });
    assert.equal(r.reason, "self", "E.164 and bare digits were not recognised as one number");
  });

  test("a real friend resolves", async () => {
    const ownerId = await makeOwner({ mobile: "+919812345678" });
    const code = await referralCodeFor(collections, ownerId);

    const r = await resolveReferral(collections, code, { deliveryPhone: "+919899999999" });
    assert.equal(r.ok, true);
    assert.equal(String(r.referrerId), String(ownerId));
  });

  test("junk and unknown codes are refused without throwing", async () => {
    for (const bad of ["", null, "ABC", "!!!!!!", "AAAAAAAA", "0O1IL0"]) {
      const r = await resolveReferral(collections, bad, {});
      assert.equal(r.ok, false, `${JSON.stringify(bad)} was accepted as a referral code`);
    }
    assert.equal((await resolveReferral(collections, "ZZZZZZ", {})).reason, "unknown");
  });
});

describe("the reward", () => {
  test("extends the tag closest to lapsing, not the newest", async () => {
    const referrerId = await makeOwner();
    // Two premium tags: one with three years of subscription, one whose trial
    // ends next month. A month is worth something only on the second.
    const far = await makeTag(referrerId, {
      subscription: { status: "active", currentPeriodEnd: iso(Date.now() + 1000 * DAY) }
    });
    const near = await makeTag(referrerId, { activatedAt: iso(Date.now() - 335 * DAY) });

    const order = { orderId: `${MARK}-o1`, referredBy: referrerId, paymentMethod: "online" };
    await collections.shopOrders.insertOne({ ...order, testMarker: MARK });

    const res = await grantReferralReward(env, collections, order, null);
    assert.equal(res.granted, true);
    assert.equal(res.tagId, String(near), "the month landed on the tag that did not need it");
    assert.notEqual(res.tagId, String(far));
  });

  test("a month lands AFTER a running trial, not on top of it", async () => {
    // membershipPeriodStart is the existing arithmetic for this. Adding from
    // `now` instead would give a referrer with eleven months of trial left a
    // period that expires before their trial does, which is no reward at all.
    const referrerId = await makeOwner();
    const activatedAt = iso(Date.now() - 30 * DAY); // 11 months of trial left
    await makeTag(referrerId, { activatedAt });

    const order = { orderId: `${MARK}-o2`, referredBy: referrerId, paymentMethod: "online" };
    await collections.shopOrders.insertOne({ ...order, testMarker: MARK });

    const res = await grantReferralReward(env, collections, order, null);
    const until = new Date(res.until).getTime();

    assert.ok(
      until > Date.now() + 360 * DAY,
      `the month was added from today (${res.until}) rather than after the trial`
    );
  });

  test("a referrer with no premium tag holds a credit instead of losing it", async () => {
    const referrerId = await makeOwner();
    const order = { orderId: `${MARK}-o3`, referredBy: referrerId, paymentMethod: "online" };
    await collections.shopOrders.insertOne({ ...order, testMarker: MARK });

    const res = await grantReferralReward(env, collections, order, null);
    assert.equal(res.held, true);

    const owner = await collections.owners.findOne({ _id: referrerId });
    assert.equal(owner.referralCreditMonths, REFERRAL_REWARD_MONTHS);
  });

  test("an order with no referrer grants nothing", async () => {
    const res = await grantReferralReward(env, collections, { orderId: `${MARK}-o4` }, null);
    assert.equal(res.granted, false);
    assert.equal(res.reason, "no-referral");
  });

  test("COD is refused even if it somehow reaches the grant", async () => {
    // Belt and braces: fulfilPaidOrder is the prepaid path, so this cannot
    // normally happen. It is explicit so the function stays safe to call from
    // anywhere that later decides an order is settled.
    const referrerId = await makeOwner();
    await makeTag(referrerId, { activatedAt: iso(Date.now() - 300 * DAY) });

    const res = await grantReferralReward(
      env, collections,
      { orderId: `${MARK}-o5`, referredBy: referrerId, paymentMethod: "cod" },
      null
    );
    assert.equal(res.granted, false);
    assert.equal(res.reason, "cod");
  });

  test("the per-referrer cap holds", async () => {
    const referrerId = await makeOwner();
    await makeTag(referrerId, { activatedAt: iso(Date.now() - 300 * DAY) });

    // Fill the window with already-rewarded orders.
    const filled = Array.from({ length: MAX_REWARDS_PER_WINDOW }, (_, i) => ({
      orderId: `${MARK}-cap-${i}`,
      referredBy: referrerId,
      referralRewardedAt: iso(Date.now() - 60 * 1000),
      testMarker: MARK
    }));
    await collections.shopOrders.insertMany(filled);

    const order = { orderId: `${MARK}-o6`, referredBy: referrerId, paymentMethod: "online" };
    await collections.shopOrders.insertOne({ ...order, testMarker: MARK });

    const res = await grantReferralReward(env, collections, order, null);
    assert.equal(res.granted, false);
    assert.equal(res.reason, "capped");
  });

  test("a failure never throws into the payment path", async () => {
    // The buyer's money has already moved by the time this runs. A reward that
    // cannot be granted must not turn a completed purchase into a 500.
    const res = await grantReferralReward(env, null, { orderId: "x", referredBy: new ObjectId() }, null);
    assert.equal(res.granted, false);
    assert.equal(res.reason, "error");
  });
});
