// What the recall bar on /get should say, and whether it should be there.
//
// The bar exists because a guest has no account: if the tab dies between the
// payment succeeding and the confirmation rendering, the order number is only
// on this device. See the recall block in get.js for that half.
//
// This half is the part that was missing. The bar was shown whenever
// /track-order recognised the order, with one fixed sentence — "Your ParkTag
// order is on its way" — and the rows live for 60 days. Delivery takes a few.
// So for roughly eight weeks AFTER the sticker arrived, a returning buyer was
// told it was still travelling, and the page it linked to said "Delivered".
// Two of our own screens disagreeing is how a tracking feature stops being
// believed.
//
// /track-order already returns everything needed to say the true thing; the
// bar simply never read it. The decisions live here, apart from the DOM and
// from localStorage, because they are rules rather than rendering.

// Rows are kept for 60 days: past any delivery, and self-clearing.
export const RECALL_TTL = 60 * 864e5;
// Rows kept on the device, and how many of the newest are checked per visit.
export const RECALL_MAX = 5;
export const RECALL_CHECK = 3;

// How long a 404 is still worth retrying. A payment whose webhook has not
// landed yet answers 404 exactly like an abandoned checkout, so a miss must
// NOT delete the row — that would throw away the buyer's only copy of the
// number at the moment it matters most. But that reasoning has a horizon:
// webhook lag is minutes. Past this, a 404 means the buyer opened Razorpay and
// walked away, and re-asking about it on every visit for two months is a
// request that can never succeed.
export const RECALL_STALE_MS = 2 * 864e5; // 48 hours

// How long a DELIVERED order stays on the bar. It is not hidden the moment it
// arrives, because that is precisely when the buyer is most likely to be
// looking for it — the sticker is in their hand and the next thing they want
// is to set it up. After a week it is old news and the bar is just clutter.
export const RECALL_DELIVERED_MS = 7 * 864e5;

export const HEADLINE_CONFIRMED = "Your ParkTag order is confirmed";
export const HEADLINE_ON_ITS_WAY = "Your ParkTag order is on its way";
export const HEADLINE_DELIVERED = "Your ParkTag order was delivered";

// The statuses this app SYNTHESISES (see /api/shop/track-order) that mean the
// parcel is not moving yet. Everything else arriving here is a raw courier
// status, which means it has been handed over and is in the network.
//
// `booking_failed` belongs with these: the courier has not accepted it, so
// "on its way" would be the one thing it definitely is not.
const NOT_SHIPPED = new Set(["processing", "cod_confirmed", "booking_failed"]);

function normalise(status) {
  return String(status == null ? "" : status).trim().toLowerCase();
}

// EXACT match, deliberately not a substring test. Delhivery's vocabulary also
// contains "Undelivered", and `/delivered/i` matches that too — which would
// announce a failed delivery attempt as a completed one, the precise inversion
// of the bug this module exists to fix.
export function isDeliveredStatus(status) {
  return normalise(status) === "delivered";
}

export function headlineFor(status) {
  if (isDeliveredStatus(status)) return HEADLINE_DELIVERED;
  return NOT_SHIPPED.has(normalise(status)) ? HEADLINE_CONFIRMED : HEADLINE_ON_ITS_WAY;
}

function timeOf(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Should the bar be shown for this order, and with what sentence?
//
// Only a delivered order is ever withheld, and only once it is a week old. An
// undated delivery is shown rather than hidden: "was delivered" is still TRUE,
// which is the property that matters here, and the row expires on its own.
export function recallDecision(order, now = Date.now()) {
  if (!order) return { show: false, headline: null };

  const headline = headlineFor(order.shippingStatus);

  if (isDeliveredStatus(order.shippingStatus)) {
    const at = timeOf(order.statusDateTime) ?? timeOf(order.orderedAt);
    if (at !== null && now - at > RECALL_DELIVERED_MS) {
      return { show: false, headline: null };
    }
  }

  return { show: true, headline };
}

// A 404 for a row this old is an abandoned checkout, not a slow webhook.
export function missIsStale(row, now = Date.now()) {
  const created = row && typeof row.t === "number" ? row.t : 0;
  return now - created > RECALL_STALE_MS;
}
