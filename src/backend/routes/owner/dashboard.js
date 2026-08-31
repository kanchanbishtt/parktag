import { requireSession, toObjectId, tryObjectId } from "../../lib/auth/auth.js";
import { createPasswordHash, verifyPassword, isNonEmptyString } from "../../lib/auth/security.js";
import { clearSession } from "../../lib/auth/session.js";
import {
  sendOtp,
  verifyOtp,
  isMobileIdentifier,
  normalizeIdentifier,
  OTP_PURPOSE_DELETE_ACCOUNT,
  OTP_PURPOSE_LINK_MOBILE
} from "../../lib/auth/otp.js";
import { getCollections, ensurePendingCallsIndexes, getVaultBucket } from "../../lib/db/repositories.js";
import { purgeVaultDocuments, deleteUsage } from "../../lib/core/vault.js";
import { callEntitlement } from "../../lib/core/call-access.js";
import { clientErrorMessage } from "../../lib/errors.js";
import { createQrDataUrl, createPrintQrDataUrl } from "../../lib/core/qr-output.js";
import { createEtagForVehicle, buildTagScanUrl, VEHICLE_LABELS, etagIdFor, stickerSerialFor } from "../../lib/core/tag-issuance.js";
import { validateAddress } from "../../lib/core/address.js";
import { resolveOwnerName, firstNameOf, cleanName, isIdentifierNotAName } from "../../lib/core/owner-name.js";
import { checkPincodeServiceability, trackingUrl } from "../../lib/integrations/delhivery.js";
// Shared with the public order-tracking page, so both show the same status off
// the same cache.
import { getOrderTracking } from "../../lib/core/order-tracking.js";

// Strip an address DB doc down to the shippable fields (no _id/ownerId/timestamps).
function shapeAddress(doc) {
  const { fullName, phone, line1, line2, landmark, city, state, pincode } = doc;
  return { fullName, phone, line1, line2, landmark, city, state, pincode };
}

// How long after a scanner makes contact the owner may call them back.
//
// Ten minutes, and deliberately much shorter than the 48 hours the activity
// list shows. Those two spans answer different questions and should not be
// confused:
//
//   48 hours — how long the owner can SEE who contacted them, with times.
//              A log. Nothing about it is actionable on its own.
//   10 minutes — how long they can RETURN that contact.
//
// The person on the other end is a stranger who rang about a parked car and
// then got on with their day. Ringing them back two days later is a call they
// have no context for and did not agree to; ringing back within ten minutes is
// the conversation they were trying to have. The short window is the courtesy,
// not a limitation.
//
// Only the most recent contact is returnable — see the route below.
const CALLBACK_WINDOW_MS = 10 * 60 * 1000;

// Said in two places below — when the account holds no premium tag at all, and
// when the contact they named arrived on an E-Tag — and the owner should not be
// able to tell those apart by the wording. Both mean the same thing to them.
const PREMIUM_REQUIRED_MESSAGE =
  "Calling someone back is a premium feature. Upgrade this vehicle to a premium tag to use it.";

// Said when the owner DOES hold a premium tag but its call window has closed.
// Kept apart from the message above on purpose: telling somebody who has
// already bought the sticker to go and buy the sticker is the kind of reply
// that ends up in a support ticket.
const CALL_SUBSCRIPTION_REQUIRED_MESSAGE =
  "Your call service has ended for this vehicle. Subscribe to call scanners back again.";

// Where a confirmation code for THIS owner may be sent.
//
// Derived from the stored owner record and never from the request body. That is
// the whole point: a caller holding a session cookie must not be able to name
// the address the code goes to, or re-authentication becomes a formality they
// perform against themselves.
//
// An unverified `mobile` is not a destination. Legacy rows carry phone numbers
// that were typed at signup and never proven, so they may belong to a stranger
// — mailing a deletion code there would be both useless and a nuisance to the
// person who actually owns the number. `email` is usable because every path
// that sets it (email OTP sign-in, Google) proved control of it first.
function reauthDestination(owner) {
  if (!owner) return null;

  if (owner.mobileVerified === true && isNonEmptyString(owner.mobile)) {
    const mobile = String(owner.mobile);
    return { channel: "mobile", identifier: mobile, hint: `••••${mobile.slice(-4)}` };
  }

  if (isNonEmptyString(owner.email)) {
    const email = String(owner.email);
    const [name, domain] = email.split("@");
    // Enough to recognise your own address, not enough to learn a new one.
    const maskedName = name.length <= 2 ? `${name[0] || ""}•` : `${name.slice(0, 2)}•••`;
    return { channel: "email", identifier: email, hint: domain ? `${maskedName}@${domain}` : maskedName };
  }

  return null;
}

