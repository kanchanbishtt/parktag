// Referrals: ₹50 off for the friend, one month of premium for the referrer.
//
// ── The rule that shapes everything here ───────────────────────────────────
//
// THE BROWSER SENDS A CODE. IT NEVER SENDS AN AMOUNT.
//
// This is the same rule flashDiscountPaiseFor() in routes/shop/index.js exists
// to enforce, and that function's comment records what happens when it slips:
// cod-prepay-order handed the ₹50 flash discount to anyone who asked, so a
// sixty-second offer was permanent for anybody who called the endpoint
// directly. A referral is the same shape of hazard with a wider door, because
// the code is public by design.
//
// ── Prepaid only ──────────────────────────────────────────────────────────
//
// The discount does not apply to Cash on Delivery, for two independent reasons
// and either would be enough.
//
// COD already carries a +₹50 handling surcharge (COD_SURCHARGE_PAISE), which
// exists to cover shipping out and the return leg on a refused parcel. A ₹50
// referral discount on a COD order cancels that surcharge exactly, so ParkTag
// would be absorbing the cost of COD *and* paying a referral on it.
//
// And COD is the cheap fraud path. Nothing in this app ever transitions a COD
// order out of "cod" (see the MAX_COD_ORDERS_PER_WINDOW comment), so there is
// no delivery signal to reward against. Rewarding at placement would let
// somebody place orders with their own code, never accept the parcels, and
// collect months while ParkTag pays the courier both ways.
//
// Prepaid means the money is genuinely in hand before anything is given away.
// The reward is granted from fulfilPaidOrder, on the same conditional update
// that decides an order is paid, so it cannot fire twice.

import { addMonths } from "./calendar.js";
import { membershipPeriodStart } from "./membership-fulfilment.js";
import { hasActiveSubscription } from "./subscription.js";
import { premiumTrialEndsAt } from "./vault.js";
import { toE164 } from "./phone.js";
import { firstNameOf, resolveOwnerName } from "./owner-name.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappReferralReward } from "../integrations/meta.js";

// What each side gets. Constants rather than literals at the call sites, so the
// two numbers that define the offer are readable in one place.
export const REFERRAL_DISCOUNT_PAISE = 5000; // ₹50 off, for the friend
export const REFERRAL_REWARD_MONTHS = 1;     // one month of premium, for the referrer

// How many rewards one referrer can earn in a rolling window.
//
// Not a fraud control on its own — the self-referral checks below are that —
// but a ceiling on how wrong things can go before somebody notices. A genuine
// enthusiast referring more than a dozen people in a month is a conversation
// worth having rather than a payout to process silently.
export const MAX_REWARDS_PER_WINDOW = 12;
const REWARD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What this order should cost, in paise. The ONE definition, shared by the
 * route that mints an order and the route that verifies its payment.
 *
 * verify-payment refuses any order whose stored amount is not what the server
 * expects (M15 Step 5), and before referrals that expectation was simply the
 * catalog price. A discounted order would have been rejected as an "Order
 * amount mismatch" after the buyer had already paid.
 *
 * Note what is NOT read here: `order.referralDiscountPaise`. The discount is
 * recomputed from the mere PRESENCE of `referredBy`, which is a field only the
 * server writes and only after resolveReferral() has approved it. A stored
 * amount is a number somebody could have tampered with; a stored referrer is a
 * decision this server already made. Deriving from the decision means a row
 * edited to claim a ₹400 discount still fails the check.
 *
 * `promoDiscountPaise` is the same rule wearing a different coat. It is passed
 * IN by the caller, who looked it up from the promoCodes collection against
 * `order.promoCode`, and it is deliberately NOT read off the order. The order
 * stores its own `promoDiscountPaise` for display only; reading that back here
 * would hand an editor of the row whatever discount they typed into it.
 *
 * `shippingFeePaise` is added AFTER the one-rupee floor below, not before. The
 * floor exists to protect the PRODUCT price from being discounted to nothing;
 * shipping is a separate line, charged on top, and must never be a way to
 * launder a fee into the floor's protection — a ₹9,999 discount code must not
 * make ₹49 of shipping disappear along with the rest of the price.
 */
