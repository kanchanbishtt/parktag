import { ObjectId } from "mongodb";
import { sendOtp, verifyOtp, isMobileIdentifier, normalizeIdentifier } from "../lib/otp.js";
import { createSession, writeSessionCookie } from "../lib/session.js";
import { getCollections } from "../lib/repositories.js";

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
      writeSessionCookie(reply, sessionId);

      return { ok: true, isNewUser };
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Verification failed"
      };
    }
  });
}
