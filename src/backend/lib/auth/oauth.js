// OAuth 2.1 for the remote admin MCP endpoint (POST /mcp), so Claude can be given the connector URL and sign in
// instead of someone pasting a token. See routes/oauth/index.js for the endpoints.
//
// The design leans on admin API tokens (lib/auth/api-token.js) rather than adding a second credential:
//   - The access token IS a ptk_ API token row. Its scope allowlist, expiry, revocation, "last used" and audit trail
//     all apply unchanged, and it shows up on the admin's Tokens page where it can be revoked.
//   - One row per connection. A refresh rotates that row's hash and expiry in place, so a connection that refreshes
//     every hour is still one line on the Tokens page, and revoking that line ends the connection for good.
//   - Public clients only (PKCE S256, no client secret) and redirect URIs limited to Claude and loopback, because
//     registration is open to anyone and the consent screen grants admin power.

import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { MAX_ACTIVE_PER_ADMIN, MAX_DAYS, SCOPES, newApiToken } from "./api-token.js";

export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_DAYS = 30;
export const CODE_TTL_S = 10 * 60;
export const MAX_CLIENTS = 2000;
export const MAX_REDIRECT_URIS = 5;
// Least privilege is what is preselected; an admin who wants more picks it on the consent screen.
export const DEFAULT_SCOPE = "read";

const CLAUDE_HOSTS = new Set(["claude.ai", "claude.com"]);
const CLAUDE_CALLBACK_PATH = "/api/mcp/auth_callback";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/; // base64url of a SHA-256

export const hashSecret = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
export const newSecret = () => crypto.randomBytes(32).toString("base64url");
export const iso = (ms) => new Date(ms).toISOString();

/**
 * Where Claude may be sent back to: its one callback path over https, or a loopback address (Claude Code on a laptop).
 * The path is pinned, not just the host: any other page on those hosts that echoed its query string would leak a code.
 */
