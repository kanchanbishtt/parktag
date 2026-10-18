// Create the recurring Razorpay PLANS that auto-renew subscribes against, once.
//
//   npm run subscriptions:create-plans
//
// A Razorpay Subscription points at a Plan, and the Plan is where the price and
// the billing cycle live — which is why no amount is in subscription-plans.js.
// This script is the one place those prices are set, mirroring the prepaid
// ladder (₹49/month, ₹249/year). It PRINTS the new plan ids; put them in env as
// RAZORPAY_SUB_PLAN_MONTHLY / RAZORPAY_SUB_PLAN_ANNUAL, then set
// SUBSCRIPTIONS_ENABLED=1 once you have taken one test-mode subscription all the
// way through a charge.
//
// Run against TEST keys first (rzp_test_...). Creating a plan is not free to
// undo — Razorpay plans cannot be deleted, only unused — so this refuses to
// re-create a plan whose id is already in env unless you pass --force.

import { getEnv } from "../lib/env.js";
import { getRazorpay } from "../lib/integrations/payments.js";

// The auto-renew prices, in paise. Deliberately the same two anchor points as
// the prepaid plans (membership-plans.js): a monthly entry and a yearly one that
// is the better deal. Six-month auto-renew is intentionally omitted — a mandate
// is a commitment, so the choice is "pay-as-you-go monthly" or "cheapest yearly".
const PLANS = [
  { envKey: "RAZORPAY_SUB_PLAN_MONTHLY", period: "monthly", interval: 1, amount: 4900, name: "ParkTag Premium (Monthly)" },
  { envKey: "RAZORPAY_SUB_PLAN_ANNUAL", period: "yearly", interval: 1, amount: 24900, name: "ParkTag Premium (Yearly)" }
];

async function main() {
  const env = getEnv();
  const rzp = getRazorpay(env);
  if (!rzp) throw new Error("Razorpay is not configured — set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.");

  const force = process.argv.includes("--force");
  const live = String(env.razorpayKeyId || "").startsWith("rzp_live_");
  if (live && !process.argv.includes("--live")) {
    throw new Error("Refusing to create plans on LIVE keys without --live. Use test keys (rzp_test_...) first.");
  }

  const results = [];
  for (const plan of PLANS) {
    const existing = process.env[plan.envKey];
    if (existing && !force) {
      console.log(`${plan.envKey} already set to ${existing} — skipping (pass --force to create anyway).`);
      continue;
    }
    const created = await rzp.plans.create({
      period: plan.period,
      interval: plan.interval,
      item: { name: plan.name, amount: plan.amount, currency: "INR" }
    });
    results.push({ envKey: plan.envKey, id: created.id, amount: plan.amount, period: plan.period });
    console.log(`Created ${plan.name}: ${created.id}`);
  }

  if (results.length) {
    console.log("\nAdd these to your environment:");
    for (const r of results) console.log(`${r.envKey}=${r.id}`);
    console.log("\nThen, after a successful TEST-mode subscription + charge, set SUBSCRIPTIONS_ENABLED=1.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[subscriptions:create-plans]", err?.message || err);
    process.exit(1);
  });
