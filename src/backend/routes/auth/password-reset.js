import { requestPasswordReset, resetPassword } from "../../lib/auth/password-reset.js";
import { clientErrorMessage } from "../../lib/errors.js";

export function registerPasswordResetRoutes(app, env) {
  app.post("/api/auth/forgot-password", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (request, reply) => {
    const { email } = request.body || {};

    if (!email) {
      reply.code(400);
      return { ok: false, error: "Email is required" };
    }

    // ALWAYS answer with the same 200 and the same non-committal message, even
    // when the send fails. Returning the error turned this into an account
    // enumeration oracle: an unknown address returned 200 immediately, while a
    // REAL one continued on to SMTP and — if mail was misconfigured or the
    // provider was down — surfaced a 500 carrying the raw internal message. The
    // difference between the two responses answered "does this address have an
    // account?" for anyone who asked. Failures are logged server-side instead.
    try {
      await requestPasswordReset(env, email);
    } catch (error) {
      request.log.error({ err: error }, "Password reset request failed");
    }

    return {
      ok: true,
      message: "If an account exists with that email, a reset link has been sent."
    };
  });

  app.post("/api/auth/reset-password", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
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
      // Only the deliberate, user-facing messages from resetPassword (expired
      // link, already used, too-short password) reach the client. Anything else
      // — a DB outage, a driver error — is logged and collapsed, rather than
      // echoed verbatim as it was before.
      return {
        ok: false,
        error: clientErrorMessage(
          error,
          "We couldn't reset your password. Please request a new link.",
          request.log
        )
      };
    }
  });
}
