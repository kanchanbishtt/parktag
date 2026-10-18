// Turning a recurring Razorpay charge into time on a tag.
//
// The one-time path (membership-fulfilment.js) claims an order ONCE from
// "created" and never runs again for it. A subscription is the opposite: it
// charges every cycle for years, firing `subscription.charged` each time, and
// EACH of those must extend the tag exactly once. So the idempotency key here is
// the PAYMENT id of the individual charge, not the subscription — a conditional
// update that only moves when lastPaymentId changes, so Razorpay's webhook
// retries (it retries until it gets a 2xx) collapse to one extension per charge.
//
// ONE TAG, ONE SUBSCRIPTION. Like membership-fulfilment, the only field read for
// entitlement is `tag.subscription` (subscription.js), so that is the field
// written. The period end comes from Razorpay's own `current_end` when present —
// it is the authority on what it charged for — and falls back to extending from
// the tag's furthest-out cover, the same arithmetic the prepaid path uses, so
// an early renewal never sells days the tag already holds.

import { membershipPeriodStart, addMonths } from "./membership-fulfilment.js";

// Razorpay timestamps are unix SECONDS. A present, sane current_end is the
// authority on the period it just charged for; anything missing or unparseable
// falls back to the month arithmetic rather than trusting junk into the future.
function periodEndFrom(subscriptionEntity, tag, months, now) {
  const currentEnd = subscriptionEntity && subscriptionEntity.current_end;
  if (typeof currentEnd === "number" && Number.isFinite(currentEnd) && currentEnd > 0) {
    const ms = currentEnd * 1000;
    // Guard against a wild value (e.g. seconds mistaken for ms) putting a tag
    // decades out: only accept a future instant within ~a decade and a half.
    if (ms > now && ms < now + 15 * 365 * 24 * 60 * 60 * 1000) {
      return new Date(ms).toISOString();
    }
  }
  return new Date(addMonths(membershipPeriodStart(tag, now), months)).toISOString();
}

// A recurring charge landed. Extend the tag, exactly once per payment.
// Returns { firstTime, currentPeriodEnd }.
export async function recordSubscriptionCharge(collections, { subscriptionEntity, paymentId, log, now = Date.now() }) {
  const subscriptionId = subscriptionEntity && subscriptionEntity.id;
  if (!subscriptionId || !paymentId) return { firstTime: false, reason: "missing-ids" };

  const sub = await collections.membershipSubscriptions.findOne({ subscriptionId });
  if (!sub) {
    // Not one of ours (or the subscribe row was never written). The webhook acks
    // rather than retries — no number of retries makes it appear.
    log?.warn?.({ event: "subscription-charge-unknown", subscriptionId }, "[subscription] charge for an unknown subscription");
    return { firstTime: false, reason: "unknown-subscription" };
  }

  // Per-charge claim. Of two concurrent deliveries of the same charge, exactly
  // one moves lastPaymentId and so extends the tag; the other is a no-op. A
  // charge whose paymentId we have already recorded changes nothing.
  const claimed = await collections.membershipSubscriptions.updateOne(
    { subscriptionId, lastPaymentId: { $ne: paymentId } },
    { $set: { lastPaymentId: paymentId, status: "active", updatedAt: new Date(now).toISOString() } }
  );
  if (!claimed.modifiedCount) {
    return { firstTime: false, currentPeriodEnd: sub.currentPeriodEnd || null };
  }

  const tag = await collections.tags.findOne({ _id: sub.tagId });
  if (!tag) {
    // The charge is real and must not be undone; the tag it was for is gone.
    // Flagged for a person rather than swallowed — this is money.
    await collections.membershipSubscriptions.updateOne(
      { subscriptionId },
      { $set: { needsAttention: "tag-missing", updatedAt: new Date(now).toISOString() } }
    );
    log?.error?.({ event: "subscription-tag-missing", subscriptionId, tagId: String(sub.tagId) }, "[subscription] charge whose tag no longer exists");
    return { firstTime: true, currentPeriodEnd: null };
  }

  const currentPeriodEnd = periodEndFrom(subscriptionEntity, tag, sub.months || 1, now);

  await collections.tags.updateOne(
    { _id: tag._id },
    { $set: { subscription: { status: "active", currentPeriodEnd, razorpaySubscriptionId: subscriptionId }, updatedAt: new Date(now).toISOString() } }
  );

  await collections.membershipSubscriptions.updateOne(
    { subscriptionId },
    { $set: { currentPeriodEnd } }
  );

  log?.info?.(
    { event: "subscription-charged", subscriptionId, tagId: String(tag._id), planKey: sub.planKey, currentPeriodEnd },
    "[subscription] recurring charge extended the tag"
  );

  return { firstTime: true, currentPeriodEnd };
}

// A lifecycle event other than a charge (activated / halted / cancelled /
// completed). Recorded on our own row for ops visibility; the tag is NOT
// revoked here. Entitlement lapses on its own when currentPeriodEnd passes
// (subscription.js checks the clock), which is the correct behaviour for a
// customer who cancels mid-period: they keep what they paid for until it ends.
export async function recordSubscriptionStatus(collections, { subscriptionEntity, status, log, now = Date.now() }) {
  const subscriptionId = subscriptionEntity && subscriptionEntity.id;
  if (!subscriptionId || !status) return { updated: false };
  const result = await collections.membershipSubscriptions.updateOne(
    { subscriptionId },
    { $set: { providerStatus: status, updatedAt: new Date(now).toISOString() } }
  );
  if (result.matchedCount) {
    log?.info?.({ event: "subscription-status", subscriptionId, status }, "[subscription] lifecycle status recorded");
  }
  return { updated: Boolean(result.matchedCount) };
}
