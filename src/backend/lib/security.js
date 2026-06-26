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
    const valid = sha256 === hash;
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
