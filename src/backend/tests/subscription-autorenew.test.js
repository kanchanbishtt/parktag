// Auto-renew (Razorpay Subscriptions): the parts that must be right before a
// rupee moves, all without a DB or the network. The signature verifier is pure
// crypto; plan resolution is pure; the charge fulfilment runs against a tiny
// fake Mongo that honours the one conditional update the idempotency rests on.
// The live Razorpay calls and the webhook wiring are exercised in test mode
// (see scripts/create-subscription-plans.js), not here.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  verifyRazorpaySubscriptionSignature,
  isRazorpaySubscriptionsConfigured
} from "../lib/integrations/payments.js";
import { getSubscriptionPlan, availableSubscriptionPlanKeys } from "../lib/core/subscription-plans.js";
import { recordSubscriptionCharge } from "../lib/core/subscription-fulfilment.js";

const SECRET = "test_secret";
const ENV = { razorpayKeySecret: SECRET };

function sign(paymentId, subscriptionId) {
  return crypto.createHmac("sha256", SECRET).update(`${paymentId}|${subscriptionId}`).digest("hex");
}

describe("subscription signature (payment_id|subscription_id)", () => {
  test("accepts a correct signature", () => {
    assert.equal(
      verifyRazorpaySubscriptionSignature(ENV, { paymentId: "pay_1", subscriptionId: "sub_1", signature: sign("pay_1", "sub_1") }),
      true
    );
  });
  test("rejects the one-time order order (order_id|payment_id) shape", () => {
    const wrong = crypto.createHmac("sha256", SECRET).update(`sub_1|pay_1`).digest("hex");
    assert.equal(verifyRazorpaySubscriptionSignature(ENV, { paymentId: "pay_1", subscriptionId: "sub_1", signature: wrong }), false);
  });
  test("rejects missing pieces", () => {
    assert.equal(verifyRazorpaySubscriptionSignature(ENV, { paymentId: "", subscriptionId: "sub_1", signature: "x" }), false);
    assert.equal(verifyRazorpaySubscriptionSignature({}, { paymentId: "p", subscriptionId: "s", signature: "x" }), false);
  });
});

describe("subscription plan resolution", () => {
  const env = { razorpaySubPlanMonthly: "plan_m", razorpaySubPlanAnnual: "plan_y" };
  test("resolves a configured key to its Razorpay plan id and months", () => {
    assert.deepEqual(getSubscriptionPlan(env, "monthly"), { key: "monthly", months: 1, totalCount: 120, label: "Monthly (auto-renew)", razorpayPlanId: "plan_m" });
    assert.equal(getSubscriptionPlan(env, "annual").months, 12);
  });
  test("returns null for an unconfigured plan, an unknown key, and prototype keys", () => {
    assert.equal(getSubscriptionPlan({ razorpaySubPlanAnnual: "plan_y" }, "monthly"), null); // id not set
    assert.equal(getSubscriptionPlan(env, "weekly"), null);
    for (const k of ["constructor", "__proto__", "toString"]) assert.equal(getSubscriptionPlan(env, k), null);
    assert.equal(getSubscriptionPlan(env, 123), null);
  });
  test("availableSubscriptionPlanKeys lists only configured plans", () => {
    assert.deepEqual(availableSubscriptionPlanKeys({ razorpaySubPlanMonthly: "plan_m" }), ["monthly"]);
    assert.deepEqual(availableSubscriptionPlanKeys({}), []);
  });
});

describe("isRazorpaySubscriptionsConfigured", () => {
  const keys = { razorpayKeyId: "rzp_test_x", razorpayKeySecret: "s" };
  test("needs keys, the switch, and at least one plan id", () => {
    assert.equal(isRazorpaySubscriptionsConfigured({ ...keys, subscriptionsEnabled: true, razorpaySubPlanMonthly: "plan_m" }), true);
    assert.equal(isRazorpaySubscriptionsConfigured({ ...keys, subscriptionsEnabled: false, razorpaySubPlanMonthly: "plan_m" }), false);
    assert.equal(isRazorpaySubscriptionsConfigured({ ...keys, subscriptionsEnabled: true }), false); // no plan id
    assert.equal(isRazorpaySubscriptionsConfigured({ subscriptionsEnabled: true, razorpaySubPlanMonthly: "plan_m" }), false); // no keys
  });
});

