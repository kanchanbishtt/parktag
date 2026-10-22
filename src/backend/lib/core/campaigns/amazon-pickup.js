// Book Delhivery pickups for Amazon parcels, and tell Slack about each order.
//
// Two modes:
//
//   * Amazon SP-API configured: every tick polls Amazon.in for new
//     seller-fulfilled orders, records each one in `amazonOrders`, posts it to
//     the n8n webhook (event "amazon_order") and asks for tomorrow's pickup.
//     A failed pickup is retried every tick until it lands, because the row
//     keeps no pickupRequestedFor until then.
//
//   * Not configured: the original blind sweep below, once a day at 21:00.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Delhivery One's Amazon integration books the waybill but never asks for a
// rider. Order 403-0418773-6862759 sat "Manifested" at Noida for days. Website
// orders are fine because bookShipmentAndPickup requests a pickup itself; the
// Amazon parcels never pass through that code, so nothing was asking.
//
// ── Why the fallback needs no list of Amazon orders ────────────────────────
//
// A pickup is raised against a WAREHOUSE and a DATE, and the Amazon parcels
// are booked from the same warehouse as ours ("EDIT TREE B2C"). One request
// for tomorrow covers every parcel waiting there, ours or Amazon's, and
// ensurePickupRequested already makes it one-per-day, so a website order that
// got there first simply wins and this becomes a no-op.
//
// ponytail: blind daily request. On a day with no parcels at all it books a
// rider for nothing. That is why the SP-API mode above exists; set
// AMAZON_LWA_* and this sweep stops running.
//
// ── Why 21:00 IST ──────────────────────────────────────────────────────────
//
// Delhivery One booked an order about 3.5 hours after Amazon received it. By
// 21:00 everything from the day is manifested; anything later rides the next
// day's request. The tick is every 15 minutes, so a failed request is retried
// on the next tick until midnight, when the window closes.

import { ensurePickupRequested } from "../shipping.js";
import { isDelhiveryConfigured, nextPickupDate } from "../../integrations/delhivery.js";
import { isAmazonConfigured, listMerchantOrders } from "../../integrations/amazon-sp.js";

export const id = "amazon-pickup";

const SWEEP_HOUR_IST = 21;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DUPLICATE_KEY = 11000;
const CURSOR_ID = "amazon-orders-cursor";
// Re-read this far behind the last poll: an order can surface in getOrders
// late, or sit in Pending (payment not settled) for a while. Duplicates are
// free, the _id makes them no-ops.
const OVERLAP_MS = 6 * 60 * 60 * 1000;
const FIRST_POLL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Amazon refuses a CreatedAfter less than two minutes old.
const AMAZON_MIN_AGE_MS = 2 * 60 * 1000;
// Pending is not paid yet, Canceled needs nothing; Shipped still gets a Slack
// post (we did receive it) but no pickup.
const NEEDS_PICKUP = new Set(["Unshipped", "PartiallyShipped"]);
const WORTH_RECORDING = new Set([...NEEDS_PICKUP, "Shipped"]);

// Tell whoever owns the webhook (n8n, which posts to Slack) what happened.
// Slack wording lives there, not here, so it can change without a deploy.
// NEVER THROWS: a dead webhook must not stop the pickup being recorded.
async function notify(env, payload, log, event = "amazon_pickup") {
  if (!env.pickupNotifyWebhookUrl) return;
  try {
    const res = await fetch(env.pickupNotifyWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, pickupLocation: env.delhiveryPickupLocation, ...payload }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) log?.warn?.({ status: res.status }, "[amazon-pickup] notify webhook refused");
  } catch (err) {
    log?.warn?.({ err }, "[amazon-pickup] notify webhook failed");
  }
}

