import crypto from "node:crypto";

const SESSION_COOKIE = "wavetag_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export async function createSession(app, user) {
  const sessionId = crypto.randomBytes(24).toString("hex");

  app.sessions.set(sessionId, {
    id: sessionId,
    userId: user.id,
    role: user.role,
    email: user.email,
    displayName: user.displayName || null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  });

  return sessionId;
}

export function readSession(app, request) {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const session = app.sessions.get(sessionId);
  if (!session) return null;

  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    app.sessions.delete(sessionId);
    return null;
  }

  return session;
}

export function clearSession(app, request, reply) {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (sessionId) app.sessions.delete(sessionId);
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
