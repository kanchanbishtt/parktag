import crypto from "node:crypto";

import { getCollections } from "../db/repositories.js";
import { createPasswordHash, isNonEmptyString, redactText } from "./security.js";
import { clientError } from "../errors.js";
import { sendPasswordResetEmail } from "../integrations/email.js";
import { findByCanonicalEmail } from "./identity.js";

const TOKEN_EXPIRY_MS = 15 * 60 * 1000;   // 15 minutes — keep the reset window short-lived
const RATE_LIMIT_MS  = 10 * 60 * 1000;    // 1 request per email per 10 minutes

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function requestPasswordReset(env, email) {
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  // `email` becomes a raw Mongo filter value below — a non-string (e.g. a
  // crafted `{ "$ne": null }` body) must never reach `findOne`. Treat it the
  // same as "not found" so this stays a no-op, matching the no-enumeration
  // behaviour just below.
  if (!isNonEmptyString(email)) {
    return { ok: true };
  }

  const owner = await findByCanonicalEmail(collections.owners, email);

  // No user enumeration — always succeed silently if email not found
  if (!owner) {
    return { ok: true };
  }

  // Rate limit: if a valid token was already sent in the last 10 minutes, silently succeed
  const recentToken = await collections.passwordResetTokens.findOne({
    email,
    used: false,
    expiresAt: { $gt: new Date().toISOString() },
    createdAt: { $gt: new Date(Date.now() - RATE_LIMIT_MS).toISOString() }
  });

  if (recentToken) {
    return { ok: true };
  }

  const token = generateToken();
  const now = new Date();

  await collections.passwordResetTokens.insertOne({
    email,
    token,
    used: false,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TOKEN_EXPIRY_MS).toISOString()
  });

  const resetUrl = `${env.appBaseUrl}/reset-password?token=${token}`;

  // Dispatched WITHOUT await, deliberately — same pattern as sendOtpEmail. An
  // awaited send made a known address measurably slower than an unknown one
  // (which returns before this point), so response latency answered "does this
  // address have an account?" regardless of how careful the message copy was.
  // Detaching it makes both paths finish in the same time. Delivery problems are
  // a server-side concern and are logged, never surfaced to the caller.
  sendPasswordResetEmail(env, { to: email, resetUrl }).catch((err) => {
    console.error("[password-reset] email send failed:", redactText(err?.message || String(err)));
  });

  return { ok: true };
}

export async function resetPassword(env, token, newPassword) {
  // CRITICAL: `token` is used as a raw Mongo filter value (`findOne({ token })`)
  // below. Without a strict string check, a client could send
  // `{ "token": { "$ne": null } }` and Mongo would treat it as "any document
  // where token is not null" instead of an exact match — matching an
  // arbitrary (attacker-uncontrolled but real) outstanding reset token
  // belonging to a different user, letting the attacker take over that
  // account without ever seeing the email. Reject non-string tokens outright.
  if (!isNonEmptyString(token) || !isNonEmptyString(newPassword)) {
    throw clientError("Token and new password are required");
  }

  if (newPassword.length < 8) {
    throw clientError("Password must be at least 8 characters");
  }

  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  const record = await collections.passwordResetTokens.findOne({ token });

  if (!record) {
    throw clientError("Invalid or expired reset link. Please request a new one.");
  }

  if (record.used) {
    throw clientError("This reset link has already been used. Please request a new one.");
  }

  if (new Date(record.expiresAt) < new Date()) {
    throw clientError("This reset link has expired. Please request a new one.");
  }

  const owner = await findByCanonicalEmail(collections.owners, record.email);

  if (!owner) {
    throw clientError("Account not found.");
  }

  await collections.owners.updateOne(
    { _id: owner._id },
    { $set: { passwordHash: await createPasswordHash(newPassword) } }
  );

  // Revoke every existing session for this account. A password reset is the
  // standard response to a suspected compromise, so any session that was stolen
  // (or is still open on a device the user no longer controls) must stop
  // working — otherwise it would survive for up to its 7-day TTL. Sessions are
  // keyed by userId = String(owner._id) across every login method. In-memory
  // caches on running instances drop these within CACHE_REVALIDATE_MS (see
  // session.js), since the docs no longer exist in Mongo to re-validate against.
  await collections.sessions
    .deleteMany({ userId: String(owner._id) })
    .catch(() => {});

  await collections.passwordResetTokens.updateOne(
    { _id: record._id },
    { $set: { used: true, usedAt: new Date().toISOString() } }
  );

  return { ok: true };
}
