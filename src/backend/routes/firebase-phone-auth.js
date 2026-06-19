import { ObjectId } from "mongodb";
import { getCollections } from "../lib/repositories.js";
import { createSession, writeSessionCookie } from "../lib/session.js";

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
  // Step 1 — send OTP via Firebase REST API (server-side, no reCAPTCHA)
  app.post("/api/auth/firebase-phone/send", async (request, reply) => {
    const { phone } = request.body || {};
    if (!phone) {
      reply.code(400);
      return { ok: false, error: "Phone number required." };
    }

    const apiKey = env.firebaseApiKey;
    if (!apiKey) {
      reply.code(500);
      return { ok: false, error: "Firebase not configured." };
    }

    const phoneE164 = normalizeE164(phone);

    try {
      const data = await firebasePost("sendVerificationCode", apiKey, {
        phoneNumber: phoneE164
      });
      return { ok: true, sessionInfo: data.sessionInfo };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });

  // Step 2 — verify OTP, sign in via Firebase REST API, create session
  app.post("/api/auth/firebase-phone/verify", async (request, reply) => {
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
      writeSessionCookie(reply, sessionId);

      return { ok: true, isNew };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });
}
