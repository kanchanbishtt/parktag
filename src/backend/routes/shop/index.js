import { createRazorpayOrder, verifyRazorpaySignature, isRazorpayConfigured, getShopProduct } from "../../lib/integrations/payments.js";
import { getCollections } from "../../lib/db/repositories.js";
import { requireSession, toObjectId, tryObjectId } from "../../lib/auth/auth.js";
import { addressToNotes } from "../../lib/core/address.js";
import { createPremiumTagForVehicle } from "../../lib/core/tag-issuance.js";
import { createShipment, isDelhiveryConfigured, updateShipmentToPrepaid, trackingUrl } from "../../lib/integrations/delhivery.js";
import { getOrderTracking } from "../../lib/core/order-tracking.js";
import { safeEqual } from "../../lib/auth/security.js";
import { sendOrderConfirmationEmail } from "../../lib/integrations/email.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappOrderUpdate } from "../../lib/integrations/meta.js";
import {
  sendOtp,
  verifyOtp,
  isMobileIdentifier,
  normalizeIdentifier,
  OTP_PURPOSE_COD_VERIFY
} from "../../lib/auth/otp.js";

// Flash-offer discount for converting a COD order to prepaid (paise). Kept
// server-side so the ₹50 saving can't be inflated by a tampered client.
const FLASH_DISCOUNT_PAISE = 5000;

// COD carries a matching +₹50 handling surcharge on top of the catalog price.
// Paying online — directly, or via the flash offer which subtracts the same
// ₹50 — removes it, so the online price always equals the catalog price. Must
// stay equal to FLASH_DISCOUNT_PAISE, or the flash-prepaid amount won't land
// back exactly on the catalog price (e.g. catalog ₹499 → COD ₹549 → online ₹499).
const COD_SURCHARGE_PAISE = FLASH_DISCOUNT_PAISE;

// Ceiling on how many unpaid COD orders one ACCOUNT can have open in a rolling
// window. COD takes no money up front and books a real courier shipment, so
// every order is cost ParkTag carries whether or not the parcel is ever
// accepted — shipping out, and the return leg when it is refused.
//
// The only limit before this was @fastify/rate-limit's 10 per 5 minutes, which
// is keyed on the caller's IP: rotating addresses walked straight past it. A
// single account placed 12 orders in one burst in testing. This cap is keyed on
// the owner, so it holds however many addresses the requests come from, and it
// sits alongside the per-IP limit rather than replacing it.
//
// A ROLLING WINDOW rather than a lifetime total, deliberately: nothing in this
// app ever transitions a COD order out of "cod" once the parcel is delivered —
// the courier status is read live from Delhivery and never written back as a
// terminal state — so a lifetime cap would permanently lock out a genuine
// repeat customer. Three a day is far more than a real buyer needs and turns
// unlimited abuse into something that costs an attacker a fresh OTP-verified
// account per three parcels.
const MAX_COD_ORDERS_PER_WINDOW = 3;
const COD_WINDOW_MS = 24 * 60 * 60 * 1000;

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

// ── Public order-tracking helpers ───────────────────────────────────────────

// One message for every failed lookup — unknown order, wrong last-4, or a
// spent attempt budget. Anything more specific would tell a stranger which
// order numbers are real. It still names both fields so a buyer who fat-
// fingered one of them knows where to look.
const TRACK_MISS_MESSAGE =
  "We couldn't find an order with those details. Check the order ID and the last 4 digits of the delivery phone number, then try again.";

// Failures allowed against ONE order before it stops answering, and the window
// they are counted over. 10/hour reduces an exhaustive walk of the 10,000
// possible last-4s to roughly six weeks per order, while leaving far more room
// than a buyer reading their own phone number off a confirmation ever needs.
const MAX_TRACK_ATTEMPTS = 10;
const TRACK_WINDOW_MINUTES = 60;

