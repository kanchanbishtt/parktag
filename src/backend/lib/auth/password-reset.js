import crypto from "node:crypto";

import { getCollections } from "../db/repositories.js";
import { createPasswordHash, isNonEmptyString } from "./security.js";
import { sendPasswordResetEmail } from "../integrations/email.js";

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

  const owner = await collections.owners.findOne({ email });

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

  await sendPasswordResetEmail(env, { to: email, resetUrl });

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
    throw new Error("Token and new password are required");
  }

  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  const record = await collections.passwordResetTokens.findOne({ token });

  if (!record) {
    throw new Error("Invalid or expired reset link. Please request a new one.");
  }

  if (record.used) {
    throw new Error("This reset link has already been used. Please request a new one.");
  }

  if (new Date(record.expiresAt) < new Date()) {
    throw new Error("This reset link has expired. Please request a new one.");
  }

  const owner = await collections.owners.findOne({ email: record.email });

  if (!owner) {
    throw new Error("Account not found.");
  }

  await collections.owners.updateOne(
    { _id: owner._id },
    { $set: { passwordHash: await createPasswordHash(newPassword) } }
  );

  await collections.passwordResetTokens.updateOne(
    { _id: record._id },
    { $set: { used: true, usedAt: new Date().toISOString() } }
  );

  return { ok: true };
}
