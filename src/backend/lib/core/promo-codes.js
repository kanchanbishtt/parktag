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
// resolvePromo() GATES: start date, expiry, revocation, usage cap, and the phone a
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
import { getShopProduct } from "../integrations/payments.js";

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

// The three ways a code's discount can be shaped. Exported so the admin route
// validates against the same list it is defined in, rather than a second
// hand-typed copy that can drift.
export const DISCOUNT_MODES = ["flat", "per_unit", "percent"];

// What one code is worth, in paise, for a cart of this size.
//
// Absent or unrecognised `discountMode` reads as "flat" — today's only
// behaviour, before this field existed, and the one every code minted before
// this feature still carries. Failing towards the mode that already shipped
// means a code nobody re-saves keeps doing exactly what it always did.
export function discountPaiseFor(promo, { subtotalPaise, quantity = 1 } = {}) {
  const mode = DISCOUNT_MODES.includes(promo?.discountMode) ? promo.discountMode : "flat";
  const qty = Math.max(1, Math.trunc(Number(quantity) || 1));

  if (mode === "percent") {
    const pct = Math.min(100, Math.max(0, Number(promo?.discountPercent) || 0));
    return Math.round((Number(subtotalPaise) || 0) * pct / 100);
  }

  const base = Math.max(0, Number(promo?.discountPaise) || 0);
  return mode === "per_unit" ? base * qty : base;
}

