import { createRazorpayOrder, verifyRazorpaySignature, isRazorpayConfigured, getShopProduct } from "../../lib/integrations/payments.js";
import { getCollections } from "../../lib/db/repositories.js";
import { requireSession, toObjectId } from "../../lib/auth/auth.js";
import { addressToNotes } from "../../lib/core/address.js";
import { createPremiumTagForVehicle } from "../../lib/core/tag-issuance.js";
import { createShipment, isDelhiveryConfigured, updateShipmentToPrepaid, trackingUrl } from "../../lib/integrations/delhivery.js";
import { sendOrderConfirmationEmail } from "../../lib/integrations/email.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappOrderUpdate } from "../../lib/integrations/meta.js";
import { sendOtp, verifyOtp, isMobileIdentifier, normalizeIdentifier } from "../../lib/auth/otp.js";

// Flash-offer discount for converting a COD order to prepaid (paise). Kept
// server-side so the ₹50 saving can't be inflated by a tampered client.
const FLASH_DISCOUNT_PAISE = 5000;

// COD carries a matching +₹50 handling surcharge on top of the catalog price.
// Paying online — directly, or via the flash offer which subtracts the same
// ₹50 — removes it, so the online price always equals the catalog price. Must
// stay equal to FLASH_DISCOUNT_PAISE, or the flash-prepaid amount won't land
// back exactly on the catalog price (e.g. catalog ₹499 → COD ₹549 → online ₹499).
const COD_SURCHARGE_PAISE = FLASH_DISCOUNT_PAISE;

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

