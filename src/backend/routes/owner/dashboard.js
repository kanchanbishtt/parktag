import { requireSession, toObjectId } from "../../lib/auth/auth.js";
import { createPasswordHash } from "../../lib/auth/security.js";
import { getCollections, ensurePendingCallsIndexes } from "../../lib/db/repositories.js";
import { createQrDataUrl, createPrintQrDataUrl } from "../../lib/core/qr-output.js";
import { createEtagForVehicle, buildTagScanUrl, VEHICLE_LABELS, etagIdFor } from "../../lib/core/tag-issuance.js";
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
  isRazorpayConfigured,
  STICKER_PRICE_INR
} from "../../lib/integrations/payments.js";
import { validateAddress, addressToNotes } from "../../lib/core/address.js";

// Strip an address DB doc down to the shippable fields (no _id/ownerId/timestamps).
function shapeAddress(doc) {
  const { fullName, phone, line1, line2, landmark, city, state, pincode } = doc;
  return { fullName, phone, line1, line2, landmark, city, state, pincode };
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

    return {
      ok: true,
      owner: {
        _id: String(owner._id),
        email: owner.email || null,
        mobile: owner.mobile || null,
        displayName: owner.displayName || request.session.displayName || null,
        credits: owner.credits || 0
      },
      tags: await Promise.all(tags.map(async (tag) => {
        const scanUrl = buildTagScanUrl(request, tag.token);
        const qrDataUrl = await createQrDataUrl(scanUrl);
        return {
          id: String(tag._id),
          token: tag.token,
          etagId: etagIdFor(tag._id),
          status: tag.status,
          vehicleType: tag.vehicleType || null,
          vehicleLabel: VEHICLE_LABELS[tag.vehicleType] || tag.vehicleLabel || "Vehicle",
          plateNumber: tag.plateNumber || null,
          printStatus: tag.printStatus || "not_requested",
          stickerRequested: tag.stickerRequested || false,
          premium: tag.premium || false,
          purchaseStatus: tag.purchaseStatus || "none",
          freeContactUsed: tag.freeContactUsed || false,
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
        callDuration: typeof item.callDuration === "number" ? item.callDuration : null,
        provider: item.provider || null,
        providerRequestId: item.providerRequestId || null,
        providerWebhookStatus: item.providerWebhookStatus || null,
        providerError: item.providerError || null,
        createdAt: item.createdAt
      }))
    };
  });

  app.post("/api/owner/mobile", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const { mobile } = request.body || {};
    if (!mobile) {
      reply.code(400);
      return { ok: false, error: "Mobile is required." };
    }

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    await collections.owners.updateOne(
      { _id: ownerId },
      { $set: { mobile } }
    );
    return { ok: true };
  });

  // Generate (or fetch existing) a real, scannable E-Tag for a vehicle.
  // Returns a high-resolution QR linked to a 256-bit secure token. This is what
  // the print/PDF flow now uses instead of the old demo QR placeholder.
  app.post("/api/owner/etag/generate", async (request, reply) => {
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
  app.post("/api/owner/local-vehicle", async (request, reply) => {
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

    const ownerId = toObjectId(request.session.userId);
    const now = new Date().toISOString();
    await collections.addresses.updateOne(
      { ownerId },
      { $set: { ...result.address, updatedAt: now }, $setOnInsert: { ownerId, createdAt: now } },
      { upsert: true }
    );

    return { ok: true, address: result.address };
  });

  // ── Premium purchase (official physical sticker) ──────────────────
  // Create a Razorpay order for upgrading a specific E-Tag to premium.
  app.post("/api/owner/tags/:tagId/purchase-order", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }
    if (!isRazorpayConfigured(env)) { reply.code(503); return { ok: false, error: "Payments are not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    const tagId = toObjectId(request.params.tagId);
    const tag = await collections.tags.findOne({ _id: tagId, ownerId, deletedAt: { $in: [null, undefined] } });
    if (!tag) { reply.code(404); return { ok: false, error: "Tag not found" }; }
    if (tag.premium) { reply.code(409); return { ok: false, error: "This E-Tag is already premium." }; }

    // A physical sticker ships to a real address — refuse to take money until we
    // have somewhere to send it. The checkout form saves the address first, so a
    // missing one here means a tampered/out-of-order request.
    const addressDoc = await collections.addresses.findOne({ ownerId });
    const shipping = addressDoc ? shapeAddress(addressDoc) : null;
    if (!shipping) { reply.code(400); return { ok: false, error: "Please add a delivery address before paying." }; }

    let order;
    try {
      order = await createRazorpayOrder(env, {
        amount: STICKER_PRICE_INR,
        receipt: `pt_sticker_${String(tag._id)}_${Date.now()}`.slice(0, 40),
        notes: { tagId: String(tag._id), plate: tag.plateNumber || "", ...addressToNotes(shipping) }
      });
    } catch (error) {
      reply.code(502);
      return { ok: false, error: error instanceof Error ? error.message : "Could not create order." };
    }

    await collections.tags.updateOne(
      { _id: tag._id },
      { $set: { "purchase.orderId": order.id, "purchase.status": "created", "purchase.amount": STICKER_PRICE_INR, "purchase.shippingAddress": shipping, updatedAt: new Date().toISOString() } }
    );

    return {
      ok: true,
      keyId: env.razorpayKeyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      productName: "Official ParkTag QR Sticker"
    };
  });

  // Verify the payment and upgrade the E-Tag to premium (re-enables contact).
  app.post("/api/owner/tags/:tagId/purchase-verify", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = request.body || {};

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    const tagId = toObjectId(request.params.tagId);
    const tag = await collections.tags.findOne({ _id: tagId, ownerId, deletedAt: { $in: [null, undefined] } });
    if (!tag) { reply.code(404); return { ok: false, error: "Tag not found" }; }

    const valid = verifyRazorpaySignature(env, {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature
    });
    // Bind the verified payment to the order we created for THIS tag.
    if (!valid || (tag.purchase?.orderId && tag.purchase.orderId !== razorpay_order_id)) {
      reply.code(400);
      return { ok: false, error: "Payment verification failed." };
    }

    const now = new Date().toISOString();
    await collections.tags.updateOne(
      { _id: tag._id },
      {
        $set: {
          premium: true,
          plan: "premium",
          physicalTagPurchased: true,
          purchaseStatus: "paid",
          premiumSince: now,
          stickerRequested: true,
          printStatus: "pending_print",
          "purchase.status": "paid",
          "purchase.paymentId": razorpay_payment_id,
          updatedAt: now
        }
      }
    );

    return { ok: true, premium: true };
  });

  app.post("/api/owner/tags/:tagId/request-sticker", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const ownerId = toObjectId(request.session.userId);
    const tagId = toObjectId(request.params.tagId);

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
    const tagId = toObjectId(request.params.tagId);

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

  app.delete("/api/owner/tags/:tagId", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const ownerId = toObjectId(request.session.userId);
    const tagId = toObjectId(request.params.tagId);

    const result = await collections.tags.findOneAndUpdate(
      { _id: tagId, ownerId, deletedAt: { $in: [null, undefined] } },
      { $set: { deletedAt: new Date().toISOString(), status: "inactive", updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );

    if (!result) {
      reply.code(404);
      return { ok: false, error: "Tag not found" };
    }

    return { ok: true };
  });

  app.post("/api/owner/set-password", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const { password } = request.body || {};
    if (!password || password.length < 8) {
      reply.code(400);
      return { ok: false, error: "Password must be at least 8 characters" };
    }

    const collections = await getCollections(env);
    const hash = await createPasswordHash(password);
    await collections.owners.updateOne(
      { _id: toObjectId(request.session.userId) },
      { $set: { passwordHash: hash } }
    );
    return { ok: true };
  });

  // Owner calls back the most recent scanner who contacted them within 60 minutes.
  // No phone input — owner's phone comes from their profile (owner.mobile).
  app.post("/api/owner/callback/register-call", async (request, reply) => {
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

    const ownerPhone = owner?.mobile || null;
    if (!ownerPhone) {
      reply.code(402);
      return { ok: false, code: "NO_PHONE", error: "Add your phone number to enable callback." };
    }

    // Most recent scanner contact within the 60-minute window.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentContact = await collections.contactRequests.findOne(
      {
        ownerId,
        phone: { $exists: true, $ne: null },
        createdAt: { $gte: oneHourAgo.toISOString() }
      },
      { sort: { createdAt: -1 } }
    );

    if (!recentContact) {
      reply.code(410);
      return {
        ok: false,
        code: "CALLBACK_WINDOW_EXPIRED",
        error: "No recent contact to call back. The 60-minute window has passed."
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
