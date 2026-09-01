// ── Login PIN ──────────────────────────────────────────────────────────────
//
// A numeric credential that signs an owner in, at the same identifier (phone or
// email) they already use. It sits beside the password rather than replacing
// it: most owners here registered through the OTP flow and have no password at
// all, so before this their only way in was to wait for a code every time.
//
// NOT THE SAME SECRET AS THE VAULT PIN (lib/core/vault.js), and deliberately a
// separate field. The vault PIN is a SECOND factor layered over an existing
// session — it is what stops someone holding an unlocked phone from reading the
// documents. If the two shared a value, learning the login PIN would also open
// the vault, and the vault PIN would stop being a second factor at all. Two
// fields, two hashes, changed independently.
//
// ── Why six digits and not four ────────────────────────────────────────────
// A login PIN is a bare credential: identifier plus PIN is the whole of the
// authentication, so its search space IS the account's strength. Four digits is
// 10,000 values. The per-account lockout allows ten guesses before a 15-minute
// hold that escalates to an hour, so a patient attacker still gets roughly 240
// guesses a day — a 4-digit PIN falls in about three weeks of unattended
// grinding, well inside the lifetime of an account.
//
// Six digits is a million values, ~11 years at that rate; eight is a hundred
// million. So the floor is six. That is the one place this departs from a
// 4-digit keypad, and it is the difference between a credential that survives a
// determined attacker and one that does not.
//
// It is also why the weak-PIN screen here is stricter than the vault's. A
// lockout bounds an attacker who has to GUESS and does nothing about a value
// that is not really a guess: 123456 is the most common numeric secret in every
// breach corpus, and the digits of the owner's own phone number are known to
// anyone who has their number.
import {
  burnHashComparison,
  createPasswordHash,
  verifyPassword
} from "./security.js";
import {
  clearLoginFailures,
  getLoginLock,
  recordLoginFailure
} from "./login-lockout.js";

export const LOGIN_PIN_MIN_DIGITS = 6;
export const LOGIN_PIN_MAX_DIGITS = 8;

// Lockout namespace for verifying the CURRENT pin during a change. Kept apart
// from sign-in so that fat-fingering a change on the settings page cannot lock
// you out of the app, and vice versa — different risks, so not one budget.
const PIN_CHANGE_LOCKOUT_ROLE = "owner-login-pin-change";

export function isValidLoginPin(pin) {
  return new RegExp(`^\\d{${LOGIN_PIN_MIN_DIGITS},${LOGIN_PIN_MAX_DIGITS}}$`).test(
    String(pin || "")
  );
}

// A run in ONE direction: 123456 or 654321, but not 123321. Every step has to
// match the first step rather than merely being +/-1, so the message the owner
// is shown ("runs like 123456") describes exactly what was refused.
function isSequentialPin(digits) {
  const direction = Number(digits[1]) - Number(digits[0]);
  if (direction !== 1 && direction !== -1) return false;
  for (let i = 2; i < digits.length; i += 1) {
    if (Number(digits[i]) - Number(digits[i - 1]) !== direction) return false;
  }
  return true;
}

// 000000, 121212, 123123. A short block repeated to fill the length carries the
// entropy of the block, not of the PIN — 121212 is six digits an attacker
// searches in the time it takes to search two.
function isRepeatedBlock(digits) {
  for (let size = 1; size <= Math.floor(digits.length / 2); size += 1) {
    if (digits.length % size !== 0) continue;
    const block = digits.slice(0, size);
    if (digits.split(block).every((part) => part === "")) return true;
  }
  return false;
}

// Anyone who can reach the sign-in page with the owner's number already HAS the
// number, so a PIN cut from it is not a secret — it is the identifier typed
// twice. Checked as a substring rather than only the last six, because the
// middle of a number is no less public than its end.
function isDrawnFromIdentifier(digits, owner) {
  if (!owner) return false;
  return [owner.mobile, owner.phone]
    .filter(Boolean)
    .some((source) => String(source).replace(/\D/g, "").includes(digits));
}

