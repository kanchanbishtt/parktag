// One paid callback, for a tag that is not entitled to any.
//
// Calling a scanner back is a premium behaviour (see call-access.js). An E-Tag
// gets one free masked CONTACT — the scanner reaching the owner — and nothing
// in the other direction: when that scanner hangs up, or the owner misses it,
// there has never been a route back to them. The tag is not premium, so
// register-call refuses, and the activity row shows an upgrade nudge instead of
// a button.
//
// This sells that one call back for ₹20, once per tag, and then stops.
//
//   E-Tag, no pass bought    the row offers "Call back ₹20".
//   E-Tag, pass paid         the row offers the call. One dial.
//   E-Tag, pass spent        no offer. The nudge returns, and it says premium.
//   Premium tag              none of this applies. callEntitlement decides,
//                            exactly as it does today.
//
// Deliberately NOT a subscription, a wallet, or a credit balance. The ladder
// this sits on is "an E-Tag can be made to work once, then buy the sticker",
// and a second purchasable callback would compete with the thing it is meant to
// advertise.
//
// Per TAG, not per owner. Every other paid behaviour in the app is decided by
// the specific tag that was scanned — `premium`, `freeContactUsed`,
// `contactAvailable` — and an owner holding three E-Tags has three separate
// stickers on three separate cars. An account-level pass would mean paying for
// one vehicle and silently spending it on another.

// ₹20, in paise. Stored on the order and re-checked at verify time, so an order
// minted before a price change cannot be settled at the old figure.
export const CALLBACK_PASS_PAISE = 2000;

// How long a paid callback stays usable, measured from the moment the payment
// was verified — NOT from the scanner's contact.
//
// This is the whole reason the price is collectable at all. The free window
// runs ten minutes from when the scanner made contact, and an owner who opens
// the app eight minutes in would be buying two minutes: enough to lose the
// window inside Razorpay's own checkout sheet and be charged for nothing. So
// the payment grants a fresh ten minutes of its own.
//
// It is the same ten minutes, and that is intentional — a paid callback is the
// same product as a premium one, not a longer one.
export const CALLBACK_PASS_WINDOW_MS = 10 * 60 * 1000;

// Below this much left on the FREE window, the offer is withdrawn rather than
// shown at a price.
//
// Nothing breaks if someone pays with ten seconds left — the fresh window above
// covers them. This exists because being asked for money at 9:55 reads as the
// app taking a payment it knows is about to be useless, and because an owner
// who pays and then watches the row vanish underneath them has no way to tell
// that the thing they bought still works.
export const CALLBACK_PASS_MIN_REMAINING_MS = 3 * 60 * 1000;

export const PASS_NOT_APPLICABLE = "not-applicable";
export const PASS_PURCHASABLE = "purchasable";
export const PASS_READY = "ready";
export const PASS_SPENT = "spent";

// Has this tag's paid callback been used up?
//
// Two ways to spend one, and they are not the same event:
//
//   usedAt   a dial was registered. The owner got what they paid for, whether
//            or not the scanner picked up — one dial is the deal.
//   lapsed   paid, never dialled, and the fresh window has since closed.
//
// The second is deliberately terminal too. A pass that came back to life after
// its window would be a credit sitting on the account, which is the balance
// this file's header rules out. In practice it is close to unreachable: the
// payment route registers the call in the same request that verifies it, so a
// pass is normally spent within a second of being bought.
function isSpent(pass, now) {
  if (!pass || !pass.paidAt) return false;
  if (pass.usedAt) return true;
  const paidAt = new Date(pass.paidAt).getTime();
  // An unparseable date is treated as spent, not as unlimited. Junk on a
  // record must never mint service — the same rule hasActiveCallSubscription
  // follows for a malformed subscription end date.
  if (!Number.isFinite(paidAt)) return true;
  return now - paidAt >= CALLBACK_PASS_WINDOW_MS;
}

// What this tag may do about a PAID callback. The one place it is decided: the
// purchase route, the payment route, register-call and the dashboard payload
// all read this, so they cannot drift into disagreeing about the same tag.
//
// Premium tags return `not-applicable` rather than any of the other three.
// Their callback is decided by callEntitlement and always was; a premium tag
// that happens to carry a stale pass field must not be routed through here.
export function callbackPassState(tag, now = Date.now()) {
  if (!tag || tag.premium) return PASS_NOT_APPLICABLE;
  const pass = tag.callbackPass;
  if (!pass || !pass.paidAt) return PASS_PURCHASABLE;
  return isSpent(pass, now) ? PASS_SPENT : PASS_READY;
}

// May this tag be offered a paid callback right now, for a contact that arrived
// at `contactCreatedAt`?
//
// `freeWindowMs` is the caller's callback window (CALLBACK_WINDOW_MS), passed
// in rather than imported so this module has one clock and the route keeps
// owning the other.
export function canPurchaseCallbackPass(tag, { contactCreatedAt, now = Date.now(), freeWindowMs } = {}) {
  if (callbackPassState(tag, now) !== PASS_PURCHASABLE) return false;

  const created = new Date(contactCreatedAt).getTime();
  if (!Number.isFinite(created)) return false;

  const remaining = freeWindowMs - (now - created);
  return remaining >= CALLBACK_PASS_MIN_REMAINING_MS;
}

// Is there a live paid pass on this tag that authorises a dial right now?
//
// Scoped to the contact it was bought for. A pass is sold against one row in
// the activity list — the person who just tried to reach them — and letting it
// dial a different contact would mean paying to call one stranger and reaching
// another.
export function hasLiveCallbackPass(tag, requestId, now = Date.now()) {
  if (callbackPassState(tag, now) !== PASS_READY) return false;
  return String(tag.callbackPass.requestId) === String(requestId);
}

// What the dashboard sends per tag, so the page can draw the right control
// without re-deriving any of the above. Mirrors how callAccess is published:
// the entitlement travels, never the raw fields it was computed from.
export function callbackPassPayload(tag, now = Date.now()) {
  const state = callbackPassState(tag, now);
  return {
    state,
    pricePaise: CALLBACK_PASS_PAISE,
    // Only meaningful while READY, and the page uses it to stop offering a
    // dial the server would refuse.
    expiresAt:
      state === PASS_READY
        ? new Date(new Date(tag.callbackPass.paidAt).getTime() + CALLBACK_PASS_WINDOW_MS).toISOString()
        : null,
    requestId: state === PASS_READY ? String(tag.callbackPass.requestId) : null
  };
}

// Why a spent pass shows no button. Said once here so the toast, the row and
// the route cannot phrase the same refusal three ways.
export const CALLBACK_PASS_SPENT_MESSAGE =
  "You've used the one-time callback for this vehicle. Go premium to keep calling back.";