// What shipping costs on top, in paise, once a code's fee and free-shipping
// threshold are applied. The threshold checks the PRE-discount subtotal — the
// price of the goods before the code's own discount comes off — so a buyer's
// shipping status does not move depending on how much the code took off.
export function shippingFeePaiseFor(promo, { subtotalPaise } = {}) {
  const fee = Math.max(0, Number(promo?.shippingFeePaise) || 0);
  if (!fee) return 0;
  const threshold = promo?.freeShippingAbovePaise;
  if (threshold != null && Number(subtotalPaise) >= Number(threshold)) return 0;
  return fee;
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
export async function resolvePromo(
  collections,
  rawCode,
  { deliveryPhone = null, productId = null, quantity = 1 } = {}
) {
  const code = normalisePromoCode(rawCode);
  if (!code || !PROMO_CODE_PATTERN.test(code)) return { ok: false, reason: "malformed" };

  const promo = await collections.promoCodes.findOne({ code });
  if (!promo) return { ok: false, reason: "unknown" };
  return evaluatePromo(promo, { deliveryPhone, productId, quantity });
}

// resolvePromo's rules on a row already read, so the website-offer code below
// can judge many packs and quantities against one read.
function evaluatePromo(promo, { deliveryPhone = null, productId = null, quantity = 1 } = {}) {
  const code = promo.code;
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

  // A campaign scheduled ahead is not live yet. An unparseable date reads as
  // NaN, which compares false and leaves the code usable, same as expiresAt.
  if (promo.startsAt && new Date(promo.startsAt).getTime() > Date.now()) {
    return { ok: false, reason: "not-started" };
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

  // The subtotal a percent mode needs to compute against. Only resolvable when
  // the caller named a product — a percent code checked with no pack in play
  // (e.g. an untied general campaign code before a pack is chosen) is worth 0
  // until one is, which is the correct direction to fail: never invent a price.
  const product = productId ? getShopProduct(productId) : null;
  const qty = Math.max(1, Math.trunc(Number(quantity) || 1));
  const subtotalPaise = product ? Math.round(product.amount * 100) * qty : 0;

  return {
    ok: true,
    code,
    discountPaise: discountPaiseFor(promo, { subtotalPaise, quantity: qty }),
    shippingFeePaise: shippingFeePaiseFor(promo, { subtotalPaise }),
    fulfilment: fulfilmentOf(promo)
  };
}

// ── Website offers ──────────────────────────────────────────────────────────
//
// A code with `autoApply: true` is a website offer: every storefront shows it
// and every order route applies it without the buyer typing anything, signed
// in or not. The landing page, /shop, /get and the dashboard shop all read it
// through the server, so a visitor and a returning customer are quoted and
// charged the same. The row's own rules (packs, dates, usage cap, active)
// decide where and when it applies, exactly as for a typed code.
//
// Never a handover code and never a bound or single-use one: the admin route
// refuses those combinations, and they are skipped here as well.

function autoApplyRows(collections) {
  return collections.promoCodes
    .find({ autoApply: true, active: { $ne: false } })
    .sort({ code: 1 })
    .toArray();
}

// What the buyer actually saves: the discount less any shipping fee the code adds.
const netSaving = (promo) => promo.discountPaise - (promo.shippingFeePaise || 0);

// Several live offers on one pack: the one that saves the buyer most wins, ties
// broken by code (the rows are sorted) so the answer never depends on database
// order. Judged per quantity, because a per-pack offer can overtake a flat one.
function bestOffer(rows, context) {
  let best = { ok: false, reason: "none" };
  for (const row of rows) {
    const promo = evaluatePromo(row, context);
    if (!promo.ok || promo.fulfilment === FULFILMENT_HANDOVER || netSaving(promo) <= 0) continue;
    if (!best.ok || netSaving(promo) > netSaving(best)) best = { ...promo, auto: true };
  }
  return best;
}

/** The best website offer for this pack and quantity, or `{ ok: false }`. */
export async function resolveAutoOffer(collections, { productId, quantity = 1, deliveryPhone = null } = {}) {
  return bestOffer(await autoApplyRows(collections), { productId, quantity, deliveryPhone });
}

/**
 * The code an order is priced with. One code per order:
 *
 *  - a code the buyer typed, if it is valid for this pack, replaces the
 *    website offer;
 *  - otherwise the website offer applies, and `typedRefusal` says why the
 *    typed one did not, so the page can tell the buyer before they pay.
 *
 * `allowHandover` is false for the dashboard: a handover code is for a sale in
 * person and has no meaning for an order that ships to a saved address.
 */
export async function resolveCheckoutPromo(
  collections,
  { typedCode = null, productId, quantity = 1, deliveryPhone = null, allowHandover = true } = {}
) {
  let typedRefusal = null;
  if (normalisePromoCode(typedCode)) {
    const typed = await resolvePromo(collections, typedCode, { productId, quantity, deliveryPhone });
    if (typed.ok && (allowHandover || typed.fulfilment !== FULFILMENT_HANDOVER)) return typed;
    typedRefusal = typed.ok ? "handover-only" : typed.reason;
  }
  const auto = await resolveAutoOffer(collections, { productId, quantity, deliveryPhone });
  return auto.ok ? { ...auto, typedRefusal } : { ok: false, reason: auto.reason, typedRefusal };
}

/**
 * The website offer on each pack, as the storefronts show it:
 *
 *   { [productId]: { code, productId, mrpPaise, discountPaise, offerPaise,
 *                    payableByQuantity } }
 *
 * `offerPaise` is what one pack costs with the offer, shipping fee included.
 * `payableByQuantity[q - 1]` is what q packs cost, worked out here by the same
 * rules the order routes charge by, so a page with a quantity stepper never
 * does discount arithmetic of its own (a percent or per-pack offer does not
 * scale like a flat one). One read of the offer rows for the whole catalogue.
 */
export async function readWebsiteOffers(collections, products, { maxQuantity = 1 } = {}) {
  const rows = await autoApplyRows(collections);
  const offers = {};
  if (!rows.length) return offers;
  for (const [productId, product] of Object.entries(products)) {
    if (product.soldOut) continue;
    const single = bestOffer(rows, { productId, quantity: 1 });
    if (!single.ok) continue;
    const unitPaise = Math.round(product.amount * 100);
    const payableByQuantity = [];
    for (let quantity = 1; quantity <= Math.max(1, maxQuantity); quantity += 1) {
      const promo = bestOffer(rows, { productId, quantity });
      const subtotal = unitPaise * quantity;
      // expectedOrderPaise's arithmetic: one-rupee floor, shipping on top.
      payableByQuantity.push(promo.ok
        ? Math.max(subtotal - promo.discountPaise, 100) + (promo.shippingFeePaise || 0)
        : subtotal);
    }
    offers[productId] = {
      code: single.code,
      productId,
      mrpPaise: unitPaise,
      discountPaise: single.discountPaise,
      offerPaise: payableByQuantity[0],
      payableByQuantity
    };
  }
  return offers;
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
 *
 * `subtotalPaise`/`quantity` are needed to price a `per_unit` or `percent`
 * code the same way resolvePromo did at mint time — passed in by the caller
 * rather than re-derived here, because verify-payment already has both as
 * server-derived, order-pinned values (see the route).
 */
export async function promoValueFor(collections, rawCode, { subtotalPaise = 0, quantity = 1 } = {}) {
  const code = normalisePromoCode(rawCode);
  if (!code) return 0;

  const promo = await collections.promoCodes.findOne(
    { code },
    { projection: { discountMode: 1, discountPaise: 1, discountPercent: 1 } }
  );
  return promo ? discountPaiseFor(promo, { subtotalPaise, quantity }) : 0;
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
