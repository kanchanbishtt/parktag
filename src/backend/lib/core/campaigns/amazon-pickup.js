// Ask Delhivery for tomorrow's pickup, once a day, for the Amazon parcels.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Delhivery One's Amazon integration books the waybill but never asks for a
// rider. Order 403-0418773-6862759 sat "Manifested" at Noida for days. Website
// orders are fine because bookShipmentAndPickup requests a pickup itself; the
// Amazon parcels never pass through that code, so nothing was asking.
//
// ── Why it needs no list of Amazon orders ──────────────────────────────────
//
// A pickup is raised against a WAREHOUSE and a DATE, and the Amazon parcels
// are booked from the same warehouse as ours ("EDIT TREE B2C"). One request
// for tomorrow covers every parcel waiting there, ours or Amazon's, and
// ensurePickupRequested already makes it one-per-day, so a website order that
// got there first simply wins and this becomes a no-op.
//
// ponytail: blind daily request. On a day with no parcels at all it books a
// rider for nothing. Upgrade: count parcels from an Amazon order feed first.
//
// ── Why 21:00 IST ──────────────────────────────────────────────────────────
//
// Delhivery One booked an order about 3.5 hours after Amazon received it. By
// 21:00 everything from the day is manifested; anything later rides the next
// day's request. The tick is every 15 minutes, so a failed request is retried
// on the next tick until midnight, when the window closes.

import { ensurePickupRequested } from "../shipping.js";
import { isDelhiveryConfigured, nextPickupDate } from "../../integrations/delhivery.js";

export const id = "amazon-pickup";

const SWEEP_HOUR_IST = 21;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DUPLICATE_KEY = 11000;

// Tell whoever owns the webhook (n8n, which posts to Slack) what happened.
// Slack wording lives there, not here, so it can change without a deploy.
// NEVER THROWS: a dead webhook must not stop the pickup being recorded.
async function notify(env, payload, log) {
  if (!env.pickupNotifyWebhookUrl) return;
  try {
    const res = await fetch(env.pickupNotifyWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "amazon_pickup", pickupLocation: env.delhiveryPickupLocation, ...payload }),
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
async function claimFailureNotice(collections, pickupDate) {
  try {
    await collections.counters.findOneAndUpdate(
      { _id: "amazon-pickup-failure-notice", pickupDate: { $ne: pickupDate } },
      { $set: { pickupDate } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    if (err?.code === DUPLICATE_KEY) return false;
    throw err;
  }
}

export async function run(env, collections, { now, dryRun, log }) {
  const hourIst = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  if (hourIst < SWEEP_HOUR_IST) return { sent: 0, skipped: "before-sweep" };

  // requestPickup answers { requested: false } for an unconfigured account and
  // ensurePickupRequested would still record that as a booked pickup.
  if (!isDelhiveryConfigured(env)) return { sent: 0, skipped: "not-configured" };

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
