import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

// SHA-256 hashes are 64-char hex — detect legacy hashes for migration
function isSha256Hash(hash) {
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
}

// bcrypt hashes are `$2<variant>$<cost>$<22-char salt><31-char digest>`. Checked
// explicitly because bcrypt.compare() THROWS on a non-string second argument
// ("Illegal arguments: string, undefined") rather than returning false — and an
// owner who registered through the OTP flow has no passwordHash at all.
function isBcryptHash(hash) {
  return typeof hash === "string" && /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
}

// A real bcrypt hash at the production cost, compared against when there is no
// genuine hash to check. Its plaintext is irrelevant and it is never a valid
// credential — the point is solely that comparing against it costs the same as
// comparing against a real account's hash.
const TIMING_EQUALISER_HASH =
  "$2b$12$CAiTw3iQP7xeoanm.WPDi.CGooYyOgDyE5/OWqLM51SA0iRsGbJqS";

// Burn one password comparison's worth of work and discard the result.
//
// A sign-in that can skip the hash comparison answers in ~1ms where a real one
// takes ~240ms, and that gap is a reliable oracle: it separates "no such
// account" from "account exists, wrong password" without the response body ever
// differing. Every path through loginUser must perform exactly one comparison,
// so the ones with nothing to compare against call this.
export async function burnHashComparison(password) {
  await bcrypt.compare(
    typeof password === "string" ? password : String(password ?? ""),
    TIMING_EQUALISER_HASH
  );
}

export async function createPasswordHash(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// Returns { valid, needsUpgrade } — needsUpgrade=true means caller should re-hash with bcrypt
//
// Every branch costs one bcrypt comparison. Two of them have no bcrypt work of
// their own and pad instead: a legacy SHA-256 hash verifies in microseconds, and
// an account with no usable hash has nothing to verify. Without the padding,
// answering fast would identify which of those a given account is.
export async function verifyPassword(password, hash) {
  if (isSha256Hash(hash)) {
    const sha256 = crypto.createHash("sha256").update(password).digest("hex");
    // Constant-time compare so a legacy-hash login can't be timing-probed.
    const valid = safeEqual(sha256, hash);
    await burnHashComparison(password);
    return { valid, needsUpgrade: valid };
  }

  // No usable hash: an OTP-registered owner (never set a password), or a record
  // whose hash is corrupt. Previously this reached bcrypt.compare(password,
  // undefined), which throws — turning a wrong-account sign-in into a 500.
  if (!isBcryptHash(hash)) {
    await burnHashComparison(password);
    return { valid: false, needsUpgrade: false };
  }

  const valid = await bcrypt.compare(password, hash);
  return { valid, needsUpgrade: false };
}

// ── One-time codes ──────────────────────────────────────────────────────
// OTPs are credentials with a short life, and they used to be written to
// otpTokens in the clear. Anyone who could read the database — an operator, a
// leaked backup, an aggregated log — could sign in as any account currently
// mid-login, without needing that account's password at all.
//
// Hashed with bcrypt like a password, for two reasons: it needs no new secret
// in the environment (so there is no deploy in which the hash key is missing
// and every code silently stops verifying), and it is deliberately slow. A
// 6-digit code is only a million possibilities, which a fast hash would give up
// instantly from a dump; at bcrypt's cost that search runs far longer than the
// ten minutes a code stays valid for.
export async function createOtpHash(code) {
  return bcrypt.hash(String(code), BCRYPT_ROUNDS);
}

export async function verifyOtpHash(code, hash) {
  if (!isBcryptHash(hash)) return false;
  return bcrypt.compare(String(code), hash);
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

// The client's IP, as computed by Fastify from the `trustProxy: 1` setting in
// app.js — i.e. the address the ONE trusted reverse proxy (Railway's edge)
// actually observed.
//
// This MUST NOT read `x-forwarded-for` directly. That header is a chain the
// client can prepend to, and its LEFTMOST entry is always fully
// attacker-controlled: a real deployment's edge APPENDS the true socket
// address to the right, so `xff.split(",")[0]` returns whatever the caller
// typed. This function used to do exactly that, which meant every value keyed
// off it was attacker-chosen. Two things broke as a result:
//
//   1. The plate-verification lockout (see routes/public/index.js) buckets
//      failed attempts by `hashIp(getClientIp(...), token)`. With a spoofable
//      key, an attacker got a fresh 3-attempt allowance on every request by
//      rotating the header — the 3-strikes/15-minute lockout never engaged, so
//      the last-4 plate check (the ONLY gate in front of masked calls, the SOS
//      call, and plate disclosure) could be brute-forced.
//   2. `contactRequests.ipAddress` is shown to admins as an audit trail. A
//      spoofable source made that record forgeable.
//
// `request.ip` is derived by proxy-addr from the trusted-hop count and cannot
// be set by the client, so both are keyed off a real value now.
export function getClientIp(request) {
  return request.ip || "unknown";
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