export function isWeakLoginPin(pin, owner = null) {
  const digits = String(pin || "");
  if (!isValidLoginPin(digits)) return false; // shape is isValidLoginPin's business
  if (isRepeatedBlock(digits)) return true;
  if (isSequentialPin(digits)) return true;
  if (isDrawnFromIdentifier(digits, owner)) return true;
  return false;
}

export function loginPinRequirementMessage() {
  return `PIN must be ${LOGIN_PIN_MIN_DIGITS} to ${LOGIN_PIN_MAX_DIGITS} digits.`;
}

export function weakLoginPinMessage() {
  return "Choose a less predictable PIN — avoid repeats like 111111, runs like 123456, and digits taken from your phone number.";
}

export async function hasLoginPin(collections, ownerId) {
  const owner = await collections.owners.findOne(
    { _id: ownerId },
    { projection: { loginPinHash: 1, loginPinSetAt: 1 } }
  );

  return {
    hasPin: Boolean(owner && owner.loginPinHash),
    setAt: (owner && owner.loginPinSetAt) || null
  };
}

export async function setLoginPin(collections, ownerId, pin) {
  const loginPinHash = await createPasswordHash(String(pin));
  const now = new Date().toISOString();

  await collections.owners.updateOne(
    { _id: ownerId },
    { $set: { loginPinHash, loginPinSetAt: now, loginPinUpdatedAt: now } }
  );

  // A fresh PIN clears any standing change-lockout: whoever set it has just
  // proven control through the path that let them set it.
  await clearLoginFailures(collections, PIN_CHANGE_LOCKOUT_ROLE, String(ownerId));
}

export async function clearStoredLoginPin(collections, ownerId) {
  await collections.owners.updateOne(
    { _id: ownerId },
    {
      $unset: { loginPinHash: "", loginPinSetAt: "" },
      $set: { loginPinUpdatedAt: new Date().toISOString() }
    }
  );
  await clearLoginFailures(collections, PIN_CHANGE_LOCKOUT_ROLE, String(ownerId));
}

// Verify the current PIN before allowing a change or a removal.
//
// Rate-limited on its own budget, because otherwise a stolen session is a free,
// unlimited oracle for the PIN: an attacker holding the cookie cannot read the
// hash, but could sit on this endpoint guessing until it answers yes, and then
// hold a credential that outlives the session they stole.
//
// Returns { ok } or { ok: false, locked, retryAfterSeconds } so the caller can
// tell a wrong PIN apart from "stop trying".
export async function verifyLoginPinForChange(collections, ownerId, pin) {
  const key = String(ownerId);

  const lock = await getLoginLock(collections, PIN_CHANGE_LOCKOUT_ROLE, key);
  if (lock.locked) {
    return { ok: false, locked: true, retryAfterSeconds: lock.retryAfterSeconds };
  }

  const owner = await collections.owners.findOne(
    { _id: ownerId },
    { projection: { loginPinHash: 1 } }
  );

  if (!owner || !owner.loginPinHash) {
    // Pay for the comparison anyway. Answering instantly would time-stamp "this
    // account has no PIN" for a caller not entitled to know it.
    await burnHashComparison(String(pin || ""));
    return { ok: false, locked: false, noPin: true };
  }

  // verifyPassword returns { valid, needsUpgrade }, NOT a boolean — the object
  // itself is always truthy, and testing it would accept any PIN.
  const { valid } = await verifyPassword(String(pin || ""), owner.loginPinHash);

  if (!valid) {
    await recordLoginFailure(collections, PIN_CHANGE_LOCKOUT_ROLE, key);
    return { ok: false, locked: false };
  }

  await clearLoginFailures(collections, PIN_CHANGE_LOCKOUT_ROLE, key);
  return { ok: true };
}
