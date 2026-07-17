import { createRazorpayOrder, verifyRazorpaySignature, isRazorpayConfigured, getShopProduct } from "../../lib/integrations/payments.js";
import { getCollections } from "../../lib/db/repositories.js";
import { requireSession, toObjectId } from "../../lib/auth/auth.js";
import { addressToNotes } from "../../lib/core/address.js";

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
  app.post("/api/shop/create-order", async (request, reply) => {
    // Shop items are physical tags that ship to the buyer, so checkout now
    // requires a logged-in owner with a saved delivery address.
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const { productId } = request.body || {};
    if (!productId) { reply.code(400); return { error: "productId required." }; }

    const product = getShopProduct(productId);
    if (!product) { reply.code(400); return { error: "Unknown product." }; }

    if (!isRazorpayConfigured(env)) { reply.code(500); return { error: "Razorpay not configured." }; }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { error: "Database not configured." }; }

    // Refuse to take money for a physical item with nowhere to ship it. The
    // checkout form saves the address first, so a missing one is out-of-order.
    const ownerId = toObjectId(request.session.userId);
    const addressDoc = await collections.addresses.findOne({ ownerId });
    const shipping = addressDoc ? shapeAddress(addressDoc) : null;
    if (!shipping) { reply.code(400); return { error: "Please add a delivery address before paying." }; }

    try {
      const order = await createRazorpayOrder(env, {
        amount: product.amount, // server catalog price (INR) → paise inside helper
        receipt: `pt_${productId}_${Date.now()}`,
        notes: { productId, productName: product.name, ...addressToNotes(shipping) }
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
      await collections.shopOrders.updateOne(
        { orderId: razorpay_order_id },
        { $set: { status: "paid", paymentId: razorpay_payment_id, paidAt: new Date().toISOString() } }
      );
    }

    return { ok: true, paymentId: razorpay_payment_id };
  });
}
