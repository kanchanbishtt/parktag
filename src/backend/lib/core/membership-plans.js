import { PREMIUM_TRIAL_DAYS } from "./vault.js";
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
// Every entry is something ParkTag actually does today, and the numbers are
// read from the entitlement constants rather than written out again here — a
// feature list that drifts from what the code grants is a promise the product
// breaks on the first tap.
//
// `scope` is which tag the line applies to, which is what the selector above
// the grid switches between. The tiers genuinely differ: an E-Tag gets one
// contact and one document, a premium tag gets masking and three, a membership
// lifts that to ten.
const SCOPE_ALL = "all";
const SCOPE_PARKING = "parking";
const SCOPE_ETAG = "etag";

export const MEMBERSHIP_SCOPES = [
  { id: SCOPE_PARKING, label: "Parking Tags" },
  { id: SCOPE_ETAG, label: "E-Tags" },
  { id: SCOPE_ALL, label: "All Other Tags" }
];

export function membershipFeatures() {
  return [
    {
      id: "masking",
      icon: "mask",
      label: "Call masking service",
      scopes: [SCOPE_PARKING, SCOPE_ALL]
    },
    {
      id: "unlimited-calls",
      icon: "phone",
      label: "Unlimited masked calls",
      scopes: [SCOPE_PARKING, SCOPE_ALL]
    },
    {
      id: "callback",
      icon: "callback",
      label: "Call back missed callers",
      scopes: [SCOPE_PARKING, SCOPE_ALL]
    },
    {
      id: "geo",
      icon: "pin",
      label: "Scanner geo location & IP",
      scopes: [SCOPE_PARKING, SCOPE_ETAG, SCOPE_ALL]
    },
    {
      id: "whatsapp",
      icon: "whatsapp",
      label: "WhatsApp notifications",
      scopes: [SCOPE_PARKING, SCOPE_ETAG, SCOPE_ALL]
    },
    {
      id: "documents",
      icon: "folder",
      label: `Store ${DOCS_PER_SUBSCRIBED_TAG} vehicle documents`,
      scopes: [SCOPE_PARKING, SCOPE_ALL]
    },
    {
      id: "etag-documents",
      icon: "folder",
      label: `E-Tag keeps ${DOCS_PER_ETAG} document`,
      scopes: [SCOPE_ETAG]
    },
    {
      id: "etag-contact",
      icon: "phone",
      label: "One free contact per E-Tag",
      scopes: [SCOPE_ETAG]
    },
    {
      id: "vault",
      icon: "lock",
      label: "PIN-locked document vault",
      scopes: [SCOPE_PARKING, SCOPE_ETAG, SCOPE_ALL]
    },
    {
      id: "sos",
      icon: "alert",
      label: "Emergency SOS contact",
      scopes: [SCOPE_PARKING, SCOPE_ALL]
    },
    {
      id: "multi-vehicle",
      icon: "car",
      label: "Add unlimited vehicles",
      scopes: [SCOPE_PARKING, SCOPE_ETAG, SCOPE_ALL]
    },
    {
      id: "trial",
      icon: "gift",
      label: `${PREMIUM_TRIAL_DAYS} days free on activation`,
      scopes: [SCOPE_PARKING, SCOPE_ALL]
    }
  ];
}

// The banner above the plans. Reads the trial length from the one constant that
// governs it, so it cannot claim 45 days after the window was widened to 90 —
// which is exactly the drift that made the old dashboard copy wrong.
export function membershipTrial() {
  return {
    days: PREMIUM_TRIAL_DAYS,
    headline: `${PREMIUM_TRIAL_DAYS} Days`,
    note: "Auto-active when you activate your tag"
  };
}

// What a premium tag grants before any membership is bought, so the screen can
// be honest about what is already included rather than selling it twice.
export function membershipIncluded() {
  return {
    trialDays: PREMIUM_TRIAL_DAYS,
    docsEtag: DOCS_PER_ETAG,
    docsPremium: DOCS_PER_PREMIUM_TAG,
    docsSubscribed: DOCS_PER_SUBSCRIBED_TAG
  };
}
