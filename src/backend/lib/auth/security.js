import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

// SHA-256 hashes are 64-char hex — detect legacy hashes for migration
function isSha256Hash(hash) {
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
}

export async function createPasswordHash(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// Returns { valid, needsUpgrade } — needsUpgrade=true means caller should re-hash with bcrypt
export async function verifyPassword(password, hash) {
  if (isSha256Hash(hash)) {
    const sha256 = crypto.createHash("sha256").update(password).digest("hex");
    // Constant-time compare so a legacy-hash login can't be timing-probed.
    const valid = safeEqual(sha256, hash);
    return { valid, needsUpgrade: valid };
  }
  const valid = await bcrypt.compare(password, hash);
  return { valid, needsUpgrade: false };
}

export function createToken(length = 12) {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

// Cryptographically secure 256-bit token (64 hex chars) for QR / E-Tag links.
// Not guessable or enumerable — replaces the legacy 12-char (48-bit) token.
export function createSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Guard against NoSQL injection: any value that is about to be used as a
// MongoDB query filter value (e.g. `{ email }`, `{ token }`) MUST be a plain
// string first. Fastify parses JSON bodies, so a client can send
// `{ "email": { "$ne": null } }` — if that object reaches `findOne({ email })`
// unchecked, Mongo interprets it as a query operator instead of a literal
// value and can match an arbitrary, attacker-uncontrolled document (e.g. the
// first row in `passwordResetTokens` — a full account-takeover primitive).
// Every route that takes a client-supplied identifier into a Mongo filter
// must validate it with this first.
export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Constant-time string compare to avoid timing side-channels on verification.
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// One-way hash for storing a scanner IP (privacy-preserving rate-limit key).
export function hashIp(ip, salt = "") {
  return crypto.createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}

// Plate utilities — centralised so no route file needs to define these locally.
export function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function getClientIp(request) {
  return (
    (request.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    request.ip ||
    "unknown"
  );
}

export function maskPlateNumber(plateNumber) {
  if (!plateNumber) return null;
  const compact = plateNumber.replace(/\s+/g, "").toUpperCase();
  if (compact.length <= 4) return "####";
  return `${compact.slice(0, -4)}####`;
}

export function getPlateLastFour(plateNumber) {
  if (!plateNumber) return null;
  return plateNumber.replace(/\s+/g, "").toUpperCase().slice(-4);
}

// ── Log-safe PII masking ────────────────────────────────────────────────
// Never write a raw email, phone number, or OTP-carrying identifier to logs
// (including local dev console output). These helpers keep just enough of
// the value to be useful for debugging without exposing the full PII.

export function maskEmail(email) {
  const value = String(email || "");
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 1))}@${domain}`;
}

// Mask an owner-supplied identifier (email or mobile) for safe logging.
export function maskIdentifier(identifier) {
  const value = String(identifier || "");
  if (value.includes("@")) return maskEmail(value);
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(digits.length - 4, 3))}${digits.slice(-4)}`;
}

// Mask any phone-like digit runs embedded in free text (e.g. third-party
// provider error messages) so logs and stored error details never carry a
// full phone number.
export function maskPhoneLikeText(input) {
  if (input === null || input === undefined) return input;
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  return raw.replace(/\+?\d[\d -]{5,}\d/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 7) return match;
    return `${"*".repeat(Math.max(digits.length - 4, 3))}${digits.slice(-4)}`;
  });
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// General-purpose redactor for free-form text that may embed PII (third-party
// error messages, exception text, etc.) — masks both emails and phone-like
// digit runs. Safe to use before writing to console/logger or persisting a
// provider error detail.
export function redactText(input) {
  if (input === null || input === undefined) return input;
  const raw =
    typeof input === "string"
      ? input
      : (() => {
          try {
            return JSON.stringify(input);
          } catch {
            return String(input);
          }
        })();
  return maskPhoneLikeText(raw).replace(EMAIL_PATTERN, (m) => maskEmail(m));
}
