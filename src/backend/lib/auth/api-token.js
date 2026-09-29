// Admin API tokens: a scoped, revocable credential for tools that cannot sign in (the admin MCP server, scripts).
//
// Why not just an admin session: the sign-in has a bot check and a cookie that dies after 12 hours, by design, so
// a tool that needs the admin panel could only run on a pasted cookie that stops working every day.
//
// What makes this safe to add next to that:
//   - DENY BY DEFAULT. A token may call only the routes listed below, and each is read or write. A route added to
//     the admin later is cookie-only until somebody adds it here. Notably NOT listed: managing admins, issuing or
//     deleting tags, marking prints, publishing designs, and these token routes themselves, so a token can never
//     mint another token or widen its own reach.
//   - Scoped. `read` covers the GET rows, `write` adds the write rows.
//   - Expiring and revocable. Every token has an expiry (at most MAX_DAYS) and can be revoked at once.
//   - Stored as a SHA-256 hash. The token is 256 random bits, so a fast hash is enough and it is shown once.
//   - Logged. Creating, revoking, and every write made with a token lands in the admin audit log.
//
// A later OAuth flow issues the same kind of row (adminId, scope, expiresAt, tokenHash) after its own consent step,
// and this module's route table and scopes are what its scopes map onto.

import crypto from "node:crypto";
import { ObjectId } from "mongodb";

export const TOKEN_PREFIX = "ptk_";
export const MAX_DAYS = 90;
export const DEFAULT_DAYS = 30;
export const MAX_ACTIVE_PER_ADMIN = 10;
export const SCOPES = ["read", "write"];

const TOKEN_SHAPE = /^ptk_[A-Za-z0-9_-]{43}$/;
// Stamp lastUsedAt at most this often: a token in a busy tool must not turn every read into a write.
const LAST_USED_EVERY_MS = 5 * 60 * 1000;

const READ = [
  "/api/admin/overview", "/api/admin/overview/summary", "/api/admin/traffic", "/api/admin/utm-sales",
  "/api/admin/reconciliation", "/api/admin/promo-codes", "/api/admin/promo-codes/report", "/api/admin/shop-settings",
  "/api/admin/etags", "/api/admin/etags/:tagId", "/api/admin/tag-batches", "/api/admin/print-queue",
  "/api/admin/activations", "/api/admin/activations/recent", "/api/admin/activity", "/api/admin/marketing",
  "/api/admin/sticker-designs", "/api/admin/sticker-designs/current", "/api/admin/reviews"
];
const WRITE = [
  "POST /api/admin/promo-codes", "PATCH /api/admin/promo-codes/:code",
  "POST /api/admin/promo-codes/:code/activate", "POST /api/admin/promo-codes/:code/revoke",
  "PATCH /api/admin/shop-settings"
];
// "METHOD /route/pattern" -> the scope needed to call it.
const RULES = new Map([...READ.map((p) => [`GET ${p}`, "read"]), ...WRITE.map((r) => [r, "write"])]);

export function newApiToken() {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashApiToken(token), tokenPrefix: token.slice(0, 8) };
}

export const hashApiToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/** The bearer token on a request, or null. Anything not shaped like ours is ignored without a database lookup. */
export function bearerApiToken(request) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(request?.headers?.authorization || ""));
  return match && TOKEN_SHAPE.test(match[1]) ? match[1] : null;
}

/** May a token with this scope call this route? `route` is Fastify's pattern, e.g. /api/admin/etags/:tagId. */
export function tokenMayCall(method, route, scope) {
  const needs = RULES.get(`${String(method).toUpperCase() === "HEAD" ? "GET" : String(method).toUpperCase()} ${route}`);
  return needs === "read" ? SCOPES.includes(scope) : needs === "write" ? scope === "write" : false;
}

export const isWrite = (method) => !["GET", "HEAD"].includes(String(method).toUpperCase());

/**
 * Resolve a request's bearer token.
 *   null                    no usable token on the request
 *   { denied: "invalid" }   unknown, revoked, expired, or its admin is gone (indistinguishable to the caller on purpose)
 *   { denied: "route" }     a good token asked for something its scope or the allowlist does not cover
 *   { session, token }      a session-shaped object for request.session, plus the stored row
 */
export async function authenticateApiToken(collections, request, now = Date.now()) {
  const raw = bearerApiToken(request);
  if (!raw) return null;

  const token = await collections.adminApiTokens.findOne({ tokenHash: hashApiToken(raw) });
  if (!token || token.revokedAt || new Date(token.expiresAt).getTime() <= now) return { denied: "invalid" };

  const admin = ObjectId.isValid(token.adminId)
    ? await collections.admins.findOne({ _id: new ObjectId(String(token.adminId)) }, { projection: { email: 1, displayName: 1 } })
    : null;
  if (!admin) return { denied: "invalid" };

  if (!tokenMayCall(request.method, request.routeOptions?.url, token.scope)) return { denied: "route" };

  const last = token.lastUsedAt ? new Date(token.lastUsedAt).getTime() : 0;
  if (now - last > LAST_USED_EVERY_MS) {
    collections.adminApiTokens.updateOne({ _id: token._id }, { $set: { lastUsedAt: new Date(now).toISOString() } }).catch(() => {});
  }

  return {
    token,
    session: {
      id: `api-token:${token._id}`,
      userId: String(token.adminId),
      role: "admin",
      email: admin.email,
      displayName: admin.displayName || null,
      via: "api-token",
      tokenId: String(token._id),
      tokenName: token.name,
      scope: token.scope,
      expiresAt: token.expiresAt
    }
  };
}
