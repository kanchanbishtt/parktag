// OAuth 2.1 endpoints for the remote admin MCP server. What this is for and how tokens are modelled: lib/auth/oauth.js.
//
//   GET  /.well-known/oauth-protected-resource[/mcp]   which authorization server guards /mcp
//   GET  /.well-known/oauth-authorization-server       endpoints and what they support
//   POST /oauth/register                               dynamic client registration (public clients, Claude/loopback redirects)
//   GET  /oauth/authorize                              sign in as an admin if needed, then show the consent screen
//   POST /oauth/authorize                              the consent decision (a fetch from that screen), answers { redirect }
//   POST /oauth/token                                  authorization_code (PKCE S256) and refresh_token
//
// Approval needs a signed-in admin, so the same sign-in (password + bot check, or Google) that guards the panel
// guards this. Nothing here can be reached by an anonymous caller except registration and the token exchange, and
// the token exchange needs a code that only an admin's consent can create.

import crypto from "node:crypto";

import { adminAccountExists } from "../../lib/auth/auth.js";
import { MAX_ACTIVE_PER_ADMIN, SCOPES } from "../../lib/auth/api-token.js";
import {
  CODE_TTL_S, MAX_CLIENTS, authorizationServerMetadata, hashSecret, isChallenge, iso, issueGrant, newSecret,
  pickScope, pkceMatches, protectedResourceMetadata, readRegistration, refreshGrant
} from "../../lib/auth/oauth.js";
import { readSession } from "../../lib/auth/session.js";
import { recordAdminEvent } from "../../lib/core/admin-audit.js";
import { getCollections } from "../../lib/db/repositories.js";

export const PENDING_COOKIE = "pt_oauth_next";
const PENDING_TTL_S = 10 * 60;
const MAX_AUTHORIZE_URL = 2000;

