// Whether a contact can be called back, and if not, why not.
//
// Three answers rather than a boolean, because the activity list draws
// something different for each: the button, the upgrade nudge, or nothing at
// all. A row that simply loses its button teaches nobody that the feature
// exists, which is the whole reason the middle answer is named.
//
// Kept out of welcome.js so it can be tested directly. This rule decides
// whether somebody who paid for a premium tag can reach the person who scanned
// it — not a thing to verify by grepping the page for a function name.
//
// The server enforces the same rule in routes/owner/dashboard.js
// (/api/owner/callback/register-call) and is the authority. This only decides
// which controls appear; that decides what actually happens. They are kept
// deliberately in step, including the awkward parts — see the tag lookup below.

export const CALLABLE = "callable";
// An E-Tag that can buy its one ₹20 callback for this contact, right now.
// Distinct from CALLABLE because the row draws a price and opens Razorpay
// rather than dialling, and distinct from NEEDS_PREMIUM because there is
// something the owner can do about it without buying a sticker.
export const NEEDS_PAYMENT = "needs-payment";
// The one paid callback on this E-Tag has been used. Kept apart from
// NEEDS_PREMIUM so the row can say "go premium" rather than offering the ₹20
// again — the whole point of a one-time pass is that it does not come back.
export const PASS_SPENT = "pass-spent";
export const NEEDS_PREMIUM = "needs-premium";
// Owns a premium tag, but its call window has closed. Kept apart from
// NEEDS_PREMIUM because "upgrade this vehicle to a premium tag" is useless
// advice to somebody who already bought one — they need a subscription, not a
// sticker, and being told otherwise reads as the app not knowing what they own.
export const NEEDS_SUBSCRIPTION = "needs-subscription";
export const NOT_CALLABLE = "not-callable";

// Does this tag hold a live ₹20 pass bought for this exact row?
//
// Reads the server's verdict (`state`, `expiresAt`) rather than re-deriving it
// from a payment time. `expiresAt` is re-checked against the clock because a
// page left open outlives the moment it was rendered — and an unparseable one
// counts as expired, never as unlimited.
export function hasLivePassFor(tag, request, now = Date.now()) {
  const pass = tag && tag.callbackPass;
  if (!pass || pass.state !== "ready" || !request) return false;
  if (String(pass.requestId) !== String(request.id)) return false;
  const ends = Date.parse(pass.expiresAt);
  return Number.isFinite(ends) && now < ends;
}

/**
 * @param request  a row from the dashboard's `requests` array
 * @param tags     the dashboard's `tags` array (deleted tags are already absent)
 * @param now      epoch ms
 * @param windowMs the callback window the server published (`callbackWindowMs`)
 * @param passMinRemainingMs how much window must be left for the ₹20 callback
 *        to still be offered (`callbackPassMinRemainingMs`)
 */
