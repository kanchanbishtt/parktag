import crypto from "node:crypto";

import { getCollections } from "../db/repositories.js";
import { sendOtpEmail } from "../integrations/email.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappOtp } from "../integrations/meta.js";
import { clientError } from "../errors.js";
import { maskIdentifier, redactText, safeEqual } from "./security.js";

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

// Resolve the owner account behind a mobile number whose control has JUST been
// proven by an OTP.
//
// The problem this solves: `mobile` is the OTP-login identity, but older
// accounts were created by paths that wrote only `phone` (registration, tag
// claim). A plain findOne({ mobile }) missed those, so an owner who signed up
// with email + password + phone and later signed in with a mobile OTP got a
// brand-new EMPTY second account, silently splitting their vehicles and orders.
//
// Matching those accounts by `phone` is only safe when the phone is real
// evidence of ownership. On legacy records it is an unverified free-text claim
// — someone could have typed a stranger's number at signup — so adopting one
// that still has a password or a linked Google account would hand the person
// holding the OTP an account that somebody else can also sign into (and vice
// versa). Hence three outcomes:
//
//   • matched  — a genuine `mobile` match, or a legacy `phone` match on an
//                account with NO other credential (nothing else can open it,
//                so proving the number proves ownership). Legacy hits are
//                upgraded in place so this only happens once.
//   • conflict — legacy `phone` match on an account that DOES have another way
//                in. Neither forking a duplicate nor silently adopting is
//                right; the caller tells the user to sign in the way they
//                already can and link the number from Settings, which is what
//                the OTP-gated POST /api/owner/mobile is for.
//   • null     — nobody owns this number yet; the caller creates a new owner.
export async function resolveOwnerByVerifiedMobile(collections, normalizedMobile) {
  const owner = await collections.owners.findOne({ mobile: normalizedMobile });
  if (owner) return { owner, adopted: false, conflict: false };

  const digits = String(normalizedMobile).replace(/\D/g, "");
  const last10 = digits.slice(-10);
  // Legacy `phone` values were never normalised, so match the stored variants.
  const legacy = await collections.owners.findOne({
    mobile: { $in: [null, ""] },
    phone: { $in: [normalizedMobile, digits, last10, `+${digits}`] }
  });

  if (!legacy) return { owner: null, adopted: false, conflict: false };

  if (legacy.passwordHash || legacy.googleId) {
    return { owner: null, adopted: false, conflict: true };
  }

  await collections.owners.updateOne(
    { _id: legacy._id },
    { $set: { mobile: normalizedMobile, phone: normalizedMobile, mobileVerified: true } }
  );

  return {
    owner: { ...legacy, mobile: normalizedMobile, phone: normalizedMobile, mobileVerified: true },
    adopted: true,
    conflict: false
  };
}

// Charge one OTP send against a destination's budget WITHOUT this app being the
// sender — used by the Firebase phone-auth path, where Firebase dispatches the
// SMS itself and so never reaches sendOtp()'s per-destination cap above. Left
// unmetered, that route was an unauthenticated way to have SMS sent to any
// number on demand, which is exactly the abuse MAX_SENDS_PER_WINDOW exists to
// stop on the WhatsApp path.
//
// The marker is written into otpTokens so both channels share ONE budget per
// destination (a victim can't be given twice the messages by alternating
// channels). It is stored `used: true` with no code, so neither verifyOtp's
// lookup nor sendOtp's reuse check can ever mistake it for a live code, while
// sendOtp's window count — which filters on identifier and createdAt only —
// still counts it.
export async function chargeExternalOtpSend(env, identifier) {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const normalized = normalizeIdentifier(identifier);
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

  const now = new Date();
  await collections.otpTokens.insertOne({
    identifier: normalized,
    code: null,
    channel: "firebase",
    used: true,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS).toISOString()
  });

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

  // Constant-time compare so the correct code can't be recovered digit-by-digit
  // by timing responses. safeEqual returns false on any length mismatch too.
  if (!safeEqual(record.code, code)) {
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
