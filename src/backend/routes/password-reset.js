import { requestPasswordReset, resetPassword } from "../lib/password-reset.js";

export function registerPasswordResetRoutes(app, env) {
  app.post("/api/auth/forgot-password", async (request, reply) => {
    const { email } = request.body || {};

    if (!email) {
      reply.code(400);
      return { ok: false, error: "Email is required" };
    }

    try {
      await requestPasswordReset(env, email);
      return {
        ok: true,
        message: "If an account exists with that email, a reset link has been sent."
      };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to process request"
      };
    }
  });

  app.post("/api/auth/reset-password", async (request, reply) => {
    const { token, password } = request.body || {};

    if (!token || !password) {
      reply.code(400);
      return { ok: false, error: "Token and password are required" };
    }

    try {
      await resetPassword(env, token, password);
      return { ok: true, message: "Password updated successfully." };
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to reset password"
      };
    }
  });
}
