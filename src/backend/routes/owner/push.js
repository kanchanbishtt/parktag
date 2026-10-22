import { z } from "zod";

import { requireSession, toObjectId } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import { getSessionCookieName, sessionHash } from "../../lib/auth/session.js";

// ── Native app push tokens ────────────────────────────────────────────────
//
// The Android app posts its FCM token after sign-in and on every cold start,
// and deletes it on sign-out. Behind the owner session and the app-wide CSRF
// origin check in app.js, like every other /api/owner/* write: a page that
// could register its own token on an owner's account would receive that
// owner's alerts.
//
// A token is one device, so it belongs to whoever signed in on it last: a
// token another owner held moves to the caller. Each row also records which
// session posted it, so signing that session out (session.js) drops it.

// At most this many devices per owner; the least recently posted go first.
export const MAX_PUSH_TOKENS_PER_OWNER = 10;

const tokenSchema = z.string().min(1).max(4096).regex(/^[A-Za-z0-9:_-]+$/);
const postSchema = z.object({ token: tokenSchema, platform: z.enum(["android", "ios", "web"]) });
const deleteSchema = z.object({ token: tokenSchema });

const RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } };

export function registerPushRoutes(app, env) {
  async function ownerContext(request, reply) {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return { blocked };

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(500);
      return { blocked: { ok: false, error: "Database not configured." } };
    }

    return { collections, ownerId: toObjectId(request.session.userId) };
  }

  app.post("/api/owner/push-tokens", RATE_LIMIT, async (request, reply) => {
    const ctx = await ownerContext(request, reply);
    if (ctx.blocked) return ctx.blocked;

    const parsed = postSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: "Invalid push token." };
    }

    const { collections, ownerId } = ctx;
    const { token, platform } = parsed.data;
    const now = new Date();

    // A real Date: the TTL index on updatedAt ignores strings.
    await collections.pushTokens.updateOne(
      { token },
      {
        $set: {
          ownerId,
          platform,
          sessionHash: sessionHash(request.cookies[getSessionCookieName()] || ""),
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    // Over the cap: drop the oldest. The one just posted is the newest.
    const excess = await collections.pushTokens
      .find({ ownerId }, { projection: { _id: 1 } })
      .sort({ updatedAt: -1, _id: -1 })
      .skip(MAX_PUSH_TOKENS_PER_OWNER)
      .toArray();
    if (excess.length) {
      await collections.pushTokens.deleteMany({ _id: { $in: excess.map((row) => row._id) } });
    }

    return { ok: true };
  });

  // Only the caller's own row. Idempotent: an unknown token is still ok.
  app.delete("/api/owner/push-tokens", RATE_LIMIT, async (request, reply) => {
    const ctx = await ownerContext(request, reply);
    if (ctx.blocked) return ctx.blocked;

    const parsed = deleteSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: "Invalid push token." };
    }

    await ctx.collections.pushTokens.deleteOne({ token: parsed.data.token, ownerId: ctx.ownerId });
    return { ok: true };
  });
}
