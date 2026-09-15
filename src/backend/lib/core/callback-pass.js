// A paid callback, for a premium tag whose free callback window has closed.
//
// A premium tag includes calling a scanner back, but only for ten minutes from
// the moment they made contact (CALLBACK_WINDOW_MS in routes/owner/dashboard.js).
// Past that, register-call refuses and the row used to go quiet — so an owner
// who missed the call and opened the app twenty minutes later had no way back
// to the person who had tried to reach them.
//
// This sells that way back for ₹20: the callback, reopened for one contact, for
// a fresh ten minutes from the moment the payment is confirmed.
//
//   Premium, inside the free window   "Call Back", included. Unchanged.
//   Premium, window closed            "Call Back ₹20" on the vehicle's newest
//                                     contact, for as long as the activity list
//                                     shows it.
//   Premium, paid                     "Call Back" again, for ten minutes from
//                                     the payment. Redialling inside that time
//                                     is included, exactly as it is in the free
//                                     window — it is the same product.
//   Premium, paid window closed       "Call Back ₹20" again.
//   Premium, call service lapsed      nothing is sold. The masked call is off on
//                                     that tag; the answer is the subscription.
//   E-Tag                             nothing is sold. Callback is a premium
//                                     feature, and the row says so.
//
// THE PASS IS THE PAID ORDER. There is no pass field on the tag or the contact:
// a callback order whose status is "paid" is the permission, and its `paidAt`
// starts the clock. The browser's verify-payment and Razorpay's webhook both
// settle orders, and they race by design — settling is a conditional update
// from "created", so exactly one of them writes `paidAt` and the other reads
// it. One record, written once, with nothing beside it to fall out of step.

// ₹20, in paise. Stored on the order and re-checked at verify time, so an order
// minted before a price change cannot be settled at the old figure.
export const CALLBACK_PASS_PAISE = 2000;

// How long a paid callback stays usable, measured from the moment the payment
// was confirmed — never from the scanner's contact, which is by definition
// already more than ten minutes old.
//
// The same ten minutes as the free window, deliberately: this reopens the
// callback the owner already had, it does not sell a longer one.
export const CALLBACK_PASS_WINDOW_MS = 10 * 60 * 1000;

// How old a contact may be and still be bought back.
//
// The same 48 hours the activity list shows. A contact the owner can see is a
// contact they can pay to return; one that has dropped off the list has no row
// to put a button on, and selling a call to someone the owner can no longer
// even see would be selling a call to a stranger.
export const CALLBACK_PASS_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// Whether a contact can be bought back right now, and if not, why not. Each
// answer is a different reply from create-order and a different row on the
// page, so they are named rather than collapsed into a boolean.
export const OFFER_AVAILABLE = "available";
// Still inside the free window. Charging for something the tag already
// includes would be indefensible however the page came to offer it.
export const OFFER_INCLUDED = "included";
export const OFFER_PREMIUM_REQUIRED = "premium-required";
export const OFFER_SUBSCRIPTION_REQUIRED = "subscription-required";
export const OFFER_TOO_OLD = "too-old";

// When a settled order's paid callback ends, in epoch ms. NaN for anything
// that is not a paid order with a parseable payment time, so every caller that
// compares against it reads junk as "already over" rather than as unlimited —
// the same rule hasActiveCallSubscription follows for a malformed end date.
export function callbackPassEndsAt(order) {
  if (!order || order.status !== "paid") return NaN;
  const paidAt = new Date(order.paidAt).getTime();
  if (!Number.isFinite(paidAt)) return NaN;
  return paidAt + CALLBACK_PASS_WINDOW_MS;
}

export function isLiveCallbackPass(order, now = Date.now()) {
  return now < callbackPassEndsAt(order);
}

// May this contact be bought back right now?
//
// `access` is the tag's callEntitlement(), passed in rather than computed here
// so this module stays free of the vault and subscription imports behind it.
// `freeWindowMs` is the route's CALLBACK_WINDOW_MS for the same reason: one
// clock, owned in one place.
//
// The page draws its button from the same inputs (callAccess and the published
// window and horizon — see callback-eligibility.js), so a button it shows and a
// purchase this refuses can only come from a tab left open across a boundary.
export function callbackPassOffer(access, { contactCreatedAt, now = Date.now(), freeWindowMs } = {}) {
  if (!access || !access.premium) return OFFER_PREMIUM_REQUIRED;
  // Premium, but its call service has lapsed. Selling a masked call on top of
  // a tag whose masking is off would be selling the subscription one call at a
  // time, and the owner is better told what they actually need.
  if (!access.masking) return OFFER_SUBSCRIPTION_REQUIRED;

  const created = new Date(contactCreatedAt).getTime();
  // Junk in, nothing sold.
  if (!Number.isFinite(created)) return OFFER_TOO_OLD;

  const age = now - created;
  // The boundary belongs to the free window, matching register-call, which
  // still honours a contact exactly CALLBACK_WINDOW_MS old.
  if (age <= freeWindowMs) return OFFER_INCLUDED;
  if (age > CALLBACK_PASS_MAX_AGE_MS) return OFFER_TOO_OLD;
  return OFFER_AVAILABLE;
}

// Every live paid callback on this account, keyed by the contact it was bought
// for: Map<requestId string, ends-at epoch ms>.
//
// Read by the dashboard (to draw the button) and register-call (to honour it),
// from this one function, so the two cannot disagree about whether a pass is
// still running. The query narrows to recent payments; the clock is re-checked
// in code because an unparseable `paidAt` must not ride through on a string
// comparison.
export async function findLiveCallbackPasses(collections, ownerId, now = Date.now()) {
  const since = new Date(now - CALLBACK_PASS_WINDOW_MS).toISOString();
  const orders = await collections.callbackOrders
    .find({ ownerId, status: "paid", paidAt: { $gt: since } })
    .project({ requestId: 1, paidAt: 1, status: 1 })
    .toArray();

  const live = new Map();
  for (const order of orders) {
    const endsAt = callbackPassEndsAt(order);
    if (!(now < endsAt)) continue;
    const key = String(order.requestId);
    // Two live passes on one contact means two payments inside ten minutes —
    // create-order refuses that, so only a race gets here. The later one is
    // what the owner is looking at, so it wins.
    if (!live.has(key) || live.get(key) < endsAt) live.set(key, endsAt);
  }
  return live;
}

// Settle a callback order: "created" to "paid", exactly once.
//
// Called by verify-payment and by the Razorpay webhook. The conditional update
// is the whole guard — of two concurrent callers exactly one matches, so a
// replayed verify, a double-tapped handler or a webhook arriving alongside the
// browser can never move `paidAt` and hand out a second ten minutes for one
// payment. Returns the order as it now stands, and whether this call was the
// one that settled it.
export async function settleCallbackOrder(collections, { orderId, paymentId, now = new Date() }) {
  const claimed = await collections.callbackOrders.updateOne(
    { orderId, status: "created" },
    { $set: { status: "paid", paymentId: paymentId || null, paidAt: now.toISOString() } }
  );
  const order = await collections.callbackOrders.findOne({ orderId });
  return { order, firstTime: claimed.modifiedCount === 1 };
}
