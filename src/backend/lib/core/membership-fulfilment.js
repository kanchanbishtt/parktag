// Turning a paid membership order into time on a tag.
//
// Shared by the two paths that can report a payment, exactly like
// fulfilPaidOrder is for the shop: POST /api/owner/membership/verify-payment,
// called by the buyer's browser, and the Razorpay webhook, which does not
// depend on the buyer's device surviving the redirect. Whichever arrives first
// does the work and the other is a no-op — a lesson this codebase learned the
// expensive way, with a webhook that was never configured and orders that sat
// unfulfilled because the tab closed.
//
// ONE TAG, ONE SUBSCRIPTION. subscription.js is the only thing that decides
// whether a tag is entitled, and it reads `tag.subscription`. That is the field
// written here. The two legacy names it also reads — callSubscription and
// documentSubscription — are deliberately NOT written: they exist so tags
// stamped before that module was unified keep working, and writing a third
// copy of the same fact is how they came to disagree in the first place.

import { hasActiveSubscription } from "./subscription.js";
import { premiumTrialEndsAt } from "./vault.js";
import { addMonths } from "./calendar.js";

// Re-exported because this was its home before the complimentary year needed
// the same arithmetic, and callers — including the tests that pin the
// month-end clamping — import it from here.
export { addMonths };

// Where a newly bought period should start.
//
// Not "now". Three things can already be running, and charging over the top of
// any of them means selling somebody days they already hold:
//
//   an active paid period   renewing early must EXTEND, not reset. Buying a
//                           second year in month eleven is the ordinary case.
//   the free year           a premium tag carries one from activation. Starting
//                           a paid month today would eat into a year of free
//                           service.
//   nothing                 start from now.
//
// So the base is the furthest-out of them. This is deliberately generous at the
// boundary: a lapsed subscription's end date is in the past, so it falls back
// to `now` rather than back-dating the new period into the gap.
export function membershipPeriodStart(tag, now = Date.now()) {
  let start = now;

  const sub = tag && (tag.subscription || tag.callSubscription || tag.documentSubscription);
  if (hasActiveSubscription(tag, now) && sub && sub.currentPeriodEnd) {
    const end = new Date(sub.currentPeriodEnd).getTime();
    if (Number.isFinite(end) && end > start) start = end;
  }

  // premiumTrialEndsAt returns null for a non-premium tag or an unparseable
  // start date, and it refuses a start date far in the future rather than
  // granting an unbounded trial — so a bad field cannot push a paid period
  // years out.
  const trialEnd = premiumTrialEndsAt(tag, now);
  if (trialEnd) {
    const end = new Date(trialEnd).getTime();
    if (Number.isFinite(end) && end > start) start = end;
  }

  return start;
}

// Claim the order and extend the tag. Returns { firstTime, currentPeriodEnd }.
//
// `firstTime` is false when someone else already claimed it, which is normal
// traffic rather than an error: Razorpay retries its webhook until it gets a
// 2xx, and the browser callback races it on every successful checkout.
export async function activateMembership(collections, { order, paymentId, log, now = Date.now() }) {
  // The gate, and the only thing preventing a double activation. A conditional
  // update from "created" is atomic in the database, so of two concurrent
  // callers exactly one sees modifiedCount 1 — the same mechanism
  // fulfilPaidOrder uses. Checking-then-writing in application code would let
  // both pass the check and both extend the subscription, selling one payment
  // twice as much time as it bought.
  const claimed = await collections.membershipOrders.updateOne(
    { orderId: order.orderId, status: "created" },
    {
      $set: {
        status: "paid",
        paymentId: paymentId || order.paymentId || null,
        paidAt: new Date(now).toISOString()
      }
    }
  );

  if (!claimed.modifiedCount) {
    const settled = await collections.membershipOrders.findOne({ orderId: order.orderId });
    return { firstTime: false, currentPeriodEnd: settled ? settled.currentPeriodEnd || null : null };
  }

  const tag = await collections.tags.findOne({ _id: order.tagId });
  if (!tag) {
    // The order is paid — that is not in doubt and must not be undone. What
    // cannot be done is grant the time, because the tag it was bought for is
    // gone. Flagged for a person rather than swallowed: the money is real.
    await collections.membershipOrders.updateOne(
      { orderId: order.orderId },
      { $set: { needsAttention: "tag-missing", updatedAt: new Date(now).toISOString() } }
    );
    if (log && log.error) {
      log.error(
        { event: "membership-tag-missing", orderId: order.orderId, tagId: String(order.tagId) },
        "[membership] paid order whose tag no longer exists"
      );
    }
    return { firstTime: true, currentPeriodEnd: null };
  }

  const startMs = membershipPeriodStart(tag, now);
  const currentPeriodEnd = new Date(addMonths(startMs, order.months)).toISOString();

  await collections.tags.updateOne(
    { _id: tag._id },
    {
      $set: {
        subscription: { status: "active", currentPeriodEnd },
        updatedAt: new Date(now).toISOString()
      }
    }
  );

  await collections.membershipOrders.updateOne(
    { orderId: order.orderId },
    { $set: { currentPeriodEnd } }
  );

  if (log && log.info) {
    log.info(
      {
        event: "membership-activated",
        orderId: order.orderId,
        planId: order.planId,
        months: order.months,
        currentPeriodEnd
      },
      "[membership] subscription extended"
    );
  }

  return { firstTime: true, currentPeriodEnd };
}
