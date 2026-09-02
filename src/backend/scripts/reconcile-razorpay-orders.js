// Find online orders that Razorpay captured but this app never fulfilled, and
// fulfil them.
//
// WHY THIS EXISTS. Two things can mark an online order paid: the buyer's
// browser calling POST /api/shop/verify-payment from Razorpay's success
// handler, and Razorpay's own webhook. The browser path depends on the
// customer's device surviving one more request after their money has already
// left — close the tab, walk into a lift, let the phone sleep, and it never
// arrives. The webhook exists to close that window, but it fails closed: with
// RAZORPAY_WEBHOOK_SECRET unset it refuses every callback, because the
// alternative is an unauthenticated endpoint that marks arbitrary orders paid.
//
// So while that secret is missing, BOTH paths can miss, and the order sits at
// "created" forever: no tag minted, no shipment booked, no confirmation e-mail,
// and nothing server-side aware that anything is owed. Setting the secret stops
// the bleeding. It does nothing for the orders already stranded, because
// Razorpay's retries have long since given up. This finds those.
//
// It is also worth keeping after the webhook is healthy. A webhook can be
// misconfigured, disabled in the dashboard, or fail for a stretch, and a
// scheduled dry run is how that gets noticed from the accounts rather than from
// a support ticket.
//
//   node src/backend/scripts/reconcile-razorpay-orders.js              # dry run
//   node src/backend/scripts/reconcile-razorpay-orders.js --apply      # fulfil
//   ... --since-days=90 --grace-minutes=15 --limit=500
//
// Re-running is safe. fulfilPaidOrder gates on a conditional update from
// status "created" to "paid", so a second pass over an order the first pass
// already handled does nothing at all.

import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { fulfilPaidOrder } from "../lib/core/order-fulfilment.js";
import { getRazorpay, isRazorpayConfigured } from "../lib/integrations/payments.js";
import { getEnv } from "../lib/env.js";

const apply = process.argv.includes("--apply");

