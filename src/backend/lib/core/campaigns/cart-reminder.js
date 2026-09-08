// "Your order did not go through." The first campaign, and the proving case for
// the whole scheduler.
//
// A shop order is written with status "created" the moment a Razorpay order is
// opened, and only becomes "paid" when the payment lands. So a row still sitting
// at "created" hours later is a checkout somebody abandoned or a payment that
// failed, and until now nothing anywhere told them.
//
// `parktag_cart_reminder` was created in WhatsApp Manager months ago, approved
// as UTILITY, and has delivered zero messages because no code ever called it.
//
// ── This is MARKETING, and it used not to be ───────────────────────────────
//
// The comment here used to argue that the reminder was honestly utility: it
// names one specific order the customer started and links to finishing it, and
// Meta had approved it as UTILITY. That reasoning is now wrong, and the way it
// went wrong is worth recording.
//
// Editing the footer (EditTree -> ParkTag) sent the template back through
// review, and Meta reclassified it to MARKETING on the way. That was not the
// footer's doing: "finish your order" is an invitation to complete a purchase,
// which is abandoned-cart, which is marketing by Meta's own taxonomy. The
// utility approval was legacy, and re-review simply applied the current rule.
//
// So the campaign now needs consent, and the consequence is deliberate and
// visible: with nothing capturing marketing opt-in yet, this campaign selects
// recipients and sends to NOBODY. That is the correct state for a marketing
// message with no consent record. It starts working the moment opt-in is
// captured at checkout, and not one message before.

import { sendOnce } from "../message-log.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappCartReminder } from "../../integrations/meta.js";
import { firstNameOf } from "../owner-name.js";
import { orderMayReceiveMarketing } from "../messaging-consent.js";

// The window, and why it has BOTH ends.
//
// The lower bound is patience: a customer who is still on the Razorpay sheet
// has not abandoned anything, and messaging them mid-payment is the worst
// possible moment. Three hours is long enough that they have genuinely stopped.
//
// The upper bound is the rule from scheduler.js — a campaign query must be
// bounded, never "older than X". An open-ended query re-matches the same order
// forever and eventually outlives the dedupe row that stops the resend. Six
// hours gives twelve ticks of slack, so a redeploy or a held lease cannot make
// us miss the order, while the dedupe key makes those twelve matches into one
// message.
const MIN_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export const id = "cart-reminder";

export async function run(env, collections, { now, limit, dryRun, log }) {
  if (!isMetaWhatsappConfigured(env)) return { sent: 0, skipped: "not-configured" };

  // ISO strings, not Dates. shopOrders.createdAt is written as an ISO string
  // (routes/shop/index.js), and a Date compared against a string in Mongo
  // matches nothing at all rather than erroring — a query that silently returns
  // empty forever is the failure mode this comment exists to prevent.
  const notBefore = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const notAfter = new Date(now.getTime() - MIN_AGE_MS).toISOString();

  const orders = await collections.shopOrders
    .find({
      status: "created",
      createdAt: { $gte: notBefore, $lte: notAfter }
    })
    .limit(limit)
    .toArray();

  let sent = 0;
  let refusedForConsent = 0;
  const selected = [];

  for (const order of orders) {
    const phone = order?.shippingAddress?.phone;
    // No number, nothing to do. A guest checkout that never reached the address
    // step has no way to be reached at all, which is correct: we know nothing
    // about that person and should not.
    if (!phone) continue;

    // Consent, checked per recipient rather than per campaign.
    //
    // A guest order has no account, so the order carries its own consent stamp;
    // a signed-in buyer's account carries theirs, and an opt-out on the account
    // overrides an older tick on the order. orderMayReceiveMarketing holds both
    // rules so this loop cannot get one of them wrong.
    const owner = order.ownerId
      ? await collections.owners.findOne(
          { _id: order.ownerId },
          { projection: { marketingOptInAt: 1, marketingOptOut: 1, messagingHardStop: 1 } }
        )
      : null;

    if (!orderMayReceiveMarketing(order, owner)) {
      refusedForConsent += 1;
      continue;
    }

    const name = firstNameOf(order?.shippingAddress?.fullName) || "there";
    const product = order.productName || "your ParkTag";

    selected.push({ orderNumber: order.orderNumber, name, product });

    if (dryRun) continue;

    const result = await sendOnce(
      env,
      collections,
      {
        campaign: id,
        // The order id, which is the natural key. Never a timestamp: a key that
        // changes between ticks is not a dedupe key, it is a serial number.
        dedupeKey: `cart:${order.orderId || order._id}`,
        ownerId: order.ownerId || null,
        to: phone,
        channel: "whatsapp",
        templateName: "parktag_cart_reminder",
        send: () =>
          sendMetaWhatsappCartReminder(env, {
            to: phone,
            name,
            product,
            // The template's {{3}} is a bare URL in the body rather than a
            // button, which is how it was approved. /shop is the only page that
            // can restart a checkout; there is no cart to resume.
            url: `${shopUrl(env)}/shop`
          })
      },
      log
    );

    if (result.sent) sent += 1;
  }

  if (dryRun) {
    log?.info?.(
      { campaign: id, wouldSend: selected.length, refusedForConsent, selected },
      "[campaign] dry run"
    );
    // `selected` is returned, not just logged. A dry run exists to be read,
    // and a count alone cannot answer "is it picking the RIGHT people",
    // which is the only question worth asking before a first live tick.
    return { sent: 0, dryRun: true, wouldSend: selected.length, refusedForConsent, selected };
  }

  // refusedForConsent is reported rather than swallowed. While opt-in capture
  // is missing this number IS the campaign, and a silent zero would read as
  // "no abandoned carts" rather than "nobody may be told about theirs".
  return { sent, considered: orders.length, refusedForConsent };
}

// The app, not the landing site. env.appBaseUrl points at the service that
// actually serves /shop; landingBaseUrl is the marketing site and does not.
function shopUrl(env) {
  return String(env.appBaseUrl || "https://app.parktag.me").replace(/\/+$/, "");
}
