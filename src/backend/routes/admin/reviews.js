// Review replies, for an admin to read and pick from.
//
//   GET  /api/admin/reviews              newest first, phone masked
//   POST /api/admin/reviews/:id/approve  { approved: true|false }
//   GET  /api/admin/reviews/:id/photo    the first photo, approved or not
//
// Approving is what puts a row on GET /api/shop/reviews. See lib/core/reviews.js.

import { requireSession } from "../../lib/auth/auth.js";
import { maskIdentifier } from "../../lib/auth/security.js";
import { getCollections } from "../../lib/db/repositories.js";
import { LIST_PROJECTION, reviewObjectId, firstPhoto, hasPhoto } from "../../lib/core/reviews.js";

export function registerAdminReviewRoutes(app, env) {
  app.get("/api/admin/reviews", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const rows = await collections.reviews
      .find({}, { projection: LIST_PROJECTION })
      .sort({ receivedAt: -1 })
      .limit(200)
      .toArray();

    return {
      ok: true,
      reviews: rows.map((r) => ({
        id: String(r._id),
        name: r.name || null,
        orderNumber: r.orderNumber || null,
        phone: maskIdentifier(r.phone),
        texts: r.texts || [],
        hasPhoto: hasPhoto(r),
        approved: r.approved === true,
        receivedAt: r.receivedAt || null
      }))
    };
  });

  app.post("/api/admin/reviews/:id/approve", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const id = reviewObjectId(request.params.id);
    if (!id) { reply.code(400); return { ok: false, error: "Invalid review id" }; }

    const approved = request.body?.approved === true;
    const collections = await getCollections(env);
    const result = await collections.reviews.updateOne(
      { _id: id },
      { $set: { approved, approvedAt: approved ? new Date() : null } }
    );
    if (!result.matchedCount) { reply.code(404); return { ok: false, error: "Review not found" }; }

    return { ok: true, approved };
  });

  app.get("/api/admin/reviews/:id/photo", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const id = reviewObjectId(request.params.id);
    const collections = await getCollections(env);
    const photo = id ? firstPhoto(await collections.reviews.findOne({ _id: id })) : null;
    if (!photo) { reply.code(404); return { ok: false, error: "No photo" }; }

    reply.type(photo.mimeType).header("Cache-Control", "private, no-store");
    return reply.send(photo.data);
  });
}