function numericFlag(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// How far back to look. Razorpay keeps orders indefinitely; the limit here is
// about not walking the whole table every run.
const sinceDays = numericFlag("since-days", 90);
// Orders younger than this are skipped: a checkout in progress is legitimately
// at "created", and a buyer still on the Razorpay page has not abandoned
// anything. Fulfilling underneath them would race the browser callback — which
// is harmless, because fulfilPaidOrder is idempotent, but it would also mean
// this script reports "recovered" for orders nothing was ever wrong with.
const graceMinutes = numericFlag("grace-minutes", 15);
const limit = numericFlag("limit", 500);

// The decision, separated from the network and the database so it can be tested
// against fixtures rather than against Razorpay.
//
// `rzpOrder` is what GET /orders/:id returns; `payments` is the items array
// from GET /orders/:id/payments.
export function classifyOrder(rzpOrder, payments) {
  if (!rzpOrder) return { action: "skip", reason: "not-found-at-razorpay" };

  const captured = (payments || []).filter((p) => p && p.status === "captured");

  // The ordinary recoverable case: Razorpay considers the order fully paid and
  // there is a captured payment to attribute it to.
  if (rzpOrder.status === "paid" && captured.length > 0) {
    return {
      action: "fulfil",
      // Newest captured payment, in the odd case of more than one.
      paymentId: captured[captured.length - 1].id,
      amountPaid: rzpOrder.amount_paid,
      reason: "paid-and-captured"
    };
  }

  // Paid according to the order, but no captured payment came back. Do not
  // guess a payment id — an order marked paid with nothing to attribute it to
  // is exactly the kind of thing a person should look at.
  if (rzpOrder.status === "paid") {
    return { action: "review", reason: "paid-but-no-captured-payment" };
  }

  // Money has moved but the order is not settled: a partial payment, or a
  // capture still in flight. Fulfilling on a part-payment would ship goods for
  // less than they cost, so this is flagged, never actioned.
  if (Number(rzpOrder.amount_paid) > 0) {
    return {
      action: "review",
      reason: `partial-payment (${rzpOrder.amount_paid} of ${rzpOrder.amount} paise)`
    };
  }

  // A captured payment against an order Razorpay does not consider paid. Rare,
  // and again a question rather than an answer.
  if (captured.length > 0) {
    return { action: "review", reason: `captured-payment-on-${rzpOrder.status}-order` };
  }

  return { action: "skip", reason: `unpaid (${rzpOrder.status})` };
}

// Razorpay's API is rate limited and this walks it one order at a time.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const env = getEnv();

  if (!isRazorpayConfigured(env)) {
    throw new Error("Razorpay is not configured — RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.");
  }

  const collections = await getCollections(env);
  if (!collections) throw new Error("No database connection — check MONGODB_URI.");

  // Say out loud what is about to be touched, before touching it. This script
  // reads live payment records and, with --apply, mints tags and books
  // shipments; running it against the wrong environment by accident is the
  // failure worth designing against.
  console.log("");
  console.log(`  mode      ${apply ? "APPLY — will fulfil orders" : "dry run — no writes"}`);
  console.log(`  database  ${env.mongoDbName}`);
  console.log(`  prefix    ${process.env.MONGODB_COLLECTION_PREFIX || "(none)"}`);
  console.log(`  runtime   ${env.runtimeMode}`);
  console.log(`  razorpay  ${String(env.razorpayKeyId).slice(0, 12)}…`);
  console.log(`  window    orders from the last ${sinceDays} days, older than ${graceMinutes} min`);
  console.log("");

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const graceCutoff = new Date(Date.now() - graceMinutes * 60 * 1000).toISOString();

  // COD orders are excluded: they have no Razorpay order to ask about, and
  // "created" is a normal resting state for one.
  const stranded = await collections.shopOrders
    .find({
      paymentMethod: "online",
      status: "created",
      orderId: { $exists: true, $ne: null },
      createdAt: { $gte: since, $lte: graceCutoff }
    })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();

  if (!stranded.length) {
    console.log("No online orders are sitting at 'created' in that window.");
    return;
  }

  console.log(`${stranded.length} order(s) at 'created' — asking Razorpay about each.\n`);

  const rzp = getRazorpay(env);
  const recovered = [];
  const review = [];
  const unpaid = [];
  const errors = [];

  for (const order of stranded) {
    let verdict;

    try {
      const rzpOrder = await rzp.orders.fetch(order.orderId);
      const payments = await rzp.orders.fetchPayments(order.orderId);
      verdict = classifyOrder(rzpOrder, payments && payments.items);
    } catch (error) {
      // One unreachable order must not abandon the rest of the run — the whole
      // point is to work through a backlog.
      errors.push({ order, message: error && error.message ? error.message : String(error) });
      continue;
    }

    const label = `${order.orderNumber || "(no number)"}  ${order.orderId}  ₹${(order.amount / 100).toFixed(2)}  ${order.createdAt}`;

    if (verdict.action === "fulfil") {
      recovered.push({ order, verdict });
      console.log(`  PAID, unfulfilled   ${label}  payment=${verdict.paymentId}`);

      if (apply) {
        const outcome = await fulfilPaidOrder(env, collections, {
          order,
          paymentId: verdict.paymentId,
          log: console
        });
        console.log(`                      ${outcome.firstTime ? "fulfilled" : "already fulfilled by someone else"}`);
      }
    } else if (verdict.action === "review") {
      review.push({ order, verdict });
      console.log(`  NEEDS A LOOK        ${label}  ${verdict.reason}`);
    } else {
      unpaid.push({ order, verdict });
    }

    await pause(120);
  }

  console.log("");
  console.log(`  paid but unfulfilled  ${recovered.length}${apply ? " (fulfilled)" : ""}`);
  console.log(`  needs a look          ${review.length}`);
  console.log(`  genuinely unpaid      ${unpaid.length}`);
  if (errors.length) console.log(`  could not be checked  ${errors.length}`);

  for (const { order, message } of errors) {
    console.log(`    ! ${order.orderId}: ${message}`);
  }

  if (recovered.length && !apply) {
    console.log("");
    console.log("Dry run. Re-run with --apply to fulfil these.");
  }
}

// Only run when invoked directly, so the exported classifier can be imported by
// a test without the script connecting to anything.
if (process.argv[1] && process.argv[1].endsWith("reconcile-razorpay-orders.js")) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => closeMongoConnection());
}
