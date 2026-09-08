// Who may be sent what, and what it costs.
//
// Two independent questions, deliberately not one flag:
//
//   MAY we send this?    consent, and only marketing needs it
//   what does it COST?   whether a free service window is open
//
// ── Utility versus marketing ───────────────────────────────────────────────
//
// Meta's categories are not a billing detail, they are a permission model.
// A utility template reports a fact about something the customer already has:
// an order they placed, a service that is ending on a date, a document they
// stored that expires next month. It needs no marketing consent because the
// customer's own action created the obligation to tell them.
//
// A marketing template makes an offer. It needs recorded opt-in, it must honour
// opt-out, and it costs roughly seven times a utility message in India.
//
// The line matters more than the money. ParkTag has ONE WhatsApp number, and it
// carries login codes and owner alerts as well as offers. A marketing send that
// draws blocks degrades the number people depend on to be told a stranger is
// standing at their car. So marketing is gated here, in one place, rather than
// remembered at each call site.

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * May we send a MARKETING template to this owner?
 *
 * Opt-in is required and absence is a no. This is the direction that costs a
 * missed offer rather than an unwanted message, and it is the only defensible
 * default for a channel the recipient did not ask us to use.
 */
export function canSendMarketing(owner, now = Date.now()) {
  if (!owner) return false;
  if (owner.marketingOptOut === true) return false;
  return Boolean(owner.marketingOptInAt);
}

/**
 * May we send a UTILITY template to this owner?
 *
 * Almost always yes, and that is correct: these are service messages about the
 * customer's own tag, order or subscription. A marketing opt-out does NOT
 * silence them, because "stop sending me offers" is not "stop telling me my
 * insurance expires next week".
 *
 * The one exception is a hard stop, which is a different intent from a
 * promotional opt-out and is recorded separately.
 */
export function canSendUtility(owner) {
  return !owner?.messagingHardStop;
}

/**
 * Is a free 24-hour customer service window open?
 *
 * Meta bills utility templates, EXCEPT inside the window a customer opens by
 * messaging the business. `waWindowOpenUntil` is stamped by the Meta webhook on
 * any inbound message.
 *
 * Nothing branches on this to decide WHETHER to send. It exists so campaigns
 * can order their work cheapest-first and so the cost of a batch is knowable
 * before it runs, which is the number that decides whether a campaign is worth
 * having at all.
 */
export function hasOpenServiceWindow(owner, now = Date.now()) {
  const until = owner?.waWindowOpenUntil;
  if (!until) return false;
  const at = new Date(until).getTime();
  return Number.isFinite(at) && at > now;
}

/**
 * The stamp applied when a customer messages us. Exported so the webhook and
 * its test agree on one definition of "24 hours".
 */
export function serviceWindowUntil(now = Date.now()) {
  return new Date(now + WINDOW_MS).toISOString();
}
