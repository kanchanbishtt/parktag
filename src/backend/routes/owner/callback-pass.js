import { requireSession, toObjectId, tryObjectId } from "../../lib/auth/auth.js";
import { getCollections, ensurePendingCallsIndexes } from "../../lib/db/repositories.js";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  verifyRazorpaySignature
} from "../../lib/integrations/payments.js";
import {
  CALLBACK_PASS_PAISE,
  CALLBACK_PASS_SPENT_MESSAGE,
  callbackPassState,
  canPurchaseCallbackPass,
  PASS_PURCHASABLE,
  PASS_READY,
  PASS_SPENT
} from "../../lib/core/callback-pass.js";
import { registerOwnerToScannerCall } from "../../lib/core/pending-call.js";
import { CALLBACK_WINDOW_MS } from "./dashboard.js";

// Selling one callback to an E-Tag.
//
// Two routes, and the second one does more than its name suggests: it verifies
// the payment AND registers the call, in one request, returning the number to
// dial. That is deliberate and it is the point of the feature.
//
// The alternative — verify, respond, let the page call register-call — puts a
// second round trip between the owner's money and their phone ringing, at the
// exact moment they are watching a ten-minute clock they just paid to beat. It
// also opens a gap where the payment succeeded and the follow-up did not, which
// is the one failure this design must not have: a charge with no call.
//
// So the dial is registered inside the same handler that verifies the
// signature. Verification is a local HMAC (no network), the pass write and the
// bridge insert are two indexed writes, and nothing here calls Razorpay's API
// or Exotel's. An owner taps Pay and gets a number back.
export function registerCallbackPassRoutes(app, env) {
  // Mint a ₹20 order for one contact.
  app.post(
    "/api/owner/callback/create-order",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;
      const ownerId = toObjectId(request.session.userId);

      if (!isRazorpayConfigured(env)) {
        reply.code(500);
        return { ok: false, error: "Payments are not configured." };
      }

      // A pass is bought against ONE contact, so the id is required here —
      // unlike register-call, which falls back to the most recent. There is no
      // sensible default for "which stranger am I paying to ring".
      const { requestId } = request.body || {};
      const wanted = tryObjectId(requestId);
      if (!wanted) {
        reply.code(400);
        return { ok: false, error: "Invalid request id." };
      }

      const collections = await getCollections(env);
      if (!collections) { reply.code(500); return { ok: false, error: "Database unavailable." }; }

      // Scoped to the signed-in owner, never looked up by id alone: an
      // ObjectId is client-supplied, and resolving one without the ownership
      // filter would let anyone with a session buy a call to a scanner who
      // contacted somebody else's tag.
      const contact = await collections.contactRequests.findOne({ _id: wanted, ownerId });
      if (!contact) { reply.code(404); return { ok: false, error: "Contact not found." }; }

      if (!contact.phone) {
        reply.code(400);
        return { ok: false, code: "NO_NUMBER", error: "This person did not leave a number." };
      }

      const owner = await collections.owners.findOne({ _id: ownerId });
      if (!owner?.mobile) {
        // Checked BEFORE taking money, not after. register-call refuses without
        // a profile number, so selling a pass to an owner who has not saved one
        // would be charging for a call that cannot be placed.
        reply.code(402);
        return { ok: false, code: "NO_PHONE", error: "Add your phone number to enable callback." };
      }

      const tag = await collections.tags.findOne({
        ownerId,
        token: contact.token,
        deletedAt: { $in: [null, undefined] }
      });
      if (!tag) { reply.code(404); return { ok: false, error: "Vehicle not found." }; }

      // A premium tag must not be sold this. Its callback is already included,
      // and charging ₹20 for something the owner has paid for once would be
      // indefensible however the page came to offer it.
      if (tag.premium) {
        reply.code(400);
        return { ok: false, code: "NOT_APPLICABLE", error: "Callback is already included on this vehicle." };
      }

      const state = callbackPassState(tag);
      if (state === PASS_READY) {
        reply.code(409);
        return { ok: false, code: "PASS_ALREADY_PAID", error: "You've already paid for this callback." };
      }
      if (state === PASS_SPENT) {
        reply.code(402);
        return { ok: false, code: "PASS_SPENT", error: CALLBACK_PASS_SPENT_MESSAGE };
      }

      // The pre-gate. Re-checked here and not merely drawn in the page: the
      // button is hidden under three minutes, but a stale tab still holds one.
      if (!canPurchaseCallbackPass(tag, {
        contactCreatedAt: contact.createdAt,
        freeWindowMs: CALLBACK_WINDOW_MS
      })) {
        reply.code(410);
        return {
          ok: false,
          code: "CALLBACK_WINDOW_EXPIRED",
          error: "The callback window for this contact has passed."
        };
      }

      // Hand back an order the owner already started rather than minting a
      // second one. Tapping Pay twice, or reloading mid-checkout, otherwise
      // leaves two live order ids for one intended purchase — both payable,
      // which on a ₹20 product means being charged ₹40 for one call. The same
      // rule the shop and membership checkouts follow, and it matters more
      // here because the window makes people tap twice.
      const reusable = await collections.callbackOrders.findOne(
        { ownerId, status: "created", requestId: contact._id, amount: CALLBACK_PASS_PAISE },
        { sort: { createdAt: -1 } }
      );

      if (reusable) {
        return {
          ok: true,
          orderId: reusable.orderId,
          amount: reusable.amount,
          currency: reusable.currency,
          keyId: env.razorpayKeyId,
          prefill: { name: owner.displayName || "", contact: owner.mobile || "" }
        };
      }

      try {
        const order = await createRazorpayOrder(env, {
          // In rupees: createRazorpayOrder multiplies by 100. The stored and
          // re-checked figure is the paise constant.
          amount: CALLBACK_PASS_PAISE / 100,
          receipt: `ptcb_${String(contact._id)}`,
          notes: { kind: "callback-pass", token: contact.token, requestId: String(contact._id) }
        });

        await collections.callbackOrders.insertOne({
          orderId: order.id,
          ownerId,
          tagId: tag._id,
          token: contact.token,
          requestId: contact._id,
          amount: order.amount,
          currency: order.currency,
          status: "created",
          createdAt: new Date().toISOString()
        });

        return {
          ok: true,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: env.razorpayKeyId,
          prefill: { name: owner.displayName || "", contact: owner.mobile || "" }
        };
      } catch (err) {
        request.log.error({ err }, "[callback pass] Razorpay order creation failed");
        reply.code(500);
        return { ok: false, error: "Couldn't start the payment. Please try again." };
      }
    }
  );

  // Confirm the ₹20 and place the call in the same breath.
  app.post(
    "/api/owner/callback/verify-payment",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;
      const ownerId = toObjectId(request.session.userId);

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = request.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        reply.code(400);
        return { ok: false, error: "Missing payment fields." };
      }
      if (!isRazorpayConfigured(env)) {
        reply.code(500);
        return { ok: false, error: "Payments are not configured." };
      }

      const valid = verifyRazorpaySignature(env, {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });
      if (!valid) { reply.code(400); return { ok: false, error: "Payment verification failed." }; }

      const collections = await getCollections(env);
      if (!collections) {
        // "Cannot check" must not resolve to "checked out fine" — and here it
        // must not resolve to "call placed" either. The money is already taken
        // at this point, so this is logged loudly rather than swallowed.
        request.log.error({ orderId: razorpay_order_id }, "[callback pass] verify reached with no database");
        reply.code(500);
        return { ok: false, error: "Could not confirm your payment. Please contact support." };
      }

      const order = await collections.callbackOrders.findOne({ orderId: razorpay_order_id });
      if (!order) { reply.code(400); return { ok: false, error: "No matching order." }; }

      // Razorpay order ids are not secret — its checkout will complete a
      // payment for any id you know — so a signature valid for someone else's
      // order would otherwise be honoured for whoever is merely signed in.
      if (String(order.ownerId) !== String(ownerId)) {
        reply.code(403);
        return { ok: false, error: "This order does not belong to your account." };
      }

      // The signature proves the payment matches the order. It says nothing
      // about the amount, so the price is re-checked against the constant.
      if (order.amount !== CALLBACK_PASS_PAISE) {
        reply.code(400);
        return { ok: false, error: "Order amount mismatch." };
      }

      const now = new Date();

      // Stamp the pass, once.
      //
      // Guarded on the pass being absent so a replayed verify — the same
      // signature posted twice by a double-tapped handler, or a webhook that
      // arrives alongside it — cannot overwrite a pass that has since been
      // USED and hand the owner a second free dial off one payment.
      const claimed = await collections.tags.findOneAndUpdate(
        {
          _id: order.tagId,
          ownerId,
          premium: { $ne: true },
          "callbackPass.paidAt": { $in: [null, undefined] }
        },
        {
          $set: {
            callbackPass: {
              orderId: order.orderId,
              requestId: order.requestId,
              paidAt: now.toISOString(),
              usedAt: null
            },
            updatedAt: now.toISOString()
          }
        },
        { returnDocument: "after" }
      );

      await collections.callbackOrders.updateOne(
        { orderId: order.orderId, status: { $ne: "paid" } },
        { $set: { status: "paid", paymentId: razorpay_payment_id, paidAt: now.toISOString() } }
      );

      // `claimed` is null when a pass was already on the tag — this payment is
      // a duplicate, or the webhook beat the browser here. Not an error: the
      // owner paid and is entitled to a call, so fall through to the tag as it
      // stands and let the dial below decide.
      const tag = claimed || (await collections.tags.findOne({ _id: order.tagId, ownerId }));

      if (callbackPassState(tag) !== PASS_READY) {
        // Spent already. Says so plainly rather than reporting success for a
        // call that will not happen.
        reply.code(409);
        return { ok: false, code: "PASS_SPENT", error: CALLBACK_PASS_SPENT_MESSAGE };
      }

      // Now place it.
      if (!env.exotelCallerId) {
        // Paid, but the call service is down. The pass stays UNUSED, so the
        // owner keeps what they bought and the row will still offer the dial.
        request.log.error({ orderId: order.orderId }, "[callback pass] paid with no caller id configured");
        reply.code(503);
        return { ok: false, code: "CALL_UNAVAILABLE", error: "Payment received. The call service is unavailable — please try the call button in a moment." };
      }

      const contact = await collections.contactRequests.findOne({ _id: order.requestId, ownerId });
      if (!contact?.phone) {
        request.log.error({ orderId: order.orderId }, "[callback pass] paid for a contact that has no number");
        reply.code(410);
        return { ok: false, code: "CONTACT_GONE", error: "Payment received, but this contact is no longer available." };
      }

      const owner = await collections.owners.findOne({ _id: ownerId });
      if (!owner?.mobile) {
        reply.code(402);
        return { ok: false, code: "NO_PHONE", error: "Payment received. Add your mobile number to place the call." };
      }

      await ensurePendingCallsIndexes(collections);
      await registerOwnerToScannerCall(collections, {
        ownerPhone: owner.mobile,
        contact,
        ownerId,
        now
      });

      // Spent by the dial, not by the payment — the same rule register-call
      // follows, written the same guarded way so whichever path gets there
      // first is the one that consumes it.
      await collections.tags.updateOne(
        { _id: order.tagId, "callbackPass.usedAt": { $in: [null, undefined] } },
        { $set: { "callbackPass.usedAt": now.toISOString(), updatedAt: now.toISOString() } }
      );

      return { ok: true, virtualNumber: env.exotelCallerId };
    }
  );
}
