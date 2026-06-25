import {
  loginUser
} from "../lib/auth.js";
import {
  clearSession,
  createSession,
  readSession,
  writeSessionCookie
} from "../lib/session.js";

export function registerAuthRoutes(app, env) {
  app.get("/api/session", async (request) => {
    const session = readSession(app, request);

    return {
      ok: true,
      session
    };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const { role, email, password } = request.body || {};

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
    writeSessionCookie(reply, sessionId, env.runtimeMode === "production");

    return {
      ok: true,
      user
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    clearSession(app, request, reply);

    return {
      ok: true
    };
  });
}
