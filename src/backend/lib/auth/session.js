import crypto from "node:crypto";

import { getEnv } from "../env.js";
import { getCollections } from "../db/repositories.js";

const SESSION_COOKIE = "wavetag_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// How long a cached session may be served before readSession re-checks it
// against Mongo. This bounds how long a REVOKED session can keep working from
// an instance's in-memory cache — e.g. after a password reset (which deletes
// the user's session docs) or a logout on a different instance. Without it, a
// cached session would be honored until its 7-day expiry even though it no
// longer exists in Mongo.
const CACHE_REVALIDATE_MS = 30 * 1000; // 30 seconds

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
    // The identifier this person actually typed to get in — their email on an
    // email/Google sign-in, their number on a mobile OTP one.
    //
    // `email` above is NOT that: every caller sets it to
    // `owner.email || owner.mobile || <typed>`, so an account that has an email
    // on file reports that email no matter which way the person signed in. The
    // dashboard displays it under the greeting, which is how signing in with a
    // phone number showed somebody an email address they had not typed.
    //
    // Optional: sessions created before this field existed simply lack it, and
    // every reader falls back to the old email/mobile pair.
    signInIdentifier: user.signInIdentifier || null,
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
            signInIdentifier: session.signInIdentifier,
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

  session.cachedAt = now.getTime();
  app.sessions.set(sessionId, session);
  return sessionId;
}

export async function readSession(app, request) {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const now = Date.now();

  // Fast path: in-process cache. Only serve from cache for a short window, then
  // fall through to Mongo so revoked sessions (password reset / logout on
  // another instance) stop being honored within CACHE_REVALIDATE_MS instead of
  // surviving until their 7-day expiry. The Mongo fallback below returns null
  // when the session doc is gone, which is exactly the revoked case.
  const cached = app.sessions.get(sessionId);
  if (cached) {
    if (!isLive(cached, now)) {
      app.sessions.delete(sessionId); // expired
    } else if (now - (cached.cachedAt || 0) < CACHE_REVALIDATE_MS) {
      return cached;
    }
    // live but stale → fall through to re-validate against Mongo
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
    signInIdentifier: doc.signInIdentifier || null,
    displayName: doc.displayName || null,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    cachedAt: now // reset the revalidation window now that Mongo confirmed it
  };
  app.sessions.set(sessionId, session); // warm the cache
  return session;
}

// Revoke every session belonging to one user, without needing their cookie.
//
// Deleting an account does NOT log that account out on its own: the session row
// is keyed by session id, not by user, so it outlives the owner document and
// readSession keeps answering from it. The row is what makes the cookie work,
// so removing it is the revocation — readSession's Mongo fallback already
// returns null for a session it cannot find.
//
// The ids are read out of Mongo first and then deleted from the in-process
// cache BY KEY. app.sessions is a BoundedTtlMap with get/set/has/delete only —
// it is not iterable, and a for..of over it throws.
//
// Best-effort by design: this runs after the destructive action it accompanies,
// and failing the whole request because a cleanup query failed would leave the
// caller thinking nothing happened when the account is already gone.
export async function revokeSessionsForUser(app, userId) {
  if (userId == null) return 0;
  const id = String(userId);

  try {
    const coll = await sessionCollection();
    if (!coll) return 0;

    const doomed = await coll.find({ userId: id }, { projection: { _id: 1 } }).toArray();
    for (const row of doomed) app.sessions.delete(row._id);

    const result = await coll.deleteMany({ userId: id });
    return result.deletedCount || 0;
  } catch {
    return 0;
  }
}

// Same thing, minus the caller's own session.
//
// Two jobs. It is the "Logout from all devices" button on the Login PIN screen,
// where signing yourself out along with the borrowed laptop would make the
// control useless — the whole point is to keep this device and drop the others.
// It also runs whenever the login PIN is set or changed, because a new
// credential should not leave old sessions standing: if someone else set that
// PIN from a stolen cookie, every session they hold dies with the change, and
// the owner finds out immediately rather than months later.
//
// `keepSessionId` is compared as a string. It arrives from request.cookies, so
// it is one already, but a caller passing anything else must not silently keep
// zero sessions and log the owner out of the device they are standing at.
export async function revokeOtherSessionsForUser(app, userId, keepSessionId) {
  if (userId == null) return 0;
  const id = String(userId);
  const keep = keepSessionId == null ? null : String(keepSessionId);

  try {
    const coll = await sessionCollection();
    if (!coll) return 0;

    const filter = keep ? { userId: id, _id: { $ne: keep } } : { userId: id };

    // Cache first, by key — app.sessions is a BoundedTtlMap with no iterator,
    // so the ids have to come out of Mongo before the rows do.
    const doomed = await coll.find(filter, { projection: { _id: 1 } }).toArray();
    for (const row of doomed) app.sessions.delete(row._id);

    const result = await coll.deleteMany(filter);
    return result.deletedCount || 0;
  } catch {
    return 0;
  }
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
  // `secure` used to be exactly `isProduction`, i.e. one environment variable.
  // Set RUNTIME_MODE to anything but "production" on a live deployment and every
  // session cookie silently loses the flag — served over HTTPS, so nothing looks
  // wrong, but now willing to travel over plain HTTP if anything can force it.
  //
  // The connection itself is the more reliable signal: request.protocol is
  // "https" whenever TLS terminated at the trusted proxy (from X-Forwarded-Proto
  // under trustProxy) or at this process. Kept as OR rather than a replacement
  // so a misconfigured proxy that fails to forward the scheme cannot take the
  // flag away either — and so local HTTP development, where neither holds, still
  // gets a usable cookie.
  const overHttps = reply.request?.protocol === "https";

  const opts = {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isProduction || overHttps
  };
  // Only persist across browser restarts when user explicitly chose "Remember me".
  // Default is a session cookie — cleared when the browser tab/window closes.
  if (rememberMe) opts.maxAge = Math.floor(SESSION_TTL_MS / 1000);
  reply.setCookie(SESSION_COOKIE, sessionId, opts);
}