export function expectedOrderPaise(catalogPaise, order, promoDiscountPaise = 0, shippingFeePaise = 0) {
  const referral = order && order.referredBy ? REFERRAL_DISCOUNT_PAISE : 0;
  const promo = Math.max(0, Number(promoDiscountPaise) || 0);
  const shipping = Math.max(0, Number(shippingFeePaise) || 0);
  // Never below ₹1. Razorpay refuses a zero or negative amount, and a discount
  // that could exceed the price would be a way to be paid for taking stock.
  return Math.max(catalogPaise - referral - promo, 100) + shipping;
}

// Unambiguous alphabet: no I, L, O, U, 0 or 1.
//
// This code gets read off a screen and typed into a phone, and sometimes read
// aloud. O/0 and I/1/l are where that goes wrong. U is dropped as well because
// removing it makes an accidental obscenity far less likely in a random string,
// which matters when the string is printed next to a customer's name.
// Exported so the test can assert on the alphabet itself rather than
// sampling dozens of minted codes and hoping a bad character turns up.
export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 6;

// Built FROM the alphabet rather than written out as ranges beside it.
//
// The hand-written version was `[2-9A-HJ-NP-Z]`, which quietly admits L and U
// because they sit inside J-N and P-Z. Codes containing them can never be
// minted, so the only effect was a validator looser than the thing it
// validates -- harmless today, and exactly the kind of drift that stops being
// harmless when somebody later trusts the regex to describe a real code.
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

function randomCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * This owner's referral code, minted on first use.
 *
 * Generated lazily rather than at signup: most owners will never open the
 * referral card, and a code that exists for everybody is a unique index
 * carrying rows nothing reads.
 *
 * Collisions are resolved by the unique index rather than by checking first.
 * A read-then-write would race two concurrent callers into the same code; the
 * index refuses the second, and the retry takes a different one.
 */
export async function referralCodeFor(collections, ownerId) {
  // Read at the TOP of every pass, and return only what the read found.
  //
  // The first version returned the code it had just generated when its
  // conditional update reported success, and re-read only when it lost. That
  // looks equivalent and is not: it has one path that returns a local variable
  // and another that returns stored state, so under a race the two could
  // disagree, and a loser that re-read a moment too early fell through to
  // generate a fresh code and eventually returned null. Three concurrent
  // callers occasionally came back with two different codes -- meaning a
  // customer could share a link carrying a code their account does not hold.
  //
  // Now there is no such path. Winning is not special-cased: whoever wins, the
  // next pass reads the document and everybody returns the same stored value.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const owner = await collections.owners.findOne(
      { _id: ownerId },
      { projection: { referralCode: 1 } }
    );
    if (!owner) return null;
    if (owner.referralCode) return owner.referralCode;

    try {
      // Conditional on the field still being absent, so two callers racing for
      // the same owner cannot overwrite each other and leave a customer holding
      // a code that no longer resolves. The result is deliberately ignored --
      // the next pass reads what actually landed.
      await collections.owners.updateOne(
        { _id: ownerId, referralCode: { $in: [null, undefined] } },
        { $set: { referralCode: randomCode() } }
      );
    } catch (err) {
      // Code already taken by a DIFFERENT owner. The unique index is the
      // collision handling; loop and draw again.
      if (err?.code !== 11000) throw err;
    }
  }

  return null;
}

/**
 * Resolve a code typed by a buyer into the owner who will be rewarded.
 *
 * Returns `{ ok: false, reason }` rather than throwing, because every rejection
 * here is a normal thing for a buyer to do (mistyped, expired habit, their own
 * code) and none of them should cost anybody a checkout. The caller drops the
 * discount and carries on.
 *
 * `deliveryPhone` is the self-referral check, and it is the one that matters.
 * A guest order has no account to compare, so the phone the parcel is going to
 * is the only identity available: without this, anybody could put their own
 * code into their own guest checkout and take ₹50 off every order while minting
 * themselves a month each time.
 */
