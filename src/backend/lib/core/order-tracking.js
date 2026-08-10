// Delhivery tracking snapshot for one shop order, cached on the order document.
//
// Shared by the owner dashboard (My Orders) and the public order-tracking page
// so a buyer sees the same status through either door, and a lookup on one
// warms the cache for the other.

import { trackShipment } from "../integrations/delhivery.js";

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
    await collections.shopOrders
      .updateOne({ _id: order._id }, { $set: { trackingCache: snapshot } })
      .catch(() => {});
    return snapshot;
  }

  // Delhivery gave us nothing usable — prefer the last good cache over a null.
  return cache || fresh;
}