// Fire the order-confirmation e-mail without ever blocking the order response —
// the order already exists, so a mail failure must never turn into a failed
// checkout. Owners who signed in with a mobile OTP may have no e-mail on file;
// we skip silently in that case (a WhatsApp confirmation would need its own
// approved Meta template before it can be wired in here).
async function sendOrderConfirmation(env, collections, ownerId, details, log) {
  try {
    const owner = await collections.owners.findOne({ _id: ownerId });
    const track = details.waybill ? trackingUrl(details.waybill) : null;
    const payload = {
      orderNumber: details.orderNumber,
      productName: details.productName,
      amountPaise: details.amountPaise,
      cod: details.cod,
      trackingUrl: track
    };
    if (owner && owner.email) {
      await sendOrderConfirmationEmail(env, { to: owner.email, ...payload });
      return;
    }
    // No e-mail on file → WhatsApp the delivery contact instead. Needs the
    // approved `parktag_order_update` template; best-effort like the e-mail.
    if (details.deliveryPhone && isMetaWhatsappConfigured(env)) {
      await sendMetaWhatsappOrderUpdate(env, {
        to: details.deliveryPhone,
        name: (owner && (owner.displayName || owner.name)) || "there",
        orderNumber: details.orderNumber,
        trackingUrl: track || ""
      });
    }
  } catch (err) {
    log?.error?.({ err }, "Order confirmation notification failed");
  }
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

      // Auto-book the Delhivery shipment for the physical item. Best-effort:
      // the payment has already succeeded and (if applicable) the tag has
      // already been minted by this point, so a booking failure here must
      // never turn into a failed response — it goes on the order for retry
      // instead. Only runs once, on the actual created→paid transition.
      let bookedWaybill = null;
      if (firstTime && isDelhiveryConfigured(env) && order.shippingAddress) {
        try {
          const { waybill } = await createShipment(env, {
            orderId: razorpay_order_id,
            address: order.shippingAddress,
            productName: order.productName
          });
          bookedWaybill = waybill;
          await collections.shopOrders.updateOne(
            { orderId: razorpay_order_id },
            { $set: { waybill, shipmentBookedAt: new Date().toISOString() }, $unset: { shipmentError: "" } }
          );
        } catch (err) {
          request.log.error({ err, orderId: razorpay_order_id }, "Delhivery shipment booking failed");
          await collections.shopOrders.updateOne(
            { orderId: razorpay_order_id },
            { $set: { shipmentError: err instanceof Error ? err.message : "Unknown error" } }
          );
        }
      }

      // Best-effort confirmation (e-mail, or WhatsApp when no e-mail) — sent
      // after booking so it can carry the tracking link when a waybill exists.
      if (firstTime) {
        await sendOrderConfirmation(env, collections, ownerId, {
          orderNumber: order.orderNumber, productName: order.productName, amountPaise: order.amount, cod: false,
          waybill: bookedWaybill, deliveryPhone: order.shippingAddress && order.shippingAddress.phone
        }, request.log);
      }
    }

    return { ok: true, paymentId: razorpay_payment_id, replaced, newTagId };
  });

  // Send an OTP to the saved delivery phone so a COD order can be phone-verified
  // (Sampark-style anti-fraud that cuts fake cash orders / RTO). The number comes
  // from the saved address server-side, never the client, and rides the same
  // WhatsApp OTP channel as login. Rate-limited to curb SMS/WhatsApp abuse.
  app.post("/api/shop/cod-otp/send", { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;
    const ownerId = toObjectId(request.session.userId);

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { error: "Database not configured." }; }

    const addressDoc = await collections.addresses.findOne({ ownerId });
    const phone = addressDoc && addressDoc.phone;
    if (!phone || !isMobileIdentifier(phone)) {
      reply.code(400); return { error: "Add a valid delivery phone number first." };
    }
    try {
      await sendOtp(env, phone);
      return { ok: true, phoneHint: "••••" + String(phone).slice(-4) };
    } catch (err) {
      request.log.error({ err }, "COD OTP send failed");
      reply.code(500); return { ok: false, error: "Could not send the verification code. Please try again." };
    }
  });

  // Place a Cash-on-Delivery order — no payment now, ships and is paid on
  // delivery. Price is resolved server-side from the catalog (same as online),
  // and we mint our own order number since there's no Razorpay order.
  app.post("/api/shop/place-cod", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;
    const ownerId = toObjectId(request.session.userId);

    const { productId, replaceTagId, otp } = request.body || {};
    if (!productId) { reply.code(400); return { error: "productId required." }; }

    const product = getShopProduct(productId);
    if (!product) { reply.code(400); return { error: "Unknown product." }; }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { error: "Database not configured." }; }

    const addressDoc = await collections.addresses.findOne({ ownerId });
    const shipping = addressDoc ? shapeAddress(addressDoc) : null;
    if (!shipping) { reply.code(400); return { error: "Please add a delivery address before ordering." }; }

    // COD anti-fraud: the delivery phone must be proven by an OTP sent to that
    // exact number. We skip re-verifying ONLY when this owner has already
    // OTP-verified this same number for a prior COD (owner.codVerifiedPhone) —
    // never based on owner.mobile, which can be set WITHOUT an OTP via the
    // profile (POST /api/owner/mobile); trusting it would let an unverified
    // (even someone else's) number through. The phone is read from the saved
    // address server-side, so the send and the check share one source of truth.
    const owner = await collections.owners.findOne({ _id: ownerId });
    const deliveryPhone = shipping.phone;
    if (!deliveryPhone || !isMobileIdentifier(deliveryPhone)) {
      reply.code(400);
      return { error: "A valid delivery phone number is required for Cash on Delivery." };
    }
    const normDelivery = normalizeIdentifier(deliveryPhone);
    const phoneTrusted = owner && owner.codVerifiedPhone && owner.codVerifiedPhone === normDelivery;
    if (!phoneTrusted) {
      // No code yet → tell the client to run the OTP step (200, not an error).
      if (!otp) return { ok: false, needsOtp: true };
      try {
        await verifyOtp(env, deliveryPhone, String(otp));
      } catch (err) {
        reply.code(400);
        return { ok: false, error: err && err.message ? err.message : "Invalid verification code." };
      }
      // Remember this OTP-proven number so the same delivery phone isn't
      // re-challenged on this owner's future COD orders.
      await collections.owners.updateOne(
        { _id: ownerId },
        { $set: { codVerifiedPhone: normDelivery } }
      );
    }

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
    // COD amount = catalog price + ₹50 COD surcharge (the courier collects this).
    const amountPaise = Math.round(product.amount * 100) + COD_SURCHARGE_PAISE;
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

    // Best-effort COD shipment booking: gives the buyer a waybill + live
    // tracking in My Orders and tells the courier to collect the cash on
    // delivery. Never blocks the order — it's already placed; a booking failure
    // is recorded on the order for retry, exactly like the prepaid path.
    let bookedWaybill = null;
    if (isDelhiveryConfigured(env)) {
      try {
        const { waybill } = await createShipment(env, {
          orderId: orderNumber,
          address: shipping,
          productName: product.name,
          codAmountPaise: amountPaise
        });
        bookedWaybill = waybill;
        await collections.shopOrders.updateOne(
          { orderNumber },
          { $set: { waybill, shipmentBookedAt: new Date().toISOString() }, $unset: { shipmentError: "" } }
        );
      } catch (err) {
        request.log.error({ err, orderNumber }, "Delhivery COD shipment booking failed");
        await collections.shopOrders.updateOne(
          { orderNumber },
          { $set: { shipmentError: err instanceof Error ? err.message : "Unknown error" } }
        );
      }
    }

    // Best-effort confirmation (e-mail, or WhatsApp when no e-mail); for COD it
    // carries the acceptance reminder + a tracking link once a waybill exists.
    await sendOrderConfirmation(env, collections, ownerId, {
      orderNumber, productName: product.name, amountPaise, cod: true,
      waybill: bookedWaybill, deliveryPhone: shipping.phone
    }, request.log);

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

    // Best-effort confirmation (e-mail, or WhatsApp when no e-mail) — the COD
    // order is now prepaid/online; carries the tracking link if a waybill exists.
    if (firstTime) {
      await sendOrderConfirmation(env, collections, ownerId, {
        orderNumber, productName: order.productName, amountPaise: order.prepayAmount, cod: false,
        waybill: order.waybill, deliveryPhone: order.shippingAddress && order.shippingAddress.phone
      }, request.log);
    }

    // If a COD shipment was already booked at order time, stop the courier from
    // collecting cash now that the order is prepaid. Best-effort: the payment
    // already succeeded, so a failed conversion is recorded on the order for
    // manual correction rather than surfaced as an error to the buyer.
    if (firstTime && order.waybill) {
      const converted = await updateShipmentToPrepaid(env, order.waybill);
      await collections.shopOrders.updateOne(
        { orderNumber, ownerId },
        converted
          ? { $set: { shipmentPaymentMode: "Prepaid", shipmentConvertedAt: new Date().toISOString() }, $unset: { codConversionError: "" } }
          : { $set: { codConversionError: "Could not switch COD shipment to Prepaid — verify with courier." } }
      );
    }

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
