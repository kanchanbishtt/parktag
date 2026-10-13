// Ceilings on what an API token (hand-minted or OAuth) may do with the few actions that cost real money or can't be
// undone. They are enforced here, on the server, so they hold however the caller was persuaded to make the request:
// an AI connected to the admin that reads a hostile review and is talked into "create FREE100 at 100% off" gets a
// refusal, not a code. A signed-in admin in the panel is not limited by any of this.
//
// Only requests that arrived with a token are checked (request.session.via === "api-token"). To go beyond a limit,
// do it in the admin panel.

export const TOKEN_LIMITS = Object.freeze({
  maxPercent: 50,
  maxDiscountPaise: 50_000, // Rs 500, per order for flat and per sticker pack for per_unit
  maxUses: 1000,
  maxTagsPerIssue: 500
});

const viaToken = (request) => request?.session?.via === "api-token";

const PROMO_HELP =
  `A token may create codes worth at most ${TOKEN_LIMITS.maxPercent}% or Rs ${TOKEN_LIMITS.maxDiscountPaise / 100} off, ` +
  `with a use limit of ${TOKEN_LIMITS.maxUses} or fewer and an expiry date. Use the admin panel for anything bigger.`;

/**
 * Check a promo code a token is creating or switching on (`doc` whole), or editing (`doc` merged, `patch` the fields
 * being changed, `before` the code as it stood). On an edit only what the token is touching is judged, so it can still
 * adjust a code you made without these limits; but while that code stays beyond them, the token may not widen it.
 * Returns an error message, or null when the request is fine (or did not come from a token).
 */
export function promoLimitError(request, doc, patch = null, before = null) {
  if (!viaToken(request)) return null;
  const fieldError = limitError(doc, patch);
  if (fieldError) return fieldError;
  // Each field passing on its own is not enough. A 100%-off code of yours, used up and expired, came back for 1000
  // uses until 2030 through an edit that set maxUses: 1000 (within the limit) and a later expiresAt (present): the
  // code a token can never create, put back on sale field by field. So while the code as edited is still one a token
  // could not create, the edit may only narrow it. Once the edit brings it within the limits as a whole, it is a code
  // the token could have made, and anything goes.
  if (before && limitError(doc, null)) {
    const opened = widening(before, doc);
    if (opened) return `A token cannot widen ${opened} on a code beyond its limits. ${PROMO_HELP}`;
  }
  return null;
}

const time = (value) => (value ? new Date(value).getTime() : null);
// How many times the code can be used: single-use wins over maxUses, and no maxUses is no limit.
const capOf = (doc) => (doc.singleUse ? 1 : Number.isInteger(doc.maxUses) ? doc.maxUses : Infinity);
// The packs it is limited to, or null for every pack (an empty list means every pack too).
const packsOf = (doc) => (Array.isArray(doc.productIds) && doc.productIds.length > 0 ? doc.productIds : null);

// What an edit opens up that the code did not allow before, in words, or null. Read the way resolvePromo reads a code
// (lib/core/promo-codes.js). Shipping is left out on purpose: adjusting it on an older code is what edits are for.
function widening(before, after) {
  if (capOf(after) > capOf(before)) return "the number of uses";
  const endBefore = time(before.expiresAt);
  if (endBefore !== null && (time(after.expiresAt) === null || time(after.expiresAt) > endBefore)) return "the expiry";
  const startBefore = time(before.startsAt);
  if (startBefore !== null && (time(after.startsAt) === null || time(after.startsAt) < startBefore)) return "the start date";
  if (before.boundPhone && after.boundPhone !== before.boundPhone) return "the mobile number it is tied to";
  const packsBefore = packsOf(before);
  const packsAfter = packsOf(after);
  if (packsBefore && (!packsAfter || packsAfter.some((id) => !packsBefore.includes(id)))) return "the packs it applies to";
  if (before.fulfilment === "handover" && after.fulfilment !== "handover") return "where it can be used";
  return null;
}

// The fixed ceilings, on the whole code (`patch` null) or on the fields an edit touches.
function limitError(doc, patch) {
  const touches = (field) => patch === null || Object.hasOwn(patch, field);

  const modeChange = touches("discountMode");
  if (doc.discountMode === "percent") {
    if ((touches("discountPercent") || modeChange) && Number(doc.discountPercent) > TOKEN_LIMITS.maxPercent) return `Discount is over the ${TOKEN_LIMITS.maxPercent}% limit for tokens. ${PROMO_HELP}`;
  } else if ((touches("discountPaise") || modeChange) && Number(doc.discountPaise) > TOKEN_LIMITS.maxDiscountPaise) {
    return `Discount is over the Rs ${TOKEN_LIMITS.maxDiscountPaise / 100} limit for tokens. ${PROMO_HELP}`;
  }
  if (touches("maxUses") && !(Number.isInteger(doc.maxUses) && doc.maxUses >= 1 && doc.maxUses <= TOKEN_LIMITS.maxUses)) {
    return `maxUses must be a whole number from 1 to ${TOKEN_LIMITS.maxUses} for tokens. ${PROMO_HELP}`;
  }
  if (touches("expiresAt") && !doc.expiresAt) return `An expiry date is required for tokens. ${PROMO_HELP}`;
  // Switching a code on for every visitor changes the price on the whole site.
  if (touches("autoApply") && doc.autoApply === true) return `Only the admin panel can make a code a website offer. ${PROMO_HELP}`;
  return null;
}

/** Check a batch of tags a token is issuing. */
export function issueLimitError(request, quantity) {
  if (!viaToken(request)) return null;
  return Number(quantity) > TOKEN_LIMITS.maxTagsPerIssue
    ? `A token may issue at most ${TOKEN_LIMITS.maxTagsPerIssue} tags at a time. Use the admin panel for a bigger batch.`
    : null;
}