const SCOPE_HELP = {
  read: "Read only: reports, tags, orders, print queue, reviews.",
  write: "Read, plus promo codes and the shop add-on setting.",
  ops: "Everything above, plus issue tags, mark prints, approve reviews, marketing units, publish sticker designs."
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page(title, body, { script = "", bodyAttrs = "" } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f6f8;color:#14161a}
main{box-sizing:border-box;width:min(30rem,calc(100% - 2rem));background:#fff;border:1px solid #dfe2e8;border-radius:12px;padding:1.5rem;margin:1rem}
h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:.5rem 0}.muted{color:#5b6270;font-size:.9rem}.host{font-weight:600;word-break:break-all}
label{display:block;margin:1rem 0 .25rem;font-weight:600}select{width:100%;padding:.55rem;font:inherit;border:1px solid #c7ccd6;border-radius:8px;background:#fff;color:inherit}
.row{display:flex;gap:.75rem;margin-top:1.25rem}button{flex:1;padding:.7rem 1rem;font:inherit;font-weight:600;border-radius:8px;border:1px solid #c7ccd6;background:#fff;color:inherit;cursor:pointer}
button.primary{background:#14161a;color:#fff;border-color:#14161a}button:disabled{opacity:.6;cursor:wait}#err{color:#b3261e;margin-top:.75rem}
@media (prefers-color-scheme:dark){body{background:#0e1013;color:#eceef2}main{background:#171a1f;border-color:#2a2f38}.muted{color:#9aa2b1}select,button{background:#171a1f;border-color:#3a404b}button.primary{background:#eceef2;color:#14161a;border-color:#eceef2}}
</style></head><body${bodyAttrs}>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

const consentScript = `
const txn = document.body.dataset.txn;
const err = document.getElementById("err");
async function decide(decision) {
  const buttons = document.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  err.textContent = "";
  try {
    const res = await fetch("/oauth/authorize", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ txn, decision, scope: document.getElementById("scope").value })
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.redirect) { window.location.assign(out.redirect); return; }
    err.textContent = out.error || "Something went wrong. Start the connection again from Claude.";
  } catch {
    err.textContent = "Could not reach the server. Try again.";
  }
  buttons.forEach((b) => (b.disabled = false));
}
document.getElementById("approve").addEventListener("click", () => decide("approve"));
document.getElementById("deny").addEventListener("click", () => decide("deny"));`;

const ago = (date) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
};

function consentPage({ txn, client, redirectUri, adminEmail, requestedScope }) {
  const options = SCOPES.map((s) => `<option value="${s}"${s === requestedScope ? " selected" : ""}>${s}: ${esc(SCOPE_HELP[s])}</option>`).join("");
  return page("Connect to ParkTag admin", `<main>
<h1>Connect <span class="host">${esc(client.name)}</span> to ParkTag admin?</h1>
<p>You are signed in as <strong>${esc(adminEmail)}</strong>. If you approve, this app can use the admin tools on your behalf until you revoke it on the Tokens page.</p>
<p class="muted">The app's name is chosen by whoever registered it, not verified by ParkTag. It registered ${esc(ago(client.createdAt))}. After approving you are sent to <span class="host">${esc(redirectUri)}</span>. Only approve if you started this from Claude yourself.</p>
<label for="scope">What it may do</label><select id="scope">${options}</select>
<div class="row"><button id="deny" type="button">Deny</button><button id="approve" class="primary" type="button">Approve</button></div>
<p id="err" role="alert"></p></main>`, { script: consentScript, bodyAttrs: ` data-txn="${esc(txn)}"` });
}

const errorPage = (message) => page("Cannot connect", `<main><h1>Cannot connect</h1><p>${esc(message)}</p><p class="muted">Start the connection again from Claude.</p></main>`);

function withParams(uri, params) {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  return url.toString();
}

const oauthError = (reply, status, error, description) => {
  reply.code(status).header("cache-control", "no-store").header("pragma", "no-cache");
  return { error, ...(description ? { error_description: description } : {}) };
};

/** If an admin just finished signing in while an authorize request was waiting, send them back to it. */
export function resumeAuthorize(request, reply) {
  const pending = request.cookies?.[PENDING_COOKIE];
  if (!pending) return false;
  reply.clearCookie(PENDING_COOKIE, { path: "/" });
  if (!/^\/oauth\/authorize\?[\x21-\x7e]{1,2000}$/.test(pending)) return false;
  reply.redirect(pending);
  return true;
}

export function registerOAuthRoutes(app, env) {
  const base = String(env.appBaseUrl).replace(/\/+$/, "");
  const isProduction = env.runtimeMode === "production";

  const metadata = (doc) => async (_request, reply) =>
    reply.header("cache-control", "public, max-age=300").header("access-control-allow-origin", "*").send(doc);
  app.get("/.well-known/oauth-protected-resource", metadata(protectedResourceMetadata(base)));
  app.get("/.well-known/oauth-protected-resource/mcp", metadata(protectedResourceMetadata(base)));
  app.get("/.well-known/oauth-authorization-server", metadata(authorizationServerMetadata(base)));

  app.post("/oauth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = readRegistration(request.body);
    if (!parsed.ok) return oauthError(reply, 400, parsed.error, parsed.description);
    const collections = await getCollections(env);
    if (!collections) return oauthError(reply, 503, "temporarily_unavailable");
    if ((await collections.oauthClients.estimatedDocumentCount()) >= MAX_CLIENTS) {
      // Full. Registration is open to anyone, so free room by dropping the oldest clients nobody ever completed a
      // grant with. One that has been used is never evicted, so a flood cannot lock real connections out.
      const stale = await collections.oauthClients.find({ used: false }, { projection: { _id: 1 } }).sort({ createdAt: 1 }).limit(200).toArray();
      if (!stale.length) return oauthError(reply, 503, "temporarily_unavailable", "Too many registered clients.");
      await collections.oauthClients.deleteMany({ _id: { $in: stale.map((c) => c._id) } });
    }

    const clientId = `ptc_${crypto.randomBytes(16).toString("base64url")}`;
    const createdAt = new Date();
    await collections.oauthClients.insertOne({ clientId, name: parsed.client.name, redirectUris: parsed.client.redirectUris, createdAt, lastActiveAt: createdAt, used: false });
    reply.code(201).header("cache-control", "no-store");
    return {
      client_id: clientId, client_name: parsed.client.name, redirect_uris: parsed.client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(createdAt.getTime() / 1000)
    };
  });

  async function signedInAdmin(request) {
    const session = await readSession(app, request);
    if (!session || session.role !== "admin") return null;
    try { return (await adminAccountExists(session.userId)) ? { id: String(session.userId), email: session.email || null } : null; } catch { return null; }
  }

  const html = (reply, doc, status = 200) =>
    reply.code(status).type("text/html; charset=utf-8").header("cache-control", "no-store").send(doc);

  app.get("/oauth/authorize", async (request, reply) => {
    const q = request.query || {};
    const collections = await getCollections(env);
    if (!collections) return html(reply, errorPage("The service is temporarily unavailable."), 503);

    // Until the client and redirect URI are trusted, an error is shown here and never sent to the redirect URI.
    const client = typeof q.client_id === "string" ? await collections.oauthClients.findOne({ clientId: q.client_id }) : null;
    if (!client) return html(reply, errorPage("Unknown app. It must register first."), 400);
    if (typeof q.redirect_uri !== "string" || !client.redirectUris.includes(q.redirect_uri)) return html(reply, errorPage("The redirect address does not match the app's registration."), 400);
    if (request.url.length > MAX_AUTHORIZE_URL) return html(reply, errorPage("The request is too long."), 400);

    const state = typeof q.state === "string" ? q.state.slice(0, 512) : undefined;
    const back = (error) => reply.redirect(withParams(q.redirect_uri, { error, state }));
    if (q.response_type !== "code") return back("unsupported_response_type");
    if (q.code_challenge_method !== "S256" || !isChallenge(q.code_challenge)) return back("invalid_request");

    const admin = await signedInAdmin(request);
    if (!admin) {
      reply.setCookie(PENDING_COOKIE, request.url, {
        httpOnly: true, path: "/", sameSite: "lax", secure: isProduction || request.protocol === "https", maxAge: PENDING_TTL_S
      });
      return reply.redirect("/admin");
    }

    const txn = newSecret();
    await collections.oauthCodes.insertOne({
      kind: "txn", tokenHash: hashSecret(txn), adminId: admin.id, clientId: client.clientId, redirectUri: q.redirect_uri,
      state: state ?? null, codeChallenge: q.code_challenge, expiresAt: new Date(Date.now() + CODE_TTL_S * 1000)
    });
    return html(reply, consentPage({
      txn, client, adminEmail: admin.email, requestedScope: pickScope(typeof q.scope === "string" ? q.scope.split(" ").find((s) => SCOPES.includes(s)) : undefined),
      redirectUri: q.redirect_uri
    }));
  });

  app.post("/oauth/authorize", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    // The app-wide CSRF hook (app.js) refuses a foreign Origin on this route. It lets a request with no Origin or
    // Referer through, because for most routes that means a script, not a browser. The consent screen always posts
    // from a browser with fetch(), so here a missing Origin means it did not come from that screen.
    if (!request.headers.origin) { reply.code(403); return { error: "Forbidden" }; }
    const admin = await signedInAdmin(request);
    if (!admin) { reply.code(401); return { error: "Your admin session ended. Sign in and start again from Claude." }; }

    const { txn, decision, scope } = request.body || {};
    if (typeof txn !== "string" || !["approve", "deny"].includes(decision)) { reply.code(400); return { error: "Bad request." }; }
    const collections = await getCollections(env);
    if (!collections) { reply.code(503); return { error: "The service is temporarily unavailable." }; }

    // Single use, and only by the admin it was shown to.
    const pending = await collections.oauthCodes.findOneAndDelete({ kind: "txn", tokenHash: hashSecret(txn), adminId: admin.id });
    if (!pending || new Date(pending.expiresAt).getTime() <= Date.now()) { reply.code(400); return { error: "This approval expired. Start again from Claude." }; }
    const client = await collections.oauthClients.findOne({ clientId: pending.clientId });
    if (!client) { reply.code(400); return { error: "That app is no longer registered. Start again from Claude." }; }

    if (decision === "deny") {
      recordAdminEvent(collections, { event: "oauth_denied", adminId: admin.id, email: admin.email, target: client.name, request });
      return { redirect: withParams(pending.redirectUri, { error: "access_denied", state: pending.state }) };
    }

    const active = await collections.adminApiTokens.countDocuments({ adminId: admin.id, revokedAt: null, expiresAt: { $gt: iso(Date.now()) } });
    if (active >= MAX_ACTIVE_PER_ADMIN) {
      reply.code(409);
      return { error: `You already have ${MAX_ACTIVE_PER_ADMIN} active API tokens. Revoke one on the Tokens page, then try again.` };
    }

    const granted = pickScope(scope);
    const code = newSecret();
    await collections.oauthCodes.insertOne({
      kind: "code", tokenHash: hashSecret(code), adminId: admin.id, adminEmail: admin.email, clientId: client.clientId,
      redirectUri: pending.redirectUri, codeChallenge: pending.codeChallenge, scope: granted,
      expiresAt: new Date(Date.now() + CODE_TTL_S * 1000)
    });
    recordAdminEvent(collections, { event: "oauth_authorized", adminId: admin.id, email: admin.email, target: `${client.name} (${granted})`, request });
    return { redirect: withParams(pending.redirectUri, { code, state: pending.state }) };
  });

  // application/x-www-form-urlencoded bodies are already parsed to an object by the app-wide parser in app.js.
  app.post("/oauth/token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const p = request.body && typeof request.body === "object" ? request.body : {};
    const str = (k) => (typeof p[k] === "string" ? p[k] : "");
    const collections = await getCollections(env);
    if (!collections) return oauthError(reply, 503, "temporarily_unavailable");

    const client = str("client_id") ? await collections.oauthClients.findOne({ clientId: str("client_id") }) : null;
    if (!client) return oauthError(reply, 401, "invalid_client", "Unknown client_id.");
    const clientRef = { clientId: client.clientId, name: client.name };
    reply.header("cache-control", "no-store").header("pragma", "no-cache");

    if (p.grant_type === "authorization_code") {
      // Consumed first, so a replayed or raced code finds nothing.
      const row = str("code")
        ? await collections.oauthCodes.findOneAndDelete({ kind: "code", tokenHash: hashSecret(str("code")), clientId: client.clientId })
        : null;
      if (!row || new Date(row.expiresAt).getTime() <= Date.now()) return oauthError(reply, 400, "invalid_grant", "The code is invalid or expired.");
      if (str("redirect_uri") !== row.redirectUri) return oauthError(reply, 400, "invalid_grant", "redirect_uri does not match the authorization request.");
      if (!pkceMatches(str("code_verifier"), row.codeChallenge)) return oauthError(reply, 400, "invalid_grant", "PKCE verification failed.");
      const out = await issueGrant(collections, { admin: { id: row.adminId, email: row.adminEmail }, client: clientRef, scope: row.scope });
      return out.error ? oauthError(reply, 400, "invalid_grant", out.error) : out;
    }

    if (p.grant_type === "refresh_token") {
      const out = str("refresh_token") ? await refreshGrant(collections, { refreshToken: str("refresh_token"), clientId: client.clientId }) : null;
      return out || oauthError(reply, 400, "invalid_grant", "The refresh token is invalid, expired or revoked. Connect again.");
    }

    return oauthError(reply, 400, "unsupported_grant_type");
  });
}
