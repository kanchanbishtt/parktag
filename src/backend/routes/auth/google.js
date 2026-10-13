import crypto from "node:crypto";

import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import { getCollections } from "../../lib/db/repositories.js";
import { findByCanonicalEmail } from "../../lib/auth/identity.js";
import { recordAdminEvent } from "../../lib/core/admin-audit.js";
import { fetchWithTimeout } from "../../lib/core/fetch-timeout.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// The browser that started a redirect sign-in, so the callback can tell it
// apart from one that was merely sent the callback link.
//
// A stored `state` only proved that SOMEBODY started a sign-in through us.
// Anyone could start one, approve it with their own Google account, stop
// before the callback, and send the resulting link to someone else: opening it
// signed that person's browser into the attacker's account (login CSRF), and
// whatever they then saved — a vehicle, an address, a document — went to the
// attacker.
//
// So each browser carries a random id in a cookie, and every state is stored
// with a hash of the id of the browser that asked for it. The callback only
// consumes a state whose hash matches the browser presenting it. One id per
// browser rather than the state itself in the cookie: sign-ins started in two
// tabs both complete, instead of the second overwriting the first.
//
// Sent only to the callback. SameSite=Lax, because Google returns with a
// top-level navigation, which Lax allows and Strict would not.
const BROWSER_COOKIE = "pt_google_browser";
const BROWSER_COOKIE_PATH = "/api/auth/google/callback";
const BROWSER_ID = /^[a-f0-9]{64}$/;

const browserHash = (id) => crypto.createHash("sha256").update(String(id)).digest("hex");

// Accepted `iss` values for a Google-issued ID token (One Tap credential).
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

// We look an owner up by email, so a Google account whose `email` is set but NOT
// verified would otherwise let someone sign in as a victim by putting the
// victim's address on an attacker-controlled Google account. Require the claim
// to be true before trusting the email. tokeninfo returns it as the string
// "true"; the OIDC userinfo endpoint returns a real boolean — accept both.
function isEmailVerified(value) {
  return value === true || value === "true";
}

