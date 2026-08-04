import { ObjectId } from "mongodb";
import { getCollections } from "../../lib/db/repositories.js";
import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import { isNonEmptyString } from "../../lib/auth/security.js";
import { chargeExternalOtpSend } from "../../lib/auth/otp.js";
import { clientErrorMessage } from "../../lib/errors.js";

const FIREBASE_API_BASE = "https://identitytoolkit.googleapis.com/v1/accounts";

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const json = Buffer.from(part, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeE164(raw) {
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits;
}

async function firebasePost(path, apiKey, body) {
  const res = await fetch(`${FIREBASE_API_BASE}:${path}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || "Firebase error";
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return data;
}

async function findOrCreateOwner(collections, phoneE164) {
  const phoneDigits = phoneE164.replace(/[^\d]/g, "");
  const phone10 = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;

  let owner = await collections.owners.findOne({
    $or: [{ mobile: phoneE164 }, { mobile: phoneDigits }, { mobile: phone10 }]
  });

  const isNew = !owner;
  if (isNew) {
    const ownerId = new ObjectId();
    owner = {
      _id: ownerId,
      mobile: phoneE164,
      displayName: phone10,
      credits: 0,
      role: "owner",
      createdAt: new Date().toISOString()
    };
    await collections.owners.insertOne(owner);
  }
  return { owner, isNew };
}

export function registerFirebasePhoneAuthRoute(app, env) {
  // Public Firebase config for the client SDK
  app.get("/api/auth/firebase-config", async (request, reply) => {
    const { firebaseApiKey, firebaseProjectId } = env;
    if (!firebaseApiKey || !firebaseProjectId) {
      reply.code(503);
      return { error: "Firebase not configured." };
    }
    return {
      apiKey: firebaseApiKey,
      authDomain: `${firebaseProjectId}.firebaseapp.com`,
      projectId: firebaseProjectId
    };
  });

  // Verify a Firebase ID token (from client SDK) and create a session
  app.post("/api/auth/firebase-phone/verify-token", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { idToken } = request.body || {};
    if (!idToken) { reply.code(400); return { ok: false, error: "ID token required." }; }

    const apiKey = env.firebaseApiKey;
    if (!apiKey) { reply.code(500); return { ok: false, error: "Firebase not configured." }; }

    try {
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken })
      });
      const data = await res.json();

      if (!res.ok || !data.users?.[0]) {
        reply.code(401);
        return { ok: false, error: "Invalid or expired token." };
      }

      const phoneE164 = data.users[0].phoneNumber;
      if (!phoneE164) { reply.code(401); return { ok: false, error: "No phone number in token." }; }

      const collections = await getCollections(env);
      if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

      const { owner, isNew } = await findOrCreateOwner(collections, phoneE164);
      const sessionId = await createSession(app, {
        id: String(owner._id),
        role: "owner",
        email: owner.email || owner.mobile || phoneE164,
        displayName: owner.displayName
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production");
      return { ok: true, isNew };
    } catch (err) {
      request.log.error({ err }, "Firebase token verification failed");
      reply.code(400);
      return { ok: false, error: "Invalid or expired token. Please try again." };
    }
  });

  // Fetch Firebase's reCAPTCHA site key (used by client to generate invisible token)
  app.get("/api/auth/firebase-phone/recaptcha-key", async (request, reply) => {
    const apiKey = env.firebaseApiKey;
    if (!apiKey) { reply.code(500); return { error: "Firebase not configured." }; }
    try {
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/recaptchaParams?key=${apiKey}`);
      const data = await res.json();
      return { siteKey: data.recaptchaSiteKey };
    } catch (err) {
      reply.code(500);
      return { error: "Could not fetch reCAPTCHA params." };
    }
  });

  // Step 1 — send OTP via Firebase REST API (invisible reCAPTCHA token from client)
  //
  // Unauthenticated, and it causes a real SMS to be sent to any number the
  // caller names — the same abuse shape as /api/auth/send-otp: harassment of a
  // victim's handset plus a per-message cost. It previously had NO rate limit,
  // treated the reCAPTCHA token as optional, and — because Firebase dispatches
  // the message itself — never reached the per-destination cap that protects
  // the WhatsApp path. Three controls now apply:
  //   1. a per-IP route limit (cheap first line);
  //   2. a MANDATORY reCAPTCHA token, so a script with no real browser is
  //      turned away before Firebase is called at all;
  //   3. the shared per-destination budget in chargeExternalOtpSend, keyed on
  //      the victim's number — the only one of the three that still holds when
  //      the caller rotates IPs.
  app.post("/api/auth/firebase-phone/send", { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const { phone, recaptchaToken } = request.body || {};
    if (!phone) {
      reply.code(400);
      return { ok: false, error: "Phone number required." };
    }

    if (!isNonEmptyString(recaptchaToken)) {
      reply.code(400);
      return {
        ok: false,
        error: "We couldn't verify this request. Please refresh the page and try again."
      };
    }

    const apiKey = env.firebaseApiKey;
    if (!apiKey) {
      reply.code(500);
      return { ok: false, error: "Firebase not configured." };
    }

    const phoneE164 = normalizeE164(phone);

    // Charge the destination budget BEFORE calling Firebase, so a number that is
    // already over its limit costs nothing and receives nothing.
    try {
      await chargeExternalOtpSend(env, phoneE164);
    } catch (err) {
      reply.code(429);
      return {
        ok: false,
        error: clientErrorMessage(
          err,
          "Too many verification codes requested. Please wait a while before trying again.",
          request.log
        )
      };
    }

    try {
      const data = await firebasePost("sendVerificationCode", apiKey, {
        phoneNumber: phoneE164,
        recaptchaToken
      });
      return { ok: true, sessionInfo: data.sessionInfo };
    } catch (err) {
      request.log.error({ err }, "Firebase send-code failed");
      reply.code(400);
      return { ok: false, error: "Could not send verification code. Please check the number and try again." };
    }
  });

  // Step 2 — verify OTP, sign in via Firebase REST API, create session
  app.post("/api/auth/firebase-phone/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { sessionInfo, code } = request.body || {};
    if (!sessionInfo || !code) {
      reply.code(400);
      return { ok: false, error: "Session info and code are required." };
    }

    const apiKey = env.firebaseApiKey;
    if (!apiKey) {
      reply.code(500);
      return { ok: false, error: "Firebase not configured." };
    }

    try {
      const data = await firebasePost("signInWithPhoneNumber", apiKey, {
        sessionInfo,
        code
      });

      const idToken = data.idToken;
      const claims = decodeJwtPayload(idToken);
      const phoneE164 = claims?.phone_number || normalizeE164(data.phoneNumber || "");

      if (!phoneE164) {
        reply.code(401);
        return { ok: false, error: "Could not read phone number from token." };
      }

      const collections = await getCollections(env);
      if (!collections) {
        reply.code(500);
        return { ok: false, error: "Database not configured." };
      }

      const { owner, isNew } = await findOrCreateOwner(collections, phoneE164);

      const sessionId = await createSession(app, {
        id: String(owner._id),
        role: "owner",
        email: owner.email || owner.mobile || phoneE164,
        displayName: owner.displayName
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production");

      return { ok: true, isNew };
    } catch (err) {
      request.log.error({ err }, "Firebase verify-code failed");
      reply.code(400);
      return { ok: false, error: "Invalid or expired code. Please try again." };
    }
  });
}
