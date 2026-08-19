// Razorpay's server-to-server notification that a payment succeeded.
//
// WHY THIS EXISTS. Until now the only thing that could mark an order paid was
// POST /api/shop/verify-payment, called by the buyer's browser from Razorpay's
// success handler. That makes fulfilment depend on the customer's device
// staying alive and online for one more request after their money has already
// left. Close the tab on the confirmation, walk into a lift, let the phone
// sleep — Razorpay captured the payment and this app never heard about it. The
// order sat at "created": no tag minted, no shipment booked, no confirmation
// e-mail, and nothing server-side aware that anything was owed. Returning to
// checkout then offered to charge them again.
//
// Razorpay retries this callback, so it closes that window without depending on
// the customer at all.
//
// AUTHENTICATION. The body is signed with the WEBHOOK secret — a different
// secret from the API key secret used for checkout signatures, configured
// alongside the endpoint in the Razorpay dashboard. It is an HMAC-SHA256 over
// the exact bytes received, which is why this reads `request.rawBody` (stashed
// by the JSON parser in app.js) rather than re-serialising the parsed object:
// key order and whitespace would not survive a round trip and the digest would
// not match.
//
// Without that check this endpoint would be a way for anyone who finds the URL
// to mark arbitrary orders paid and have real stock shipped for free, so it
// fails CLOSED — no secret configured means no webhook is accepted.
import crypto from "node:crypto";

import { getCollections } from "../../lib/db/repositories.js";
import { fulfilPaidOrder } from "../../lib/core/order-fulfilment.js";

// Events that mean "the money for this order is captured". `order.paid` fires
// once an order is fully paid, which is the state fulfilment cares about;
// `payment.captured` is accepted too because an account can be subscribed to
// one, the other, or both, and handling either keeps this working whichever the
// dashboard is set to send.
const PAID_EVENTS = new Set(["order.paid", "payment.captured"]);

export function verifyRazorpayWebhookSignature(secret, rawBody, signature) {
  if (!secret || !rawBody || typeof signature !== "string" || !signature) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // Length-check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and the length of a digest is not a secret.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Pull the Razorpay order id out of whichever event shape arrived.
function orderIdFrom(payload) {
  const entities = payload && payload.payload;
  if (!entities) return null;
  return (
    entities.order?.entity?.id ||
    entities.payment?.entity?.order_id ||
    null
  );
}

function paymentIdFrom(payload) {
  return payload?.payload?.payment?.entity?.id || null;
}

export function registerRazorpayWebhookRoutes(app, env) {
  // Say so at boot. An unconfigured secret does not break checkout — the browser
  // callback still fulfils the ordinary case — but it silently leaves the gap
  // this endpoint exists to close, and the symptom is a customer who paid and
  // received nothing. That is not something to discover from a support ticket.
  //
  // A warning rather than a refusal to boot, deliberately: the other webhook
  // secrets are hard-required in production because without them their
  // endpoints accept FORGED traffic, which is worse than being down. This one
  // fails closed on its own, so a missing secret costs reconciliation, not
  // safety — and taking the whole site down over it would be the larger outage.
  // Promote it to REQUIRED_IN_PRODUCTION once it is set in the environment.
  if (!env.razorpayWebhookSecret) {
    const message =
      "[razorpay webhook] RAZORPAY_WEBHOOK_SECRET is not configured — " +
      "/api/provider/razorpay/webhook will refuse every callback. A payment whose " +
      "buyer closed the tab before the confirmation request will NOT be fulfilled.";

    if (env.runtimeMode === "production") {
      app.log.warn(message);
    } else {
      app.log.info(`${message} (expected outside production)`);
    }
  }

  app.post("/api/provider/razorpay/webhook", async (request, reply) => {
    // Fail closed. An unauthenticated caller here could mark any order paid.
    if (!env.razorpayWebhookSecret) {
      request.log.error(
        "[razorpay webhook] RAZORPAY_WEBHOOK_SECRET is not configured — refusing the callback. " +
          "Paid orders will NOT be fulfilled until it is set."
      );
      reply.code(503);
      return { ok: false, error: "Webhook not configured" };
    }

    const signature = request.headers["x-razorpay-signature"];
    if (!verifyRazorpayWebhookSignature(env.razorpayWebhookSecret, request.rawBody, signature)) {
      request.log.warn(
        { event: "razorpay-webhook-bad-signature" },
        "[razorpay webhook] rejected a callback whose signature did not verify"
      );
      reply.code(401);
      return { ok: false, error: "Invalid signature" };
    }

    const body = request.body || {};
    const event = String(body.event || "");

    // Anything else — refunds, failures, settlement notifications — is
    // acknowledged and ignored. A non-2xx would make Razorpay retry an event
    // this app has no handler for, forever.
    if (!PAID_EVENTS.has(event)) {
      return { ok: true, ignored: event || "unknown" };
    }

    const orderId = orderIdFrom(body);
    const paymentId = paymentIdFrom(body);
    if (!orderId) {
      request.log.warn({ event }, "[razorpay webhook] paid event carried no order id");
      return { ok: true, ignored: "no-order-id" };
    }

    const collections = await getCollections(env);
    if (!collections) {
      // 500 so Razorpay retries: the payment is real and the order still needs
      // fulfilling, so this must not be acknowledged as handled.
      request.log.error({ orderId }, "[razorpay webhook] no database — asking for a retry");
      reply.code(500);
      return { ok: false, error: "Database unavailable" };
    }

    const order = await collections.shopOrders.findOne({ orderId });
    if (!order) {
      // Not one of ours, or the row was never written. Acknowledged rather than
      // retried — no amount of retrying will make it appear.
      request.log.warn({ orderId }, "[razorpay webhook] no matching order");
      return { ok: true, ignored: "unknown-order" };
    }

    // Deliberately NOT re-checking the amount against the catalog the way
    // verify-payment does. That check exists there to reject an order the
    // browser presents; here Razorpay is telling us what it actually captured
    // for an order this server created, and refusing it would leave a genuinely
    // paid order unfulfilled — the exact failure this endpoint exists to stop.
    // A price that has moved since the order was created is a reconciliation
    // question for the dashboard, not a reason to withhold someone's goods.
    const outcome = await fulfilPaidOrder(env, collections, {
      order,
      paymentId: paymentId || order.paymentId || null,
      log: request.log
    });

    if (outcome.firstTime) {
      request.log.info(
        { event: "razorpay-webhook-fulfilled", orderId, orderNumber: order.orderNumber },
        "[razorpay webhook] fulfilled an order the browser never confirmed"
      );
    }

    return { ok: true, fulfilled: outcome.firstTime };
  });
}