// A failing request retries every tick, so without this a Delhivery outage
// would post to Slack a dozen times before midnight. First failure per pickup
// date speaks; the rest stay quiet. Same upsert-or-duplicate-key claim as the
// scheduler lease: the database picks the single winner.
async function claimFailureNotice(collections, pickupDate, id = "amazon-pickup-failure-notice") {
  try {
    await collections.counters.findOneAndUpdate(
      { _id: id, pickupDate: { $ne: pickupDate } },
      { $set: { pickupDate } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    if (err?.code === DUPLICATE_KEY) return false;
    throw err;
  }
}

export async function run(env, collections, ctx) {
  // requestPickup answers { requested: false } for an unconfigured account and
  // ensurePickupRequested would still record that as a booked pickup.
  if (!isDelhiveryConfigured(env)) return { sent: 0, skipped: "not-configured" };
  return isAmazonConfigured(env) ? pollAmazon(env, collections, ctx) : eveningSweep(env, collections, ctx);
}

// Record new Amazon orders, post each one, then make sure a rider is booked
// for every recorded order still waiting for one.
async function pollAmazon(env, collections, { now, dryRun, log }) {
  const cursor = await collections.counters.findOne({ _id: CURSOR_ID });
  const since = cursor?.polledAt
    ? new Date(new Date(cursor.polledAt).getTime() - OVERLAP_MS)
    : new Date(now.getTime() - FIRST_POLL_LOOKBACK_MS);
  const createdAfter = new Date(Math.min(since.getTime(), now.getTime() - AMAZON_MIN_AGE_MS));

  let orders;
  try {
    orders = await listMerchantOrders(env, { createdAfter });
  } catch (err) {
    log?.error?.({ err }, "[amazon-pickup] could not read Amazon orders");
    if (!dryRun && (await claimFailureNotice(collections, nextPickupDate(now), "amazon-orders-failure-notice"))) {
      await notify(env, { outcome: "orders-unreadable", error: String(err?.message || err) }, log, "amazon_order");
    }
    return { sent: 0, reason: "orders-unreadable" };
  }
  if (dryRun) return { sent: 0, dryRun: true, seen: orders.length };

  let fresh = 0;
  for (const order of orders.filter((o) => WORTH_RECORDING.has(o.status))) {
    try {
      await collections.amazonOrders.insertOne({
        _id: order.amazonOrderId,
        ...order,
        needsPickup: NEEDS_PICKUP.has(order.status),
        pickupRequestedFor: null,
        seenAt: now
      });
    } catch (err) {
      if (err?.code === DUPLICATE_KEY) continue;
      throw err;
    }
    fresh += 1;
    await notify(env, { outcome: "received", ...order }, log, "amazon_order");
  }
  await collections.counters.updateOne({ _id: CURSOR_ID }, { $set: { polledAt: now } }, { upsert: true });

  const waiting = await collections.amazonOrders
    .find({ needsPickup: true, pickupRequestedFor: null }, { projection: { _id: 1 } })
    .toArray();
  if (waiting.length === 0) return { sent: 0, fresh, reason: "nothing-waiting" };

  const pickupDate = nextPickupDate(now);
  const result = await ensurePickupRequested(env, collections, { pickupDate, expectedPackageCount: waiting.length }, log);

  if (result.requested || result.reason === "already-requested") {
    await collections.amazonOrders.updateMany(
      { _id: { $in: waiting.map((o) => o._id) } },
      { $set: { pickupRequestedFor: result.forDate || pickupDate } }
    );
  }
  if (result.requested) {
    await notify(
      env,
      { outcome: "requested", pickupDate: result.forDate, pickupId: result.pickupId, atTime: result.atTime, amazonOrderIds: waiting.map((o) => o._id) },
      log
    );
  } else if (result.reason !== "already-requested" && (await claimFailureNotice(collections, pickupDate))) {
    await notify(env, { outcome: "failed", pickupDate, reason: result.reason, error: result.error || null }, log);
  }

  return { sent: 0, fresh, pickupDate, reason: result.reason || "requested" };
}

async function eveningSweep(env, collections, { now, dryRun, log }) {
  const hourIst = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  if (hourIst < SWEEP_HOUR_IST) return { sent: 0, skipped: "before-sweep" };

  const pickupDate = nextPickupDate(now);
  if (dryRun) return { sent: 0, dryRun: true, pickupDate };

  const result = await ensurePickupRequested(env, collections, { pickupDate }, log);

  if (result.requested) {
    await notify(
      env,
      { outcome: "requested", pickupDate: result.forDate, pickupId: result.pickupId, atTime: result.atTime },
      log
    );
  } else if (result.reason !== "already-requested" && (await claimFailureNotice(collections, pickupDate))) {
    await notify(
      env,
      { outcome: "failed", pickupDate, reason: result.reason, error: result.error || null },
      log
    );
  }

  return { sent: 0, pickupDate, reason: result.reason || "requested" };
}
