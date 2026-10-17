import crypto from "node:crypto";

import { getCollections } from "../db/repositories.js";
import { createPasswordHash, isNonEmptyString, redactText } from "./security.js";
import { clientError } from "../errors.js";
import { sendPasswordResetEmail, sendPasswordChangedEmail } from "../integrations/email.js";
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

  // Every session the account has is revoked by the ROUTE, not here, through
  // revokeSessionsForUser(): it needs the app (the in-process session cache)
  // and this module has only the env. A password reset is the standard
  // response to a suspected compromise, so a stolen session must stop working
  // at once, not at the next 30-second cache re-check. This used to delete the
  // Mongo rows itself, which left the cache warm and, worse, left the
  // cache-aware revoke nothing to evict (it reads the ids from Mongo first).
  // The owner is handed back so the route can do both the revoke and the
  // fresh sign-in for the device that proved it owns the email.

  // Burn every unused link for this address, not only the one just used. Two
  // requests in a row mean two live links; after the first reset the second
  // would still have set a password, which is a reset link outliving the
  // reset it was meant for.
  const usedAt = new Date().toISOString();
  await collections.passwordResetTokens.updateMany(
    { email: record.email, used: false },
    { $set: { used: true, usedAt } }
  );

  // Tell the owner, whether or not it was them. Detached like the reset mail:
  // the password is already changed, and a slow or failing mail server must
  // not turn a finished reset into an error on the screen.
  const notifyTo = owner.email || record.email;
  sendPasswordChangedEmail(env, { to: notifyTo, name: owner.displayName }).catch((err) => {
    console.error("[password-reset] changed-password email failed:", redactText(err?.message || String(err)));
  });

  return { ok: true, owner };
}
