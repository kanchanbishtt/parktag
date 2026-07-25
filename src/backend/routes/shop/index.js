import { createRazorpayOrder, verifyRazorpaySignature, isRazorpayConfigured, getShopProduct } from "../../lib/integrations/payments.js";
import { getCollections } from "../../lib/db/repositories.js";
import { requireSession, toObjectId } from "../../lib/auth/auth.js";
import { addressToNotes } from "../../lib/core/address.js";
import { createPremiumTagForVehicle } from "../../lib/core/tag-issuance.js";

// Shippable subset of an address DB doc.
function shapeAddress(doc) {
  const { fullName, phone, line1, line2, landmark, city, state, pincode } = doc;
  return { fullName, phone, line1, line2, landmark, city, state, pincode };
}

export function registerShopRoutes(app, env) {
  // Expose key ID to frontend (safe — public key)
  app.get("/api/shop/razorpay-key", async (_request, reply) => {
    if (!isRazorpayConfigured(env)) { reply.code(500); return { error: "Razorpay not configured." }; }
    return { keyId: env.razorpayKeyId };
  });

  // Create order — the price is resolved SERVER-SIDE from the catalog (M15).
  // The client sends only a productId; any client-supplied `amount` is ignored,
  // so a tampered request can't buy a product for the wrong price.
  //
  // Optional `replaceTagId` (M18): when the owner buys a premium tag from an
  // expired free-trial vehicle card, this is the free tag to replace. On a
  // successful payment (verify-payment) we mint a new premium tag for that
  // vehicle and soft-remove the old free tag. Missing/invalid → plain order.
  app.post("/api/shop/create-order", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    // Shop items are physical tags that ship to the buyer, so checkout now
    // requires a logged-in owner with a saved delivery address.
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;
    const ownerId = toObjectId(request.session.userId);

    const { productId, replaceTagId } = request.body || {};
    if (!productId) { reply.code(400); return { error: "productId required." }; }

    const product = getShopProduct(productId);
    if (!product) { reply.code(400); return { error: "Unknown product." }; }

    if (!isRazorpayConfigured(env)) { reply.code(500); return { error: "Razorpay not configured." }; }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { error: "Database not configured." }; }

    // Refuse to take money for a physical item with nowhere to ship it. The
    // checkout form saves the address first, so a missing one is out-of-order.
    const addressDoc = await collections.addresses.findOne({ ownerId });
    const shipping = addressDoc ? shapeAddress(addressDoc) : null;
    if (!shipping) { reply.code(400); return { error: "Please add a delivery address before paying." }; }

    // Validate the replace-context tag (scoped to this owner, still a live,
    // non-premium tag). Invalid or absent → treat as a plain physical order.
    let validReplaceTagId = null;
    if (replaceTagId) {
      const oldTag = await collections.tags.findOne({
        _id: toObjectId(replaceTagId),
        ownerId,
        deletedAt: { $in: [null, undefined] }
      });
      if (oldTag && !oldTag.premium) {
        validReplaceTagId = String(oldTag._id);
      }
    }

    try {
      const order = await createRazorpayOrder(env, {
        amount: product.amount, // server catalog price (INR) → paise inside helper
        receipt: `pt_${productId}_${Date.now()}`,
        notes: { productId, productName: product.name, replaceTagId: validReplaceTagId || "", ...addressToNotes(shipping) }
      });

      // Persist the server-created order so verify-payment can prove the payment
      // maps to a real order at the catalog price (M15 Step 5). Amount is stored
      // in paise, exactly as Razorpay recorded it.
      {
        await collections.shopOrders.insertOne({
          orderId: order.id,
          ownerId,
          productId,
          productName: product.name,
          amount: order.amount, // paise
          currency: order.currency,
          status: "created",
          shippingAddress: shipping,
          replaceTagId: validReplaceTagId,
          createdAt: new Date().toISOString()
        });
      }

      return { ok: true, orderId: order.id, amount: order.amount, currency: order.currency };
    } catch (err) {
      request.log.error({ err }, "Razorpay order creation failed");
      reply.code(500);
      return { ok: false, error: "Failed to create order. Please try again." };
    }
  });

  // Verify payment signature
  app.post("/api/shop/verify-payment", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;
    const ownerId = toObjectId(request.session.userId);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = request.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      reply.code(400); return { ok: false, error: "Missing payment fields." };
    }
    if (!isRazorpayConfigured(env)) { reply.code(500); return { ok: false, error: "Razorpay not configured." }; }

    const valid = verifyRazorpaySignature(env, {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature
    });

    if (!valid) {
      reply.code(400); return { ok: false, error: "Payment verification failed." };
    }

    // A valid signature only proves "this payment matches this order" — it says
    // nothing about the order's amount. Re-check against the server-created order
    // (M15 Step 5): the order must exist and its stored amount must still equal
    // the current catalog price in paise. This rejects any order that was never
    // minted by us, or whose amount doesn't match the catalog.
    const collections = await getCollections(env);
    let replaced = false;
    let newTagId = null;
    if (collections) {
      const order = await collections.shopOrders.findOne({ orderId: razorpay_order_id });
      if (!order) {
        reply.code(400); return { ok: false, error: "No matching order." };
      }
      // Bind the order to the session that created it. Razorpay order ids are
      // not secret by design (Razorpay's own checkout lets anyone complete a
      // payment for a known order id) — without this check, a signature that
      // is valid for *someone else's* order would still be accepted here as
      // long as the caller is logged in as *any* owner, letting an attacker's
      // session flip another owner's order to "paid" out from under them.
      if (String(order.ownerId) !== String(ownerId)) {
        reply.code(403); return { ok: false, error: "This order does not belong to your account." };
      }
      const product = getShopProduct(order.productId);
      const expectedPaise = product ? Math.round(product.amount * 100) : null;
      if (expectedPaise === null || order.amount !== expectedPaise) {
        reply.code(400); return { ok: false, error: "Order amount mismatch." };
      }

      // Atomically flip created → paid so a duplicate verify can't mint twice.
      const paidTransition = await collections.shopOrders.updateOne(
        { orderId: razorpay_order_id, status: "created" },
        { $set: { status: "paid", paymentId: razorpay_payment_id, paidAt: new Date().toISOString() } }
      );
      const firstTime = paidTransition.modifiedCount === 1;

      // Tag replacement (M18): mint a new premium tag for the vehicle and
      // soft-remove the spent free-trial tag. Only on the first paid transition
      // and only when this order carried a valid replace-context.
      if (firstTime && order.replaceTagId) {
        const oldTag = await collections.tags.findOne({
          _id: toObjectId(order.replaceTagId),
          ownerId,
          deletedAt: { $in: [null, undefined] }
        });
        if (oldTag && !oldTag.premium) {
          const premiumTag = await createPremiumTagForVehicle(collections, ownerId, {
            plateNumber: oldTag.plateNumber,
            vehicleType: oldTag.vehicleType,
            vehicleLabel: oldTag.vehicleLabel
          });
          const now = new Date().toISOString();
          await collections.tags.updateOne(
            { _id: oldTag._id },
            { $set: { deletedAt: now, status: "inactive", updatedAt: now } }
          );
          newTagId = String(premiumTag._id);
          replaced = true;
          await collections.shopOrders.updateOne(
            { orderId: razorpay_order_id },
            { $set: { mintedTagId: newTagId } }
          );
        }
      }
    }

    return { ok: true, paymentId: razorpay_payment_id, replaced, newTagId };
  });
}
