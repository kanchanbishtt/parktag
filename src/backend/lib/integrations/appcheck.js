// Firebase App Check verification for the native Android app.
//
// The app cannot run web reCAPTCHA v3, so on POST /api/auth/send-otp it sends a
// limited-use App Check token in X-Firebase-AppCheck instead. A token that
// passes every check below stands in for reCAPTCHA; anything else falls back to
// the reCAPTCHA path unchanged, so the web flow is unaffected.
//
// Verified with node:crypto against Google's published JWKS (no new
// dependency). Same contract as recaptcha.js: never throws, always resolves to
// { ok, reason }.

import crypto from "node:crypto";

import { fetchWithTimeout } from "../core/fetch-timeout.js";
import { getCollections } from "../db/repositories.js";

export const APPCHECK_JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";
const ISSUER_PREFIX = "https://firebaseappcheck.googleapis.com/";
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;
const JWKS_TIMEOUT_MS = 5000;
// A kid we do not know forces at most one refetch per window, so rotated keys
// are picked up within minutes while forged kids cannot make us hammer Google.
const JWKS_REFETCH_COOLDOWN_MS = 5 * 60 * 1000;
const DUPLICATE_KEY = 11000;

let jwksCache = { keys: null, fetchedAt: 0 };
let lastForcedRefetchAt = 0;

// Tests swap the JWKS between suites; production never calls this.
export function resetAppCheckJwksCache() {
  jwksCache = { keys: null, fetchedAt: 0 };
  lastForcedRefetchAt = 0;
}

export function appCheckAppIds(env) {
  return String(env.appCheckAppIds || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
}

export function isAppCheckConfigured(env) {
  return Boolean(env.firebaseProjectNumber) && appCheckAppIds(env).length > 0;
}

async function getJwks({ force = false } = {}) {
  if (!force && jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchWithTimeout(APPCHECK_JWKS_URL, {}, JWKS_TIMEOUT_MS);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.keys)) throw new Error("JWKS response has no keys");
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

async function findJwk(kid) {
  const jwk = (await getJwks()).find(key => key.kid === kid);
  if (jwk || Date.now() - lastForcedRefetchAt < JWKS_REFETCH_COOLDOWN_MS) return jwk;
  lastForcedRefetchAt = Date.now();
  return (await getJwks({ force: true })).find(key => key.kid === kid);
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

// Signature and claims only; the jti replay guard is applied by the caller.
async function verifyJwt(env, token) {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  let header;
  let payload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header?.alg !== "RS256" || !header.kid) return { ok: false, reason: "bad-header" };

  const jwk = await findJwk(header.kid);
  if (!jwk) return { ok: false, reason: "unknown-kid" };

  const signatureOk = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(parts[2], "base64url")
  );
  if (!signatureOk) return { ok: false, reason: "bad-signature" };

  const projectNumber = String(env.firebaseProjectNumber);
  if (payload.iss !== `${ISSUER_PREFIX}${projectNumber}`) return { ok: false, reason: "bad-iss" };

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(`projects/${projectNumber}`)) return { ok: false, reason: "bad-aud" };

  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (!appCheckAppIds(env).includes(payload.sub)) return { ok: false, reason: "bad-sub" };
  if (typeof payload.jti !== "string" || !payload.jti) return { ok: false, reason: "no-jti" };

  return { ok: true, payload };
}

export async function verifyAppCheckToken(env, token) {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing-token" };
  if (!isAppCheckConfigured(env)) return { ok: false, reason: "not-configured" };

  try {
    const result = await verifyJwt(env, token);
    if (!result.ok) return result;

    // Limited-use tokens are single-use: the unique jti index turns a replay
    // into a duplicate-key error, and the TTL drops the row once it expires.
    const collections = await getCollections(env);
    if (!collections) return { ok: false, reason: "no-db" };
    try {
      await collections.appCheckJti.insertOne({
        jti: result.payload.jti,
        expiresAt: new Date(result.payload.exp * 1000)
      });
    } catch (err) {
      if (err?.code === DUPLICATE_KEY) return { ok: false, reason: "replayed" };
      throw err;
    }
    return { ok: true, appId: result.payload.sub };
  } catch (err) {
    // Fail closed to reCAPTCHA, never open: an unreachable JWKS or database
    // just means the caller takes the existing bot check.
    return { ok: false, reason: "error", error: err?.message };
  }
}
