import { ObjectId } from "mongodb";
import { getCollections } from "../../lib/db/repositories.js";
import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import { isNonEmptyString } from "../../lib/auth/security.js";
import { chargeExternalOtpSend, normalizeIdentifier, resolveOwnerByVerifiedMobile, isDuplicateMobileError } from "../../lib/auth/otp.js";
import { clientErrorMessage } from "../../lib/errors.js";
import { fetchWithTimeout } from "../../lib/core/fetch-timeout.js";
import {
  anonymousDistinctId,
  attributionProps,
  sendMixpanelEventBestEffort
} from "../../lib/integrations/mixpanel.js";

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
  const res = await fetchWithTimeout(`${FIREBASE_API_BASE}:${path}?key=${apiKey}`, {
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

export async function findOrCreateOwner(collections, phoneE164) {
  phoneE164 = normalizeIdentifier(phoneE164);
  const resolved = await resolveOwnerByVerifiedMobile(collections, phoneE164);
  if (resolved.conflict) {
    return { conflict: true };
  }
  let owner = resolved.owner;

  const isNew = !owner;
  if (isNew) {
    const ownerId = new ObjectId();
    owner = {
      _id: ownerId,
      mobile: phoneE164,
      phone: phoneE164,
      mobileVerified: true,
      // Not the phone number. Writing the identifier here made every screen
      // reading displayName render it as a person's name — the dashboard
      // greeted these owners with "Hi 9876500123". Null means "not known yet",
      // which the dashboard answers with "Hi there" and an inline field.
      displayName: null,
      credits: 0,
      role: "owner",
      createdAt: new Date().toISOString()
    };
    try {
      await collections.owners.insertOne(owner);
    } catch (error) {
      if (!isDuplicateMobileError(error)) throw error;
      const winner = await resolveOwnerByVerifiedMobile(collections, phoneE164);
      if (!winner.owner) throw error;
      return { owner: winner.owner, isNew: false };
    }
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
      const res = await fetchWithTimeout(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
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

      const { owner, isNew, conflict } = await findOrCreateOwner(collections, phoneE164);
      if (conflict) {
        reply.code(409);
        return { ok: false, code: "ACCOUNT_EXISTS", error: "Sign in with your existing email or Google account, then link this number in Settings." };
      }
      const sessionId = await createSession(app, {
        id: String(owner._id),
        role: "owner",
        email: owner.email || owner.mobile || phoneE164,
        signInIdentifier: phoneE164,
        displayName: owner.displayName,
        signInMethod: "firebase_phone",
        isNewUser: isNew,
        request
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production", "owner");
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
      const res = await fetchWithTimeout(`https://identitytoolkit.googleapis.com/v1/recaptchaParams?key=${apiKey}`);
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
    const collections = await getCollections(env);
    let reservation = null;
    let charge = null;
    try {
      reservation = await reserveSmsWindow(collections, phoneE164);
      charge = await chargeExternalOtpSend(env, phoneE164);
    } catch (err) {
      if (reservation) await releaseSmsWindow(collections, reservation);
      reply.code(429);
      // Tell the page how long the number is blocked for, so it can show a
      // countdown instead of a bare error — its own memory of the window is
      // lost on every reload, and only this side knows the real expiry.
      const retryAfter = Number.isInteger(err?.retryAfterSeconds) && err.retryAfterSeconds > 0 ? err.retryAfterSeconds : null;
      if (retryAfter) reply.header("retry-after", String(retryAfter));
      return {
        ok: false,
        error: clientErrorMessage(
          err,
          "Too many verification codes requested. Please wait a while before trying again.",
          request.log
        ),
        ...(retryAfter ? { retryAfter } : {})
      };
    }

    try {
      const data = await firebasePost("sendVerificationCode", apiKey, {
        phoneNumber: phoneE164,
        recaptchaToken
      });
      await collections.otpTokens.updateOne(
        { _id: charge.insertedId, channel: "firebase-pending" },
        { $set: { channel: "firebase", sentAt: new Date().toISOString() } }
      );
      sendMixpanelEventBestEffort(request.log, env, {
        eventName: "otp_requested",
        distinctId: anonymousDistinctId(env, request),
        properties: { method: "firebase_phone", ...attributionProps(request) }
      });
      return { ok: true, sessionInfo: data.sessionInfo };
    } catch (err) {
      // HTTP errors are definite rejections: no SMS was sent. Do not let a
      // rejected Google request lock both SMS and WhatsApp for this number.
      // A network error is ambiguous, so retain the reservation defensively.
      if (err?.status) {
        await collections.otpTokens.deleteOne({ _id: charge.insertedId, channel: "firebase-pending" });
        await releaseSmsWindow(collections, reservation);
      }
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

      const { owner, isNew, conflict } = await findOrCreateOwner(collections, phoneE164);
      if (conflict) {
        reply.code(409);
        return { ok: false, code: "ACCOUNT_EXISTS", error: "Sign in with your existing email or Google account, then link this number in Settings." };
      }

      const sessionId = await createSession(app, {
        id: String(owner._id),
        role: "owner",
        email: owner.email || owner.mobile || phoneE164,
        signInIdentifier: phoneE164,
        displayName: owner.displayName,
        signInMethod: "firebase_phone",
        isNewUser: isNew,
        request
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production", "owner");

      return { ok: true, isNew };
    } catch (err) {
      request.log.error({ err }, "Firebase verify-code failed");
      sendMixpanelEventBestEffort(request.log, env, {
        eventName: "otp_failed",
        distinctId: anonymousDistinctId(env, request),
        // Firebase answers a bad code and an outage the same way, so unlike
        // the WhatsApp path there is no "rejected" to report.
        properties: { method: "firebase_phone", ...attributionProps(request) }
      });
      reply.code(400);
      return { ok: false, error: "Invalid or expired code. Please try again." };
    }
  });
}

// A stable MongoDB ID makes simultaneous requests compete for one reservation.
// Reserve before contacting Firebase, including failed/uncertain sends.
export async function reserveSmsWindow(collections, phone, now = Date.now()) {
  if (!collections) throw new Error("Database not configured.");
  const id = `sms-window:${normalizeIdentifier(phone)}`;
  const expiresAt = new Date(now + SMS_WINDOW_MS).toISOString();
  try {
    await collections.otpTokens.updateOne(
      { _id: id, expiresAt: { $lte: new Date(now).toISOString() } },
      { $set: { channel: "sms-window", expiresAt } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    // A live window exists for this number. Read its expiry so the caller can
    // tell the user exactly how long to wait rather than "10 minutes" every time.
    // The lookup is a courtesy: if it fails, still refuse, with the full window.
    const existing = await Promise.resolve()
      .then(() => collections.otpTokens.findOne({ _id: id }, { projection: { expiresAt: 1 } }))
      .catch(() => null);
    const remainingMs = existing?.expiresAt ? Date.parse(existing.expiresAt) - now : SMS_WINDOW_MS;
    const retryAfterSeconds = Math.max(1, Math.ceil((Number.isFinite(remainingMs) ? remainingMs : SMS_WINDOW_MS) / 1000));
    throw Object.assign(
      new Error(`An SMS was sent to this number recently. Please wait ${formatWait(retryAfterSeconds)} before requesting another.`),
      { expose: true, retryAfterSeconds }
    );
  }
  return { id, expiresAt };
}

const SMS_WINDOW_MS = 600000;

function formatWait(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} sec`;
  return s === 0 ? `${m} min` : `${m} min ${s} sec`;
}

async function releaseSmsWindow(collections, reservation) {
  if (!collections || !reservation) return;
  await collections.otpTokens.deleteOne({
    _id: reservation.id,
    channel: "sms-window",
    expiresAt: reservation.expiresAt
  });
}
