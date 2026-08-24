import {
  loginUser
} from "../../lib/auth/auth.js";
import {
  clearSession,
  createSession,
  getSessionCookieName,
  readSession,
  writeSessionCookie
} from "../../lib/auth/session.js";
import { revokeVaultAccess } from "../../lib/core/vault.js";
import {
  clearLoginFailures,
  getLoginLock,
  recordLoginFailure
} from "../../lib/auth/login-lockout.js";
import { getCollections } from "../../lib/db/repositories.js";

export function registerAuthRoutes(app, env) {
  // Whoami for the current cookie. Returns only what a page needs to render
  // signed-in chrome.
  //
  // It must NEVER return `session.id`. That value IS the wavetag_session cookie,
  // so echoing it handed any script on the page the bearer token the httpOnly
  // flag exists to keep out of reach — one XSS (and the CSP still runs
  // 'unsafe-inline' for both script-src and script-src-attr) turned into a
  // stolen 7-day session replayable from anywhere. `userId` is dropped for the
  // same reason: it is the ObjectId every /api/owner/* route keys off, and no
  // client needs it.
  app.get("/api/session", async (request) => {
    const session = await readSession(app, request);

    if (!session) {
      return { ok: true, session: null };
    }

    return {
      ok: true,
      session: {
        role: session.role,
        email: session.email,
        displayName: session.displayName || null,
        expiresAt: session.expiresAt
      }
    };
  });

  // The role a sign-in authenticates against is fixed by the ROUTE, never by the
  // request body.
  //
  // There used to be a single /api/auth/login whose `role` came from the caller
  // and chose the collection to look in — so the owner login page's own endpoint
  // was equally an admin login endpoint. Anyone could point credential stuffing
  // at the admin table from the public sign-in surface, and the only thing in
  // the way was the per-account lockout. Splitting the routes means an owner
  // endpoint can only ever read `owners`, and reaching admins requires the
  // admin route, which can be firewalled, monitored, or moved independently.
  function credentialLogin(role) {
    return async function handler(request, reply) {
      const { email, password, rememberMe, role: bodyRole } = request.body || {};

      // A body role is no longer honoured. Rejecting a contradictory one — as
      // opposed to ignoring it — means a stale client that still sends
      // `role: "admin"` here fails loudly instead of silently attempting an
      // owner sign-in and reporting "Invalid credentials" forever.
      if (bodyRole !== undefined && bodyRole !== role) {
        reply.code(400);
        return {
          ok: false,
          error: "This endpoint does not accept a role. Use the sign-in page for your account type."
        };
      }

      if (!email || !password) {
        reply.code(400);
        return {
          ok: false,
          error: "email and password are required"
        };
      }

      // Per-ACCOUNT lockout, checked before the password is verified so a locked
      // account costs an attacker a single indexed read rather than a bcrypt
      // comparison. The per-IP rate limit above does not cover this case:
      // credential stuffing arrives from a rotating pool of addresses, which a
      // per-IP counter never sees as one attack.
      //
      // Keyed by role as well as identifier, so owner and admin accounts sharing
      // an address lock independently of one another.
      const collections = await getCollections(env);
      const lock = await getLoginLock(collections, role, email);

      if (lock.locked) {
        reply.code(429);
        reply.header("retry-after", String(lock.retryAfterSeconds));
        return {
          ok: false,
          error: "Too many failed sign-in attempts. Please try again later."
        };
      }

      const user = await loginUser(env, role, email, password);

      if (!user) {
        // Recorded against the submitted identifier whether or not an account
        // exists for it, so this stays silent about who has an account. The
        // response is byte-identical to the pre-existing one for the same reason.
        await recordLoginFailure(collections, role, email);
        reply.code(401);
        return {
          ok: false,
          error: "Invalid credentials"
        };
      }

      await clearLoginFailures(collections, role, email);

      const sessionId = await createSession(app, user);
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production", Boolean(rememberMe));

      return {
        ok: true,
        user
      };
    };
  }

  const loginRateLimit = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  app.post("/api/auth/login", loginRateLimit, credentialLogin("owner"));
  app.post("/api/auth/admin/login", loginRateLimit, credentialLogin("admin"));

  app.post("/api/auth/logout", async (request, reply) => {
    // Drop any standing vault unlock before the session goes. The grant is
    // keyed by session id, so once the session is deleted nothing can present
    // it — it is inert either way, and never reachable by a recycled id
    // because session ids are 192 bits of randomness and are never reissued.
    // It is removed here so signing out does not leave a row behind that says
    // an unlocked vault exists, which is both untrue and confusing to read in
    // the database.
    const sessionId = request.cookies[getSessionCookieName()];
    if (sessionId) {
      const collections = await getCollections(env);
      if (collections) await revokeVaultAccess(collections, sessionId);
    }

    await clearSession(app, request, reply);

    return {
      ok: true
    };
  });
}
