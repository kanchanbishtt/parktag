// Whether a contact can be called back, and if not, why not.
//
// Several answers rather than a boolean, because the activity list draws
// something different for each: the button, the ₹20 button, an upgrade or
// renewal nudge, or nothing at all. A row that simply loses its button teaches
// nobody that the feature exists, which is the whole reason the in-between
// answers are named.
//
// Kept out of welcome.js so it can be tested directly. This rule decides
// whether somebody who paid for a premium tag can reach the person who scanned
// it — not a thing to verify by grepping the page for a function name.
//
// The server enforces the same rule in routes/owner/dashboard.js
// (/api/owner/callback/register-call) and routes/owner/callback-pass.js
// (/api/owner/callback/create-order), and is the authority. This only decides
// which controls appear; those decide what actually happens. They are kept
// deliberately in step, including the awkward parts — see the tag lookup below.

export const CALLABLE = "callable";
// A premium tag whose free ten minutes on this contact are over: the owner can
// pay ₹20 to reopen the callback for another ten. Distinct from CALLABLE
// because the row draws a price and opens Razorpay rather than dialling, and
// distinct from NOT_CALLABLE because there is something the owner can do.
export const NEEDS_PAYMENT = "needs-payment";
export const NEEDS_PREMIUM = "needs-premium";
// Owns a premium tag, but its call service has lapsed. Kept apart from
// NEEDS_PREMIUM because "upgrade this vehicle to a premium tag" is useless
// advice to somebody who already bought one — they need a subscription, not a
// sticker, and being told otherwise reads as the app not knowing what they own.
export const NEEDS_SUBSCRIPTION = "needs-subscription";
export const NOT_CALLABLE = "not-callable";

// Is a ₹20 callback the owner bought for this row still running?
//
// Reads the server's verdict (`callbackPassExpiresAt`, present only while one
// is live) rather than re-deriving it from a payment time. It is re-checked
// against the clock because a page left open outlives the moment it was
// rendered — and an unparseable time counts as over, never as unlimited.
export function hasLivePass(request, now = Date.now()) {
  if (!request || !request.callbackPassExpiresAt) return false;
  const ends = Date.parse(request.callbackPassExpiresAt);
  return Number.isFinite(ends) && now < ends;
}

/**
 * @param request  a row from the dashboard's `requests` array
 * @param tags     the dashboard's `tags` array (deleted tags are already absent)
 * @param now      epoch ms
 * @param windowMs the free callback window the server published (`callbackWindowMs`)
 * @param passMaxAgeMs how old a contact may be and still be bought back
 *        (`callbackPassMaxAgeMs`). Defaults to 0, which offers nothing: a page
 *        that was never told the horizon must not invent one.
 */
export function callbackState(
  request,
  { tags = [], now = Date.now(), windowMs = 0, passMaxAgeMs = 0 } = {}
) {
  // Nobody to dial. An anonymous report is a notification, not a conversation.
  if (!request || !request.phone) return NOT_CALLABLE;

  // "NOT answered", never "is missed". Exotel's status callback has never been
  // configured, so callOutcome is null on every call in the database; gating on
  // `=== "missed"` would hide the button from all of them. Unknown means keep
  // offering it.
  if (request.callOutcome === "answered") return NOT_CALLABLE;

  // A paid callback for THIS row runs on its own clock — ten minutes from the
  // payment — and is checked before the contact's age for that reason: the
  // contact is by definition older than the free window, and gating on it
  // would leave an owner holding a paid callback with no button to use it.
  if (hasLivePass(request, now)) return CALLABLE;

  // Two separate spans, and keeping them apart is the point: the list shows 48
  // hours of history, a free callback lasts ten minutes. Seeing who called is
  // not the same permission as ringing them back. Written so that an
  // unparseable date falls out here rather than sliding through as NaN.
  const age = now - new Date(request.createdAt).getTime();
  if (!Number.isFinite(age)) return NOT_CALLABLE;

  // Premium belongs to the TAG, not the account, the same way contactAvailable
  // and unlimitedContact already do. A contact that arrived on an E-Tag is not
  // returnable even when the owner also holds a premium sticker on another
  // vehicle: it is the sticker that was paid for.
  //
  // A token with no matching tag — a deleted vehicle, most likely — reads as
  // "needs premium" inside the window, which matches the server: deleted tags
  // are excluded from its premium list as well, so both refuse.
  const tag = tags.find((candidate) => candidate && candidate.token === request.token);

  // Masking is no longer permanent: a premium tag includes it for a year and
  // then needs a subscription. The answer is NOT re-derived here — the server
  // sends `callAccess` per tag from the one function that decides it, so this
  // page cannot reach a different verdict than the route it is drawing a button
  // for. Re-implementing the window arithmetic in the client is exactly how the
  // two would drift.
  //
  // `premium` is checked alongside `masking` because an E-Tag whose one free
  // contact is still unused also reads `masking: true` — that is the scanner's
  // side of the glass — and the owner's callback has never been part of it.
  const access = tag && tag.callAccess;

  if (age > windowMs) {
    // The free window is over. A premium tag whose call service is running can
    // buy it back for this contact, until the contact is too old to be sold;
    // create-order refuses on exactly these three conditions. Everything else
    // shows nothing: nagging about an upgrade over a contact from yesterday
    // would be noise, and the renewal nudge is for the live window.
    //
    // No `callAccess` (a response from before the field) offers nothing too —
    // the page cannot tell a lapsed premium tag from a running one without it.
    const premiumRunning = Boolean(access && access.premium && access.masking);
    return premiumRunning && age <= passMaxAgeMs ? NEEDS_PAYMENT : NOT_CALLABLE;
  }

  if (!tag) return NEEDS_PREMIUM;

  if (access) {
    // Premium but out of cover is a different message from never having
    // bought one at all.
    if (access.premium) return access.masking ? CALLABLE : NEEDS_SUBSCRIPTION;
    return NEEDS_PREMIUM;
  }

  // No `callAccess` in the payload: a page loaded from a cached response served
  // before this field existed. Falling back to the old rule keeps behaviour
  // exactly as it is today rather than hiding the button from someone who has
  // paid — of the two ways to be wrong here, the strict one is the quieter and
  // worse bug, and the server refuses anything this lets through regardless.
  return tag.premium ? CALLABLE : NEEDS_PREMIUM;
}
