// Push to the owner's native app, over FCM HTTP v1.
//
// No SDK: a service-account JWT signed with node:crypto, exchanged for an
// access token, then one messages:send per device token. The service account
// is the whole JSON in FCM_SERVICE_ACCOUNT_JSON; unset, every send is a no-op.
//
// Push is a bonus channel. WhatsApp and e-mail stay the ones an alert is
// judged by, so nothing here throws, nothing here is awaited on a scanner's
// request, and nothing here counts toward whether the owner was "reached".
//
// ── What a push may carry ─────────────────────────────────────────────────
// A notification is shown on a lock screen, so it carries the reason, the
// masked plate and at most a place name. Never a phone number, the full plate,
// the tag token or anything about the scanner. `data` is {type, tagId,
// requestId} and the app treats it as a hint to refresh, never as data.
//
// ── When a token row is deleted ──────────────────────────────────────────
// Only when FCM says that token is dead: a 404 UNREGISTERED, or a 400 whose
// details name the field message.token. A generic 400 INVALID_ARGUMENT means
// the PAYLOAD is wrong, and a payload bug pruning on it would wipe every
// owner's tokens in one deploy.

import crypto from "node:crypto";

import { fetchWithTimeout } from "../core/fetch-timeout.js";
import { maskPlateNumber } from "../auth/security.js";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// Google's access tokens last an hour; refresh with a margin.
const ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000;
export const PUSH_CHANNEL_ID = "parktag_alerts";

let cachedAccess = null; // { key, token, expiresAt }

// The cache is keyed on the whole credential, so a rotated private key under
// the same client_email never reuses a token minted for the old one.
function credentialKey(sa) {
  return crypto.createHash("sha256").update(`${sa.client_email}\n${sa.private_key}`).digest("hex");
}

function readServiceAccount(json) {
  if (!json) return null;
  try {
    const sa = JSON.parse(json);
    return sa && sa.client_email && sa.private_key && sa.project_id ? sa : null;
  } catch {
    return null;
  }
}

function signJwt(sa, nowMs) {
  const iat = Math.floor(nowMs / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  return `${unsigned}.${signature}`;
}

async function accessToken(sa, nowMs) {
  const key = credentialKey(sa);
  if (cachedAccess && cachedAccess.key === key && cachedAccess.expiresAt > nowMs) {
    return cachedAccess.token;
  }
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(sa, nowMs)
    }).toString()
  });
  if (!res.ok) throw new Error(`FCM token exchange failed (${res.status})`);
  const body = await res.json();
  if (!body?.access_token) throw new Error("FCM token exchange returned no access token");
  cachedAccess = { key, token: body.access_token, expiresAt: nowMs + ACCESS_TOKEN_TTL_MS };
  return cachedAccess.token;
}

// A run of 10 or more digits is a phone number as far as a lock screen is
// concerned. Nothing should put one here; this makes sure nothing can.
function scrub(text) {
  return String(text || "").replace(/\d{10,}/g, "").replace(/\s+/g, " ").trim();
}

// The masked plate, plus "Near <place>" when the scanner shared one.
export function pushBody(plateNumber, place = null, extra = null) {
  return scrub([maskPlateNumber(plateNumber), place ? `Near ${place}` : null, extra].filter(Boolean).join(" · "));
}

export function buildFcmMessage(token, { title, body, data = {}, collapseKey }) {
  const stringData = {};
  for (const key of ["type", "tagId", "requestId"]) {
    if (data[key] != null) stringData[key] = String(data[key]);
  }
  const tag = String(collapseKey || stringData.requestId || "parktag");
  return {
    message: {
      token,
      notification: { title: scrub(title), body: scrub(body) },
      data: stringData,
      android: {
        priority: "HIGH",
        ttl: "600s",
        collapse_key: tag,
        notification: { tag, channel_id: PUSH_CHANNEL_ID }
      }
    }
  };
}

// True only for the two answers that mean THIS token is gone.
export function isDeadTokenResponse(status, errorBody) {
  const details = Array.isArray(errorBody?.error?.details) ? errorBody.error.details : [];
  if (status === 404) return details.some((d) => d?.errorCode === "UNREGISTERED");
  if (status === 400) {
    return details.some(
      (d) => Array.isArray(d?.fieldViolations) && d.fieldViolations.some((v) => v?.field === "message.token")
    );
  }
  return false;
}

// Resolves true when delivered, "auth" when FCM refused the bearer itself
// (401/403), false otherwise.
async function sendOne(collections, url, bearer, token, payload) {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify(buildFcmMessage(token, payload))
  });
  if (res.ok) return true;
  if (res.status === 401 || res.status === 403) return "auth";

  const errorBody = await res.json().catch(() => null);
  if (isDeadTokenResponse(res.status, errorBody)) {
    await collections.pushTokens.deleteOne({ token });
  } else {
    // The status only. The message can echo the token back.
    console.error("[fcm] push not delivered:", res.status, errorBody?.error?.status || "");
  }
  return false;
}

/**
 * Push {title, body, data, collapseKey} to every device the owner registered.
 * Resolves to { sent } and never rejects. No-op without FCM_SERVICE_ACCOUNT_JSON.
 */
export async function sendOwnerPush(env, collections, ownerId, payload, { now = Date.now() } = {}) {
  try {
    const sa = readServiceAccount(env?.fcmServiceAccountJson);
    if (!sa || !ownerId || !collections?.pushTokens) return { sent: 0 };

    const rows = await collections.pushTokens.find({ ownerId }, { projection: { token: 1 } }).toArray();
    if (!rows.length) return { sent: 0 };

    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
    const sendAll = async (tokens) => {
      const bearer = await accessToken(sa, now);
      const results = await Promise.allSettled(tokens.map((token) => sendOne(collections, url, bearer, token, payload)));
      return results.map((r) => (r.status === "fulfilled" ? r.value : false));
    };

    const tokens = rows.map((row) => row.token);
    const first = await sendAll(tokens);
    let sent = first.filter((v) => v === true).length;
    const refused = tokens.filter((_, i) => first[i] === "auth");
    if (refused.length) {
      // A revoked or skewed access token would otherwise fail every push until
      // it expires. Drop it and retry those devices once with a fresh one.
      cachedAccess = null;
      const retry = await sendAll(refused);
      sent += retry.filter((v) => v === true).length;
      if (retry.some((v) => v === "auth")) console.error("[fcm] push not delivered: FCM refused a fresh access token");
    }
    return { sent };
  } catch (err) {
    console.error("[fcm] push failed:", err?.message);
    return { sent: 0 };
  }
}
