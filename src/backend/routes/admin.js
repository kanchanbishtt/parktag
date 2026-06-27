import { ObjectId } from "mongodb";

import { requireSession } from "../lib/auth.js";
import { getCollections } from "../lib/repositories.js";
import {
  buildIssuedTagOutput,
  createUnclaimedTags
} from "../lib/tag-issuance.js";

function etagIdFor(id) {
  return `PT-${String(id).slice(-8).toUpperCase()}`;
}

export function registerAdminRoutes(app, env) {
  // ── E-Tag management (spec §10) ───────────────────────────────────
  // List / search all owner E-Tags with purchase + contact summary.
  app.get("/api/admin/etags", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const q = String(request.query.q || "").trim().toLowerCase();
    const statusFilter = String(request.query.status || "");
    const includeDeleted = request.query.includeDeleted === "1";

    const tags = await collections.tags
      .find({ ownerId: { $ne: null } })
      .sort({ createdAt: -1 })
      .toArray();
    const owners = await collections.owners.find({}).toArray();
    const ownerMap = Object.fromEntries(owners.map((o) => [String(o._id), o]));
    const requests = await collections.contactRequests.find({}).toArray();
    const countsByToken = {};
    for (const r of requests) countsByToken[r.token] = (countsByToken[r.token] || 0) + 1;

    let list = tags.map((t) => {
      const owner = ownerMap[String(t.ownerId)] || {};
      return {
        id: String(t._id),
        etagId: etagIdFor(t._id),
        token: t.token,
        plateNumber: t.plateNumber || null,
        vehicleType: t.vehicleType || null,
        vehicleLabel: t.vehicleLabel || null,
        status: t.status,
        premium: Boolean(t.premium),
        purchaseStatus: t.purchaseStatus || "none",
        physicalTagPurchased: Boolean(t.physicalTagPurchased),
        freeContactUsed: Boolean(t.freeContactUsed),
        deletedAt: t.deletedAt || null,
        ownerName: owner.displayName || null,
        ownerEmail: owner.email || null,
        ownerMobile: owner.mobile || owner.phone || null,
        contactCount: countsByToken[t.token] || 0,
        createdAt: t.createdAt
      };
    });

    if (!includeDeleted) list = list.filter((t) => !t.deletedAt);
    if (statusFilter) list = list.filter((t) => t.status === statusFilter);
    if (q) {
      list = list.filter(
        (t) =>
          (t.plateNumber || "").toLowerCase().includes(q) ||
          (t.etagId || "").toLowerCase().includes(q) ||
          (t.token || "").toLowerCase().includes(q) ||
          (t.ownerEmail || "").toLowerCase().includes(q) ||
          (t.ownerMobile || "").toLowerCase().includes(q)
      );
    }

    const total = list.length;
    return { ok: true, total, etags: list.slice(0, 300) };
  });

  // E-Tag detail with full contact / call / WhatsApp logs.
  app.get("/api/admin/etags/:tagId", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    let tagId;
    try { tagId = new ObjectId(request.params.tagId); } catch { reply.code(400); return { ok: false, error: "Bad id" }; }

    const tag = await collections.tags.findOne({ _id: tagId });
    if (!tag) { reply.code(404); return { ok: false, error: "E-Tag not found" }; }

    const owner = tag.ownerId ? await collections.owners.findOne({ _id: tag.ownerId }) : null;
    const logs = await collections.contactRequests
      .find({ token: tag.token })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    return {
      ok: true,
      etag: {
        id: String(tag._id),
        etagId: etagIdFor(tag._id),
        token: tag.token,
        plateNumber: tag.plateNumber || null,
        vehicleType: tag.vehicleType || null,
        status: tag.status,
        premium: Boolean(tag.premium),
        purchaseStatus: tag.purchaseStatus || "none",
        physicalTagPurchased: Boolean(tag.physicalTagPurchased),
        freeContactUsed: Boolean(tag.freeContactUsed),
        freeContactUsedAt: tag.freeContactUsedAt || null,
        contactAttempts: tag.contactAttempts || 0,
        lastContactAt: tag.lastContactAt || null,
        deletedAt: tag.deletedAt || null,
        createdAt: tag.createdAt,
        owner: owner ? { name: owner.displayName || null, email: owner.email || null, mobile: owner.mobile || owner.phone || null } : null
      },
      logs: logs.map((item) => ({
        id: String(item._id),
        action: item.action,
        messageChannel: item.messageChannel || null,
        reason: item.reason || null,
        status: item.status,
        callResult: item.callResult || null,
        callDuration: typeof item.callDuration === "number" ? item.callDuration : null,
        recordingUrl: item.recordingUrl || null,
        ipAddress: item.ipAddress || null,
        userAgent: item.userAgent || null,
        createdAt: item.createdAt
      }))
    };
  });

  // Activate / deactivate an E-Tag.
  app.post("/api/admin/etags/:tagId/status", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const { status } = request.body || {};
    if (!["active", "inactive"].includes(status)) {
      reply.code(400);
      return { ok: false, error: "status must be active or inactive" };
    }

    const collections = await getCollections(env);
    let tagId;
    try { tagId = new ObjectId(request.params.tagId); } catch { reply.code(400); return { ok: false, error: "Bad id" }; }

    const result = await collections.tags.findOneAndUpdate(
      { _id: tagId },
      { $set: { status, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    if (!result) { reply.code(404); return { ok: false, error: "E-Tag not found" }; }
    return { ok: true, status };
  });

  // Soft-delete an E-Tag (hidden from owner + admin default views).
  app.delete("/api/admin/etags/:tagId", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    let tagId;
    try { tagId = new ObjectId(request.params.tagId); } catch { reply.code(400); return { ok: false, error: "Bad id" }; }

    const result = await collections.tags.updateOne(
      { _id: tagId },
      { $set: { deletedAt: new Date().toISOString(), status: "inactive", updatedAt: new Date().toISOString() } }
    );
    if (!result.matchedCount) { reply.code(404); return { ok: false, error: "E-Tag not found" }; }
    return { ok: true };
  });

  app.get("/api/admin/overview", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);

    if (blocked) {
      return blocked;
    }

    const collections = await getCollections(env);
    const owners = await collections.owners.find({}).toArray();
    const tags = await collections.tags.find({}).toArray();
    const requests = await collections.contactRequests
      .find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    const ownerSummaries = owners
      .map((owner) => {
      const ownerTags = tags.filter(
        (tag) => tag.ownerId && String(tag.ownerId) === String(owner._id)
      );

      return {
        id: String(owner._id),
        displayName: owner.displayName,
        email: owner.email,
        credits: owner.credits || 0,
        tags: ownerTags.length,
        activeTags: ownerTags.filter((tag) => tag.status === "active").length,
        createdAt: owner.createdAt,
        latestTagToken: ownerTags[0]?.token || null
      };
      })
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    const recentRegistrations = ownerSummaries.slice(0, 8).map((owner) => ({
      id: owner.id,
      displayName: owner.displayName,
      email: owner.email,
      createdAt: owner.createdAt,
      tags: owner.tags,
      activeTags: owner.activeTags,
      latestTagToken: owner.latestTagToken
    }));

    return {
      ok: true,
      counts: {
        owners: owners.length,
        tags: tags.length,
        requests: requests.length,
        pendingPrint: tags.filter(
          (tag) => tag.status === "unclaimed" && tag.printStatus !== "printed"
        ).length
      },
      owners: ownerSummaries,
      recentRequests: requests.map((item) => ({
        id: String(item._id),
        token: item.token,
        phone: item.phone,
        action: item.action,
        messageChannel: item.messageChannel || null,
        status: item.status,
        provider: item.provider || null,
        providerRequestId: item.providerRequestId || null,
        providerWebhookStatus: item.providerWebhookStatus || null,
        providerError: item.providerError || null,
        providerErrorDetail: item.providerErrorDetail || null,
        providerStatusCode: item.providerStatusCode || null,
        createdAt: item.createdAt
      })),
      recentRegistrations,
      pendingPrintTags: tags
        .filter((tag) => tag.status === "unclaimed" && tag.printStatus !== "printed")
        .map((tag) => ({
          id: String(tag._id),
          token: tag.token,
          batchNumber: tag.batchNumber || null,
          printStatus: tag.printStatus || "pending_print",
          createdAt: tag.createdAt
        }))
    };
  });

  app.post("/api/admin/tags/issue", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);

    if (blocked) {
      return blocked;
    }

    const { batchNumber, batchLabel, quantity, stickerRequested } =
      request.body || {};

    const collections = await getCollections(env);
    const tags = await createUnclaimedTags(collections, {
      batchNumber,
      batchLabel,
      quantity,
      stickerRequested
    });

    const output = await Promise.all(
      tags.map((tag) => buildIssuedTagOutput(request, tag))
    );

    return {
      ok: true,
      tags: output
    };
  });

  app.get("/api/admin/print-queue", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const tags = await collections.tags
      .find({ status: "unclaimed" })
      .sort({ createdAt: -1 })
      .toArray();

    return {
      ok: true,
      tags: tags.map((tag) => ({
        id: String(tag._id),
        token: tag.token,
        batchNumber: tag.batchNumber || null,
        batchLabel: tag.batchLabel || null,
        printStatus: tag.printStatus || "pending_print",
        claimUrl: `${request.protocol}://${request.hostname}/vehicle/${tag.token}`,
        createdAt: tag.createdAt
      }))
    };
  });

  app.get("/api/admin/print-queue/export", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const tags = await collections.tags
      .find({ status: "unclaimed" })
      .sort({ createdAt: -1 })
      .toArray();

    const output = await Promise.all(tags.map((tag) => buildIssuedTagOutput(request, tag)));

    return { ok: true, tags: output };
  });

  app.delete("/api/admin/tags/batch/:batchNumber", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const result = await collections.tags.deleteMany({
      status: "unclaimed",
      batchNumber: request.params.batchNumber
    });

    return { ok: true, deleted: result.deletedCount };
  });

  app.delete("/api/admin/tags/unclaimed/all", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const result = await collections.tags.deleteMany({ status: "unclaimed" });

    return { ok: true, deleted: result.deletedCount };
  });

  app.post("/api/admin/print-queue/:tagId/mark-printed", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const { ObjectId } = await import("mongodb");
    const collections = await getCollections(env);
    const tagId = new ObjectId(request.params.tagId);

    await collections.tags.updateOne(
      { _id: tagId },
      { $set: { printStatus: "printed", printedAt: new Date().toISOString() } }
    );

    return { ok: true };
  });

  app.get("/api/admin/owners", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const owners = await collections.owners.find({}).sort({ createdAt: -1 }).toArray();
    const tags = await collections.tags.find({}).toArray();

    return {
      ok: true,
      owners: owners.map((owner) => {
        const ownerTags = tags.filter(
          (tag) => tag.ownerId && String(tag.ownerId) === String(owner._id)
        );
        return {
          id: String(owner._id),
          displayName: owner.displayName,
          email: owner.email,
          phone: owner.phone,
          credits: owner.credits || 0,
          tags: ownerTags.length,
          activeTags: ownerTags.filter((t) => t.status === "active").length,
          tagTokens: ownerTags.map((t) => t.token),
          createdAt: owner.createdAt
        };
      })
    };
  });

  app.get("/api/admin/activity", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const limit = Math.min(parseInt(request.query.limit || "50", 10), 200);
    const collections = await getCollections(env);

    const requests = await collections.contactRequests
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const tags = await collections.tags.find({}).toArray();
    const tokenToLabel = Object.fromEntries(
      tags.map((t) => [t.token, t.vehicleLabel || t.token])
    );

    return {
      ok: true,
      activity: requests.map((item) => ({
        id: String(item._id),
        token: item.token,
        vehicleLabel: tokenToLabel[item.token] || item.token,
        phone: item.phone,
        action: item.action,
        messageChannel: item.messageChannel || null,
        message: item.message || null,
        status: item.status,
        provider: item.provider || null,
        providerError: item.providerError || null,
        createdAt: item.createdAt
      }))
    };
  });

  app.get("/api/admin/admins", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const admins = await collections.admins.find({}).sort({ createdAt: -1 }).toArray();

    return {
      ok: true,
      admins: admins.map((a) => ({
        id: String(a._id),
        email: a.email,
        displayName: a.displayName,
        createdAt: a.createdAt
      }))
    };
  });

  app.post("/api/admin/admins", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);

    if (blocked) {
      return blocked;
    }

    const { email, password, displayName } = request.body || {};

    if (!email || !password || !displayName) {
      reply.code(400);
      return {
        ok: false,
        error: "email, password, and displayName are required"
      };
    }

    const collections = await getCollections(env);
    const existing = await collections.admins.findOne({ email });

    if (existing) {
      reply.code(400);
      return {
        ok: false,
        error: "Admin email already exists"
      };
    }

    const { createPasswordHash } = await import("../lib/security.js");

    await collections.admins.insertOne({
      email,
      passwordHash: await createPasswordHash(password),
      displayName,
      role: "admin",
      createdAt: new Date().toISOString()
    });

    return {
      ok: true
    };
  });
}
