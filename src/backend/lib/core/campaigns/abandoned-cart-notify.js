// Tell the team, in Slack, about every checkout that was filled in and never paid.
//
// This messages NOBODY outside the team. It POSTs one JSON body per abandoned
// order to an n8n webhook, and n8n turns it into the Slack message. The wording
// lives there, not here, so it can change without a deploy; the same split as
// the daily Amazon pickup report (amazon-pickup.js).
//
// ── Which orders ───────────────────────────────────────────────────────────
//
// The same rows cart-reminder reads: shop orders still "created" after the
// buyer stopped, with a delivery phone on them. A row with no phone has nothing
// to act on, so it is not worth a Slack message. Our own test orders are left
// out. Online checkouts only: a COD order is "cod" the moment it is written, so
// it never sits at "created" (see routes/shop/index.js).
//
// ── Why the window has both ends ───────────────────────────────────────────
//
// Thirty minutes of patience, because somebody still on the Razorpay sheet has
// not abandoned anything. Six hours at the top, per the rule in scheduler.js: a
// campaign query must be bounded, or it re-matches the same rows forever.
//
// ── Exactly once, and what happens when n8n is down ────────────────────────
//
// The claim is `abandonedNotifiedAt` on the order, taken with a conditional
// update so two ticks cannot both win. If the webhook then fails the claim is
// RELEASED, unlike a customer message (message-log.js), where a retry could
// duplicate. A repeated Slack line is cheap and a lost one is the whole point
// of this job, so the next tick retries until the six-hour window closes.

import { orderMayReceiveMarketing } from "../messaging-consent.js";

export const id = "abandoned-cart-notify";

const MIN_AGE_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PER_TICK = 20;

const rupees = (paise) => (typeof paise === "number" ? paise / 100 : null);

// Everything we know about the checkout, flat enough for an n8n expression.
// Prices are in rupees; the database keeps paise.
export function describeAbandonedOrder(order, now, marketingConsent) {
  const a = order.shippingAddress || {};
  const at = order.attribution || {};
  return {
    event: "abandoned_cart",
    orderNumber: order.orderNumber,
    razorpayOrderId: order.orderId || null,
    startedAt: order.createdAt,
    minutesSinceStarted: Math.round((now.getTime() - new Date(order.createdAt).getTime()) / 60000),
    page: order.channel || null,
    guest: Boolean(order.guest),
    product: {
      id: order.productId || null,
      name: order.productName || null,
      quantity: order.quantity || 1,
      addOns: (order.addOns || []).map((x) => x?.name).filter(Boolean)
    },
    amountRupees: rupees(order.amount),
    mrpRupees: rupees(order.mrpPaise),
    promoCode: order.promoCode || null,
    promoDiscountRupees: rupees(order.promoDiscountPaise),
    shippingFeeRupees: rupees(order.shippingFeePaise),
    buyer: {
      name: a.fullName || null,
      phone: a.phone || null,
      email: a.email || null
    },
    address: {
      line1: a.line1 || null,
      line2: a.line2 || null,
      landmark: a.landmark || null,
      city: a.city || null,
      state: a.state || null,
      pincode: a.pincode || null
    },
    attribution: {
      source: at.source || null,
      medium: at.medium || null,
      campaign: at.campaign || null,
      content: at.content || null
    },
    marketingConsent
  };
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`webhook answered ${res.status}`);
}

export async function run(env, collections, { now, limit, dryRun, log }) {
  if (!env.abandonedNotifyWebhookUrl) return { sent: 0, skipped: "not-configured" };

  // ISO strings, not Dates: shopOrders.createdAt is stored as a string, and a
  // Date compared against it matches nothing instead of erroring.
  const notBefore = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const notAfter = new Date(now.getTime() - MIN_AGE_MS).toISOString();

  const orders = await collections.shopOrders
    .find({
      status: "created",
      createdAt: { $gte: notBefore, $lte: notAfter },
      internal: { $ne: true },
      channel: { $nin: ["internal", "giveaway"] },
      "shippingAddress.phone": { $exists: true, $nin: [null, ""] },
      abandonedNotifiedAt: { $exists: false }
    })
    .limit(Math.min(limit, PER_TICK))
    .toArray();

  let notified = 0;
  let failed = 0;

  for (const order of orders) {
    const owner = order.ownerId
      ? await collections.owners.findOne(
          { _id: order.ownerId },
          { projection: { marketingOptInAt: 1, marketingOptOut: 1, messagingHardStop: 1 } }
        )
      : null;
    const body = describeAbandonedOrder(order, now, orderMayReceiveMarketing(order, owner));

    if (dryRun) {
      log?.info?.({ campaign: id, orderNumber: order.orderNumber }, "[campaign] dry run, would notify");
      continue;
    }

    const claim = await collections.shopOrders.updateOne(
      { _id: order._id, abandonedNotifiedAt: { $exists: false } },
      { $set: { abandonedNotifiedAt: now } }
    );
    if (claim.modifiedCount !== 1) continue;

    try {
      await post(env.abandonedNotifyWebhookUrl, body);
      notified += 1;
    } catch (err) {
      failed += 1;
      log?.warn?.({ err, orderNumber: order.orderNumber }, "[abandoned-cart-notify] webhook failed, will retry");
      await collections.shopOrders
        .updateOne({ _id: order._id }, { $unset: { abandonedNotifiedAt: "" } })
        .catch(() => {});
    }
  }

  // sent stays 0: nothing was sent to a customer, so the scheduler's send
  // budget is untouched.
  return { sent: 0, considered: orders.length, notified, failed, ...(dryRun ? { dryRun: true } : {}) };
}
