import crypto from "node:crypto";

import { getEnv } from "../env.js";
import { getCollections } from "../db/repositories.js";

const SESSION_COOKIE = "wavetag_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Sessions are persisted in MongoDB (the `sessions` collection) so they survive
// server restarts/deploys and are shared across multiple instances — an
// in-memory-only store logged users out on every restart and behaved
// inconsistently behind a load balancer. `app.sessions` stays as a fast
// in-process cache in front of Mongo.

async function sessionCollection() {
  const collections = await getCollections(getEnv());
  return collections ? collections.sessions : null;
}

// One-time TTL index so Mongo auto-removes expired session docs.
let indexEnsured = false;
async function ensureSessionIndex(coll) {
  if (indexEnsured || !coll) return;
  try {
    await coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    indexEnsured = true;
  } catch {
    // Non-fatal: sessions still work; readSession also checks expiry itself.
  }
}

function isLive(session, now) {
  return session && session.expiresAt && new Date(session.expiresAt).getTime() > now;
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export async function createSession(app, user) {
  const sessionId = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const session = {
    id: sessionId,
    userId: user.id,
    role: user.role,
    email: user.email,
    displayName: user.displayName || null,
    createdAt: now.toISOString(),
    expiresAt
  };

  // Best-effort persistence: if Mongo is momentarily unavailable, still cache
  // the session so login succeeds (login already required Mongo to verify the
  // user, so this rarely fails).
  try {
    const coll = await sessionCollection();
    if (coll) {
      await ensureSessionIndex(coll);
      await coll.updateOne(
        { _id: sessionId },
        {
          $set: {
            _id: sessionId,
            userId: session.userId,
            role: session.role,
            email: session.email,
            displayName: session.displayName,
            createdAt: now,
            expiresAt
          }
        },
        { upsert: true }
      );
    }
  } catch {
    // Fall back to the in-memory cache only.
  }

  app.sessions.set(sessionId, session);
  return sessionId;
}

export async function readSession(app, request) {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const now = Date.now();

  // Fast path: in-process cache.
  const cached = app.sessions.get(sessionId);
  if (cached) {
    if (isLive(cached, now)) return cached;
    app.sessions.delete(sessionId); // expired
  }

  // Fallback: Mongo (survives restarts and is shared across instances).
  let doc;
  try {
    const coll = await sessionCollection();
    if (!coll) return null;
    doc = await coll.findOne({ _id: sessionId });
  } catch {
    return null;
  }
  if (!doc) return null;

  if (!isLive(doc, now)) {
    sessionCollection()
      .then((coll) => coll && coll.deleteOne({ _id: sessionId }))
      .catch(() => {});
    return null;
  }

  const session = {
    id: sessionId,
    userId: doc.userId,
    role: doc.role,
    email: doc.email,
    displayName: doc.displayName || null,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt
  };
  app.sessions.set(sessionId, session); // warm the cache
  return session;
}

export async function clearSession(app, request, reply) {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (sessionId) {
    app.sessions.delete(sessionId);
    try {
      const coll = await sessionCollection();
      if (coll) await coll.deleteOne({ _id: sessionId });
    } catch {
      // Best-effort — the cookie is cleared regardless, so the client is logged out.
    }
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function writeSessionCookie(reply, sessionId, isProduction = false, rememberMe = false) {
  const opts = {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isProduction
  };
  // Only persist across browser restarts when user explicitly chose "Remember me".
  // Default is a session cookie — cleared when the browser tab/window closes.
  if (rememberMe) opts.maxAge = Math.floor(SESSION_TTL_MS / 1000);
  reply.setCookie(SESSION_COOKIE, sessionId, opts);
}
