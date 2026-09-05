import { PREMIUM_TRIAL_DISPLAY, PREMIUM_TRIAL_LABEL, PREMIUM_TRIAL_MONTHS } from "./vault.js";
import {
  DOCS_PER_ETAG,
  DOCS_PER_PREMIUM_TAG,
  DOCS_PER_SUBSCRIBED_TAG
} from "./vault.js";

// ── Membership plans ───────────────────────────────────────────────────────
//
// What the membership screen shows. Server-side for the same reason
// SHOP_PRODUCTS is: a price the browser authors is a price the browser can
// change. The page renders whatever this returns and computes nothing of its
// own, so there is exactly one place a plan or a saving can be edited.
//
// NOT YET A CHECKOUT. There is no membership SKU in SHOP_PRODUCTS and no
// recurring-billing integration — the shop sells physical tags, one order at a
// time. These are the plans as designed; wiring them to Razorpay needs a
// subscription product and a renewal path that does not exist yet, so the page
// presents them and says so rather than opening a checkout that cannot complete.

// Everything is priced off one monthly rate, so a change to it moves the whole
// ladder and the savings stay true. Rupees, not paise: nothing here is charged
// yet, and the moment it is, the amount must come from the shop catalog in
// paise like every other charge.
const MONTHLY_INR = 49;

// The monthly plan IS the monthly rate — it is not written out a second time.
// Two copies of one number is how a rate change moves the price on the card and
// leaves every saving on the other cards computed against the old one, which
// reads as a pricing bug long before anyone finds the duplicate.
const PLAN_MONTHS = [
  { id: "m1", months: 1, priceInr: MONTHLY_INR },
  { id: "m6", months: 6, priceInr: 149, popular: true },
  { id: "m12", months: 12, priceInr: 249 }
];

// What the server will actually charge, in paise, for a plan the browser named.
//
// The browser sends a plan id and nothing else — never an amount. This is the
// only place a membership price becomes money, for the same reason
// getShopProduct is the only place a product price does.
//
// A .find() over the array rather than an object index, which is what makes it
// prototype-safe for free: SHOP_PRODUCTS had to grow an own-property guard
// because a bare lookup reached "constructor" and "__proto__" and returned
// something truthy with no amount on it, and the NaN that followed wrote a real
// order. An array cannot be reached that way at all.
export function getMembershipPlan(planId) {
  if (typeof planId !== "string") return null;
  return membershipPlans().find((plan) => plan.id === planId) || null;
}

// Paise, because that is the unit Razorpay charges in and the unit every stored
// amount in this codebase is already in. Converting once, here, keeps the
// rounding in one place instead of at each call site.
export function membershipPlanPaise(plan) {
  return Math.round(plan.priceInr * 100);
}

function planLabel(months) {
  return months === 1 ? "1 Month" : `${months} Months`;
}

// Computed, never typed in. A hardcoded "17% OFF" beside a price is a claim
// that silently becomes false the first time either number moves, and a wrong
// saving on a purchase screen is the kind of wrong that matters.
function savingPercent(months, priceInr) {
  const undiscounted = MONTHLY_INR * months;
  if (undiscounted <= priceInr) return 0;
  return Math.round(((undiscounted - priceInr) / undiscounted) * 100);
}

export function membershipPlans() {
  return PLAN_MONTHS.map((plan) => {
    // What the plan works out to per month — the number that actually makes a
    // longer term legible, because "₹249" beside "₹49" reads as five times the
    // price until you do the division yourself.
    //
    // Rounded to whole rupees, and flagged when that rounding lost something.
    // ₹149 over six months is ₹24.83, and printing a flat "₹25/mo" would be a
    // price we do not charge; the flag is what lets the screen write "≈ ₹25/mo"
    // for that one and an exact "₹49/mo" for the monthly plan.
    const exact = plan.priceInr / plan.months;
    const perMonthInr = Math.round(exact);

    return {
      id: plan.id,
      months: plan.months,
      label: planLabel(plan.months),
      priceInr: plan.priceInr,
      perMonthInr,
      perMonthExact: perMonthInr === exact,
      savingPercent: savingPercent(plan.months, plan.priceInr),
      popular: Boolean(plan.popular)
    };
  });
}

// ── Feature grid ───────────────────────────────────────────────────────────
//
// What a membership actually buys. Every entry is something ParkTag does
// today, and the numbers are read from the entitlement constants rather than
// written out again here — a feature list that drifts from what the code
// grants is a promise the product breaks on the first tap.
//
// One flat list, deliberately. There was a tag-type selector above this that
// switched between Parking Tags, E-Tags and All Other Tags, and two of those
// three answers were wrong for a page that sells memberships: the E-Tag column
// listed the FREE tier's limits (one contact, one document), which is what a
// membership is meant to lift, and "All Other Tags" showed the identical set to
// Parking Tags. A control with three positions and one useful answer is a
// control that only costs a tap.
export function membershipFeatures() {
  return [
    { id: "masking", icon: "mask", label: "Call masking service" },
    { id: "unlimited-calls", icon: "phone", label: "Unlimited masked calls" },
    { id: "callback", icon: "callback", label: "Call back missed callers" },
    { id: "geo", icon: "pin", label: "Scanner geo location & IP" },
    { id: "whatsapp", icon: "whatsapp", label: "WhatsApp notifications" },
    { id: "documents", icon: "folder", label: `Store ${DOCS_PER_SUBSCRIBED_TAG} vehicle documents` },
    { id: "vault", icon: "lock", label: "PIN-locked document vault" },
    { id: "sos", icon: "alert", label: "Emergency SOS contact" },
    { id: "multi-vehicle", icon: "car", label: "Add unlimited vehicles" },
    { id: "trial", icon: "gift", label: `${PREMIUM_TRIAL_LABEL} free on activation` }
  ];
}

// The banner above the plans. Reads the trial length from the one constant that
// governs it, so it cannot claim 90 days after the window was widened to a year
// — which is exactly the drift that made the old dashboard copy wrong.
export function membershipTrial() {
  return {
    months: PREMIUM_TRIAL_MONTHS,
    // Split for the capsule, which stacks the numeral over the unit, and joined
    // for prose. Both come from the same derivation so they cannot disagree.
    value: PREMIUM_TRIAL_DISPLAY.value,
    unit: PREMIUM_TRIAL_DISPLAY.unit,
    headline: PREMIUM_TRIAL_LABEL,
    // "premium tag", not "tag": the trial rides on a premium tag, and an owner
    // holding only a free eTag would otherwise read this as a promise to them.
    note: "Auto-active when you activate your premium tag"
  };
}

// What a premium tag grants before any membership is bought, so the screen can
// be honest about what is already included rather than selling it twice.
export function membershipIncluded() {
  return {
    trialMonths: PREMIUM_TRIAL_MONTHS,
    trialLabel: PREMIUM_TRIAL_LABEL,
    docsEtag: DOCS_PER_ETAG,
    docsPremium: DOCS_PER_PREMIUM_TAG,
    docsSubscribed: DOCS_PER_SUBSCRIBED_TAG
  };
}
