import crypto from "node:crypto";

import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import { getCollections } from "../../lib/db/repositories.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function registerGoogleAuthRoutes(app, env) {
  if (!env.googleClientId) return;

  const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  // Purge expired states to prevent unbounded memory growth
  function purgeExpiredStates() {
    const now = Date.now();
    for (const [key, ts] of app.oauthStates) {
      if (now - ts > STATE_TTL_MS) app.oauthStates.delete(key);
    }
  }

  function startOAuth(reply, role) {
    purgeExpiredStates();
    const state = crypto.randomBytes(16).toString("hex");
    app.oauthStates.set(state, { ts: Date.now(), role });
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

  app.get("/api/auth/google", async (_request, reply) => {
    startOAuth(reply, "owner");
  });

  app.get("/api/auth/admin/google", async (_request, reply) => {
    startOAuth(reply, "admin");
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    const { code, state, error } = request.query;

    if (error || !code) {
      reply.redirect("/owner-login?error=google_cancelled");
      return;
    }

    const storedState = app.oauthStates.get(state);
    if (!storedState || Date.now() - storedState.ts > STATE_TTL_MS) {
      app.oauthStates.delete(state);
      reply.redirect("/owner-login?error=invalid_state");
      return;
    }
    const role = storedState.role || "owner";
    app.oauthStates.delete(state);

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
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

      const userRes = await fetch(GOOGLE_USERINFO_URL, {
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

      const collections = await getCollections(env);
      if (!collections) {
        const errBase = role === "admin" ? "/admin" : "/owner-login";
        reply.redirect(`${errBase}?error=db_unavailable`);
        return;
      }

      if (role === "admin") {
        const admin = await collections.admins.findOne({ email });
        if (!admin) {
          reply.redirect("/admin?error=no_account");
          return;
        }
        const sessionId = await createSession(app, {
          id: String(admin._id),
          role: "admin",
          email: admin.email,
          displayName: admin.displayName || email
        });
        writeSessionCookie(reply, sessionId, env.runtimeMode === "production");
        reply.redirect("/admin/overview");
        return;
      }

      const owner = await collections.owners.findOne({ email });

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
        displayName: resolvedOwner.displayName || displayName
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production");
      reply.redirect("/owner-welcome");
    } catch (err) {
      app.log.error(err, "Google auth callback error");
      reply.redirect("/owner-login?error=auth_failed");
    }
  });

  // ── Expose public client ID to frontend ──────────────────────────
  app.get("/api/auth/google/config", async (_request, reply) => {
    reply.send({ clientId: env.googleClientId });
  });

  // ── One Tap: verify ID token from GSI credential callback ────────
  app.post("/api/auth/google/credential", async (request, reply) => {
    const { credential } = request.body || {};
    if (!credential) return reply.code(400).send({ error: "missing_credential" });

    try {
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      );
      const info = await verifyRes.json();

      if (!verifyRes.ok || info.aud !== env.googleClientId) {
        return reply.code(401).send({ error: "invalid_token" });
      }

      const email = info.email?.toLowerCase();
      const displayName = info.name || email;
      if (!email) return reply.code(400).send({ error: "no_email" });

      const collections = await getCollections(env);
      if (!collections) return reply.code(503).send({ error: "db_unavailable" });

      let owner = await collections.owners.findOne({ email });
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
        email: owner.email, displayName: owner.displayName || displayName
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production");
      reply.send({ redirect: "/owner-welcome" });
    } catch (err) {
      app.log.error(err, "Google credential verification error");
      reply.code(500).send({ error: "auth_failed" });
    }
  });

  // ── Popup fallback: exchange auth code from popup flow ───────────
  app.post("/api/auth/google/popup", async (request, reply) => {
    const { code } = request.body || {};
    if (!code) return reply.code(400).send({ error: "missing_code" });

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
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

      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      if (!userRes.ok) return reply.code(401).send({ error: "userinfo_failed" });

      const userInfo = await userRes.json();
      const email = userInfo.email?.toLowerCase();
      const displayName = userInfo.name || email;
      if (!email) return reply.code(400).send({ error: "no_email" });

      const collections = await getCollections(env);
      if (!collections) return reply.code(503).send({ error: "db_unavailable" });

      let owner = await collections.owners.findOne({ email });
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
        email: owner.email, displayName: owner.displayName || displayName
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production");
      reply.send({ redirect: "/owner-welcome" });
    } catch (err) {
      app.log.error(err, "Google popup auth error");
      reply.code(500).send({ error: "auth_failed" });
    }
  });
}
