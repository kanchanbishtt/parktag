import crypto from "node:crypto";

import { getCollections } from "./repositories.js";
import { sendOtpEmail } from "./email.js";
import { isExotelSmsConfigured, sendExotelSms } from "./exotel.js";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RATE_LIMIT_MS = 2 * 60 * 1000;

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

  await collections.otpTokens.insertOne({
    identifier: normalized,
    code,
    used: false,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS).toISOString()
  });

  if (isMobile) {
    if (isExotelSmsConfigured(env)) {
      await sendExotelSms(env, {
        to: normalized,
        body: `${code} is your ParkTag verification code. Valid for 10 minutes. Do not share this with anyone.`
      });
    } else if (env.runtimeMode !== "production") {
      console.log(`\n[ParkTag] OTP for ${normalized}: ${code}\n`);
    } else {
      throw new Error("SMS is not configured on this server.");
    }
  } else {
    await sendOtpEmail(env, { to: normalized, code });
  }

  return { ok: true };
}

export async function verifyOtp(env, identifier, code) {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const normalized = normalizeIdentifier(identifier);
  const isMobile = isMobileIdentifier(identifier);

  const record = await collections.otpTokens.findOne({
    identifier: normalized,
    code,
    used: false,
    expiresAt: { $gt: new Date().toISOString() }
  });

  if (!record) throw new Error("Invalid or expired code. Please try again.");

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
