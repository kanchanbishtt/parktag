import { ObjectId } from "mongodb";
import { sendOtp, verifyOtp, isMobileIdentifier, normalizeIdentifier } from "../../lib/auth/otp.js";
import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import { getCollections } from "../../lib/db/repositories.js";
import { clientErrorMessage } from "../../lib/errors.js";
import { verifyRecaptcha } from "../../lib/integrations/recaptcha.js";

export function registerOtpAuthRoutes(app, env) {
  // Public: lets the browser fetch the reCAPTCHA site key (safe to expose). Empty
  // when unconfigured, in which case the frontend loads no reCAPTCHA at all.
  app.get("/api/auth/recaptcha/config", async (_request, reply) => {
    reply.send({ siteKey: env.recaptchaSiteKey || "" });
  });

  app.post("/api/auth/send-otp", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { identifier, recaptchaToken } = request.body || {};

    if (!identifier) {
      reply.code(400);
      return { ok: false, error: "Email or mobile number is required" };
    }

    // Bot check on the public OTP-send endpoint (no-op unless reCAPTCHA is
    // configured). Blocks scripted SMS/WhatsApp flooding that per-IP limits miss
    // when the attacker rotates IPs; the per-destination cap in sendOtp backs it.
    const captcha = await verifyRecaptcha(env, recaptchaToken, {
      remoteIp: request.ip,
      expectedAction: "send_otp"
    });
    if (!captcha.ok) {
      request.log.warn({ reason: captcha.reason, score: captcha.score }, "reCAPTCHA rejected send-otp");
      reply.code(400);
      return {
        ok: false,
        error: "We couldn't verify this request. Please refresh the page and try again."
      };
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
