// Tag reports, for an admin to read and act on.
//
//   GET  /api/admin/tag-reports?status=open|resolved|all&q=&page=
//        newest first, 100 a page, with the reported sticker and its owner
//   POST /api/admin/tag-reports/:id/status   { status: "resolved"|"open", note? }
//
// A report is what a stranger standing at a vehicle says about its tag: sold
// on, wrong number, never answers, misuse (POST /api/tags/:token/report in
// routes/public). It lands in `tag_reports` with status "open" and, until this
// page existed, nothing ever read it back. The reporter's own number is stored
// so support can call them; it is shown here and nowhere public.

import { ObjectId } from "mongodb";

import { requireSession } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import { stickerSerialFor } from "../../lib/core/tag-issuance.js";

export const REPORT_REASON_LABELS = {
  sold: "Vehicle sold on",
  wrong_number: "Wrong number",
  no_answer: "Owner never answers",
  abuse: "Misuse",
  other: "Other"
};

const PAGE_SIZE = 100;
const NOTE_MAX = 500;

function toObjectId(value) {
  try { return new ObjectId(String(value)); } catch { return null; }
}

// What the page and the MCP tool get for one report.
function reportRow(r, tag, owner) {
  return {
    id: String(r._id),
    reason: r.reason || "other",
    reasonLabel: REPORT_REASON_LABELS[r.reason] || "Other",
    details: r.details || null,
    reporterName: r.reporterName || null,
    reporterPhone: r.reporterPhone || null,
    status: r.status === "resolved" ? "resolved" : "open",
    createdAt: r.createdAt || null,
    resolvedAt: r.resolvedAt || null,
    resolvedBy: r.resolvedBy || null,
    note: r.note || null,
    // The sticker as it is now, not as it was when reported: a tag the owner
    // has since paused or deleted reads that way here.
    tag: tag
      ? {
          id: String(tag._id),
          serial: stickerSerialFor(tag) || null,
          plateNumber: tag.plateNumber || null,
          vehicleLabel: tag.vehicleLabel || tag.vehicleType || null,
          status: tag.deletedAt ? "deleted" : tag.status || null,
          premium: Boolean(tag.premium)
        }
      : null,
    owner: owner
      ? { id: String(owner._id), name: owner.displayName || null, mobile: owner.mobile || owner.phone || null, email: owner.email || null }
      : null
  };
}

export function registerAdminTagReportRoutes(app, env) {
  app.get("/api/admin/tag-reports", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const status = ["open", "resolved", "all"].includes(request.query.status) ? request.query.status : "open";
    const q = String(request.query.q || "").trim().slice(0, 80);
    const requestedPage = parseInt(request.query.page || "1", 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    const filter = status === "all" ? {} : status === "resolved" ? { status: "resolved" } : { status: { $ne: "resolved" } };
    if (q) {
      // Reporter name or number, the free text, or the reported plate / serial
      // (matched through the tag, below). Escaped: a search is not a regex.
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const digits = q.replace(/\D/g, "");
      const or = [{ reporterName: rx }, { details: rx }];
      if (digits.length >= 4) or.push({ reporterPhone: new RegExp(digits.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      const tagIds = await collections.tags
        .find({ $or: [{ plateNumber: rx }, { serialNumber: Number.isFinite(Number(q)) ? Number(q) : -1 }] }, { projection: { _id: 1 }, limit: 200 })
        .toArray();
      if (tagIds.length) or.push({ tagId: { $in: tagIds.map((t) => t._id) } });
      filter.$or = or;
    }

    const [total, open, resolved, rows] = await Promise.all([
      collections.tagReports.countDocuments(filter),
      collections.tagReports.countDocuments({ status: { $ne: "resolved" } }),
      collections.tagReports.countDocuments({ status: "resolved" }),
      collections.tagReports
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray()
    ]);

    // One read for the stickers on this page, one for their owners.
    const tagIds = [...new Set(rows.map((r) => String(r.tagId)))].map(toObjectId).filter(Boolean);
    const tags = tagIds.length
      ? await collections.tags
          .find({ _id: { $in: tagIds } }, { projection: { serialNumber: 1, batchNumber: 1, plateNumber: 1, vehicleLabel: 1, vehicleType: 1, status: 1, deletedAt: 1, premium: 1, ownerId: 1 } })
          .toArray()
      : [];
    const tagById = new Map(tags.map((t) => [String(t._id), t]));
    const ownerIds = [...new Set(tags.map((t) => t.ownerId && String(t.ownerId)).filter(Boolean))].map(toObjectId).filter(Boolean);
    const owners = ownerIds.length
      ? await collections.owners.find({ _id: { $in: ownerIds } }, { projection: { displayName: 1, mobile: 1, phone: 1, email: 1 } }).toArray()
      : [];
    const ownerById = new Map(owners.map((o) => [String(o._id), o]));

    // How many times each sticker on this page has been reported, every
    // status: a third report on one sticker is the most useful fact here.
    const perTag = new Map();
    if (tagIds.length) {
      const grouped = await collections.tagReports
        .aggregate([{ $match: { tagId: { $in: tagIds } } }, { $group: { _id: "$tagId", n: { $sum: 1 } } }])
        .toArray();
      for (const g of grouped) perTag.set(String(g._id), g.n);
    }

    return {
      ok: true,
      status,
      counts: { open, resolved, total: open + resolved, matching: total },
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      pageSize: PAGE_SIZE,
      reports: rows.map((r) => {
        const tag = tagById.get(String(r.tagId)) || null;
        const owner = tag && tag.ownerId ? ownerById.get(String(tag.ownerId)) || null : null;
        return { ...reportRow(r, tag, owner), reportsOnTag: perTag.get(String(r.tagId)) || 1 };
      })
    };
  });

  // Resolve (or reopen) a report. Resolving records who and when, and an
  // optional note on what was done: "called the reporter, tag was the old
  // owner's, paused it". The report itself is never deleted.
  app.post("/api/admin/tag-reports/:id/status", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const id = toObjectId(request.params.id);
    if (!id) { reply.code(400); return { ok: false, error: "Invalid report id" }; }

    const body = request.body || {};
    const status = body.status === "resolved" ? "resolved" : body.status === "open" ? "open" : null;
    if (!status) { reply.code(400); return { ok: false, error: "status must be \"resolved\" or \"open\"" }; }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, NOTE_MAX) : "";

    const collections = await getCollections(env);
    const now = new Date().toISOString();
    const set = status === "resolved"
      ? { status, resolvedAt: now, resolvedBy: request.session?.email || null, updatedAt: now, ...(note ? { note } : {}) }
      : { status, resolvedAt: null, resolvedBy: null, updatedAt: now, ...(note ? { note } : {}) };

    const result = await collections.tagReports.updateOne({ _id: id }, { $set: set });
    if (!result.matchedCount) { reply.code(404); return { ok: false, error: "Report not found" }; }

    request.log.info({ event: "tag-report-status", reportId: String(id), status, admin: set.resolvedBy || request.session?.email || null }, "[report] status changed by admin");
    return { ok: true, status, resolvedAt: set.resolvedAt, resolvedBy: set.resolvedBy, note: note || null };
  });
}
