// The auto-renew plans the subscribe endpoint will open, and the ONLY place a
// plan key becomes a real Razorpay plan id. The browser sends a key ("monthly"
// or "annual") and never an amount or a plan id: the price lives in the Razorpay
// PLAN entity (created by scripts/create-subscription-plans.js), and the id of
// that plan lives in env. This mirrors getMembershipPlan / getShopProduct — a
// price or a plan id the browser can author is one it can change.
//
// `.find()` over an array, not an object index, so a key like "constructor" or
// "__proto__" cannot reach a truthy non-plan — the same prototype-safety
// getMembershipPlan and getShopProduct rely on.

// total_count is how many cycles Razorpay will attempt before it marks the
// subscription `completed`. The API requires a number, so a long horizon stands
// in for "until the customer cancels" rather than pretending an unbounded
// mandate exists: 120 monthly cycles and 10 annual cycles are both ten years,
// beyond any realistic tag life, and a customer who somehow reaches the end is
// re-offered rather than silently dropped.
const PLANS = [
  { key: "monthly", months: 1, totalCount: 120, label: "Monthly (auto-renew)", envKey: "razorpaySubPlanMonthly" },
  { key: "annual", months: 12, totalCount: 10, label: "Yearly (auto-renew)", envKey: "razorpaySubPlanAnnual" }
];

// Resolve a plan key to its live Razorpay plan id from env. Returns null when
// the key is unknown OR its plan id is not configured, so the caller treats an
// unconfigured plan exactly like an unknown one: no subscription is opened.
export function getSubscriptionPlan(env, planKey) {
  if (typeof planKey !== "string") return null;
  const plan = PLANS.find((p) => p.key === planKey);
  if (!plan) return null;
  const razorpayPlanId = env && env[plan.envKey];
  if (!razorpayPlanId) return null;
  return {
    key: plan.key,
    months: plan.months,
    totalCount: plan.totalCount,
    label: plan.label,
    razorpayPlanId
  };
}

// The keys whose plan id is configured, for the membership screen to show only
// the auto-renew options that can actually be opened.
export function availableSubscriptionPlanKeys(env) {
  return PLANS.filter((p) => env && env[p.envKey]).map((p) => p.key);
}