export function registerGoogleAuthRoutes(app, env) {
  if (!env.googleClientId) return;

  const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  // OAuth `state` (the CSRF nonce) is persisted in Mongo, not just in this
  // process's memory. It used to live only in an in-process Map, which meant a
  // deploy or restart between the redirect to Google and the callback lost the
  // state and failed the sign-in with `invalid_state` — and if the service ever
  // runs more than one instance, the callback frequently lands on a different
  // instance than the one that issued the state, breaking a large share of
  // logins. The in-memory Map is kept as a fast path in front of it, and the
  // TTL index on oauth_states handles expiry (see repositories.js).
  async function saveOAuthState(state, role, browser) {
    app.oauthStates.set(state, { ts: Date.now(), role, browser });
    try {
      const collections = await getCollections(env);
      if (collections) {
        await collections.oauthStates.insertOne({
          _id: state,
          role,
          browser,
          createdAt: new Date()
        });
      }
    } catch {
      // Non-fatal: the in-memory copy still covers the single-instance,
      // no-restart case, which is the common one.
    }
  }

  // Single-use: reading a state also consumes it, so a captured callback URL
  // cannot be replayed. Only the browser that started the sign-in can consume
  // it; for any other the state is left as it was, so a link opened elsewhere
  // does not burn the sign-in for the browser it belongs to.
  async function consumeOAuthState(state, browserId) {
    if (typeof state !== "string" || !state) return null;
    if (typeof browserId !== "string" || !BROWSER_ID.test(browserId)) return null;
    const browser = browserHash(browserId);

    let cached = app.oauthStates.get(state);
    if (cached && cached.browser !== browser) cached = null;
    if (cached) app.oauthStates.delete(state);

    let doc = null;
    try {
      const collections = await getCollections(env);
      if (collections) {
        doc = await collections.oauthStates.findOneAndDelete({ _id: state, browser });
      }
    } catch {
      // Fall back to the in-memory copy below.
    }

    const found = doc || cached;
    if (!found) return null;

    const issuedAt = doc ? new Date(doc.createdAt).getTime() : cached.ts;
    if (Date.now() - issuedAt > STATE_TTL_MS) return null;

    return { role: found.role || "owner" };
  }

  async function startOAuth(request, reply, role) {
    const state = crypto.randomBytes(16).toString("hex");
    // The browser's id if it already has one, so every tab shares it.
    const existing = request.cookies?.[BROWSER_COOKIE];
    const browserId = BROWSER_ID.test(existing || "") ? existing : crypto.randomBytes(32).toString("hex");
    await saveOAuthState(state, role, browserHash(browserId));
    // Re-set each time, so it lives as long as the newest sign-in.
    reply.setCookie(BROWSER_COOKIE, browserId, {
      httpOnly: true,
      path: BROWSER_COOKIE_PATH,
      sameSite: "lax",
      // As writeSessionCookie decides it.
      secure: env.runtimeMode === "production" || reply.request?.protocol === "https",
      maxAge: Math.floor(STATE_TTL_MS / 1000)
    });
    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleCallbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online"
    });
    reply.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  }

  app.get("/api/auth/google", async (request, reply) => {
    await startOAuth(request, reply, "owner");
  });

  app.get("/api/auth/admin/google", async (request, reply) => {
    await startOAuth(request, reply, "admin");
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    const { code, state, error } = request.query;

    if (error || !code) {
      reply.redirect("/owner-login?error=google_cancelled");
      return;
    }

    // The browser cookie stays: another tab's sign-in may still be on its way
    // back. It is only an id, useless without a state started alongside it,
    // and it expires with the newest of them.
    const storedState = await consumeOAuthState(state, request.cookies?.[BROWSER_COOKIE]);
    if (!storedState) {
      reply.redirect("/owner-login?error=invalid_state");
      return;
    }
    const role = storedState.role;

    try {
      const tokenRes = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: env.googleCallbackUrl,
          grant_type: "authorization_code"
        })
      });

      if (!tokenRes.ok) {
        reply.redirect("/owner-login?error=token_exchange_failed");
        return;
      }

      const tokens = await tokenRes.json();

      const userRes = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });

      if (!userRes.ok) {
        reply.redirect("/owner-login?error=userinfo_failed");
        return;
      }

      const userInfo = await userRes.json();
      const email = userInfo.email?.toLowerCase();
      const displayName = userInfo.name || email;

      if (!email) {
        reply.redirect("/owner?error=no_email");
        return;
      }
      if (!isEmailVerified(userInfo.email_verified)) {
        const base = role === "admin" ? "/admin" : "/owner-login";
        reply.redirect(`${base}?error=email_unverified`);
        return;
      }

      const collections = await getCollections(env);
      if (!collections) {
        const errBase = role === "admin" ? "/admin" : "/owner-login";
        reply.redirect(`${errBase}?error=db_unavailable`);
        return;
      }

      if (role === "admin") {
        const admin = await findByCanonicalEmail(collections.admins, email);
        if (!admin) {
          // Not awaited: the log never slows or blocks a sign-in.
          recordAdminEvent(collections, { event: "login_failed", email, reason: "no_account", request });
          reply.redirect("/admin?error=no_account");
          return;
        }
        const sessionId = await createSession(app, {
          id: String(admin._id),
          role: "admin",
          email: admin.email,
          signInIdentifier: admin.email,
          displayName: admin.displayName || email
        });
        writeSessionCookie(reply, sessionId, env.runtimeMode === "production", "admin");
        recordAdminEvent(collections, { event: "login", adminId: String(admin._id), email: admin.email, method: "google", request });
        reply.redirect("/admin/overview");
        return;
      }

      const owner = await findByCanonicalEmail(collections.owners, email);

      if (!owner) {
        reply.redirect("/owner-login?error=no_account");
        return;
      }

      // Update displayName if the existing record has none or an email-shaped one
      const existing = owner.displayName || "";
      const needsName = !existing || existing.includes("@");
      let resolvedOwner = owner;
      if (needsName && displayName && !displayName.includes("@")) {
        await collections.owners.updateOne(
          { _id: owner._id },
          { $set: { displayName, googleId: userInfo.sub } }
        );
        resolvedOwner = { ...owner, displayName };
      }

      const sessionId = await createSession(app, {
        id: String(resolvedOwner._id),
        role: "owner",
        email: resolvedOwner.email,
        signInIdentifier: resolvedOwner.email,
        displayName: resolvedOwner.displayName || displayName,
        signInMethod: "google",
        request
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production", "owner");
      reply.redirect("/owner-welcome");
    } catch (err) {
      app.log.error(err, "Google auth callback error");
      reply.redirect("/owner-login?error=auth_failed");
    }
  });

  // ── Expose public client ID to frontend ──────────────────────────
  app.get("/api/auth/google/config", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    reply.send({ clientId: env.googleClientId });
  });

  // ── One Tap: verify ID token from GSI credential callback ────────
  app.post("/api/auth/google/credential", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { credential } = request.body || {};
    if (!credential) return reply.code(400).send({ error: "missing_credential" });

    try {
      const verifyRes = await fetchWithTimeout(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      );
      const info = await verifyRes.json();

      // Validate the token is genuinely ours and genuinely from Google:
      // - aud: minted for THIS client (not some other app's token replayed here)
      // - iss: issued by Google's token service
      if (!verifyRes.ok || info.aud !== env.googleClientId || !GOOGLE_ISSUERS.has(info.iss)) {
        return reply.code(401).send({ error: "invalid_token" });
      }

      const email = info.email?.toLowerCase();
      const displayName = info.name || email;
      if (!email) return reply.code(400).send({ error: "no_email" });
      if (!isEmailVerified(info.email_verified)) {
        return reply.code(403).send({ error: "email_unverified" });
      }

      const collections = await getCollections(env);
      if (!collections) return reply.code(503).send({ error: "db_unavailable" });

      let owner = await findByCanonicalEmail(collections.owners, email);
      if (!owner) {
        return reply.code(404).send({ error: "no_account" });
      }

      const existing = owner.displayName || "";
      const needsName = !existing || existing.includes("@");
      if (needsName && displayName && !displayName.includes("@")) {
        await collections.owners.updateOne(
          { _id: owner._id },
          { $set: { displayName, googleId: info.sub } }
        );
        owner = { ...owner, displayName };
      }

      const sessionId = await createSession(app, {
        id: String(owner._id), role: "owner",
        email: owner.email, signInIdentifier: owner.email,
        displayName: owner.displayName || displayName,
        signInMethod: "google",
        request
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production", "owner");
      reply.send({ redirect: "/owner-welcome" });
    } catch (err) {
      app.log.error(err, "Google credential verification error");
      reply.code(500).send({ error: "auth_failed" });
    }
  });

  // ── Popup fallback: exchange auth code from popup flow ───────────
  app.post("/api/auth/google/popup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { code } = request.body || {};
    if (!code) return reply.code(400).send({ error: "missing_code" });

    try {
      const tokenRes = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: "postmessage",
          grant_type: "authorization_code"
        })
      });

      if (!tokenRes.ok) return reply.code(401).send({ error: "token_exchange_failed" });
      const tokens = await tokenRes.json();

      const userRes = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      if (!userRes.ok) return reply.code(401).send({ error: "userinfo_failed" });

      const userInfo = await userRes.json();
      const email = userInfo.email?.toLowerCase();
      const displayName = userInfo.name || email;
      if (!email) return reply.code(400).send({ error: "no_email" });
      if (!isEmailVerified(userInfo.email_verified)) {
        return reply.code(403).send({ error: "email_unverified" });
      }

      const collections = await getCollections(env);
      if (!collections) return reply.code(503).send({ error: "db_unavailable" });

      let owner = await findByCanonicalEmail(collections.owners, email);
      if (!owner) {
        return reply.code(404).send({ error: "no_account" });
      }

      const existing = owner.displayName || "";
      const needsName = !existing || existing.includes("@");
      if (needsName && displayName && !displayName.includes("@")) {
        await collections.owners.updateOne(
          { _id: owner._id },
          { $set: { displayName, googleId: userInfo.sub } }
        );
        owner = { ...owner, displayName };
      }

      const sessionId = await createSession(app, {
        id: String(owner._id), role: "owner",
        email: owner.email, signInIdentifier: owner.email,
        displayName: owner.displayName || displayName,
        signInMethod: "google",
        request
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production", "owner");
      reply.send({ redirect: "/owner-welcome" });
    } catch (err) {
      app.log.error(err, "Google popup auth error");
      reply.code(500).send({ error: "auth_failed" });
    }
  });
}