export async function resolveReferral(collections, rawCode, { deliveryPhone = null, buyerOwnerId = null } = {}) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code || !CODE_PATTERN.test(code)) return { ok: false, reason: "malformed" };

  const referrer = await collections.owners.findOne(
    { referralCode: code },
    { projection: { _id: 1, mobile: 1, phone: 1, displayName: 1 } }
  );
  if (!referrer) return { ok: false, reason: "unknown" };

  if (buyerOwnerId && String(buyerOwnerId) === String(referrer._id)) {
    return { ok: false, reason: "self" };
  }

  // Compared in E.164 so "9812345678" and "+919812345678" are recognised as one
  // number. Stored formats differ by signup path, and a raw string comparison
  // would let the oldest accounts self-refer.
  const buyerNumber = toE164(deliveryPhone);
  if (buyerNumber) {
    const referrerNumbers = [toE164(referrer.mobile), toE164(referrer.phone)].filter(Boolean);
    if (referrerNumbers.includes(buyerNumber)) return { ok: false, reason: "self" };
  }

  return { ok: true, referrerId: referrer._id, code };
}

const LIVE = { deletedAt: { $in: [null, undefined] } };

/**
 * When this premium tag's paid-for time runs out, in ms, or null when there is
 * nothing a month could be added to.
 *
 * Null for an OPEN-ENDED subscription, deliberately. A comped or grandfathered
 * tag is `status: "active"` with no end date, which subscription.js reads as
 * unlimited. The first version of the reward ignored that case and wrote a
 * dated period over it, so a referral turned "forever" into "thirteen months":
 * the one tag a reward could only ever make worse.
 */
function premiumEndsAt(tag, now) {
  const sub = tag.subscription || tag.callSubscription || tag.documentSubscription;
  const active = hasActiveSubscription(tag, now);
  if (active && (sub.currentPeriodEnd === null || sub.currentPeriodEnd === undefined)) return null;

  const subEnd = active ? new Date(sub.currentPeriodEnd).getTime() : 0;
  const trialEnd = premiumTrialEndsAt(tag, now);
  const ends = Math.max(subEnd || 0, trialEnd ? new Date(trialEnd).getTime() : 0);
  return Number.isFinite(ends) && ends > 0 ? ends : null;
}

// The tag whose premium runs out SOONEST. A month is worth most on the tag
// closest to lapsing, and adding it to a tag with two years left would be a
// reward the referrer never notices.
async function extendableTagFor(collections, ownerId, now) {
  const tags = await collections.tags.find({ ownerId, premium: true, ...LIVE }).toArray();
  return (
    tags
      .map((tag) => ({ tag, ends: premiumEndsAt(tag, now) }))
      .filter((row) => row.ends !== null)
      .sort((a, b) => a.ends - b.ends)[0]?.tag || null
  );
}

/**
 * Add `months` to one tag, atomically. Returns `{ endsAt }`, or null when the
 * tag cannot take them.
 *
 * Conditional on the subscription still being the one that was read. The first
 * version read the tag, worked out the new end date and wrote it back
 * unconditionally, so two friends paying in the same second both read the same
 * start, both wrote the same end, and one of the two months vanished. Here the
 * loser's update matches nothing, and it goes round again on top of the
 * winner's date.
 */
async function extendPremium(collections, tagId, months, now) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tag = await collections.tags.findOne({ _id: tagId, premium: true, ...LIVE });
    if (!tag || premiumEndsAt(tag, now) === null) return null;

    // membershipPeriodStart, not `now`. It is the existing, tested arithmetic
    // that refuses to back-date a new period into a running trial or an active
    // subscription — so a month added to a tag with eight months of trial left
    // lands at month nine, not next week.
    const startsAt = membershipPeriodStart(tag, now);
    const endsAt = new Date(addMonths(startsAt, months)).toISOString();

    const written = await collections.tags.updateOne(
      // `null` matches a subscription that is absent as well as one that is null.
      { _id: tag._id, subscription: tag.subscription ?? null },
      {
        $set: {
          // `subscription` only. The two legacy field names are read by
          // subscription.js but deliberately never written -- writing a third
          // copy of one fact is how they came to disagree in the first place.
          subscription: { status: "active", currentPeriodEnd: endsAt, source: "referral" },
          updatedAt: new Date().toISOString()
        }
      }
    );
    if (written.modifiedCount === 1) return { endsAt };
  }
  return null;
}

function monthsLabel(months) {
  return months === 1 ? "1 month" : `${months} months`;
}

function readableDate(iso) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata"
  });
}

