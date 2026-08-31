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
export const NEEDS_PREMIUM = "needs-premium";
// Owns a premium tag, but its call window has closed. Kept apart from
// NEEDS_PREMIUM because "upgrade this vehicle to a premium tag" is useless
// advice to somebody who already bought one — they need a subscription, not a
// sticker, and being told otherwise reads as the app not knowing what they own.
export const NEEDS_SUBSCRIPTION = "needs-subscription";
export const NOT_CALLABLE = "not-callable";

/**
 * @param request  a row from the dashboard's `requests` array
 * @param tags     the dashboard's `tags` array (deleted tags are already absent)
 * @param now      epoch ms
 * @param windowMs the callback window the server published (`callbackWindowMs`)
 */
export function callbackState(request, { tags = [], now = Date.now(), windowMs = 0 } = {}) {
  // Nobody to dial. An anonymous report is a notification, not a conversation.
  if (!request || !request.phone) return NOT_CALLABLE;

  // "NOT answered", never "is missed". Exotel's status callback has never been
  // configured, so callOutcome is null on every call in the database; gating on
  // `=== "missed"` would hide the button from all of them. Unknown means keep
  // offering it.
  if (request.callOutcome === "answered") return NOT_CALLABLE;

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

  // Masking is no longer permanent: a premium tag includes it for 45 days and
  // then needs a subscription. The answer is NOT re-derived here — the server
  // sends `callAccess` per tag from the one function that decides it, so this
  // page cannot reach a different verdict than the route it is drawing a button
  // for. Re-implementing the 45-day arithmetic in the client is exactly how the
  // two would drift.
  if (tag.callAccess) {
    if (tag.callAccess.masking) return CALLABLE;
    // Premium but out of window is a different message from never having
    // bought one at all.
    return tag.callAccess.premium ? NEEDS_SUBSCRIPTION : NEEDS_PREMIUM;
  }

  // No `callAccess` in the payload: a page loaded from a cached response served
  // before this field existed. Falling back to the old rule keeps behaviour
  // exactly as it is today rather than hiding the button from someone who has
  // paid — of the two ways to be wrong here, the strict one is the quieter and
  // worse bug, and the server refuses anything this lets through regardless.
  return tag.premium ? CALLABLE : NEEDS_PREMIUM;
}
