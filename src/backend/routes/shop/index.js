import { createRazorpayOrder, verifyRazorpaySignature, isRazorpayConfigured, getShopProduct } from "../../lib/integrations/payments.js";
import { getCollections } from "../../lib/db/repositories.js";
import { requireSession, toObjectId } from "../../lib/auth/auth.js";
import { addressToNotes } from "../../lib/core/address.js";
import { createPremiumTagForVehicle } from "../../lib/core/tag-issuance.js";

// Flash-offer discount for converting a COD order to prepaid (paise). Kept
// server-side so the ₹50 saving can't be inflated by a tampered client.
const FLASH_DISCOUNT_PAISE = 5000;

// Genuine order reference shown on the confirmation screen: a date prefix plus a
// real, monotonically increasing sequence — like a standard e-commerce order id
// (e.g. PT-260728-00042), never a random blob. The sequence comes from an atomic
// per-collection counter so every order gets the next number with no collisions.
async function generateOrderNumber(collections) {
  const now = new Date();
  const datePart =
    String(now.getFullYear()).slice(-2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const res = await collections.counters.findOneAndUpdate(
    { _id: "shopOrder" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  // The v6 driver returns the doc directly; older behaviour wraps it in `.value`.
  const seq = (res && (res.seq ?? (res.value && res.value.seq))) || 1;
  return `PT-${datePart}-${String(seq).padStart(5, "0")}`;
}

// Shippable subset of an address DB doc.
function shapeAddress(doc) {
  const { fullName, phone, line1, line2, landmark, city, state, pincode } = doc;
  return { fullName, phone, line1, line2, landmark, city, state, pincode };
}

// Mint the replacement premium tag for an M18 replace-order and soft-remove the
// old free tag. Shared by online verify-payment and COD flash-prepay verify.
// Returns { replaced, newTagId }.
async function mintReplacementIfNeeded(collections, ownerId, order) {
  if (!order.replaceTagId) return { replaced: false, newTagId: null };
  const oldTag = await collections.tags.findOne({
    _id: toObjectId(order.replaceTagId),
    ownerId,
    deletedAt: { $in: [null, undefined] }
  });
  if (!oldTag || oldTag.premium) return { replaced: false, newTagId: null };
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
  return { replaced: true, newTagId: String(premiumTag._id) };
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
  app.post("/api/shop/create-order", async (request, reply) => {
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
      const orderNumber = await generateOrderNumber(collections);
      {
        await collections.shopOrders.insertOne({
          orderId: order.id,
          orderNumber,
          paymentMethod: "online",
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

      return { ok: true, orderId: order.id, orderNumber, amount: order.amount, currency: order.currency };
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

  // Place a Cash-on-Delivery order — no payment now, ships and is paid on
  // delivery. Price is resolved server-side from the catalog (same as online),
  // and we mint our own order number since there's no Razorpay order.
  app.post("/api/shop/place-cod", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;
    const ownerId = toObjectId(request.session.userId);

    const { productId, replaceTagId } = request.body || {};
    if (!productId) { reply.code(400); return { error: "productId required." }; }

    const product = getShopProduct(productId);
    if (!product) { reply.code(400); return { error: "Unknown product." }; }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { error: "Database not configured." }; }

    const addressDoc = await collections.addresses.findOne({ ownerId });
    const shipping = addressDoc ? shapeAddress(addressDoc) : null;
    if (!shipping) { reply.code(400); return { error: "Please add a delivery address before ordering." }; }

    let validReplaceTagId = null;
    if (replaceTagId) {
      const oldTag = await collections.tags.findOne({
        _id: toObjectId(replaceTagId),
        ownerId,
        deletedAt: { $in: [null, undefined] }
      });
      if (oldTag && !oldTag.premium) validReplaceTagId = String(oldTag._id);
    }

    const orderNumber = await generateOrderNumber(collections);
    const amountPaise = Math.round(product.amount * 100);
    await collections.shopOrders.insertOne({
      orderNumber,
      paymentMethod: "cod",
      ownerId,
      productId,
      productName: product.name,
      amount: amountPaise, // paise (full COD price)
      currency: "INR",
      status: "cod",
      shippingAddress: shipping,
      replaceTagId: validReplaceTagId,
      createdAt: new Date().toISOString()
    });

    return { ok: true, orderNumber, amount: amountPaise, productName: product.name };
  });

  // Flash offer: create a discounted (−₹50) Razorpay order to convert an
  // existing COD order to prepaid. The discount is applied here, server-side.
  app.post("/api/shop/cod-prepay-order", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;
    const ownerId = toObjectId(request.session.userId);

    const { orderNumber } = request.body || {};
    if (!orderNumber) { reply.code(400); return { error: "orderNumber required." }; }
    if (!isRazorpayConfigured(env)) { reply.code(500); return { error: "Razorpay not configured." }; }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { error: "Database not configured." }; }

    const order = await collections.shopOrders.findOne({ orderNumber, ownerId, status: "cod" });
    if (!order) { reply.code(400); return { error: "No matching COD order." }; }

    const discountedPaise = Math.max(order.amount - FLASH_DISCOUNT_PAISE, 100);
    try {
      const rzOrder = await createRazorpayOrder(env, {
        amount: discountedPaise / 100, // helper converts INR → paise
        receipt: `pt_cod_${orderNumber}`,
        notes: { orderNumber, productId: order.productId, prepay: "1" }
      });
      await collections.shopOrders.updateOne(
        { orderNumber, ownerId },
        { $set: { prepayOrderId: rzOrder.id, prepayAmount: rzOrder.amount } }
      );
      return { ok: true, orderId: rzOrder.id, amount: rzOrder.amount, currency: rzOrder.currency, keyId: env.razorpayKeyId };
    } catch (err) {
      request.log.error({ err }, "COD flash-prepay order creation failed");
      reply.code(500);
      return { ok: false, error: "Failed to start payment." };
    }
  });

  // Verify the flash-prepay payment and convert the COD order to paid/online.
  app.post("/api/shop/cod-prepay-verify", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;
    const ownerId = toObjectId(request.session.userId);

    const { orderNumber, razorpay_order_id, razorpay_payment_id, razorpay_signature } = request.body || {};
    if (!orderNumber || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      reply.code(400); return { ok: false, error: "Missing payment fields." };
    }
    if (!isRazorpayConfigured(env)) { reply.code(500); return { ok: false, error: "Razorpay not configured." }; }

    const valid = verifyRazorpaySignature(env, {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature
    });
    if (!valid) { reply.code(400); return { ok: false, error: "Payment verification failed." }; }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const order = await collections.shopOrders.findOne({ orderNumber, ownerId });
    if (!order) { reply.code(400); return { ok: false, error: "No matching order." }; }
    // The payment must be for the exact prepay order we created for this COD order.
    if (order.prepayOrderId !== razorpay_order_id) {
      reply.code(400); return { ok: false, error: "Order mismatch." };
    }

    // Atomically flip cod → paid so a duplicate verify can't mint/convert twice.
    const transition = await collections.shopOrders.updateOne(
      { orderNumber, ownerId, status: "cod" },
      { $set: {
        status: "paid",
        paymentMethod: "online",
        paymentId: razorpay_payment_id,
        paidAmount: order.prepayAmount,
        discount: order.amount - order.prepayAmount,
        paidAt: new Date().toISOString()
      } }
    );
    const firstTime = transition.modifiedCount === 1;

    let replaced = false, newTagId = null;
    if (firstTime) {
      const result = await mintReplacementIfNeeded(collections, ownerId, order);
      replaced = result.replaced;
      newTagId = result.newTagId;
      if (newTagId) {
        await collections.shopOrders.updateOne({ orderNumber, ownerId }, { $set: { mintedTagId: newTagId } });
      }
    }

    return { ok: true, replaced, newTagId };
  });
}