/**
 * The four values the reward message carries, and the number it goes to. Null
 * when the referrer has no number to send it to.
 *
 * Pure, and separate from the send, so what the message says can be held down
 * by a test: external-guard.js refuses every real template send in a test run,
 * which is right, and would otherwise leave this wording checked by nothing.
 */
export function referralRewardMessage({ owner, address = null, order, months, until }) {
  const to = owner && (owner.mobile || owner.phone);
  if (!to) return null;
  return {
    to,
    // Never the raw displayName: see resolveOwnerName.
    name: firstNameOf(resolveOwnerName(owner, address)) || "there",
    // First name only, off the parcel. It is the friend they sent the link to.
    friend: firstNameOf(order?.shippingAddress?.fullName || "") || "A friend",
    reward: monthsLabel(months),
    endsOn: readableDate(until)
  };
}

// Tell the referrer. Until this existed the only sign of a reward was a date
// on the profile card moving by a month, which nobody notices; the template
// (`parktag_referral_reward`, docs/WHATSAPP_TEMPLATES.md 2.7) had been approved
// and was sent by nothing.
//
// Best effort and never awaited by the payment path: the month is already on
// the tag, and a message that cannot be delivered must not be able to delay or
// fail somebody else's purchase.
async function notifyReferralReward(env, collections, { referrerId, order, months, until, log }) {
  try {
    if (!env || !isMetaWhatsappConfigured(env)) return;
    const owner = await collections.owners.findOne({ _id: referrerId });
    const address = collections.addresses
      ? await collections.addresses.findOne({ ownerId: referrerId }).catch(() => null)
      : null;
    const message = referralRewardMessage({ owner, address, order, months, until });
    if (message) await sendMetaWhatsappReferralReward(env, message);
  } catch (err) {
    log?.warn?.({ err, event: "referral-reward-notify-failed", orderId: order?.orderId }, "[referral] reward message not sent");
  }
}

/**
 * Give the referrer their month. Called once, from fulfilPaidOrder, behind the
 * conditional update that decides an order is paid.
 *
 * Best effort and never throws: the buyer's order is already paid and shipping,
 * and a reward that cannot be granted must not turn a successful purchase into
 * a failed request.
 */
export async function grantReferralReward(env, collections, order, log) {
  try {
    const referrerId = order?.referredBy;
    if (!referrerId) return { granted: false, reason: "no-referral" };

    // COD never reaches here (fulfilPaidOrder is the prepaid path), but the
    // check is explicit rather than implied: this function must be safe to call
    // from anywhere that later decides an order is settled.
    if (order.paymentMethod === "cod") return { granted: false, reason: "cod" };

    const since = new Date(Date.now() - REWARD_WINDOW_MS).toISOString();
    const recent = await collections.shopOrders.countDocuments({
      referredBy: referrerId,
      referralRewardedAt: { $gt: since }
    });
    if (recent >= MAX_REWARDS_PER_WINDOW) {
      log?.warn?.(
        { event: "referral-cap-hit", referrerId: String(referrerId), window: recent },
        "[referral] reward cap reached for this referrer, nothing granted"
      );
      return { granted: false, reason: "capped" };
    }

    const now = Date.now();
    const target = await extendableTagFor(collections, referrerId, now);
    const extended = target
      ? await extendPremium(collections, target._id, REFERRAL_REWARD_MONTHS, now)
      : null;
    const rewardedAt = new Date().toISOString();

    if (!extended) {
      // A referrer with no premium tag has nothing to extend. The month is held
      // on the account rather than dropped, and redeemReferralCredit() spends it
      // the first time they have a tag that can take it.
      //
      // The order is stamped here too. It used not to be, which left a held
      // reward invisible to the cap above and to the count on the referral
      // card: earned, and recorded nowhere but a bare number on the account.
      await collections.owners.updateOne(
        { _id: referrerId },
        { $inc: { referralCreditMonths: REFERRAL_REWARD_MONTHS } }
      );
      await collections.shopOrders.updateOne(
        { orderId: order.orderId },
        { $set: { referralRewardedAt: rewardedAt, referralRewardHeld: true } }
      );
      log?.info?.(
        { event: "referral-credit-held", referrerId: String(referrerId) },
        "[referral] referrer has no premium tag, month held as credit"
      );
      return { granted: true, held: true };
    }

    await collections.shopOrders.updateOne(
      { orderId: order.orderId },
      { $set: { referralRewardedAt: rewardedAt, referralRewardTagId: String(target._id) } }
    );

    log?.info?.(
      {
        event: "referral-rewarded",
        referrerId: String(referrerId),
        tagId: String(target._id),
        months: REFERRAL_REWARD_MONTHS,
        until: extended.endsAt
      },
      "[referral] premium extended"
    );

    // Not awaited: see notifyReferralReward. It absorbs its own failures.
    notifyReferralReward(env, collections, {
      referrerId, order, months: REFERRAL_REWARD_MONTHS, until: extended.endsAt, log
    });

    return { granted: true, tagId: String(target._id), until: extended.endsAt };
  } catch (err) {
    log?.error?.({ err, orderId: order?.orderId }, "[referral] reward failed");
    return { granted: false, reason: "error" };
  }
}

