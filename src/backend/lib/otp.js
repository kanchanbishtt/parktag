import crypto from "node:crypto";

import { getCollections } from "./repositories.js";
import { sendOtpEmail } from "./email.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappOtp } from "./meta.js";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RATE_LIMIT_MS = 2 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

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
        throw new Error("Could not send WhatsApp OTP. Please try again.");
      }
    } else if (env.runtimeMode !== "production") {
      console.log(`\n[ParkTag] OTP for ${normalized}: ${code}\n`);
    } else {
      throw new Error("WhatsApp OTP is not configured on this server.");
    }
  } else {
    sendOtpEmail(env, { to: normalized, code })
      .catch(err => console.error("[OTP] Email send failed:", err));
  }

  return { ok: true };
}

export async function verifyOtp(env, identifier, code) {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const normalized = normalizeIdentifier(identifier);
  const isMobile = isMobileIdentifier(identifier);

  // Find the token without the code first so we can count failed attempts
  const record = await collections.otpTokens.findOne({
    identifier: normalized,
    used: false,
    expiresAt: { $gt: new Date().toISOString() }
  });

  if (!record) throw new Error("Invalid or expired code. Please try again.");

  // Enforce attempt limit
  if ((record.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    await collections.otpTokens.updateOne(
      { _id: record._id },
      { $set: { used: true } }
    );
    throw new Error("Too many incorrect attempts. Please request a new code.");
  }

  if (record.code !== code) {
    await collections.otpTokens.updateOne(
      { _id: record._id },
      { $inc: { attempts: 1 } }
    );
    const remaining = MAX_VERIFY_ATTEMPTS - (record.attempts || 0) - 1;
    throw new Error(
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
