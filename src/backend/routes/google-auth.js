import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { createSession, writeSessionCookie } from "../lib/session.js";
import { getCollections } from "../lib/repositories.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function registerGoogleAuthRoutes(app, env) {
  if (!env.googleClientId) return;

  app.get("/api/auth/google", async (request, reply) => {
    const state = crypto.randomBytes(16).toString("hex");

    reply.setCookie("pt_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/"
    });

    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleCallbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account"
    });

    reply.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    const { code, state, error } = request.query;

    if (error || !code) {
      reply.redirect("/owner-login?error=google_cancelled");
      return;
    }

    const storedState = request.cookies?.pt_oauth_state;
    if (!storedState || storedState !== state) {
      reply.redirect("/owner-login?error=invalid_state");
      return;
    }

    reply.clearCookie("pt_oauth_state", { path: "/" });

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
        reply.redirect("/owner-login?error=db_unavailable");
        return;
      }

      const owner = await collections.owners.findOne({ email });

      let resolvedOwner = owner;
      const isNew = !owner;

      if (isNew) {
        const ownerId = new ObjectId();
        resolvedOwner = {
          _id: ownerId,
          email,
          displayName,
          googleId: userInfo.sub,
          credits: 0,
          role: "owner",
          createdAt: new Date().toISOString()
        };
        await collections.owners.insertOne(resolvedOwner);
      }

      const sessionId = await createSession(app, {
        id: String(resolvedOwner._id),
        role: "owner",
        email: resolvedOwner.email,
        displayName: resolvedOwner.displayName || displayName
      });
      writeSessionCookie(reply, sessionId);
      reply.redirect(isNew ? "/owner-welcome?new=1" : "/owner-welcome");
    } catch (err) {
      app.log.error(err, "Google auth callback error");
      reply.redirect("/owner-login?error=auth_failed");
    }
  });
}