/**
 * Spend the months a referrer was holding, now that they have a tag to put
 * them on.
 *
 * grantReferralReward banks a month when the referrer owns no premium tag, and
 * for as long as nothing spent that balance the offer on the card ("you get a
 * month for each friend who buys") was simply untrue for every owner on a free
 * tag: the friend paid, the counter went up, and the month never arrived.
 *
 * Called when the dashboard loads, which is the one place every route to a
 * premium tag ends up (a sticker activated, a free tag upgraded, one issued by
 * an admin), rather than from each of those paths separately.
 *
 * The balance is CLAIMED before it is spent: a conditional update takes it to
 * zero, and only the caller whose update matched goes on to extend the tag.
 * Two dashboard loads at once therefore spend it once. If the extension then
 * fails, the months go back.
 *
 * Never throws. A balance that cannot be spent now is spent on a later visit.
 */
export async function redeemReferralCredit(collections, ownerId, log) {
  try {
    const owner = await collections.owners.findOne(
      { _id: ownerId, referralCreditMonths: { $gte: 1 } },
      { projection: { referralCreditMonths: 1 } }
    );
    const months = Math.trunc(Number(owner?.referralCreditMonths) || 0);
    if (months < 1) return { redeemed: 0 };

    const now = Date.now();
    const target = await extendableTagFor(collections, ownerId, now);
    if (!target) return { redeemed: 0 };

    const claimed = await collections.owners.updateOne(
      { _id: ownerId, referralCreditMonths: owner.referralCreditMonths },
      { $set: { referralCreditMonths: 0 } }
    );
    if (claimed.modifiedCount !== 1) return { redeemed: 0 };

    const extended = await extendPremium(collections, target._id, months, now);
    if (!extended) {
      await collections.owners.updateOne({ _id: ownerId }, { $inc: { referralCreditMonths: months } });
      return { redeemed: 0 };
    }

    log?.info?.(
      { event: "referral-credit-redeemed", referrerId: String(ownerId), tagId: String(target._id), months, until: extended.endsAt },
      "[referral] held months added to a premium tag"
    );
    return { redeemed: months, tagId: String(target._id), until: extended.endsAt };
  } catch (err) {
    log?.error?.({ err, ownerId: String(ownerId) }, "[referral] held credit could not be redeemed");
    return { redeemed: 0 };
  }
}

/**
 * How many of this owner's referrals have been rewarded.
 *
 * Counted from the orders rather than kept as a running total on the account:
 * the orders are the record of what was paid for, and a counter beside them is
 * a second copy that can drift. Served by the `referral_rewards` index.
 */
export async function countReferralRewards(collections, ownerId) {
  return collections.shopOrders.countDocuments({
    referredBy: ownerId,
    referralRewardedAt: { $type: "string" }
  });
}

/**
 * What the referral card says this owner has earned so far.
 *
 * `monthsWaiting` is the balance redeemReferralCredit has not been able to
 * spend yet. It is never more than `monthsEarned`; the Math.max covers months
 * banked before held orders were stamped, which the count cannot see.
 */
export function referralSummary(rewards, creditMonths = 0) {
  const friends = Math.max(0, Math.trunc(Number(rewards) || 0));
  const monthsWaiting = Math.max(0, Math.trunc(Number(creditMonths) || 0));
  return {
    friends,
    monthsEarned: Math.max(friends * REFERRAL_REWARD_MONTHS, monthsWaiting),
    monthsWaiting
  };
}
