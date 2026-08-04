import {
  loginUser
} from "../../lib/auth/auth.js";
import {
  clearSession,
  createSession,
  readSession,
  writeSessionCookie
} from "../../lib/auth/session.js";

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

  app.post("/api/auth/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { role, email, password, rememberMe } = request.body || {};

    if (!role || !email || !password) {
      reply.code(400);
      return {
        ok: false,
        error: "role, email, and password are required"
      };
    }

    const user = await loginUser(env, role, email, password);

    if (!user) {
      reply.code(401);
      return {
        ok: false,
        error: "Invalid credentials"
      };
    }

    const sessionId = await createSession(app, user);
    writeSessionCookie(reply, sessionId, env.runtimeMode === "production", Boolean(rememberMe));

    return {
      ok: true,
      user
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await clearSession(app, request, reply);

    return {
      ok: true
    };
  });
}
