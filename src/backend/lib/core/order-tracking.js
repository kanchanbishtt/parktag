// Delhivery tracking snapshot for one shop order, cached on the order document.
//
// Shared by the owner dashboard (My Orders) and the public order-tracking page
// so a buyer sees the same status through either door, and a lookup on one
// warms the cache for the other.

import { trackShipment, isDelhiveryConfigured } from "../integrations/delhivery.js";
import { isDisposableRun } from "./external-guard.js";

// How long a persisted snapshot stays fresh before we call Delhivery again.
// Every dashboard open would otherwise hit Delhivery once per order (up to 20
// in parallel); a short cache keeps status live without hammering them or
// risking rate limits. Delivered is terminal, so a slightly stale snapshot is
// harmless.
export const TRACKING_TTL_MS = 15 * 60 * 1000;

// Uses the cache when fresh; otherwise refreshes from Delhivery and persists
// it. Never throws (trackShipment is best-effort) and never overwrites a good
// cached status with a transient null from a Delhivery hiccup.
export async function getOrderTracking(collections, env, order) {
  if (!order.waybill) return null;

  const cache = order.trackingCache;
  if (cache && cache.fetchedAt &&
      Date.now() - new Date(cache.fetchedAt).getTime() < TRACKING_TTL_MS) {
    return cache;
  }

  const fresh = await trackShipment(env, order.waybill);
  if (fresh && fresh.status) {
    const snapshot = { ...fresh, fetchedAt: new Date().toISOString() };
    const set = { trackingCache: snapshot };
    // Stamped once, the first time Delhivery says Delivered, so the review
    // request campaign has a date to count from. Delhivery's own timestamp when
    // it parses (it carries no zone, so it can be ~5h off; irrelevant at a
    // three-day wait), otherwise the moment we noticed.
    if (!order.deliveredAt && /^delivered$/i.test(fresh.status)) {
      const at = new Date(fresh.statusDateTime || NaN);
      set.deliveredAt = (Number.isNaN(at.getTime()) ? new Date() : at).toISOString();
    }
    await collections.shopOrders
      .updateOne({ _id: order._id }, { $set: set })
      .catch(() => {});
    return snapshot;
  }

  // Delhivery gave us nothing usable — prefer the last good cache over a null.
  return cache || fresh;
}

// Resolves to null if `promise` has not settled within `ms`. trackShipment has
// no timeout of its own, and a caller holding an admin page open must not wait
// on a hung courier API. The lookup itself carries on and still caches.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Re-read the courier status of shipped, not-yet-delivered orders whose cached
// status is older than TRACKING_TTL_MS, so "delivered" is known without waiting
// for the buyer to open tracking. Read-only on Delhivery's side: it books and
// charges nothing. Bounded by `limit`, a few at a time, stalest first.
//
// Returns { configured, checked, changed }: `changed` counts orders whose
// courier status is different from what was stored.
export async function refreshStaleTracking(
  collections,
  env,
  orders,
  { limit = 20, concurrency = 4, timeoutMs = 8000, now = Date.now() } = {}
) {
  // A test run never reaches the courier, even for a read.
  if (!isDelhiveryConfigured(env) || isDisposableRun(env)) {
    return { configured: false, checked: 0, changed: 0 };
  }

  const fetchedAt = (order) => {
    const t = new Date(order.trackingCache?.fetchedAt || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const due = orders
    .filter((order) => order.waybill && !order.deliveredAt && now - fetchedAt(order) >= TRACKING_TTL_MS)
    .sort((a, b) => fetchedAt(a) - fetchedAt(b))
    .slice(0, Math.max(0, limit));

  let changed = 0;
  for (let i = 0; i < due.length; i += concurrency) {
    const batch = due.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (order) => {
        const before = order.trackingCache?.status || null;
        const snapshot = await withTimeout(getOrderTracking(collections, env, order), timeoutMs);
        return Boolean(snapshot && snapshot.status && snapshot.status !== before);
      })
    );
    changed += results.filter(Boolean).length;
  }

  return { configured: true, checked: due.length, changed };
}

const DELIVERED = /^delivered$/i;
const BACKGROUND_CONCURRENCY = 3;
// Order ids being refreshed right now, so a burst of dashboard opens does not
// queue the same Delhivery lookup again and again.
const refreshing = new Set();

// The snapshot as stored, however old. Never calls Delhivery.
export function cachedOrderTracking(order) {
  return order.waybill ? order.trackingCache || null : null;
}

function needsRefresh(order, now) {
  if (!order.waybill || order.deliveredAt) return false;
  const cache = order.trackingCache;
  if (cache && DELIVERED.test(cache.status || "")) return false;
  if (!cache || !cache.fetchedAt) return true;
  return now - new Date(cache.fetchedAt).getTime() >= TRACKING_TTL_MS;
}

// Refresh the tracking of any of these orders that is missing or stale, without
// making the caller wait for it. The dashboard's order list used to await up to
// 20 Delhivery lookups inline on a cold cache; it now answers from the stored
// snapshot and calls this, so the next open is fresh. Delivered orders are
// terminal and never refreshed. At most a few lookups run at once, and an
// order already being refreshed is skipped. Never throws.
export function refreshTrackingInBackground(collections, env, orders, log, now = Date.now()) {
  const queue = orders.filter((order) => needsRefresh(order, now) && !refreshing.has(String(order._id)));
  if (!queue.length) return;
  for (const order of queue) refreshing.add(String(order._id));

  const worker = async () => {
    for (let order = queue.shift(); order; order = queue.shift()) {
      try {
        await getOrderTracking(collections, env, order);
      } catch (err) {
        log?.warn?.({ err }, "[tracking] background refresh failed");
      } finally {
        refreshing.delete(String(order._id));
      }
    }
  };
  void Promise.all(Array.from({ length: Math.min(BACKGROUND_CONCURRENCY, queue.length) }, worker));
}
