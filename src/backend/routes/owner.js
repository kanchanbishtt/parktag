import { requireSession, toObjectId } from "../lib/auth.js";
import { getCollections } from "../lib/repositories.js";
import { createQrDataUrl, createPrintQrDataUrl } from "../lib/qr-output.js";
import { createEtagForVehicle, buildTagScanUrl } from "../lib/tag-issuance.js";
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
  isRazorpayConfigured,
  STICKER_PRICE_INR
} from "../lib/payments.js";

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

    const LABELS = { car:"Car", bike:"Bike", scooter:"Scooter", auto_rickshaw:"Auto Rickshaw", truck:"Truck", bus:"Bus", bicycle:"Bicycle", e_scooter:"E-Scooter" };

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
          etagId: `PT-${String(tag._id).slice(-8).toUpperCase()}`,
          status: tag.status,
          vehicleType: tag.vehicleType || null,
          // Prefer the real type label; fall back to the stored label for older tags.
          vehicleLabel: LABELS[tag.vehicleType] || tag.vehicleLabel || "Vehicle",
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
        etagId: `PT-${String(tag._id).slice(-8).toUpperCase()}`,
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

    let order;
    try {
      order = await createRazorpayOrder(env, {
        amount: STICKER_PRICE_INR,
        receipt: `pt_sticker_${String(tag._id)}_${Date.now()}`.slice(0, 40),
        notes: { tagId: String(tag._id), plate: tag.plateNumber || "" }
      });
    } catch (error) {
      reply.code(502);
      return { ok: false, error: error instanceof Error ? error.message : "Could not create order." };
    }

    await collections.tags.updateOne(
      { _id: tag._id },
      { $set: { "purchase.orderId": order.id, "purchase.status": "created", "purchase.amount": STICKER_PRICE_INR, updatedAt: new Date().toISOString() } }
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
}
