import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SESSION_COOKIE = "wavetag_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// In development, nodemon restarts the server on every file save, which would
// otherwise wipe the in-memory session store and log you out constantly.
// Persist sessions to a local file (dev only) so a restart reloads them.
// Production keeps sessions in memory only — no session tokens are written to disk.
const SESSION_FILE = path.join(process.cwd(), ".dev-sessions.json");
const PERSIST =
  process.env.APP_ENV !== "production" && process.env.APP_ENV !== "prod";

export function loadSessions(app) {
  if (!PERSIST) return;
  try {
    const now = Date.now();
    for (const s of JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"))) {
      if (!s.expiresAt || new Date(s.expiresAt).getTime() > now) {
        app.sessions.set(s.id, s);
      }
    }
  } catch {
    // No session file yet, or it is unreadable — start with an empty store.
  }
}

function persistSessions(app) {
  if (!PERSIST) return;
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify([...app.sessions.values()]));
  } catch {
    // Best effort — persistence is a dev convenience, never fatal.
  }
}

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

  persistSessions(app);
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
  if (sessionId) {
    app.sessions.delete(sessionId);
    persistSessions(app);
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
