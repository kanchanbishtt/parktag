import { requireSession, toObjectId, tryObjectId } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import {
  getMembershipPlan,
  membershipFeatures,
  membershipPlanPaise,
  membershipPlans,
  membershipTrial
} from "../../lib/core/membership-plans.js";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  verifyRazorpaySignature
} from "../../lib/integrations/payments.js";
import { activateMembership, membershipPeriodStart } from "../../lib/core/membership-fulfilment.js";
import { isInPremiumTrial } from "../../lib/core/vault.js";
import { generateOrderNumber } from "../../lib/core/order-number.js";
import { hasActiveSubscription } from "../../lib/core/subscription.js";

// What the membership screen renders, and the checkout behind it.
//
// The page computes nothing: no prices, no savings, no trial length, and above
// all no amount. The browser sends a plan id; the server resolves what that
// costs. A price the browser can author is a price the browser can change, and
// that is the whole reason SHOP_PRODUCTS lives on this side too.
//
// ONE-TIME PREPAID, NOT A RECURRING MANDATE. The plans are fixed terms at fixed
// prices — ₹49 for a month, ₹149 for six, ₹249 for twelve — so a purchase buys
// a block of time and extends the tag's period. Razorpay Subscriptions would
// mean plan entities, an eMandate or UPI Autopay mandate signed by the customer
// and enabled on the account, and a renewal lifecycle with its own failure
// states. None of that is needed to sell a fixed term, and a mandate the buyer
// has to authorise is a harder sell than a single payment. Auto-renew is a
// deliberate follow-up, not an oversight.

// Which tag the membership applies to.
//
// The entitlement model is per tag — subscription.js reads tag.subscription and
// nothing else — so a purchase has to name one. Owners today hold exactly one
// claimed tag each, so asking would be a question with one possible answer, and
// this resolves it silently in that case. With several, the caller must say
// which: guessing would put a year of premium on whichever tag happened to sort
// first, and the owner would have no idea until they looked.
async function resolveTargetTag(collections, ownerId, requestedTagId) {
  const owned = await collections.tags
    .find({ ownerId, deletedAt: { $exists: false } })
    .project({ _id: 1, plateNumber: 1, premium: 1, premiumSince: 1, activatedAt: 1, createdAt: 1, subscription: 1, callSubscription: 1, documentSubscription: 1 })
    .toArray();

  if (!owned.length) return { error: "You need an activated tag before buying a membership." };

  if (requestedTagId) {
    const wanted = tryObjectId(requestedTagId);
    // Scoped to tags this owner holds, so a tagId from another account cannot
    // be topped up by whoever knows its id.
    const match = wanted && owned.find((tag) => String(tag._id) === String(wanted));
    if (!match) return { error: "That tag is not on your account." };
    return { tag: match };
  }

  if (owned.length > 1) {
    return {
      error: "Choose which tag this membership is for.",
      choices: owned.map((tag) => ({ tagId: String(tag._id), plateNumber: tag.plateNumber || null }))
    };
  }

  return { tag: owned[0] };
}

// What Razorpay's sheet should show for this buyer. The same three fields the
// shop sends (see checkoutPrefill in routes/shop/index.js), and sent the same
// way — with the order, for the length of one checkout. It used to be a global
// the dashboard left on `window` for the whole session, where every script on
// the page could read it, checkout.js included.
async function checkoutPrefill(collections, ownerId) {
  const owner = await collections.owners.findOne({ _id: ownerId });
  return {
    // The owner's real name, never a greeting: Razorpay bills against this.
    name: (owner && owner.displayName) || "",
    email: (owner && owner.email) || "",
    contact: (owner && owner.mobile) || ""
  };
}