export function isAllowedRedirectUri(value) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return CLAUDE_HOSTS.has(url.hostname) && url.pathname === CLAUDE_CALLBACK_PATH && !url.search;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** RFC 7636 S256: does this verifier hash to the challenge the code was issued against? */
export function pkceMatches(verifier, challenge) {
  if (!VERIFIER.test(String(verifier)) || !CHALLENGE.test(String(challenge))) return false;
  const actual = Buffer.from(crypto.createHash("sha256").update(verifier).digest("base64url"));
  const wanted = Buffer.from(challenge);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

export const isChallenge = (value) => CHALLENGE.test(String(value));
export const pickScope = (value) => (SCOPES.includes(value) ? value : DEFAULT_SCOPE);

const trimUrl = (value) => String(value).replace(/\/+$/, "");

/** RFC 9728: tells a client which authorization server guards this resource. */
export function protectedResourceMetadata(base) {
  return {
    resource: `${trimUrl(base)}/mcp`,
    authorization_servers: [trimUrl(base)],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "ParkTag admin"
  };
}

/** RFC 8414: where to register, authorize and exchange codes. */
export function authorizationServerMetadata(base) {
  const root = trimUrl(base);
  return {
    issuer: root,
    authorization_endpoint: `${root}/oauth/authorize`,
    token_endpoint: `${root}/oauth/token`,
    registration_endpoint: `${root}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES
  };
}

/** Validate a dynamic client registration body (RFC 7591). Returns { ok, client } or { ok:false, error }. */
export function readRegistration(body) {
  const b = body && typeof body === "object" ? body : {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > MAX_REDIRECT_URIS || !uris.every((u) => typeof u === "string" && isAllowedRedirectUri(u))) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must be Claude's callback (https://claude.ai or https://claude.com) or a loopback address." };
  }
  if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== "none") {
    return { ok: false, error: "invalid_client_metadata", description: "Only public clients are supported (token_endpoint_auth_method: none)." };
  }
  // Control, bidi-override and zero-width characters out: the name is shown to an admin deciding whether to approve.
  const name = typeof b.client_name === "string" ? b.client_name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return { ok: true, client: { name: name || "MCP client", redirectUris: [...new Set(uris)] } };
}

const activeFilter = (adminId, now) => ({ adminId, revokedAt: null, expiresAt: { $gt: iso(now) } });

/**
 * Turn an approved consent into tokens: one api-token row (the access token) plus a refresh token that points at it.
 * Returns the OAuth token response, or { error } when the admin already holds the maximum number of live tokens.
 */
export async function issueGrant(collections, { admin, client, scope, now = Date.now() }) {
  const adminId = String(admin.id);
  const active = await collections.adminApiTokens.countDocuments(activeFilter(adminId, now));
  if (active >= MAX_ACTIVE_PER_ADMIN) {
    return { error: `You already have ${MAX_ACTIVE_PER_ADMIN} active API tokens. Revoke one on the Tokens page, then connect again.` };
  }

  const access = newApiToken();
  const { insertedId } = await collections.adminApiTokens.insertOne({
    adminId, adminEmail: admin.email, name: `${client.name} (OAuth)`.slice(0, 60), scope,
    tokenHash: access.tokenHash, tokenPrefix: access.tokenPrefix,
    createdAt: iso(now), expiresAt: iso(now + ACCESS_TTL_S * 1000), lastUsedAt: null, revokedAt: null,
    via: "oauth", oauthClientId: client.clientId
  });

  const refreshToken = newSecret();
  const connectionEndsAt = new Date(now + MAX_DAYS * 86_400_000);
  await collections.oauthRefreshTokens.insertOne({
    tokenHash: hashSecret(refreshToken), accessTokenId: insertedId, clientId: client.clientId, adminId,
    createdAt: new Date(now), connectionEndsAt, expiresAt: refreshExpiry(now, connectionEndsAt), consumedAt: null
  });
  touchClient(collections, client.clientId, now);
  return tokenResponse(access.token, refreshToken, scope);
}

/**
 * Exchange a refresh token. Single use, with reuse detection: a refresh token is marked consumed rather than deleted,
 * and presenting a consumed one means two parties hold the same chain, so the whole connection is revoked. A
 * connection also has an absolute end (the same ceiling as a hand-minted token): refreshing never extends it.
 * The connection's api-token row is rotated in place; if it was revoked (or its admin removed) the refresh fails.
 */
export async function refreshGrant(collections, { refreshToken, clientId, now = Date.now() }) {
  const row = await collections.oauthRefreshTokens.findOneAndUpdate(
    { tokenHash: hashSecret(refreshToken), clientId },
    { $set: { consumedAt: new Date(now) } },
    { returnDocument: "before" }
  );
  if (!row) return null;
  if (row.consumedAt) {
    await collections.adminApiTokens.updateOne({ _id: row.accessTokenId, revokedAt: null }, { $set: { revokedAt: iso(now) } });
    return null;
  }
  const endsAt = new Date(row.connectionEndsAt).getTime();
  if (new Date(row.expiresAt).getTime() <= now || endsAt <= now) return null;

  const access = await collections.adminApiTokens.findOne({ _id: row.accessTokenId });
  if (!access || access.revokedAt || !ObjectId.isValid(access.adminId)) return null;
  const admin = await collections.admins.findOne({ _id: new ObjectId(String(access.adminId)) }, { projection: { _id: 1 } });
  if (!admin) return null;

  const fresh = newApiToken();
  await collections.adminApiTokens.updateOne({ _id: access._id }, {
    $set: { tokenHash: fresh.tokenHash, tokenPrefix: fresh.tokenPrefix, expiresAt: iso(Math.min(now + ACCESS_TTL_S * 1000, endsAt)) }
  });
  const next = newSecret();
  await collections.oauthRefreshTokens.insertOne({
    tokenHash: hashSecret(next), accessTokenId: access._id, clientId, adminId: row.adminId,
    createdAt: new Date(now), connectionEndsAt: row.connectionEndsAt, expiresAt: refreshExpiry(now, row.connectionEndsAt), consumedAt: null
  });
  touchClient(collections, clientId, now);
  return tokenResponse(fresh.token, next, access.scope);
}

const refreshExpiry = (now, connectionEndsAt) =>
  new Date(Math.min(now + REFRESH_TTL_DAYS * 86_400_000, new Date(connectionEndsAt).getTime()));

/** A client that completes a grant or a refresh is real: it stops being evictable and its idle clock restarts. */
const touchClient = (collections, clientId, now) =>
  collections.oauthClients.updateOne({ clientId }, { $set: { used: true, lastActiveAt: new Date(now) } }).catch(() => {});

const tokenResponse = (accessToken, refreshToken, scope) => ({
  access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refreshToken, scope
});
