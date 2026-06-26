import crypto from "node:crypto";

import { getCollections } from "./repositories.js";
import { createPasswordHash } from "./security.js";
import { sendPasswordResetEmail } from "./email.js";

const TOKEN_EXPIRY_MS = 60 * 60 * 1000;   // 1 hour
const RATE_LIMIT_MS  = 10 * 60 * 1000;    // 1 request per email per 10 minutes

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function requestPasswordReset(env, email) {
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
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
  if (!token || !newPassword) {
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
