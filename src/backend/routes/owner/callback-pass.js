import { requireSession, toObjectId, tryObjectId } from "../../lib/auth/auth.js";
import { getCollections, ensurePendingCallsIndexes } from "../../lib/db/repositories.js";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  verifyRazorpaySignature
} from "../../lib/integrations/payments.js";
import { callEntitlement } from "../../lib/core/call-access.js";
import {
  CALLBACK_PASS_PAISE,
  callbackPassEndsAt,
  callbackPassOffer,
  findLiveCallbackPasses,
  isLiveCallbackPass,
  settleCallbackOrder,
  OFFER_INCLUDED,
  OFFER_PREMIUM_REQUIRED,
  OFFER_SUBSCRIPTION_REQUIRED,
  OFFER_TOO_OLD
} from "../../lib/core/callback-pass.js";
import { registerOwnerToScannerCall } from "../../lib/core/pending-call.js";
import {
  CALLBACK_WINDOW_MS,
  CALL_SUBSCRIPTION_REQUIRED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE
} from "./dashboard.js";

// Buying back a premium tag's callback once its free ten minutes are over.
//
// Two routes, and the second one does more than its name suggests: it verifies
// the payment AND registers the call, in one request, returning the number to
// dial. That is deliberate and it is the point of the feature.
//
// The alternative — verify, respond, let the page call register-call — puts a
// second round trip between the owner's money and their phone ringing, and
// opens a gap where the payment succeeded and the follow-up did not. That is
// the one failure this design must not have: a charge with no call.
//
// So the dial is registered inside the same handler that verifies the
// signature. Verification is a local HMAC (no network), settling the order and
// inserting the bridge are two indexed writes, and nothing here calls
// Razorpay's API or Exotel's. An owner taps Pay and gets a number back.
//
// If the call cannot be placed at that moment — no virtual number configured,
// no mobile on the profile — the payment still stands and so does the ten
// minutes it bought: the dashboard reads the paid order and draws an ordinary
// Call Back button on that row, which register-call honours until it ends.
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

      // A callback is bought against ONE contact, so the id is required here —
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

      // Already paid, and still running. Checked before anything that could
      // refuse on the contact's age or recency: a stale tab showing the price
      // on a row the owner has since paid for must be told to use what they
      // bought, never "too old" or "not the latest" — and never charged twice.
      const live = await findLiveCallbackPasses(collections, ownerId);
      const endsAt = live.get(String(contact._id));
      if (endsAt) {
        reply.code(409);
        return {
          ok: false,
          code: "PASS_ALREADY_PAID",
          error: "You've already paid to call this person back. Tap Call Back to connect.",
          expiresAt: new Date(endsAt).toISOString()
        };
      }

      const owner = await collections.owners.findOne({ _id: ownerId });
      if (!owner?.mobile) {
        // Checked BEFORE taking money, not after. The bridge is keyed to the
        // owner's own number, so selling a callback to an owner who has not
        // saved one would be charging for a call that cannot be placed.
        reply.code(402);
        return { ok: false, code: "NO_PHONE", error: "Add your phone number to enable callback." };
      }

      const tag = await collections.tags.findOne({
        ownerId,
        token: contact.token,
        deletedAt: { $in: [null, undefined] }
      });
      if (!tag) { reply.code(404); return { ok: false, error: "Vehicle not found." }; }

      // The same entitlement register-call and the page read, so a tag cannot
      // be sold a callback that the route which dials it would call lapsed.
      const offer = callbackPassOffer(callEntitlement(tag), {
        contactCreatedAt: contact.createdAt,
        freeWindowMs: CALLBACK_WINDOW_MS
      });

      if (offer === OFFER_PREMIUM_REQUIRED) {
        reply.code(402);
        return { ok: false, code: "PREMIUM_REQUIRED", error: PREMIUM_REQUIRED_MESSAGE };
      }
      if (offer === OFFER_SUBSCRIPTION_REQUIRED) {
        reply.code(402);
        return { ok: false, code: "CALL_SUBSCRIPTION_REQUIRED", error: CALL_SUBSCRIPTION_REQUIRED_MESSAGE };
      }
      if (offer === OFFER_INCLUDED) {
        // Not an error the owner caused: the page decides from the device's
        // clock and this from the server's, and the two can straddle the
        // boundary by a few seconds. The page answers this code by placing
        // the included call instead, so a tap on "₹20" a moment early still
        // ends in a call — without a charge.
        reply.code(409);
        return {
          ok: false,
          code: "CALLBACK_INCLUDED",
          error: "This contact can still be called back for free."
        };
      }
      if (offer === OFFER_TOO_OLD) {
        reply.code(410);
        return {
          ok: false,
          code: "CALLBACK_WINDOW_EXPIRED",
          error: "This contact is too old to call back."
        };
      }

      // Only the newest contact on this vehicle may be bought.
      //
      // The page offers one ₹20 button per vehicle, on its newest contact; this
      // holds a stale tab to the same rule. Without it an owner could pay to
      // ring someone who contacted the car earlier and has since moved on, and
      // a scanner who tried twice would be two purchases for one person.
      // "Newer" is judged exactly as the page judges it — a contact that left a
      // number and did not end in a conversation — so the button and this
      // route cannot disagree about which row is the live one.
      const newer = await collections.contactRequests.findOne({
        ownerId,
        token: contact.token,
        _id: { $ne: contact._id },
        phone: { $nin: [null, ""] },
        callOutcome: { $ne: "answered" },
        createdAt: { $gt: contact.createdAt }
      });
      if (newer) {
        reply.code(410);
        return {
          ok: false,
          code: "CALLBACK_NOT_LATEST",
          error: "Only your most recent contact can be called back."
        };
      }

      // Hand back an order the owner already started rather than minting a
      // second one. Tapping Pay twice, or reloading mid-checkout, otherwise
      // leaves two live order ids for one intended purchase — both payable,
      // which on a ₹20 product means being charged ₹40 for one call. The same
      // rule the shop and membership checkouts follow.
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
          // One contact can be bought back more than once (each purchase is
          // its own ten minutes), so the receipt carries a time component.
          // Razorpay caps receipts at 40 characters; this is at most 38.
          receipt: `ptcb_${String(contact._id)}_${Date.now().toString(36)}`,
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
        // at this point, so this is logged loudly rather than swallowed. The
        // webhook settles the order independently once the database is back.
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

      // Settle the order, once. If the webhook — or an earlier copy of this
      // request — got here first, this changes nothing and `paidAt` stays
      // where it was, so a replay can never restart the ten minutes.
      const { order: settled } = await settleCallbackOrder(collections, {
        orderId: order.orderId,
        paymentId: razorpay_payment_id,
        now
      });

      if (!isLiveCallbackPass(settled, now.getTime())) {
        // Only reachable by replaying a payment whose ten minutes are already
        // over — the owner has had what it bought.
        reply.code(410);
        return {
          ok: false,
          code: "PASS_EXPIRED",
          error: "This paid callback has ended. You can buy another from the activity list."
        };
      }

      const expiresAt = new Date(callbackPassEndsAt(settled)).toISOString();

      // Now place it. From here on every refusal says the money arrived, and
      // leaves the paid ten minutes standing: the dashboard reads the settled
      // order and offers an ordinary Call Back on the row until they end.
      if (!env.exotelCallerId) {
        request.log.error({ orderId: order.orderId }, "[callback pass] paid with no caller id configured");
        reply.code(503);
        return {
          ok: false,
          code: "CALL_UNAVAILABLE",
          error: "Payment received. The call service is unavailable — tap Call Back again in a moment.",
          expiresAt
        };
      }

      const contact = await collections.contactRequests.findOne({ _id: order.requestId, ownerId });
      if (!contact?.phone) {
        request.log.error({ orderId: order.orderId }, "[callback pass] paid for a contact that has no number");
        reply.code(410);
        return { ok: false, code: "CONTACT_GONE", error: "Payment received, but this contact is no longer available. Please contact support." };
      }

      const owner = await collections.owners.findOne({ _id: ownerId });
      if (!owner?.mobile) {
        reply.code(402);
        return {
          ok: false,
          code: "NO_PHONE",
          error: "Payment received. Add your mobile number, then tap Call Back.",
          expiresAt
        };
      }

      await ensurePendingCallsIndexes(collections);
      await registerOwnerToScannerCall(collections, {
        ownerPhone: owner.mobile,
        contact,
        ownerId,
        now
      });

      return { ok: true, virtualNumber: env.exotelCallerId, expiresAt };
    }
  );
}
