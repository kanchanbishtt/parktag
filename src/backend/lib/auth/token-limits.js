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
 * Check a promo code a token is creating (`doc` whole) or editing (`doc` merged, `patch` the fields being changed).
 * On an edit only what the token is touching is judged, so it can still adjust a code you made without these limits.
 * Returns an error message, or null when the request is fine (or did not come from a token).
 */
export function promoLimitError(request, doc, patch = null) {
  if (!viaToken(request)) return null;
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
  return null;
}

/** Check a batch of tags a token is issuing. */
export function issueLimitError(request, quantity) {
  if (!viaToken(request)) return null;
  return Number(quantity) > TOKEN_LIMITS.maxTagsPerIssue
    ? `A token may issue at most ${TOKEN_LIMITS.maxTagsPerIssue} tags at a time. Use the admin panel for a bigger batch.`
    : null;
}
