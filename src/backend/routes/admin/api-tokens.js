import { requireSession, tryObjectId } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import { recordAdminEvent } from "../../lib/core/admin-audit.js";
import { DEFAULT_DAYS, MAX_ACTIVE_PER_ADMIN, MAX_DAYS, SCOPES, newApiToken } from "../../lib/auth/api-token.js";

// Manage the signed-in admin's own API tokens (see lib/auth/api-token.js for what a token may do).
//
//   POST   /api/admin/api-tokens        { name, scope?: read|write, days?: 1..90 }  -> the token, shown once
//   GET    /api/admin/api-tokens        your tokens, never their secrets
//   DELETE /api/admin/api-tokens/:id    revoke one, effective immediately
//
// None of these routes is on a token's allowlist, so they only answer to a signed-in admin: a token cannot mint,
// list or revoke tokens.

const NAME_MAX = 60;

const publicRow = (t) => ({
  id: String(t._id), name: t.name, scope: t.scope, tokenPrefix: t.tokenPrefix,
  createdAt: t.createdAt, expiresAt: t.expiresAt, lastUsedAt: t.lastUsedAt || null, revokedAt: t.revokedAt || null
});

export function registerAdminApiTokenRoutes(app, env) {
  app.post("/api/admin/api-tokens", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(503); return { ok: false, error: "Database is not available." }; }

    const body = request.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const scope = body.scope === undefined ? "read" : body.scope;
    const days = body.days === undefined ? DEFAULT_DAYS : body.days;

    if (!name || name.length > NAME_MAX) { reply.code(400); return { ok: false, error: `Give the token a name of 1-${NAME_MAX} characters.` }; }
    if (!SCOPES.includes(scope)) { reply.code(400); return { ok: false, error: `scope must be one of ${SCOPES.join(", ")}.` }; }
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) { reply.code(400); return { ok: false, error: `days must be a whole number from 1 to ${MAX_DAYS}.` }; }

    const nowIso = new Date().toISOString();
    const active = await collections.adminApiTokens.countDocuments({
      adminId: request.session.userId, revokedAt: null, expiresAt: { $gt: nowIso }
    });
    if (active >= MAX_ACTIVE_PER_ADMIN) {
      reply.code(409);
      return { ok: false, error: `You already have ${MAX_ACTIVE_PER_ADMIN} active tokens. Revoke one first.` };
    }

    const { token, tokenHash, tokenPrefix } = newApiToken();
    const doc = {
      adminId: request.session.userId,
      adminEmail: request.session.email,
      name, scope, tokenHash, tokenPrefix,
      createdAt: nowIso,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
      lastUsedAt: null,
      revokedAt: null
    };
    const { insertedId } = await collections.adminApiTokens.insertOne(doc);

    recordAdminEvent(collections, {
      event: "api_token_created", adminId: request.session.userId, email: request.session.email,
      target: `${name} (${scope}, ${days}d)`, request
    });

    return { ok: true, data: { ...publicRow({ ...doc, _id: insertedId }), token, note: "Copy the token now. It is not shown again." } };
  });

  app.get("/api/admin/api-tokens", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(503); return { ok: false, error: "Database is not available." }; }

    const rows = await collections.adminApiTokens
      .find({ adminId: request.session.userId }, { projection: { tokenHash: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return { ok: true, data: rows.map(publicRow) };
  });

  app.delete("/api/admin/api-tokens/:id", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(503); return { ok: false, error: "Database is not available." }; }

    const id = tryObjectId(request.params.id);
    // Only your own: another admin's token id answers exactly like one that does not exist.
    const token = id && await collections.adminApiTokens.findOne({ _id: id, adminId: request.session.userId });
    if (!token) { reply.code(404); return { ok: false, error: "No such token." }; }

    if (!token.revokedAt) {
      await collections.adminApiTokens.updateOne({ _id: id }, { $set: { revokedAt: new Date().toISOString() } });
      recordAdminEvent(collections, {
        event: "api_token_revoked", adminId: request.session.userId, email: request.session.email, target: token.name, request
      });
    }
    return { ok: true };
  });
}