export function registerOwnerRoutes(app, env) {
  app.get("/api/owner/dashboard", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);

    if (blocked) {
      return blocked;
    }

    const collections = await getCollections(env);
    const ownerId = toObjectId(request.session.userId);

    const owner = await collections.owners.findOne({ _id: ownerId });

    // A live session whose account is gone. This is reachable: deactivating a
    // field-demo sticker deletes the throwaway account the activation wizard
    // created for the customer, and the cookie outlives it. Everything below
    // dereferences `owner`, so without this the route threw a TypeError and
    // answered 500 — a server error where the caller should simply be sent
    // back to sign in.
    //
    // The cookie goes too. Answering 401 while leaving it in place means the
    // browser keeps replaying a session that can never work again, and every
    // page load pays for another round trip to be told the same thing.
    if (!owner) {
      await clearSession(app, request, reply);
      reply.code(401);
      return { ok: false, error: "Authentication required" };
    }

    // Single source of truth: every vehicle is a real tag. Lazily migrate any
    // legacy owner.localVehicles[] into real E-Tags (each gets its own unique
    // secure token + QR), then clear them so they never show twice.
    let tags = await collections.tags
      .find({ ownerId, deletedAt: { $in: [null, undefined] } })
      .toArray();

    const legacyLocals = owner.localVehicles || [];
    if (legacyLocals.length) {
      const havePlates = new Set(
        tags.map((t) => (t.plateNumber || "").toUpperCase()).filter(Boolean)
      );
      for (const v of legacyLocals) {
        const plate = (v.number || "").toUpperCase();
        if (!plate || havePlates.has(plate)) continue;
        try {
          await createEtagForVehicle(collections, ownerId, { type: v.type, number: v.number });
          havePlates.add(plate);
        } catch (_) { /* skip malformed legacy rows */ }
      }
      await collections.owners.updateOne({ _id: ownerId }, { $set: { localVehicles: [] } });
      tags = await collections.tags
        .find({ ownerId, deletedAt: { $in: [null, undefined] } })
        .toArray();
    }

    const requests = await collections.contactRequests
      .find({ ownerId })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    // Resolved server-side so the greeting, the My Info panel and the address
    // form all agree. The browser used to guess a name out of the email itself,
    // which is how "info@" became "Hi Info".
    const addressForName = await collections.addresses.findOne({ ownerId });
    const resolvedName = resolveOwnerName(owner, addressForName);

    return {
      ok: true,
      owner: {
        // No `_id`. It is the ObjectId every /api/owner/* route keys off, and
        // /api/session already refuses to hand it out for exactly that reason —
        // this route was quietly undoing that. Nothing in the page needs it: the
        // browser identifies the signed-in owner by email or mobile, and the
        // server never accepts an owner id from the client anyway, so sending it
        // only widened what a script on this page could read. That matters more
        // here than elsewhere because the dashboard is not one of the
        // STRICT_SCRIPT_PAGES — its CSP still permits inline script.
        email: owner.email || null,
        mobile: owner.mobile || null,
        // What this person typed to sign in, so the header can echo it back
        // instead of ranking email above mobile and showing an address to
        // somebody who signed in with a phone number. Null on sessions created
        // before the field existed — the page falls back to email/mobile.
        signInIdentifier: request.session.signInIdentifier || null,
        // Only a name the owner actually set. A stored identifier reads as
        // "no name", so the dashboard offers to collect one instead of
        // greeting them with their own phone number.
        displayName: isIdentifierNotAName(owner.displayName, owner)
          ? null
          : cleanName(owner.displayName),
        // What to put after "Hi" — null means the dashboard says "there".
        greetingName: firstNameOf(resolvedName),
        // Whether that name is stored on the profile or merely inferred, so the
        // dashboard knows to offer "add your name" rather than "edit".
        hasOwnName: Boolean(cleanName(owner.displayName) &&
          !isIdentifierNotAName(owner.displayName, owner)),
        credits: owner.credits || 0
      },
      tags: await Promise.all(tags.map(async (tag) => {
        const scanUrl = buildTagScanUrl(request, tag.token);
        const qrDataUrl = await createQrDataUrl(scanUrl);
        return {
          id: String(tag._id),
          // Stays, unlike owner._id above, and the difference is worth stating
          // because an audit will otherwise flag the two together every time.
          // This token is not withheld from the owner by anything: it is printed
          // on their own sticker, it is encoded in the QR image returned two
          // fields down, and `scanUrl` right below spells it out in full. It is
          // also load-bearing — contact requests reference their tag by token,
          // so the page matches them on it. Removing it would break that while
          // leaking nothing, since scanUrl would still carry the same value.
          token: tag.token,
          etagId: etagIdFor(tag._id),
          serial: stickerSerialFor(tag),
          status: tag.status,
          vehicleType: tag.vehicleType || null,
          vehicleLabel: VEHICLE_LABELS[tag.vehicleType] || tag.vehicleLabel || "Vehicle",
          plateNumber: tag.plateNumber || null,
          printStatus: tag.printStatus || "not_requested",
          stickerRequested: tag.stickerRequested || false,
          premium: tag.premium || false,
          purchaseStatus: tag.purchaseStatus || "none",
          freeContactUsed: tag.freeContactUsed || false,
          // Whether masked calling is running on this tag, and why. The page
          // needs the reason as well as the answer: "not available" and "ends
          // in 5 days" are the same boolean and completely different messages.
          // Sent as the entitlement rather than as a bare flag so the UI cannot
          // re-derive the rule and get a different answer from the server.
          callAccess: callEntitlement(tag),
          // Returned in full (not masked) because this is the owner's own
          // session reading back a number they typed, so the SOS field can
          // prefill on any device instead of only where it was first saved.
          emergencyContact: tag.emergencyContact || null,
          scanUrl,
          qrDataUrl
        };
      })),
      requests: requests.map((item) => ({
        id: String(item._id),
        token: item.token,
        phone: item.phone,
        action: item.action,
        messageChannel: item.messageChannel || null,
        reason: item.reason || null,
        message: item.message || null,
        status: item.status,
        callResult: item.callResult || null,
        // Normalised "answered" | "missed" | "failed" | null — see
        // lib/core/call-outcome.js. The page decides whether to offer a
        // callback from this, rather than trying to read Exotel's own
        // vocabulary (which it previously did, and got wrong).
        callOutcome: item.callOutcome || null,
        callDuration: typeof item.callDuration === "number" ? item.callDuration : null,
        provider: item.provider || null,
        providerRequestId: item.providerRequestId || null,
        providerWebhookStatus: item.providerWebhookStatus || null,
        providerError: item.providerError || null,
        createdAt: item.createdAt,
        // When the provider last told us anything about this contact. For a
        // call that is the closest thing we have to when it ended, so the
        // activity log can show more than the moment it started.
        updatedAt: item.updatedAt || null
      })),
      // Sent rather than duplicated as a constant in the page, so the button
      // the browser draws and the window the server enforces cannot drift
      // apart. The route re-checks regardless — a stale button gets a clean
      // 410, never a call it should not have placed.
      callbackWindowMs: CALLBACK_WINDOW_MS
    };
  });

  // Send an OTP to the number the owner wants to save as their callback mobile.
  // The number becomes the phone the masked-call feature dials, so it must be
  // proven with an OTP before it can be stored — otherwise an owner could point
  // it at a victim's number and make the system call them (harassment), or save
  // unvalidated junk. Same gate the COD flow uses (codVerifiedPhone).
  app.post(
    "/api/owner/mobile/send-otp",
    { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;

      const { mobile } = request.body || {};
      if (!mobile || !isMobileIdentifier(mobile)) {
        reply.code(400);
        return { ok: false, error: "Enter a valid mobile number." };
      }

      const collections = await getCollections(env);
      if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

      try {
        // Scoped: proving control of a number before linking it is not a
        // sign-in, and this endpoint takes the number straight from the request
        // body — so as an `auth` code it was a way to have a working sign-in
        // code sent to any number the caller named.
        await sendOtp(env, mobile, { purpose: OTP_PURPOSE_LINK_MOBILE });
        return { ok: true, phoneHint: "••••" + String(normalizeIdentifier(mobile)).slice(-4) };
      } catch (err) {
        request.log.error({ err }, "owner mobile OTP send failed");
        reply.code(500);
        return { ok: false, error: "Could not send the verification code. Please try again." };
      }
    }
  );

  app.post("/api/owner/mobile", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const { mobile, otp } = request.body || {};
    if (!mobile || !isMobileIdentifier(mobile)) {
      reply.code(400);
      return { ok: false, error: "Enter a valid mobile number." };
    }
    // No code supplied yet → tell the client to run the OTP step (not an error).
    if (!otp) {
      return { ok: false, needsOtp: true };
    }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    // Prove control of the number before saving it. verifyOtp throws a
    // client-safe message on a bad/expired/rate-limited code.
    try {
      await verifyOtp(env, mobile, String(otp), { purpose: OTP_PURPOSE_LINK_MOBILE });
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err && err.message ? err.message : "Invalid verification code." };
    }

    const normalized = normalizeIdentifier(mobile);
    const ownerId = toObjectId(request.session.userId);
    await collections.owners.updateOne(
      { _id: ownerId },
      { $set: { mobile: normalized, mobileVerified: true } }
    );
    return { ok: true, mobile: normalized };
  });

  // Generate (or fetch existing) a real, scannable E-Tag for a vehicle.
  // Returns a high-resolution QR linked to a 256-bit secure token. This is what
  // the print/PDF flow now uses instead of the old demo QR placeholder.
  app.post("/api/owner/etag/generate", { config: { rateLimit: { max: 20, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const { type, number } = request.body || {};
    if (!number) {
      reply.code(400);
      return { ok: false, error: "Vehicle number is required." };
    }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);

    let result;
    try {
      result = await createEtagForVehicle(collections, ownerId, { type, number });
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error instanceof Error ? error.message : "Could not generate E-Tag." };
    }

    const { tag } = result;
    const scanUrl = buildTagScanUrl(request, tag.token);
    const qrDataUrl = await createPrintQrDataUrl(scanUrl);

    return {
      ok: true,
      etag: {
        id: String(tag._id),
        token: tag.token,
        etagId: etagIdFor(tag._id),
        serial: stickerSerialFor(tag),
        vehicleType: tag.vehicleType || type || null,
        plateNumber: tag.plateNumber,
        status: tag.status,
        createdAt: tag.createdAt,
        scanUrl,
        qrDataUrl
      }
    };
  });

  // Add a vehicle. Every added vehicle becomes a real, scannable E-Tag with its
  // own unique 256-bit secure token + QR (single source of truth in `tags`).
  // Kept at this path for frontend compatibility. Idempotent: re-adding the same
  // plate returns 409 (the existing E-Tag is reused, never duplicated).
  app.post("/api/owner/local-vehicle", { config: { rateLimit: { max: 20, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const { type, number } = request.body || {};
    if (!type || !number) {
      reply.code(400);
      return { ok: false, error: "Vehicle type and number required." };
    }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);

    let result;
    try {
      result = await createEtagForVehicle(collections, ownerId, { type, number });
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error instanceof Error ? error.message : "Could not add vehicle." };
    }

    if (!result.created) {
      reply.code(409);
      return { ok: false, error: "Vehicle already added." };
    }
    return { ok: true, id: String(result.tag._id), token: result.tag.token };
  });

  // ── Profile ───────────────────────────────────────────────────────
  // Sets the name shown on the dashboard. There was no way for an owner to
  // record a name at all before this: sign-in collects an email or a mobile and
  // nothing else, and the field it landed in was the identifier itself.
  app.patch("/api/owner/profile", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    const owner = await collections.owners.findOne({ _id: ownerId });
    if (!owner) { reply.code(404); return { ok: false, error: "Owner not found." }; }

    // An empty value clears the name rather than erroring — the inline field
    // has to be undoable, and "" is how the browser says "I changed my mind".
    const raw = request.body?.displayName;
    const name = cleanName(raw);

    if (raw != null && String(raw).trim() !== "" && !name) {
      reply.code(400);
      return { ok: false, error: "Please enter at least 2 characters." };
    }

    // Refusing the identifier keeps the very problem this endpoint exists to fix
    // from being typed straight back in.
    if (name && isIdentifierNotAName(name, owner)) {
      reply.code(400);
      return { ok: false, error: "Please enter your name, not your phone number or email." };
    }

    await collections.owners.updateOne(
      { _id: ownerId },
      { $set: { displayName: name, updatedAt: new Date().toISOString() } }
    );

    // The session carries displayName for other screens; leaving it stale would
    // show the old name until the owner signed out and back in.
    if (request.session) request.session.displayName = name;

    const address = await collections.addresses.findOne({ ownerId });
    const resolved = resolveOwnerName({ ...owner, displayName: name }, address);
    return {
      ok: true,
      displayName: name,
      greetingName: firstNameOf(resolved),
      hasOwnName: Boolean(name)
    };
  });

  // ── Delivery address (physical sticker shipping) ──────────────────
  // One saved address per owner, reused across purchases. Returns the saved
  // address so the checkout form can prefill it on repeat buys.
  app.get("/api/owner/address", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    const doc = await collections.addresses.findOne({ ownerId });
    return { ok: true, address: doc ? shapeAddress(doc) : null };
  });

  // Validate and upsert the owner's delivery address before checkout.
  app.post("/api/owner/address", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const result = validateAddress(request.body);
    if (!result.ok) { reply.code(400); return { ok: false, error: result.error }; }

    // Fail OPEN on a Delhivery outage (serviceable === null) — only an
    // explicit "not serviceable" answer blocks saving the address.
    const { serviceable } = await checkPincodeServiceability(env, result.address.pincode);
    if (serviceable === false) {
      reply.code(400);
      return { ok: false, error: `Sorry, we can't currently deliver to PIN code ${result.address.pincode}.` };
    }

    const ownerId = toObjectId(request.session.userId);
    const now = new Date().toISOString();
    await collections.addresses.updateOne(
      { ownerId },
      { $set: { ...result.address, updatedAt: now }, $setOnInsert: { ownerId, createdAt: now } },
      { upsert: true }
    );

    // The recipient name typed here is the only real name most owners ever give
    // us, so adopt it as the profile name when there isn't one. Deliberately
    // only fills a gap: an owner who set their own name keeps it, even if they
    // ship to someone else.
    const owner = await collections.owners.findOne({ _id: ownerId });
    const recipient = cleanName(result.address.fullName);
    if (owner && recipient &&
        isIdentifierNotAName(owner.displayName, owner) &&
        !isIdentifierNotAName(recipient, owner)) {
      await collections.owners.updateOne(
        { _id: ownerId },
        { $set: { displayName: recipient, updatedAt: now } }
      );
      if (request.session) request.session.displayName = recipient;
    }

    return { ok: true, address: result.address };
  });

  // Shop orders for this owner — both prepaid ("paid") and Cash-on-Delivery
  // ("cod"), so a COD buyer can see and track the order they just placed.
  // Best-effort live tracking status for any order that already has a Delhivery
  // waybill. Tracking lookups run in parallel and never throw (see
  // trackShipment) — a Delhivery hiccup shows "status unavailable" for that
  // order, not a broken endpoint.
  app.get("/api/owner/orders", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    const orders = await collections.shopOrders
      .find({ ownerId, status: { $in: ["paid", "cod"] } })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    const withTracking = await Promise.all(orders.map(async (order) => {
      const tracking = await getOrderTracking(collections, env, order);
      const isCod = order.status === "cod";
      return {
        id: String(order._id),
        orderNumber: order.orderNumber || null,
        productName: order.productName,
        amount: order.amount,
        currency: order.currency,
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
        trackingInstructions: tracking?.instructions || null,
        // Whether an in-app timeline is worth opening (has a waybill).
        trackable: Boolean(order.waybill)
      };
    }));

    return { ok: true, orders: withTracking };
  });

  // Full in-app tracking timeline for a single order — the checkpoint history
  // (Manifested → Picked up → In Transit → Out for delivery → Delivered) so the
  // buyer can follow the parcel without leaving the app. Cached per order (see
  // getOrderTracking); best-effort, so a Delhivery hiccup yields an empty
  // timeline rather than an error.
  app.get("/api/owner/orders/:id/track", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const orderId = tryObjectId(request.params.id);
    if (!orderId) { reply.code(400); return { ok: false, error: "Invalid order id" }; }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    // Scope to this owner — never let one owner read another's order/waybill.
    const order = await collections.shopOrders.findOne({ _id: orderId, ownerId });
    if (!order) { reply.code(404); return { ok: false, error: "Order not found." }; }

    const tracking = await getOrderTracking(collections, env, order);

    return {
      ok: true,
      orderNumber: order.orderNumber || null,
      productName: order.productName || null,
      waybill: order.waybill || null,
      trackingUrl: order.waybill ? trackingUrl(order.waybill) : null,
      status: tracking?.status || (order.waybill ? "booked" : null),
      statusDateTime: tracking?.statusDateTime || null,
      scans: Array.isArray(tracking?.scans) ? tracking.scans : []
    };
  });

  // The old in-place ₹199 premium-upgrade endpoints (purchase-order /
  // purchase-verify) were removed in M18. Premium tags are now bought through
  // the shop (rate list); a paid shop order mints a new premium tag and
  // soft-removes the spent free-trial tag. See routes/shop/index.js.

  app.post("/api/owner/tags/:tagId/request-sticker", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const ownerId = toObjectId(request.session.userId);
    const tagId = tryObjectId(request.params.tagId);
    if (!tagId) { reply.code(400); return { ok: false, error: "Invalid tag id" }; }

    const result = await collections.tags.findOneAndUpdate(
      { _id: tagId, ownerId },
      { $set: { stickerRequested: true, printStatus: "pending_print", stickerRequestedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );

    if (!result) {
      reply.code(404);
      return { ok: false, error: "Tag not found" };
    }

    return { ok: true, printStatus: "pending_print" };
  });

  app.post("/api/owner/tags/:tagId/status", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);

    if (blocked) {
      return blocked;
    }

    const { status } = request.body || {};

    if (!status || !["active", "inactive"].includes(status)) {
      reply.code(400);
      return {
        ok: false,
        error: "status must be active or inactive"
      };
    }

    const collections = await getCollections(env);
    const ownerId = toObjectId(request.session.userId);
    const tagId = tryObjectId(request.params.tagId);
    if (!tagId) { reply.code(400); return { ok: false, error: "Invalid tag id" }; }

    const result = await collections.tags.findOneAndUpdate(
      {
        _id: tagId,
        ownerId
      },
      {
        $set: {
          status
        }
      },
      {
        returnDocument: "after"
      }
    );

    if (!result) {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found"
      };
    }

    return {
      ok: true,
      tag: {
        id: String(result._id),
        status: result.status
      }
    };
  });

  // ── Emergency / SOS contact ───────────────────────────────────────────
  // The owner's next of kin for this vehicle. Stored per TAG, not per owner,
  // because a household can tag several vehicles and want a different person
  // reachable for each. Send an empty string to clear it.
  //
  // Until now this number only ever lived in the browser's localStorage, so it
  // existed on exactly one device and the server could not dial it. Persisting
  // it here is what makes the scanner-side SOS button able to connect anyone.
  app.post("/api/owner/tags/:tagId/emergency-contact", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const raw = String((request.body || {}).emergencyContact ?? "").trim();
    const digits = raw.replace(/\D/g, "");

    // Required, and no longer clearable. This number is the whole of the SOS
    // feature: a scanner standing at a crash gets the owner's next of kin only
    // if one is recorded. Allowing it to be emptied meant the button could be
    // switched off silently, from the one screen where that is least visible.
    if (!raw) {
      reply.code(400);
      return { ok: false, error: "An emergency contact is required — this is who we call in an accident." };
    }

    // Demand something that can actually be dialled. 7-15 digits covers every
    // E.164 national number.
    if (digits.length < 7 || digits.length > 15) {
      reply.code(400);
      return { ok: false, error: "Enter a valid emergency contact number." };
    }

    const collections = await getCollections(env);
    const ownerId = toObjectId(request.session.userId);
    const tagId = tryObjectId(request.params.tagId);
    if (!tagId) { reply.code(400); return { ok: false, error: "Invalid tag id" }; }

    const emergencyContact = toE164(raw);

    // Guard against an owner pointing the SOS at the tag's own masked-call
    // number or at their own mobile — in an accident that reaches nobody new.
    const owner = await collections.owners.findOne({ _id: ownerId });
    const ownerPhone = owner ? toE164(owner.mobile || owner.phone || "") : null;
    if (emergencyContact && ownerPhone && emergencyContact === ownerPhone) {
      reply.code(400);
      return {
        ok: false,
        error: "Use a number other than your own — this is who we call when you cannot answer."
      };
    }

    const result = await collections.tags.findOneAndUpdate(
      { _id: tagId, ownerId, deletedAt: { $in: [null, undefined] } },
      { $set: { emergencyContact, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );

    if (!result) {
      reply.code(404);
      return { ok: false, error: "Tag not found" };
    }

    return { ok: true, emergencyContact: result.emergencyContact || null };
  });

  app.delete("/api/owner/tags/:tagId", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const ownerId = toObjectId(request.session.userId);
    const tagId = tryObjectId(request.params.tagId);
    if (!tagId) { reply.code(400); return { ok: false, error: "Invalid tag id" }; }

    const result = await collections.tags.findOneAndUpdate(
      { _id: tagId, ownerId, deletedAt: { $in: [null, undefined] } },
      { $set: { deletedAt: new Date().toISOString(), status: "inactive", updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );

    if (!result) {
      reply.code(404);
      return { ok: false, error: "Tag not found" };
    }

    // The tag is soft-deleted, but its documents must go for real. ownedTag()
    // in the vault routes requires `deletedAt: null`, so once the tag is
    // deleted the owner can no longer list, view or delete anything filed under
    // it — the rows and their bytes would sit there permanently, out of reach
    // and still counted against the 40MB storage quota. Deleting a vehicle is
    // the owner asking for its paperwork to go too.
    const purged = await purgeVaultDocuments(
      collections,
      await getVaultBucket(env),
      { ownerId, tagId: String(tagId) }
    );
    if (purged.orphanedBlobs) {
      request.log.error(
        { event: "vault-purge-orphans", tagId: String(tagId), orphanedBlobs: purged.orphanedBlobs },
        "[vault] vehicle deleted but some document blobs could not be removed — sweep required"
      );
    }

    return { ok: true };
  });

  // Set or change the account password.
  //
  // Two properties this must hold, neither of which it used to:
  //
  //  1. CHANGING an existing password requires proving the current one. Without
  //     that check a session alone was enough to overwrite it, so anyone who got
  //     hold of a cookie could lock the real owner out and convert temporary
  //     access into permanent credentials. Accounts with no password yet
  //     (mobile-OTP or Google sign-ups) are SETTING one for the first time, so
  //     there is nothing to prove — the session is the only credential they have
  //     and demanding a password they never had would lock them out of the
  //     feature entirely.
  //  2. A successful change revokes every OTHER session, which is what makes
  //     "change your password" an effective response to a suspected compromise.
  //     resetPassword() already did this; this route did not, so the attacker's
  //     session survived the very action taken to evict them. The CURRENT
  //     session is deliberately kept alive so the owner isn't logged out of the
  //     tab they just used.
  app.post(
    "/api/owner/set-password",
    { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;

      const { password, currentPassword } = request.body || {};
      if (!isNonEmptyString(password) || password.length < 8) {
        reply.code(400);
        return { ok: false, error: "Password must be at least 8 characters" };
      }

      const collections = await getCollections(env);
      if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

      const ownerId = toObjectId(request.session.userId);
      const owner = await collections.owners.findOne({ _id: ownerId });
      if (!owner) {
        reply.code(404);
        return { ok: false, error: "Account not found." };
      }

      if (owner.passwordHash) {
        if (!isNonEmptyString(currentPassword)) {
          reply.code(400);
          return {
            ok: false,
            code: "CURRENT_PASSWORD_REQUIRED",
            error: "Enter your current password to change it."
          };
        }
        const { valid } = await verifyPassword(currentPassword, owner.passwordHash);
        if (!valid) {
          reply.code(401);
          return { ok: false, error: "Incorrect current password." };
        }
      }

      const hash = await createPasswordHash(password);
      await collections.owners.updateOne(
        { _id: ownerId },
        { $set: { passwordHash: hash } }
      );

      // Evict every other session for this account (see note 2 above).
      await collections.sessions
        .deleteMany({ userId: String(ownerId), _id: { $ne: request.session.id } })
        .catch(() => {});

      return { ok: true };
    }
  );

  // Send the confirmation code that DELETE /api/owner/account requires from an
  // account with no password. Split from the delete itself so that merely
  // opening the confirmation dialog does not dispatch a message, and so a
  // caller probing the delete endpoint cannot use it to spray codes at the
  // owner's phone.
  app.post(
    "/api/owner/account/send-delete-code",
    { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;

      const collections = await getCollections(env);
      if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

      const ownerId = toObjectId(request.session.userId);
      const owner = await collections.owners.findOne({ _id: ownerId });
      if (!owner) {
        reply.code(404);
        return { ok: false, error: "Account not found." };
      }

      // An account that has a password re-authenticates with it; issuing a code
      // as well would just add a second way in.
      if (owner.passwordHash) {
        reply.code(400);
        return { ok: false, code: "PASSWORD_REQUIRED", error: "Enter your password to confirm." };
      }

      const destination = reauthDestination(owner);
      if (!destination) {
        reply.code(409);
        return {
          ok: false,
          code: "NO_DESTINATION",
          error:
            "Add and verify a mobile number or email on your account before deleting it."
        };
      }

      try {
        await sendOtp(env, destination.identifier, { purpose: OTP_PURPOSE_DELETE_ACCOUNT });
      } catch (err) {
        // sendOtp raises a client-safe ClientError for the conditions an owner
        // can act on — on the email channel the per-destination flood cap is the
        // only one. Everything else collapses to a generic message and is
        // logged. 429 is exact for the cap and merely imprecise for the two
        // WhatsApp misconfiguration throws, which are server faults the owner
        // could not tell apart in any case.
        const exposable = err && err.expose === true;
        reply.code(exposable ? 429 : 500);
        return {
          ok: false,
          error: clientErrorMessage(
            err,
            "Could not send the confirmation code. Please try again.",
            request.log
          )
        };
      }

      return { ok: true, channel: destination.channel, hint: destination.hint };
    }
  );

  // Permanently delete the owner's account and every record tied to it.
  //
  // This is the most destructive action in the app and there is no undo, so a
  // session cookie on its own is never enough — a stale or stolen one would
  // otherwise be a complete account wipe. What counts as proof depends on what
  // the account actually has:
  //
  //   • a password  → re-enter it.
  //   • no password → a fresh single-use code, sent by the route above to the
  //     destination on the OWNER RECORD. OTP sign-up is the default path here,
  //     so this is the common case, and it used to fall through to session-only
  //     auth: an empty body plus a cookie deleted the account outright.
  //
  // Neither branch tells the caller anything they could not already read off
  // their own dashboard, so the "which is it" reply below leaks nothing.
  app.delete(
    "/api/owner/account",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;

      const collections = await getCollections(env);
      if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

      const ownerId = toObjectId(request.session.userId);
      const owner = await collections.owners.findOne({ _id: ownerId });
      if (!owner) {
        reply.code(404);
        return { ok: false, error: "Account not found." };
      }

      if (owner.passwordHash) {
        const { password } = request.body || {};
        if (!isNonEmptyString(password)) {
          reply.code(400);
          return { ok: false, code: "PASSWORD_REQUIRED", error: "Password is required." };
        }

        const { valid } = await verifyPassword(password, owner.passwordHash);
        if (!valid) {
          reply.code(401);
          return { ok: false, error: "Incorrect password." };
        }
      } else {
        const destination = reauthDestination(owner);
        if (!destination) {
          reply.code(409);
          return {
            ok: false,
            code: "NO_DESTINATION",
            error:
              "Add and verify a mobile number or email on your account before deleting it."
          };
        }

        // No code supplied yet → tell the client to run the code step. Same
        // two-step contract as POST /api/owner/mobile, and deliberately not an
        // error: it is the first half of a normal deletion.
        const { otp } = request.body || {};
        if (!isNonEmptyString(otp)) {
          reply.code(400);
          return {
            ok: false,
            needsOtp: true,
            code: "OTP_REQUIRED",
            channel: destination.channel,
            hint: destination.hint,
            error: "Enter the confirmation code we sent you."
          };
        }

        // Scoped to this purpose, so a sign-in code cannot stand in for it, and
        // marked used on success, so the code cannot delete anything twice.
        try {
          await verifyOtp(env, destination.identifier, otp, {
            purpose: OTP_PURPOSE_DELETE_ACCOUNT
          });
        } catch (err) {
          reply.code(400);
          return {
            ok: false,
            code: "OTP_INVALID",
            error: clientErrorMessage(err, "Invalid confirmation code.", request.log)
          };
        }
      }

      // The document vault goes FIRST and is awaited on its own. These are
      // identity documents — an RC, a driving licence, an insurance policy —
      // and they used to survive the account outright: this handler wiped the
      // five collections below and nothing in the app has ever swept the vault.
      // Failing here must abort the deletion rather than proceed, otherwise the
      // owner record disappears and takes with it the only link back to the
      // documents that are still stored.
      const purged = await purgeVaultDocuments(
        collections,
        await getVaultBucket(env),
        { ownerId }
      );
      if (purged.orphanedBlobs) {
        request.log.error(
          { event: "vault-purge-orphans", orphanedBlobs: purged.orphanedBlobs },
          "[vault] account deleted but some document blobs could not be removed — sweep required"
        );
      }

      await Promise.all([
        collections.tags.deleteMany({ ownerId }),
        collections.contactRequests.deleteMany({ ownerId }),
        collections.shopOrders.deleteMany({ ownerId }),
        collections.addresses.deleteMany({ ownerId }),
        collections.pendingCalls.deleteMany({ ownerId }),
        // Any standing vault unlock. Keyed by session id, so it is not reachable
        // through the owner record and would otherwise outlive it.
        collections.vaultGrants.deleteMany({ ownerId: String(ownerId) }),
        // The storage counter goes with the owner it belongs to.
        deleteUsage(collections, ownerId)
      ]);
      await collections.owners.deleteOne({ _id: ownerId });

      // EVERY session, not just the one making the request. clearSession below
      // only removes the caller's, so a second signed-in device kept a working
      // session for a deleted account for the rest of its 7-day life — and
      // readSession does not check that the owner still exists, so that session
      // authenticated normally and could still download the vault.
      await collections.sessions
        .deleteMany({ userId: String(ownerId) })
        .catch(() => {});

      // Must be awaited. clearSession only reaches `reply.clearCookie` after an
      // `await` on the session collection, so firing it off unawaited let the
      // response serialise first and the Set-Cookie header never made it out —
      // the browser kept a cookie for a deleted account.
      await clearSession(app, request, reply);
      return { ok: true };
    }
  );

  // Owner calls back the most recent scanner who contacted them within 60 minutes.
  // No phone input — owner's phone comes from their profile (owner.mobile).
  app.post("/api/owner/callback/register-call", { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    if (!env.exotelCallerId) {
      reply.code(503);
      return { ok: false, error: "Call service is not configured." };
    }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    await ensurePendingCallsIndexes(collections);

    const ownerId = toObjectId(request.session.userId);
    const owner = await collections.owners.findOne({ _id: ownerId });

    // Calling a scanner back is a premium feature.
    //
    // Premium is a property of the TAG, never of the account: every other paid
    // behaviour in the app (contactAvailable, unlimitedContact, the free-contact
    // gate) is decided by `tag.premium` for the specific tag that was scanned,
    // and there is no owner-level premium flag anywhere. So eligibility is
    // scoped to contacts that ARRIVED ON a premium tag, not to owners who
    // happen to own one — otherwise a single premium purchase would quietly
    // unlock callback for every E-Tag on the account.
    //
    // Deleted tags are excluded so that this agrees with the dashboard, which
    // builds its own tag list the same way. A button the page draws and a route
    // that refuses it is worse than either answer on its own.
    // Premium alone is no longer enough. Masking runs for 45 days from purchase
    // and then needs a subscription, and calling a scanner back IS a masked
    // call — so a tag whose window has closed must not still offer one. The
    // decision comes from callEntitlement so this route, the scanner's
    // availability check and register-call cannot disagree about the same tag.
    //
    // The extra fields are projected because the entitlement needs them; a
    // token-only projection would make every tag look like it had no trial and
    // no subscription, which reads as lapsed and would switch callback off for
    // everyone.
    const callableTags = await collections.tags
      .find(
        { ownerId, premium: true, deletedAt: { $in: [null, undefined] } },
        { projection: { token: 1, premium: 1, premiumSince: 1, createdAt: 1, callSubscription: 1, freeContactUsed: 1 } }
      )
      .toArray();

    const premiumTokens = callableTags
      .filter((tag) => callEntitlement(tag).masking)
      .map((tag) => tag.token);

    if (!premiumTokens.length) {
      // Distinguishing the two cases matters: "buy a premium tag" is useless
      // advice to somebody who already owns one and whose 45 days have run out.
      const lapsed = callableTags.length > 0;
      reply.code(402);
      return {
        ok: false,
        code: lapsed ? "CALL_SUBSCRIPTION_REQUIRED" : "PREMIUM_REQUIRED",
        error: lapsed ? CALL_SUBSCRIPTION_REQUIRED_MESSAGE : PREMIUM_REQUIRED_MESSAGE
      };
    }

    const ownerPhone = owner?.mobile || null;
    if (!ownerPhone) {
      reply.code(402);
      return { ok: false, code: "NO_PHONE", error: "Add your phone number to enable callback." };
    }

    const windowStart = new Date(Date.now() - CALLBACK_WINDOW_MS).toISOString();

    // Which contact are we returning? The activity list now puts a button on
    // each row, so the caller names one. Without an id this still resolves the
    // most recent, which is what the single banner button has always sent.
    //
    // `ownerId` is part of the filter and NOT taken from the body: an id is a
    // client-supplied value, and looking it up without scoping it to the signed
    // -in owner would let anyone holding a session dial the scanner attached to
    // somebody else's tag by guessing an ObjectId.
    const { requestId } = request.body || {};

    // Validate the shape before it is used, so a junk id is a 400 rather than
    // being quietly ignored and answered as if it had matched.
    let wanted = null;
    if (requestId !== undefined && requestId !== null) {
      wanted = tryObjectId(requestId);
      if (!wanted) {
        reply.code(400);
        return { ok: false, error: "Invalid request id." };
      }
    }

    // The MOST RECENT contact, and only that one.
    //
    // Not "any contact inside the window": returning an older one means ringing
    // somebody who reported something, was answered or gave up, and has since
    // moved on — while the person who just called is left waiting. If two
    // people contacted the same vehicle, the live conversation is the newer.
    //
    // Resolved here rather than trusted from the body, so a stale page holding
    // yesterday's row id cannot dial its way past this.
    const filter = {
      ownerId,
      token: { $in: premiumTokens },
      phone: { $exists: true, $ne: null },
      createdAt: { $gte: windowStart }
    };

    // Note what this filter does NOT do: refuse a call that was answered.
    //
    // The activity list stops OFFERING a callback once a conversation
    // demonstrably happened (see canCallBack in welcome.js), and that is a
    // presentation rule. This route's job is authorisation — whose contact it
    // is, and whether it is still inside the window — and neither is affected
    // by how the call went. An owner who cuts off after four seconds and wants
    // to redial is doing something entirely legitimate, and refusing it here
    // would turn a tidier list into a dead end.
    const recentContact = await collections.contactRequests.findOne(filter, {
      sort: { createdAt: -1 }
    });

    // Before falling back to "the window has passed": if the row they named is
    // real and theirs and simply arrived on an E-Tag, say THAT. Telling an owner
    // their ten minutes ran out on a contact from one minute ago would send them
    // looking for a bug instead of at the upgrade that would fix it.
    if (wanted) {
      const named = await collections.contactRequests.findOne({ _id: wanted, ownerId });
      if (named && !premiumTokens.includes(named.token)) {
        // Same split as the account-level check above. A contact that arrived
        // on a premium tag whose call window has closed is NOT an upgrade
        // prompt — that owner is holding the sticker this would tell them to
        // buy. `callableTags` is the unfiltered premium list, so presence there
        // with absence from premiumTokens is exactly "premium but lapsed".
        const lapsedTag = callableTags.some((tag) => tag.token === named.token);
        reply.code(402);
        return {
          ok: false,
          code: lapsedTag ? "CALL_SUBSCRIPTION_REQUIRED" : "PREMIUM_REQUIRED",
          error: lapsedTag ? CALL_SUBSCRIPTION_REQUIRED_MESSAGE : PREMIUM_REQUIRED_MESSAGE
        };
      }
    }

    if (!recentContact) {
      reply.code(410);
      return {
        ok: false,
        code: "CALLBACK_WINDOW_EXPIRED",
        error: "The 10-minute callback window for this contact has passed."
      };
    }

    // A named row that is not the newest one. The page should not be offering
    // it, so this is either a tab left open while another call arrived, or a
    // request built by hand. Same answer either way.
    if (wanted && String(recentContact._id) !== String(wanted)) {
      reply.code(410);
      return {
        ok: false,
        code: "CALLBACK_NOT_LATEST",
        error: "Only your most recent contact can be called back."
      };
    }

    const now = new Date();

    await collections.pendingCalls.insertOne({
      callerPhone: toE164(ownerPhone),
      targetPhone: recentContact.phone,
      token: recentContact.token,
      ownerId,
      requestId: recentContact._id,
      type: "owner_to_scanner",
      consumed: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000)
    });

    return { ok: true, virtualNumber: env.exotelCallerId };
  });

}

function toE164(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}