export function registerMembershipRoutes(app, env) {
  app.get(
    "/api/owner/membership",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;

      // Sent as a flag rather than assumed by the client, so an environment
      // without Razorpay configured shows the page and says why instead of
      // opening a checkout that cannot complete.
      const checkoutEnabled = isRazorpayConfigured(env);

      let subscription = null;
      const collections = await getCollections(env);
      if (collections) {
        const ownerId = toObjectId(request.session.userId);
        const now = Date.now();
        // premium / premiumSince / activatedAt / createdAt are what
        // premiumTrialEndsAt() reads. Without them projected, every tag looks
        // like it has no trial and the screen offers a membership to someone
        // already covered by the free year — which is what it used to do.
        const tags = await collections.tags
          .find({ ownerId, deletedAt: { $exists: false } })
          .project({
            _id: 1, plateNumber: 1, premium: 1, premiumSince: 1, activatedAt: 1, createdAt: 1,
            subscription: 1, callSubscription: 1, documentSubscription: 1
          })
          .toArray();

        // Covered until when, counting the free year as cover — because it is.
        // The features honour it (call-access.js and vault.js both read the
        // trial alongside the subscription), so a screen that ignored it was
        // selling an owner what their premium tag already gave them.
        //
        // membershipPeriodStart() is the same function checkout uses to decide
        // where bought months begin: the later of now, a paid period end and a
        // trial end. So "when would a purchase start" and "how long am I
        // covered" cannot disagree — they are one calculation.
        const covered = tags
          .map((tag) => ({ tag, until: membershipPeriodStart(tag, now) }))
          .filter((row) => row.until > now);

        if (covered.length) {
          // The furthest-out date across their tags, because that is the one
          // the owner would recognise.
          const furthest = covered.reduce((a, b) => (b.until > a.until ? b : a));
          subscription = {
            active: true,
            currentPeriodEnd: new Date(furthest.until).toISOString(),
            // Nothing paid for yet: the cover is the year included with the
            // tag. The screen says so differently, and the button stays live —
            // buying during the trial is allowed and adds time after it.
            trial: !hasActiveSubscription(furthest.tag, now) && isInPremiumTrial(furthest.tag, now)
          };
        }
      }

      return {
        ok: true,
        trial: membershipTrial(),
        plans: membershipPlans(),
        features: membershipFeatures(),
        checkoutEnabled,
        subscription
      };
    }
  );

  // Mint a Razorpay order for a plan. Same shape and the same rate limit as
  // /api/shop/create-order.
  app.post(
    "/api/owner/membership/create-order",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;
      const ownerId = toObjectId(request.session.userId);

      const { planId, tagId } = request.body || {};
      const plan = getMembershipPlan(planId);
      if (!plan) { reply.code(400); return { ok: false, error: "Unknown plan." }; }

      const collections = await getCollections(env);
      if (!collections) { reply.code(500); return { ok: false, error: "Database unavailable." }; }

      const target = await resolveTargetTag(collections, ownerId, tagId);
      if (target.error) {
        reply.code(400);
        return { ok: false, error: target.error, choices: target.choices || undefined };
      }

      const amountPaise = membershipPlanPaise(plan);

      // Hand back a checkout the buyer already started rather than minting a
      // second one. Reloading the page or tapping Go Pro twice otherwise leaves
      // abandoned orders in the Razorpay account and, worse, gives two live
      // order ids for one intended purchase — both payable.
      //
      // The match is exact, including the amount, so a plan whose price has
      // moved since is not resumed at the old figure.
      const reusable = await collections.membershipOrders.findOne(
        { ownerId, status: "created", planId: plan.id, tagId: target.tag._id, amount: amountPaise },
        { sort: { createdAt: -1 } }
      );

      if (reusable) {
        return {
          ok: true,
          orderId: reusable.orderId,
          orderNumber: reusable.orderNumber,
          amount: reusable.amount,
          currency: reusable.currency,
          keyId: env.razorpayKeyId,
          planId: plan.id,
          prefill: await checkoutPrefill(collections, ownerId)
        };
      }

      // Checked here, not at the top: everything above is answerable without
      // the payment API, including handing back an order already started.
      if (!isRazorpayConfigured(env)) {
        reply.code(500);
        return { ok: false, error: "Razorpay not configured." };
      }

      const order = await createRazorpayOrder(env, {
        amount: plan.priceInr,
        receipt: `pt_mem_${plan.id}_${Date.now()}`,
        notes: {
          kind: "membership",
          planId: plan.id,
          months: String(plan.months),
          tagId: String(target.tag._id)
        }
      });

      // Same reference format and the same atomic sequence the shop uses, so a
      // buyer quoting "PT-260902-00043" gets one answer and support does not
      // have to ask which kind of order they mean.
      const orderNumber = await generateOrderNumber(collections);

      await collections.membershipOrders.insertOne({
        orderId: order.id,
        orderNumber,
        ownerId,
        tagId: target.tag._id,
        planId: plan.id,
        months: plan.months,
        // Paise, exactly as Razorpay recorded it — the figure verify-payment
        // re-checks against the catalogue.
        amount: order.amount,
        currency: order.currency,
        status: "created",
        createdAt: new Date().toISOString()
      });

      return {
        ok: true,
        orderId: order.id,
        orderNumber,
        amount: order.amount,
        currency: order.currency,
        keyId: env.razorpayKeyId,
        planId: plan.id,
        prefill: await checkoutPrefill(collections, ownerId)
      };
    }
  );

  // The browser's report that a payment succeeded. The webhook is the other
  // path and neither is trusted to be the one that arrives — see
  // lib/core/membership-fulfilment.js.
  app.post(
    "/api/owner/membership/verify-payment",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;
      const ownerId = toObjectId(request.session.userId);

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = request.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        reply.code(400); return { ok: false, error: "Missing payment fields." };
      }
      if (!isRazorpayConfigured(env)) {
        reply.code(500); return { ok: false, error: "Razorpay not configured." };
      }

      const valid = verifyRazorpaySignature(env, {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });
      if (!valid) { reply.code(400); return { ok: false, error: "Payment verification failed." }; }

      const collections = await getCollections(env);
      if (!collections) {
        // "Cannot check" must not resolve to "checked out fine". Every check
        // below lives behind the database.
        request.log.error({ orderId: razorpay_order_id }, "[membership] verify reached with no database");
        reply.code(500);
        return { ok: false, error: "Could not confirm your payment. Please contact support." };
      }

      const order = await collections.membershipOrders.findOne({ orderId: razorpay_order_id });
      if (!order) { reply.code(400); return { ok: false, error: "No matching order." }; }

      // Razorpay order ids are not secret — its own checkout will complete a
      // payment for any id you know — so a signature valid for someone else's
      // order would otherwise be accepted here by whoever is merely logged in.
      if (String(order.ownerId) !== String(ownerId)) {
        reply.code(403);
        return { ok: false, error: "This order does not belong to your account." };
      }

      // The signature proves the payment matches the order; it says nothing
      // about the amount. Re-checked against the catalogue, so an order minted
      // at a price that has since changed cannot be settled at the old figure.
      const plan = getMembershipPlan(order.planId);
      if (!plan || order.amount !== membershipPlanPaise(plan)) {
        reply.code(400); return { ok: false, error: "Order amount mismatch." };
      }

      const outcome = await activateMembership(collections, {
        order,
        paymentId: razorpay_payment_id,
        log: request.log
      });

      // The receipt says what the SERVER recorded, not what the browser was
      // still holding from create-order — figures assembled before the payment
      // and never reconciled with it afterwards. The rule the shop's
      // confirmation follows, for the same reason.
      return {
        ok: true,
        orderNumber: order.orderNumber || null,
        planId: order.planId,
        planLabel: plan.label,
        months: order.months,
        amountPaise: order.amount,
        currentPeriodEnd: outcome.currentPeriodEnd
      };
    }
  );
}
