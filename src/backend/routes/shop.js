import Razorpay from "razorpay";
import crypto from "node:crypto";

export function registerShopRoutes(app, env) {
  const getRazorpay = () => {
    if (!env.razorpayKeyId || !env.razorpayKeySecret) return null;
    return new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
  };

  // Expose key ID to frontend (safe — public key)
  app.get("/api/shop/razorpay-key", async (_request, reply) => {
    if (!env.razorpayKeyId) { reply.code(500); return { error: "Razorpay not configured." }; }
    return { keyId: env.razorpayKeyId };
  });

  // Create order
  app.post("/api/shop/create-order", async (request, reply) => {
    const { amount, productId, productName } = request.body || {};
    if (!amount || !productId) { reply.code(400); return { error: "amount and productId required." }; }

    const rzp = getRazorpay();
    if (!rzp) { reply.code(500); return { error: "Razorpay not configured." }; }

    try {
      const order = await rzp.orders.create({
        amount: Math.round(amount * 100), // paise
        currency: "INR",
        receipt: `pt_${productId}_${Date.now()}`,
        notes: { productName: productName || productId }
      });
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
    if (!env.razorpayKeySecret) { reply.code(500); return { ok: false, error: "Razorpay not configured." }; }

    const expected = crypto
      .createHmac("sha256", env.razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      reply.code(400); return { ok: false, error: "Payment verification failed." };
    }

    return { ok: true, paymentId: razorpay_payment_id };
  });
}