// Accept an order number however the buyer types it — lowercase, spaced, or
// with the dashes dropped by a copy/paste — and canonicalise it back to the
// stored PT-YYMMDD-NNNNN form. Returns "" for anything that can't be one.
function normalizeOrderNumber(raw) {
  const compact = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const parts = /^PT(\d{6})(\d{5})$/.exec(compact);
  return parts ? `PT-${parts[1]}-${parts[2]}` : "";
}

// True once an order has burnt its attempts inside the current window. An
// expired window is not exhausted — the count starts again on the next miss.
function trackGuardExhausted(guard) {
  if (!guard || !guard.startedAt) return false;
  const windowOpen =
    Date.now() - new Date(guard.startedAt).getTime() < TRACK_WINDOW_MINUTES * 60 * 1000;
  return windowOpen && Number(guard.failures || 0) >= MAX_TRACK_ATTEMPTS;
}

// Update document for one failed attempt: extend the open window, or start a
// fresh one if the last window has already run out.
function bumpTrackGuard(guard) {
  const windowOpen =
    guard?.startedAt &&
    Date.now() - new Date(guard.startedAt).getTime() < TRACK_WINDOW_MINUTES * 60 * 1000;
  return windowOpen
    ? { $inc: { "trackGuard.failures": 1 } }
    : { $set: { trackGuard: { failures: 1, startedAt: new Date().toISOString() } } };
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
    const replaceOid = replaceTagId ? tryObjectId(replaceTagId) : null;
    if (replaceOid) {
      const oldTag = await collections.tags.findOne({
        _id: replaceOid,
        ownerId,
        deletedAt: { $in: [null, undefined] }
      });
      if (oldTag && !oldTag.premium) {
        validReplaceTagId = String(oldTag._id);
      }
    }

    // Reuse an identical checkout the buyer has already started rather than
    // minting a second one.
    //
    // Every call used to create a fresh Razorpay order, a fresh shopOrders row
    // and consume the atomic order-number counter — so reloading the checkout,
    // or tapping Pay twice, burnt order numbers and left abandoned orders in the
    // Razorpay account. At 20 calls a minute per IP, and rotatable, that also
    // let the visible order sequence be inflated at will.
    //
    // The match has to be exact, or reuse would quietly charge for the wrong
    // thing: same product, same replace-context, same shipping address, still
    // unpaid, and still priced at the current catalog rate — a stored order
    // whose price has since moved would be rejected by verify-payment's amount
    // check, so handing it back would strand the buyer at the payment sheet.
    const expectedPaise = Math.round(product.amount * 100);
    const reusable = await collections.shopOrders.findOne({
      ownerId,
      status: "created",
      productId,
      replaceTagId: validReplaceTagId,
      amount: expectedPaise
    }, { sort: { createdAt: -1 } });

    if (reusable && JSON.stringify(reusable.shippingAddress) === JSON.stringify(shipping)) {
      return {
        ok: true,
        orderId: reusable.orderId,
        orderNumber: reusable.orderNumber,
        amount: reusable.amount,
        currency: reusable.currency
      };
    }

    // Checked here rather than at the top of the route: everything above this
    // point — validating the product, the address, the replace-context, and
    // handing back a checkout the buyer already started — is answerable without
    // the payment API. Only minting a NEW order needs it.
    if (!isRazorpayConfigured(env)) { reply.code(500); return { error: "Razorpay not configured." }; }

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
  app.post("/api/shop/verify-payment", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
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
    // Every check that follows lives behind the database, so no database means
    // this route cannot do its job. It used to wrap the lot in `if (collections)`
    // and still answer `{ ok: true }` when there was none — the order was never
    // located, its amount never re-checked, its ownership never confirmed, and
    // the caller was told the payment was verified anyway. A signature is still
    // required to get this far, so this was not directly exploitable, but
    // "cannot check" must not resolve to "checked out fine".
    const collections = await getCollections(env);
    if (!collections) {
      request.log.error({ orderId: razorpay_order_id }, "verify-payment reached with no database");
      reply.code(500);
      return { ok: false, error: "Could not confirm your payment. Please contact support." };
    }

    let replaced = false;
    let newTagId = null;
    {
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
      // Scoped to COD verification. This code goes to a number the person
      // checking out typed into their own address form, so it must not also be
      // a way into the account that number belongs to — as an `auth` code it
      // was exactly that, and this endpoint was a way to have ParkTag send a
      // working sign-in code to any number on request.
      //
      // The WhatsApp body is still Meta's approved "parktag_login" template and
      // so still reads as a sign-in code; that needs a second approved template
      // to fix. The scoping is what removes the account risk in the meantime.
      await sendOtp(env, phone, { purpose: OTP_PURPOSE_COD_VERIFY });
      return { ok: true, phoneHint: "••••" + String(phone).slice(-4) };
    } catch (err) {
      request.log.error({ err }, "COD OTP send failed");
      reply.code(500); return { ok: false, error: "Could not send the verification code. Please try again." };
    }
  });

  // Place a Cash-on-Delivery order — no payment now, ships and is paid on
  // delivery. Price is resolved server-side from the catalog (same as online),
  // and we mint our own order number since there's no Razorpay order.
  app.post("/api/shop/place-cod", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (request, reply) => {
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

    // Per-account ceiling (see MAX_COD_ORDERS_PER_WINDOW). Checked before the
    // OTP step so someone at their limit is told so immediately rather than
    // being walked through a verification that cannot end in an order.
    // `createdAt` is an ISO-8601 string, which orders lexicographically, so a
    // string comparison is a date comparison here.
    const codWindowStart = new Date(Date.now() - COD_WINDOW_MS).toISOString();
    const openCodOrders = await collections.shopOrders.countDocuments({
      ownerId,
      status: "cod",
      createdAt: { $gt: codWindowStart }
    });
    if (openCodOrders >= MAX_COD_ORDERS_PER_WINDOW) {
      reply.code(429);
      return {
        ok: false,
        code: "COD_LIMIT",
        error:
          "You already have the maximum number of Cash on Delivery orders open. " +
          "Pay for one online, or try again tomorrow."
      };
    }

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
        // Only a code issued by cod-otp/send above. A sign-in code is not
        // interchangeable with one, in either direction.
        await verifyOtp(env, deliveryPhone, String(otp), { purpose: OTP_PURPOSE_COD_VERIFY });
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
    const replaceOid = replaceTagId ? tryObjectId(replaceTagId) : null;
    if (replaceOid) {
      const oldTag = await collections.tags.findOne({
        _id: replaceOid,
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
  app.post("/api/shop/cod-prepay-order", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
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

    // Reuse the prepay order already minted for this COD order rather than
    // minting a second one.
    //
    // This used to overwrite `prepayOrderId` on every call, and cod-prepay-verify
    // only accepts a payment matching the CURRENT one. So opening the flash offer
    // twice and paying the first sheet — an ordinary thing to do if the sheet is
    // dismissed and reopened — got the money captured by Razorpay and then
    // rejected here with "Order mismatch": the order stayed COD, and the courier
    // still collected cash on delivery. The buyer paid twice.
    //
    // Returning the stored order makes the route idempotent, so whichever sheet
    // the buyer completes is the one verify expects. It also stops each reopen
    // creating a throwaway order in the Razorpay account.
    if (order.prepayOrderId && typeof order.prepayAmount === "number") {
      return {
        ok: true,
        orderId: order.prepayOrderId,
        amount: order.prepayAmount,
        currency: "INR",
        keyId: env.razorpayKeyId
      };
    }

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
  app.post("/api/shop/cod-prepay-verify", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
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

  // ── Public order tracking ────────────────────────────────────────────────
  // Lets a buyer follow their parcel without signing in — the drawer's "Track
  // order" row, and the only route open to someone who bought a tag in a shop
  // and has no owner account yet.
  //
  // It asks for the order number AND the last 4 digits of the delivery phone,
  // and that second field is not decoration. Order numbers are sequential
  // (PT-YYMMDD-00042, see generateOrderNumber above), so an ID-only lookup
  // would let anyone count upwards and read the whole order book. The last 4
  // is something only the buyer has, costs them nothing to supply, and turns
  // each order into a 10,000-guess problem.
  app.post("/api/shop/track-order", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const orderNumber = normalizeOrderNumber((request.body || {}).orderNumber);
    const lastFour = String((request.body || {}).lastFour || "").trim();

    if (!orderNumber || !/^\d{4}$/.test(lastFour)) {
      reply.code(400);
      return { ok: false, error: TRACK_MISS_MESSAGE };
    }

    // Only orders that were actually placed. A "created" row is a Razorpay
    // order the buyer abandoned before paying — there is nothing to track, and
    // it must not confirm that the number exists either.
    const order = await collections.shopOrders.findOne({
      orderNumber,
      status: { $in: ["paid", "cod"] }
    });

    if (!order) {
      reply.code(404);
      return { ok: false, error: TRACK_MISS_MESSAGE };
    }

    // Per-order ceiling, independent of IP. The @fastify/rate-limit cap above
    // is per-IP and so is only as strong as the attacker's willingness to
    // rotate addresses; this one cannot be widened that way, because the key is
    // the order the attacker is by definition trying to open.
    if (trackGuardExhausted(order.trackGuard)) {
      // Deliberately the same 404 + message as a miss. A distinguishable
      // "too many attempts" would be an order-EXISTS oracle: ten cheap requests
      // per candidate number would then map out which orders are real, which is
      // the enumeration the last-4 is here to prevent. The cost is a genuine
      // buyer who has already mistyped ten times in an hour reading "check your
      // details" instead of "wait a while" — still true, still actionable, and
      // rare enough to be worth the trade.
      reply.code(404);
      return { ok: false, error: TRACK_MISS_MESSAGE };
    }

    const expected = String(order.shippingAddress?.phone || "").replace(/\D/g, "").slice(-4);
    if (!expected || !safeEqual(expected, lastFour)) {
      await collections.shopOrders
        .updateOne({ _id: order._id }, bumpTrackGuard(order.trackGuard))
        .catch(() => {});
      reply.code(404);
      return { ok: false, error: TRACK_MISS_MESSAGE };
    }

    // Proven. Clear the failure window so earlier typos never count against a
    // buyer who then gets it right.
    if (order.trackGuard) {
      await collections.shopOrders
        .updateOne({ _id: order._id }, { $unset: { trackGuard: "" } })
        .catch(() => {});
    }

    const tracking = await getOrderTracking(collections, env, order);
    const isCod = order.status === "cod";

    // Everything below is about the PARCEL, never about the person. No name,
    // phone, address or e-mail is returned — the pair that opened this response
    // is the buyer's own, but there is no reason for the page to echo back
    // details the courier already has and the buyer already knows.
    return {
      ok: true,
      order: {
        orderNumber: order.orderNumber,
        productName: order.productName || null,
        amount: typeof order.amount === "number" ? order.amount : null,
        paymentMethod: isCod ? "cod" : "paid",
        // COD orders have no paidAt — fall back to when the order was placed.
        orderedAt: order.paidAt || order.createdAt || null,
        waybill: order.waybill || null,
        trackingUrl: order.waybill ? trackingUrl(order.waybill) : null,
        shippingStatus: order.shipmentError
          ? "booking_failed"
          : order.waybill
            ? (tracking?.status || "booked")
            : (isCod ? "cod_confirmed" : "processing"),
        statusDateTime: tracking?.statusDateTime || null,
        scans: Array.isArray(tracking?.scans) ? tracking.scans : []
      }
    };
  });
}
