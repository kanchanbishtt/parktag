// "How's it going?" A few days after a ParkTag is delivered, ask the buyer on
// WhatsApp for a line about it and a photo of the tag on their car. Replies
// land in the `reviews` collection (lib/core/reviews.js) for an admin to pick
// from; nothing is published without approval.
//
// ── Knowing it was delivered ───────────────────────────────────────────────
//
// Delhivery never tells us. Delivery is only learned when somebody looks:
// getOrderTracking() polls on demand and stamps `deliveredAt` the first time
// the status reads Delivered. Most buyers never open tracking again once the
// parcel arrives, so this campaign does the looking itself, a few stale orders
// per tick, before it selects anybody.
//
// ── Gated on its own switch ────────────────────────────────────────────────
//
// REVIEW_REQUESTS_ENABLED, not just SCHEDULER_ENABLED. The template has to be
// created and approved first (scripts/create-review-template.js), and it is
// submitted as UTILITY. If Meta reclassifies it to MARKETING, as it did
// parktag_cart_reminder, leave the switch off: this campaign does not check
// marketing consent.

import { sendOnce } from "../message-log.js";
import { getOrderTracking } from "../order-tracking.js";
import { isInternalPhone } from "../internal-orders.js";
import { toE164 } from "../phone.js";
import { firstNameOf } from "../owner-name.js";
import {
  isMetaWhatsappConfigured,
  sendMetaWhatsappReviewRequest,
  REVIEW_REQUEST_TEMPLATE
} from "../../integrations/meta.js";

const DAY = 24 * 60 * 60 * 1000;

// The window, bounded at both ends per scheduler.js. Three days is long enough
// to have stuck the tag on; ten gives a week of ticks of slack for a redeploy
// or a late delivery stamp, after which asking would be odd anyway.
const MIN_AGE_MS = 3 * DAY;
const MAX_AGE_MS = 10 * DAY;

// Orders older than this are not polled for delivery. A parcel still not
// Delivered after 45 days has gone back to origin, and polling it forever
// would spend Delhivery calls on nothing.
const TRACK_WITHIN_MS = 45 * DAY;
const TRACK_PER_TICK = 20;
const SENDS_PER_TICK = 20;

// Orders a real customer paid for or will pay for on the doorstep. Internal
// tests and giveaways are the same filter the sales digest uses
// (slack-commands.js), so "who counts as a customer" has one answer.
const REAL_ORDER = {
  status: { $in: ["paid", "cod"] },
  deletedAt: { $in: [null, undefined] },
  internal: { $ne: true },
  channel: { $nin: ["internal", "giveaway"] }
};

export const id = "review-request";

let warnedDisabled = false;

// Poll Delhivery for recent orders nobody has looked at lately, so deliveredAt
// gets stamped. Bounded by age and count; getOrderTracking never throws.
async function refreshDeliveries(env, collections, now) {
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const orders = await collections.shopOrders
    .find({
      ...REAL_ORDER,
      waybill: { $type: "string", $gt: "" },
      deliveredAt: { $exists: false },
      createdAt: { $gte: new Date(now.getTime() - TRACK_WITHIN_MS).toISOString() },
      $or: [
        { "trackingCache.fetchedAt": { $exists: false } },
        { "trackingCache.fetchedAt": { $lt: staleBefore } }
      ]
    })
    .sort({ "trackingCache.fetchedAt": 1 })
    .limit(TRACK_PER_TICK)
    .toArray();

  for (const order of orders) await getOrderTracking(collections, env, order);
  return orders.length;
}

export async function run(env, collections, { now, limit, dryRun, log }) {
  if (!env.reviewRequestsEnabled || !isMetaWhatsappConfigured(env)) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      log?.info?.(
        { campaign: id },
        `[campaign] review requests off (REVIEW_REQUESTS_ENABLED=1 once ${REVIEW_REQUEST_TEMPLATE} is approved)`
      );
    }
    return { sent: 0, skipped: "not-enabled" };
  }

  const tracked = await refreshDeliveries(env, collections, now);

  // ISO strings: deliveredAt is written as one (order-tracking.js), and a
  // Date compared against a string matches nothing (see cart-reminder.js).
  const orders = await collections.shopOrders
    .find({
      ...REAL_ORDER,
      deliveredAt: {
        $gte: new Date(now.getTime() - MAX_AGE_MS).toISOString(),
        $lte: new Date(now.getTime() - MIN_AGE_MS).toISOString()
      },
      reviewRequestSentAt: { $exists: false },
      "shippingAddress.phone": { $type: "string", $gt: "" }
    })
    .limit(Math.min(limit, SENDS_PER_TICK))
    .toArray();

  let sent = 0;
  const selected = [];

  for (const order of orders) {
    const phone = toE164(order.shippingAddress.phone);
    if (!phone || isInternalPhone(env, phone)) continue;

    // Somebody who replied STOP, or asked never to be messaged, is not asked
    // for a favour. Only an account can carry that; a guest has nowhere to.
    if (order.ownerId) {
      const owner = await collections.owners.findOne(
        { _id: order.ownerId },
        { projection: { marketingOptOut: 1, messagingHardStop: 1 } }
      );
      if (owner?.marketingOptOut === true || owner?.messagingHardStop) continue;
    }

    const name = firstNameOf(order.shippingAddress.fullName) || "there";
    selected.push({ orderNumber: order.orderNumber, name });
    if (dryRun) continue;

    // The claim. Atomic on the order, so two instances cannot both win it,
    // and it also records the number the inbound webhook matches replies to.
    // sendOnce below is the second, campaign-wide lock.
    const claimed = await collections.shopOrders.findOneAndUpdate(
      { _id: order._id, reviewRequestSentAt: { $exists: false } },
      { $set: { reviewRequestSentAt: now.toISOString(), reviewRequestPhone: phone } }
    );
    if (!claimed) continue;

    const result = await sendOnce(
      env,
      collections,
      {
        campaign: id,
        dedupeKey: `review:${order._id}`,
        ownerId: order.ownerId || null,
        to: phone,
        channel: "whatsapp",
        templateName: REVIEW_REQUEST_TEMPLATE,
        send: () => sendMetaWhatsappReviewRequest(env, { to: phone, name })
      },
      log
    );

    if (result.sent) sent += 1;
  }

  if (dryRun) {
    log?.info?.({ campaign: id, tracked, wouldSend: selected.length, selected }, "[campaign] dry run");
    return { sent: 0, dryRun: true, tracked, wouldSend: selected.length, selected };
  }

  return { sent, tracked, considered: orders.length };
}