export function callbackState(
  request,
  { tags = [], now = Date.now(), windowMs = 0, passMinRemainingMs = 0 } = {}
) {
  // Nobody to dial. An anonymous report is a notification, not a conversation.
  if (!request || !request.phone) return NOT_CALLABLE;

  // "NOT answered", never "is missed". Exotel's status callback has never been
  // configured, so callOutcome is null on every call in the database; gating on
  // `=== "missed"` would hide the button from all of them. Unknown means keep
  // offering it.
  if (request.callOutcome === "answered") return NOT_CALLABLE;

  // A paid ₹20 callback for THIS row runs on its own clock, and is checked
  // before the free window below for that reason.
  //
  // The payment grants a fresh ten minutes from the moment it was verified —
  // that is the promise that makes it safe to sell at minute seven. The
  // normal path spends the pass instantly (the payment route places the call),
  // but an owner whose call could not be placed, or who closed the tab and was
  // credited by the webhook, comes back to a row whose own ten minutes may be
  // long gone. Gating them on the contact's age would leave them holding a
  // paid callback with no button to use it.
  const ownTag = tags.find((candidate) => candidate && candidate.token === request.token);
  if (hasLivePassFor(ownTag, request, now)) return CALLABLE;

  // Two separate spans, and keeping them apart is the point: the list shows 48
  // hours of history, a callback lasts ten minutes. Seeing who called is not
  // the same permission as ringing them back. Written so that an unparseable
  // date falls out here rather than sliding through as NaN.
  const age = now - new Date(request.createdAt).getTime();
  if (!Number.isFinite(age) || age > windowMs) return NOT_CALLABLE;

  // Premium belongs to the TAG, not the account, the same way contactAvailable
  // and unlimitedContact already do. A contact that arrived on an E-Tag is not
  // returnable even when the owner also holds a premium sticker on another
  // vehicle: it is the sticker that was paid for.
  //
  // A token with no matching tag lands here too — a deleted vehicle, most
  // likely. It reads as "needs premium" rather than "not callable", which is
  // slightly generous wording for a tag that may well have been premium before
  // it was deleted, but it matches what the server does: deleted tags are
  // excluded from its premium list as well, so both refuse. Agreeing with the
  // server matters more here than finding a fourth word for a rare case.
  const tag = tags.find((candidate) => candidate && candidate.token === request.token);
  if (!tag) return NEEDS_PREMIUM;

  // Masking is no longer permanent: a premium tag includes it for a year and
  // then needs a subscription. The answer is NOT re-derived here — the server
  // sends `callAccess` per tag from the one function that decides it, so this
  // page cannot reach a different verdict than the route it is drawing a button
  // for. Re-implementing the window arithmetic in the client is exactly how the
  // two would drift.
  if (tag.callAccess) {
    if (tag.callAccess.masking) return CALLABLE;

    // Premium but out of window is a different message from never having
    // bought one at all.
    if (tag.callAccess.premium) return NEEDS_SUBSCRIPTION;

    // An E-Tag. Before falling back to the upgrade nudge, ask whether this one
    // can buy — or has already bought — its single ₹20 callback.
    //
    // The verdict is the SERVER's, read off the tag payload, for the same
    // reason callAccess is: whether a pass is live depends on when it was paid
    // for, and a browser deciding that for itself would offer a dial the route
    // refuses, or hide one the owner has been charged for.
    const pass = tag.callbackPass;
    if (pass) {
      // Paid, unused, and bought for THIS row. A pass on a different contact
      // is not a permission to ring this one — the server scopes it the same
      // way, so offering it here would only produce a 402 on tap.
      if (pass.state === "ready") {
        if (String(pass.requestId) !== String(request.id)) return NEEDS_PREMIUM;
        // Bought for this row but its own clock has run out while the page sat
        // open: the server now reads it as spent, so the row says so rather
        // than offering a dial the route will refuse.
        return hasLivePassFor(tag, request, now) ? CALLABLE : PASS_SPENT;
      }
      if (pass.state === "spent") return PASS_SPENT;
      if (pass.state === "purchasable") {
        // No usable threshold means the page never received it — an older
        // server, or a page that failed to read the field. Fall back to exactly
        // what this row showed before the ₹20 option existed, the upgrade
        // nudge, rather than to nothing. Falling to not-callable here is what
        // once made the whole feature vanish without a trace: an empty row
        // reads as "nothing to do", where a nudge at least reads as a choice.
        if (!Number.isFinite(passMinRemainingMs)) return NEEDS_PREMIUM;
        // Withdrawn near the end of the window rather than sold at a price the
        // clock is about to make worthless. `passMinRemainingMs` comes from the
        // server beside the window itself, so this threshold and the one
        // create-order enforces are the same number.
        //
        // Below it the row falls back to the upgrade nudge it showed before
        // the ₹20 option existed — not to nothing, which would make the last
        // three minutes the one stretch where an E-Tag row stops mentioning
        // that callback exists at all.
        const remaining = windowMs - age;
        return remaining >= passMinRemainingMs ? NEEDS_PAYMENT : NEEDS_PREMIUM;
      }
    }

    return NEEDS_PREMIUM;
  }

  // No `callAccess` in the payload: a page loaded from a cached response served
  // before this field existed. Falling back to the old rule keeps behaviour
  // exactly as it is today rather than hiding the button from someone who has
  // paid — of the two ways to be wrong here, the strict one is the quieter and
  // worse bug, and the server refuses anything this lets through regardless.
  return tag.premium ? CALLABLE : NEEDS_PREMIUM;
}
