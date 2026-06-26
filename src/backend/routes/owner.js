import { requireSession, toObjectId } from "../lib/auth.js";
import { getCollections } from "../lib/repositories.js";
import { createQrDataUrl } from "../lib/qr-output.js";

export function registerOwnerRoutes(app, env) {
  app.get("/api/owner/dashboard", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);

    if (blocked) {
      return blocked;
    }

    const collections = await getCollections(env);
    const ownerId = toObjectId(request.session.userId);

    const owner = await collections.owners.findOne({ _id: ownerId });
    const tags = await collections.tags.find({ ownerId }).toArray();
    const requests = await collections.contactRequests
      .find({ ownerId })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    const LABELS = { car:"Car", bike:"Bike", scooter:"Scooter", auto_rickshaw:"Auto Rickshaw", truck:"Truck", bus:"Bus", bicycle:"Bicycle", e_scooter:"E-Scooter" };
    const localVehicles = (owner.localVehicles || []).map((v, i) => ({
      id: `local_${i}`,
      vehicleType: v.type,
      vehicleLabel: LABELS[v.type] || v.type,
      plateNumber: v.number,
      status: "active",
      isLocal: true
    }));

    return {
      ok: true,
      owner: {
        _id: String(owner._id),
        email: owner.email || null,
        mobile: owner.mobile || null,
        displayName: owner.displayName || request.session.displayName || null,
        credits: owner.credits || 0
      },
      tags: [...localVehicles, ...(await Promise.all(tags.map(async (tag) => {
        const scanUrl = `${request.protocol}://${request.hostname}${request.port ? `:${request.port}` : ""}/vehicle/${tag.token}`;
        const qrDataUrl = await createQrDataUrl(scanUrl);
        return {
          id: String(tag._id),
          token: tag.token,
          status: tag.status,
          vehicleLabel: tag.vehicleLabel,
          plateNumber: tag.plateNumber || null,
          printStatus: tag.printStatus || "not_requested",
          stickerRequested: tag.stickerRequested || false,
          scanUrl,
          qrDataUrl
        };
      })))],
      requests: requests.map((item) => ({
        id: String(item._id),
        token: item.token,
        phone: item.phone,
        action: item.action,
        messageChannel: item.messageChannel || null,
        message: item.message || null,
        status: item.status,
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
    const normalizedNumber = number.trim().toUpperCase();

    // Check duplicate in local vehicles
    const owner = await collections.owners.findOne({ _id: ownerId });
    const existsLocal = (owner?.localVehicles || []).some(v => v.number === normalizedNumber);
    // Check duplicate in registered tags
    const existsTag = await collections.tags.findOne({ ownerId, plateNumber: normalizedNumber });

    if (existsLocal || existsTag) {
      reply.code(409);
      return { ok: false, error: "Vehicle already added." };
    }

    await collections.owners.updateOne(
      { _id: ownerId },
      { $push: { localVehicles: { type, number: normalizedNumber, addedAt: new Date().toISOString() } } }
    );
    return { ok: true };
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
