import { ObjectId } from "mongodb";
import {
  sendOtp,
  verifyOtp,
  isMobileIdentifier,
  normalizeIdentifier,
  resolveOwnerByVerifiedMobile
} from "../../lib/auth/otp.js";
import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import { getCollections } from "../../lib/db/repositories.js";
import { clientErrorMessage } from "../../lib/errors.js";
import { verifyRecaptcha, isRecaptchaConfigured } from "../../lib/integrations/recaptcha.js";

export function registerOtpAuthRoutes(app, env) {
  // verifyRecaptcha() no-ops when no keys are set, which is right for local work
  // but means the bot gate on /api/auth/send-otp can be entirely absent in a
  // deployment without anything saying so. Every OTP costs real money to send
  // and lands on somebody's phone, so an unconfigured production deployment is
  // worth stating out loud rather than discovering from a WhatsApp bill.
  //
  // A warning and not a hard failure: the per-IP and per-destination send caps
  // still apply, so this degrades the defence rather than removing it, and
  // refusing to boot over it would take the whole site down for a bot control.
  if (!isRecaptchaConfigured(env)) {
    const message =
      "[recaptcha] RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET are not configured — " +
      "/api/auth/send-otp has NO bot check. Scripted OTP flooding is limited only by " +
      "the per-IP and per-destination send caps.";

    if (env.runtimeMode === "production") {
      app.log.warn(message);
    } else {
      app.log.info(`${message} (expected outside production)`);
    }
  }

  // Public: lets the browser fetch the reCAPTCHA site key (safe to expose). Empty
  // when unconfigured, in which case the frontend loads no reCAPTCHA at all.
  app.get("/api/auth/recaptcha/config", async (_request, reply) => {
    reply.send({ siteKey: env.recaptchaSiteKey || "" });
  });

  app.post("/api/auth/send-otp", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { identifier, recaptchaToken } = request.body || {};

    // Type, not just presence: a non-empty array or object is truthy and used
    // to sail past this check into string handling that then threw a 500.
    if (typeof identifier !== "string" || !identifier.trim()) {
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

    // Type, not just presence — see send-otp above. `{ identifier: [...] }`
    // and `{ identifier: { $ne: null } }` both used to reach normalizeIdentifier
    // and throw, answering a malformed request with 500 instead of 400.
    if (typeof identifier !== "string" || !identifier.trim()) {
      reply.code(400);
      return { ok: false, error: "Identifier and code are required" };
    }
    if (typeof code !== "string" && typeof code !== "number") {
      reply.code(400);
      return { ok: false, error: "Identifier and code are required" };
    }
    if (!String(code).trim()) {
      reply.code(400);
      return { ok: false, error: "Identifier and code are required" };
    }

    try {
      const result = await verifyOtp(env, identifier, code);

      let owner = result.owner;
      let isNewUser = result.isNewUser;
      const collections = await getCollections(env);
      const normalized = normalizeIdentifier(identifier);
      const isMobile = isMobileIdentifier(identifier);

      // For a mobile sign-in, re-resolve through the shared helper so an older
      // account that only ever stored this number in `phone` is reunited with
      // its owner instead of being shadowed by a fresh empty duplicate.
      if (isMobile && isNewUser) {
        const resolved = await resolveOwnerByVerifiedMobile(collections, normalized);

        if (resolved.conflict) {
          request.log.warn(
            { event: "otp-login-conflict" },
            "[auth] OTP number belongs to an account with another sign-in method — refusing to fork a duplicate"
          );
          reply.code(409);
          return {
            ok: false,
            code: "ACCOUNT_EXISTS",
            error:
              "This number is already on an account you can sign in to with your email or Google. Please sign in that way, then add this number from Settings."
          };
        }

        if (resolved.owner) {
          owner = resolved.owner;
          isNewUser = false;
          if (resolved.adopted) {
            request.log.info(
              { event: "otp-login-adopted-legacy-account", ownerId: String(owner._id) },
              "[auth] linked a legacy phone-only account to its verified mobile"
            );
          }
        }
      }

      if (isNewUser) {
        const ownerId = new ObjectId();
        owner = {
          _id: ownerId,
          // Not the identifier they signed in with. Storing it here made the
          // dashboard greet people with their own phone number or email; null
          // means "not known yet" and the dashboard asks for it inline.
          displayName: null,
          credits: 0,
          role: "owner",
          createdAt: new Date().toISOString()
        };
        if (isMobile) {
          owner.mobile = normalized;
          owner.phone = normalized;
          owner.mobileVerified = true;
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
