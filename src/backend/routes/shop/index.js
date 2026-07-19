import { createRazorpayOrder, verifyRazorpaySignature, isRazorpayConfigured, getShopProduct } from "../../lib/integrations/payments.js";
import { getCollections } from "../../lib/db/repositories.js";
import { requireSession, toObjectId } from "../../lib/auth/auth.js";
import { createPremiumTagForVehicle } from "../../lib/core/tag-issuance.js";

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
  app.post("/api/shop/create-order", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;
    const ownerId = toObjectId(request.session.userId);

    const { productId, replaceTagId } = request.body || {};
    if (!productId) { reply.code(400); return { error: "productId required." }; }

    const product = getShopProduct(productId);
    if (!product) { reply.code(400); return { error: "Unknown product." }; }

    if (!isRazorpayConfigured(env)) { reply.code(500); return { error: "Razorpay not configured." }; }

    const collections = await getCollections(env);

    // Validate the replace-context tag (scoped to this owner, still a live,
    // non-premium tag). Invalid or absent → treat as a plain physical order.
    let validReplaceTagId = null;
    if (replaceTagId && collections) {
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
        notes: { productId, productName: product.name, replaceTagId: validReplaceTagId || "" }
      });

      // Persist the server-created order so verify-payment can prove the payment
      // maps to a real order at the catalog price (M15 Step 5). Amount is stored
      // in paise, exactly as Razorpay recorded it.
      if (collections) {
        await collections.shopOrders.insertOne({
          orderId: order.id,
          productId,
          productName: product.name,
          amount: order.amount, // paise
          currency: order.currency,
          status: "created",
          ownerId,
          replaceTagId: validReplaceTagId,
          createdAt: new Date().toISOString()
        });
      }

      return { ok: true, orderId: order.id, amount: order.amount, currency: order.currency };
    } catch (err) {
      reply.code(500);
      return { ok: false, error: err.message || "Failed to create order." };
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