// A fake Mongo that honours the conditional update recordSubscriptionCharge
// relies on: updateOne with { lastPaymentId: { $ne } } only modifies when the
// stored value differs, which is the whole idempotency mechanism.
function fakeCollections({ sub, tag }) {
  const subs = sub ? [sub] : [];
  const tags = tag ? [tag] : [];
  const match = (doc, filter) =>
    Object.entries(filter).every(([k, v]) =>
      v && typeof v === "object" && "$ne" in v ? doc[k] !== v.$ne : doc[k] === v
    );
  const apply = (doc, update) => { if (update.$set) Object.assign(doc, update.$set); };
  return {
    membershipSubscriptions: {
      findOne: async (f) => subs.find((d) => match(d, f)) || null,
      updateOne: async (f, u) => {
        const d = subs.find((x) => match(x, f));
        if (!d) return { modifiedCount: 0, matchedCount: 0 };
        apply(d, u);
        return { modifiedCount: 1, matchedCount: 1 };
      }
    },
    tags: {
      findOne: async (f) => tags.find((d) => match(d, f)) || null,
      updateOne: async (f, u) => { const d = tags.find((x) => match(x, f)); if (d) apply(d, u); return { modifiedCount: d ? 1 : 0 }; }
    },
    _sub: () => subs[0],
    _tag: () => tags[0]
  };
}

describe("recordSubscriptionCharge", () => {
  const now = Date.UTC(2026, 0, 1);
  const subRow = () => ({ subscriptionId: "sub_1", tagId: "tag1", months: 1, lastPaymentId: null, currentPeriodEnd: null });
  const premiumTag = () => ({ _id: "tag1", premium: true, activatedAt: new Date(now).toISOString() });

  test("first charge extends the tag using Razorpay current_end", async () => {
    const currentEnd = Math.floor((now + 31 * 24 * 60 * 60 * 1000) / 1000);
    const c = fakeCollections({ sub: subRow(), tag: premiumTag() });
    const out = await recordSubscriptionCharge(c, { subscriptionEntity: { id: "sub_1", current_end: currentEnd }, paymentId: "pay_1", now });
    assert.equal(out.firstTime, true);
    assert.equal(out.currentPeriodEnd, new Date(currentEnd * 1000).toISOString());
    assert.equal(c._tag().subscription.status, "active");
    assert.equal(c._tag().subscription.razorpaySubscriptionId, "sub_1");
  });

  test("a duplicate delivery of the same payment is a no-op (idempotent per charge)", async () => {
    const c = fakeCollections({ sub: { ...subRow(), lastPaymentId: "pay_1", currentPeriodEnd: "x" }, tag: premiumTag() });
    const out = await recordSubscriptionCharge(c, { subscriptionEntity: { id: "sub_1" }, paymentId: "pay_1", now });
    assert.equal(out.firstTime, false);
  });

  test("falls back to month arithmetic when current_end is absent/insane", async () => {
    const c = fakeCollections({ sub: subRow(), tag: premiumTag() });
    const out = await recordSubscriptionCharge(c, { subscriptionEntity: { id: "sub_1" }, paymentId: "pay_2", now });
    assert.equal(out.firstTime, true);
    assert.ok(new Date(out.currentPeriodEnd).getTime() > now, "period end must be in the future");
  });

  test("an unknown subscription is acknowledged, not applied", async () => {
    const c = fakeCollections({ sub: null, tag: premiumTag() });
    const out = await recordSubscriptionCharge(c, { subscriptionEntity: { id: "sub_unknown" }, paymentId: "pay_3", now });
    assert.equal(out.firstTime, false);
    assert.equal(out.reason, "unknown-subscription");
  });

  test("a charge whose tag is gone is flagged, not silently dropped", async () => {
    const c = fakeCollections({ sub: subRow(), tag: null });
    const out = await recordSubscriptionCharge(c, { subscriptionEntity: { id: "sub_1" }, paymentId: "pay_4", now });
    assert.equal(out.firstTime, true);
    assert.equal(out.currentPeriodEnd, null);
    assert.equal(c._sub().needsAttention, "tag-missing");
  });

  test("missing ids are rejected", async () => {
    const c = fakeCollections({ sub: subRow(), tag: premiumTag() });
    assert.equal((await recordSubscriptionCharge(c, { subscriptionEntity: {}, paymentId: "p", now })).reason, "missing-ids");
    assert.equal((await recordSubscriptionCharge(c, { subscriptionEntity: { id: "sub_1" }, paymentId: null, now })).reason, "missing-ids");
  });
});
