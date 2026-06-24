import { sendOtp, verifyOtp, isMobileIdentifier, normalizeIdentifier } from "../lib/otp.js";
import { createSession, writeSessionCookie } from "../lib/session.js";

export function registerOtpAuthRoutes(app, env) {
  app.post("/api/auth/send-otp", async (request, reply) => {
    const { identifier } = request.body || {};

    if (!identifier) {
      reply.code(400);
      return { ok: false, error: "Email or mobile number is required" };
    }

    try {
      await sendOtp(env, identifier);
      return { ok: true };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to send code"
      };
    }
  });

  app.post("/api/auth/verify-otp", async (request, reply) => {
    const { identifier, code } = request.body || {};

    if (!identifier || !code) {
      reply.code(400);
      return { ok: false, error: "Identifier and code are required" };
    }

    try {
      const result = await verifyOtp(env, identifier, code);

      if (!result.isNewUser && result.owner) {
        const sessionId = await createSession(app, {
          id: String(result.owner._id),
          role: "owner",
          email: result.owner.email || result.owner.mobile || identifier,
          displayName: result.owner.displayName
        });
        writeSessionCookie(reply, sessionId);
      }

      return { ok: true, isNewUser: result.isNewUser };
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Verification failed"
      };
    }
  });
}
