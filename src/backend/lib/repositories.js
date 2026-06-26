import { getMongoDb } from "./mongo.js";

function withPrefix(prefix, name) {
  return `${prefix}${name}`;
}

export async function getCollections(env) {
  const db = await getMongoDb(env);

  if (!db) {
    return null;
  }

  const prefix = env.mongoCollectionPrefix || "";

  return {
    admins: db.collection(withPrefix(prefix, "admins")),
    owners: db.collection(withPrefix(prefix, "owners")),
    tags: db.collection(withPrefix(prefix, "tags")),
    contactRequests: db.collection(withPrefix(prefix, "contact_requests")),
    passwordResetTokens: db.collection(withPrefix(prefix, "password_reset_tokens")),
    otpTokens: db.collection(withPrefix(prefix, "otp_tokens")),
    // Tracks per-scanner verification attempts, lockouts, and contact grants.
    verificationSessions: db.collection(withPrefix(prefix, "verification_sessions"))
  };
}

// Idempotently ensure the TTL index that auto-cleans expired verification
// sessions. Guarded so it only runs once per process.
let verificationIndexEnsured = false;
export async function ensureVerificationIndexes(collections) {
  if (verificationIndexEnsured || !collections) {
    return;
  }
  try {
    await collections.verificationSessions.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    );
    await collections.verificationSessions.createIndex({ token: 1, ipHash: 1 });
    verificationIndexEnsured = true;
  } catch (_) {
    // Non-fatal: verification still works without the TTL index.
  }
}
