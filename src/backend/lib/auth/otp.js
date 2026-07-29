import crypto from "node:crypto";

import { getCollections } from "../db/repositories.js";
import { sendOtpEmail } from "../integrations/email.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappOtp } from "../integrations/meta.js";
import { clientError } from "../errors.js";
import { maskIdentifier, redactText } from "./security.js";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RATE_LIMIT_MS = 2 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
// Hard cap on how many codes a single destination (phone/email) can be sent in a
// rolling window, regardless of source IP. The per-route @fastify/rate-limit
// configs are keyed on the caller's IP, so an attacker rotating IPs could still
// bomb one victim's phone with SMS/WhatsApp (harassment + real per-message cost).
// This cap is enforced in the DB against the destination itself, so it holds no
// matter how many IPs the requests come from. Sits above the 2-min reuse
// throttle below: legit resends within 2 min reuse the existing code and never
// reach this counter, so a normal login/verify flow stays well under the cap.
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60 * 1000;

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

export function isMobileIdentifier(identifier) {
  const stripped = String(identifier || "").trim().replace(/[\s\-()]/g, "");
  if (stripped.includes("@")) return false;
  return /^\+?\d{7,15}$/.test(stripped);
}

function normalizePhone(input) {
  const digits = input.trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits;
}

export function normalizeIdentifier(identifier) {
  if (isMobileIdentifier(identifier)) return normalizePhone(identifier);
  return identifier.trim().toLowerCase();
}

export async function sendOtp(env, identifier) {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const normalized = normalizeIdentifier(identifier);
  const isMobile = isMobileIdentifier(identifier);

  const recent = await collections.otpTokens.findOne({
    identifier: normalized,
    used: false,
    expiresAt: { $gt: new Date().toISOString() },
    createdAt: { $gt: new Date(Date.now() - RATE_LIMIT_MS).toISOString() }
  });

  if (recent) return { ok: true };

  // Per-destination flood cap (see MAX_SENDS_PER_WINDOW). Count actual sends —
  // each real send inserts exactly one token, and reuse hits above return before
  // inserting — so this equals the number of messages dispatched to this
  // destination in the window, across every IP.
  const windowStart = new Date(Date.now() - SEND_WINDOW_MS).toISOString();
  const sentInWindow = await collections.otpTokens.countDocuments({
    identifier: normalized,
    createdAt: { $gt: windowStart }
  });
  if (sentInWindow >= MAX_SENDS_PER_WINDOW) {
    throw clientError(
      "Too many verification codes requested. Please wait a while before trying again."
    );
  }

  const code = generateOtp();
  const now = new Date();

  const inserted = await collections.otpTokens.insertOne({
    identifier: normalized,
    code,
    used: false,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS).toISOString()
  });

  if (isMobile) {
    if (isMetaWhatsappConfigured(env)) {
      try {
        await sendMetaWhatsappOtp(env, { to: normalized, code });
      } catch (err) {
        console.error("[OTP] WhatsApp send failed:", err?.message, err?.providerDetail);
        await collections.otpTokens.deleteOne({ _id: inserted.insertedId });
        throw clientError("Could not send WhatsApp OTP. Please try again.");
      }
    } else if (env.runtimeMode !== "production") {
      // Dev-only fallback so the flow is testable without WhatsApp configured.
      // Identifier is masked — only the OTP itself needs to be readable here.
      console.log(`\n[ParkTag] Dev OTP for ${maskIdentifier(normalized)}: ${code}\n`);
    } else {
      throw clientError("WhatsApp OTP is not configured on this server.");
    }
  } else {
    sendOtpEmail(env, { to: normalized, code })
      .catch(err => console.error("[OTP] Email send failed:", redactText(err?.message || String(err))));
  }

  return { ok: true };
}

export async function verifyOtp(env, identifier, code) {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const normalized = normalizeIdentifier(identifier);
  const isMobile = isMobileIdentifier(identifier);

  // Find the token without the code first so we can count failed attempts.
  // Always verify against the MOST RECENT unused code: a user who taps "resend"
  // after the send rate-limit window can hold more than one valid token at once,
  // and an unsorted findOne returns the oldest — so the freshly-sent code would
  // be checked against a stale token and wrongly rejected as invalid.
  const record = await collections.otpTokens.findOne({
    identifier: normalized,
    used: false,
    expiresAt: { $gt: new Date().toISOString() }
  }, { sort: { createdAt: -1 } });

  if (!record) throw clientError("Invalid or expired code. Please try again.");

  // Enforce attempt limit
  if ((record.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    await collections.otpTokens.updateOne(
      { _id: record._id },
      { $set: { used: true } }
    );
    throw clientError("Too many incorrect attempts. Please request a new code.");
  }

  if (record.code !== code) {
    await collections.otpTokens.updateOne(
      { _id: record._id },
      { $inc: { attempts: 1 } }
    );
    const remaining = MAX_VERIFY_ATTEMPTS - (record.attempts || 0) - 1;
    throw clientError(
      `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
    );
  }

  await collections.otpTokens.updateOne(
    { _id: record._id },
    { $set: { used: true, usedAt: new Date().toISOString() } }
  );

  const owner = isMobile
    ? await collections.owners.findOne({ mobile: normalized })
    : await collections.owners.findOne({ email: normalized });

  return {
    ok: true,
    isNewUser: !owner,
    owner: owner || null
  };
}
