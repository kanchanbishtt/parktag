// Discount codes for a negotiated price.
//
// ── THE BROWSER SENDS A CODE. IT NEVER SENDS AN AMOUNT. ────────────────────
//
// The same rule referrals.js is built on, and for the same reason: that file
// records what happened when it slipped, when cod-prepay-order handed a ₹50
// flash discount to anyone who called the endpoint directly and a sixty-second
// offer became permanent. A promo code is the identical hazard through a wider
// door, because these are handed out in WhatsApp groups on purpose.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Every offline and WhatsApp sale used to bypass the shop: UPI to edittree@axl,
// sticker handed over, nothing written down. Four real customers were invisible
// to reporting, and no sticker could be traced to a reason for leaving. A
// negotiated price now goes through the ordinary checkout with a code, so there
// is one path, one ledger and one payment rail.
//
// ── The two speeds, and why they differ ────────────────────────────────────
//
// resolvePromo() GATES: expiry, revocation, usage cap, and the phone a
// single-use code is bound to. That is the mint-time question, "may this buyer
// have this price".
//
// promoValueFor() only asks "what is this code worth". That is the verify-time
// question, and it must not gate. verify-payment runs the amount check on every
// arrival and it arrives twice by design, because the browser callback and the
// Razorpay webhook race each other (see order-fulfilment.js). Fulfilment
// consumes the code between them, so a gating re-check would call it exhausted,
// compute the full catalogue price, and reject a payment already taken.

import { toE164 } from "./phone.js";

// A WIDER alphabet than referrals.js uses, and that difference is deliberate.
//
// Referral codes are minted at random, so dropping I, L, O, U, 0 and 1 costs
// nothing: the machine simply picks from what is left, and the code is never
// misheard when read aloud.
//
// A promo code is chosen by a person, after a place or an offer, and the same
// restriction turns out to ban most of the words anybody would reach for.
// "OMAXE100" has an O. "SUPERTECH" has a U. Refusing those would mean an admin
// fighting the form over a code they have already promised a customer, and the
// likely outcome is a worse code rather than a safer one.
//
// So the judgement sits with the human choosing it. The trade is real and worth
// naming: a code containing O or 1 can be misread when dictated down a phone.
const MIN_LENGTH = 4;
const MAX_LENGTH = 16;

export const PROMO_CODE_PATTERN = new RegExp(`^[A-Z0-9]{${MIN_LENGTH},${MAX_LENGTH}}$`);

// How the sticker reaches the buyer. Carried on the CODE rather than asked at
// checkout: a negotiated code is usually handed over face to face, and asking
// that buyer for a shipping address is friction for a parcel nobody will post,
// which then leaves an order the stuck-parcel alert chases forever.
export const FULFILMENT_SHIP = "ship";
export const FULFILMENT_HANDOVER = "handover";
const FULFILMENT_MODES = new Set([FULFILMENT_SHIP, FULFILMENT_HANDOVER]);

// Unrecognised and unset both mean ship. Failing towards shipping costs a
// wasted address field; failing the other way silently stops booking couriers
// and loses somebody their delivery.
function fulfilmentOf(doc) {
  return FULFILMENT_MODES.has(doc?.fulfilment) ? doc.fulfilment : FULFILMENT_SHIP;
}

export function normalisePromoCode(raw) {
  return String(raw || "").trim().toUpperCase();
}

/**
 * May this buyer have this price?
 *
 * Returns `{ ok: false, reason }` rather than throwing, exactly as
 * resolveReferral does, because every rejection here is an ordinary thing for a
 * buyer to do: a mistype, a code that has expired, one meant for somebody else.
 * None of them should cost anybody a checkout. The caller drops the discount and
 * carries on at the catalogue price.
 */
export async function resolvePromo(collections, rawCode, { deliveryPhone = null, productId = null } = {}) {
  const code = normalisePromoCode(rawCode);
  if (!code || !PROMO_CODE_PATTERN.test(code)) return { ok: false, reason: "malformed" };

  const promo = await collections.promoCodes.findOne({ code });
  if (!promo) return { ok: false, reason: "unknown" };
  if (promo.active === false) return { ok: false, reason: "revoked" };

  // A code negotiated for one pack must not come off another. "Rs 99 off the
  // Pack of 2" applied to a Rs 299 single tag is a third of the price given
  // away, and the buyer would be right to think they were promised it.
  //
  // An EMPTY or absent list means every pack, so a general campaign code needs
  // no ceremony. Only a list that exists and excludes this product refuses.
  if (Array.isArray(promo.productIds) && promo.productIds.length > 0) {
    if (!productId || !promo.productIds.includes(productId)) {
      return { ok: false, reason: "wrong-pack", productIds: promo.productIds };
    }
  }

  if (promo.expiresAt && new Date(promo.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // A single-use code is a cap of one, expressed the way the person creating it
  // thinks about it.
  const cap = promo.singleUse ? 1 : promo.maxUses;
  if (cap != null && Number(promo.usedCount || 0) >= Number(cap)) {
    return { ok: false, reason: "exhausted" };
  }

  // Bound to one buyer, so a screenshot forwarded to a group chat is worth
  // nothing to anybody else.
  //
  // Compared in E.164 because stored formats differ by signup path, the same
  // trap resolveReferral's self-referral check documents: a raw string compare
  // would refuse the very buyer the code was minted for.
  if (promo.boundPhone) {
    const buyer = toE164(deliveryPhone);
    const bound = toE164(promo.boundPhone);
    if (!buyer || !bound || buyer !== bound) return { ok: false, reason: "not-yours" };
  }

  return {
    ok: true,
    code,
    discountPaise: Math.max(0, Number(promo.discountPaise) || 0),
    fulfilment: fulfilmentOf(promo)
  };
}

/**
 * What is this code worth, in paise, regardless of whether it may still be used?
 *
 * For the verification path only. See the header: gating here would reject the
 * second of two racing arrivals for a payment that has already succeeded.
 *
 * An unknown code is worth nothing, so a row naming one falls back to the
 * catalogue price and fails the amount check. That is the correct direction to
 * fail: a code somebody invented buys them no discount.
 */
export async function promoValueFor(collections, rawCode) {
  const code = normalisePromoCode(rawCode);
  if (!code) return 0;

  const promo = await collections.promoCodes.findOne({ code }, { projection: { discountPaise: 1 } });
  return promo ? Math.max(0, Number(promo.discountPaise) || 0) : 0;
}

/**
 * Burn one use, once the money is actually in hand.
 *
 * Called from fulfilPaidOrder, behind the conditional update that decides an
 * order is paid, for the same reason grantReferralReward is: incrementing at
 * checkout would burn codes on carts that are never completed.
 *
 * Recording the order number rather than only a counter makes this idempotent.
 * Fulfilment is reached from two racing callers and the conditional update is
 * what stops the second, but a code burnt twice by a retry would deny somebody
 * a discount they were promised.
 *
 * Never throws. The buyer has paid and their parcel is being booked; a usage
 * counter that cannot be written must not turn that into a failed request.
 */
export async function consumePromo(collections, rawCode, orderNumber, log) {
  const code = normalisePromoCode(rawCode);
  if (!code || !orderNumber) return;

  try {
    await collections.promoCodes.updateOne(
      { code, usedByOrders: { $ne: orderNumber } },
      { $inc: { usedCount: 1 }, $push: { usedByOrders: orderNumber }, $set: { lastUsedAt: new Date().toISOString() } }
    );
  } catch (err) {
    log?.warn?.({ err, code }, "[promo] could not record use");
  }
}
