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
  app.get("/api/session", async (request) => {
    const session = await readSession(app, request);

    return {
      ok: true,
      session
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
