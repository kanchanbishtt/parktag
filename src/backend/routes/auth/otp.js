import { ObjectId } from "mongodb";
import { sendOtp, verifyOtp, isMobileIdentifier, normalizeIdentifier } from "../../lib/auth/otp.js";
import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import { getCollections } from "../../lib/db/repositories.js";
import { clientErrorMessage } from "../../lib/errors.js";

export function registerOtpAuthRoutes(app, env) {
  app.post("/api/auth/send-otp", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
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
        error: clientErrorMessage(
          error,
          "We couldn't send your code right now. Please try again in a moment.",
          app.log
        )
      };
    }
  });

  app.post("/api/auth/verify-otp", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { identifier, code } = request.body || {};

    if (!identifier || !code) {
      reply.code(400);
      return { ok: false, error: "Identifier and code are required" };
    }

    try {
      const result = await verifyOtp(env, identifier, code);

      let owner = result.owner;
      const isNewUser = result.isNewUser;

      if (isNewUser) {
        const collections = await getCollections(env);
        const normalized = normalizeIdentifier(identifier);
        const isMobile = isMobileIdentifier(identifier);
        const ownerId = new ObjectId();
        owner = {
          _id: ownerId,
          displayName: normalized,
          credits: 0,
          role: "owner",
          createdAt: new Date().toISOString()
        };
        if (isMobile) {
          owner.mobile = normalized;
        } else {
          owner.email = normalized;
        }
        await collections.owners.insertOne(owner);
      }

      const sessionId = await createSession(app, {
        id: String(owner._id),
        role: "owner",
        email: owner.email || owner.mobile || identifier,
        displayName: owner.displayName
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production");

      return { ok: true, isNewUser };
    } catch (error) {
      const isExposable = error && error.expose === true;
      reply.code(isExposable ? 400 : 500);
      return {
        ok: false,
        error: clientErrorMessage(
          error,
          "We couldn't verify your code right now. Please try again in a moment.",
          app.log
        )
      };
    }
  });
}
