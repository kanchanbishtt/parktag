// Approved buyer reviews, for the website. Public and unauthenticated, like
// /api/shop/public-catalogue, so the same promise applies: what is NOT in the
// response matters more than what is. First name, words, a photo link; never
// the phone number, order number or anything else that finds the buyer.
//
// Not rendered anywhere yet. An admin approves rows at /admin/reviews first.

import { getCollections } from "../../lib/db/repositories.js";
import { createLoaderCache } from "../../lib/core/loader-cache.js";
import { LIST_PROJECTION, toPublicReview, reviewObjectId, firstPhoto } from "../../lib/core/reviews.js";

export function registerShopReviewRoutes(app, env) {
  // Everyone sees the same approved reviews, and an admin approving one can wait
  // a minute to show. Off outside production so tests and dev see live data.
  const reviewsCache = createLoaderCache({
    ttlMs: 60 * 1000,
    cap: 1,
    name: "public-reviews",
    enabled: env.runtimeMode === "production"
  });

  app.get(
    "/api/shop/reviews",
    // Per-replica counting: a cheap cached read does not need the Mongo round
    // trip a cross-replica limit costs.
    { config: { rateLimit: { max: 60, timeWindow: "1 minute", local: true } } },
    async (_request, reply) => {
      const collections = await getCollections(env);
      if (!collections) { reply.code(503); return { ok: false, error: "Reviews are unavailable." }; }

      reply.header("Cache-Control", "public, max-age=60");
      return reviewsCache("approved", async () => {
        const rows = await collections.reviews
          .find({ approved: true }, { projection: LIST_PROJECTION })
          .sort({ receivedAt: -1 })
          .limit(50)
          .toArray();

        return { ok: true, reviews: rows.map(toPublicReview) };
      });
    }
  );

  app.get(
    "/api/shop/reviews/:id/photo",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const id = reviewObjectId(request.params.id);
      const collections = id ? await getCollections(env) : null;
      // Approved only: an unapproved photo is somebody's car, not ours to show.
      const review = collections ? await collections.reviews.findOne({ _id: id, approved: true }) : null;
      const photo = firstPhoto(review);
      if (!photo) { reply.code(404); return { ok: false, error: "Not found." }; }

      reply.type(photo.mimeType).header("Cache-Control", "public, max-age=3600");
      return reply.send(photo.data);
    }
  );
}
