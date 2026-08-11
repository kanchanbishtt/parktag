import { GridFSBucket } from "mongodb";

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
    // Login sessions — persisted so admins/owners stay logged in across server
    // restarts/deploys and across multiple instances (not just one process's
    // memory). Auto-expired by a TTL index on expiresAt.
    sessions: db.collection(withPrefix(prefix, "sessions")),
    contactRequests: db.collection(withPrefix(prefix, "contact_requests")),
    // Scanner-submitted reports about a tag ("vehicle is sold", "wrong number",
    // abuse). Written by the public report form and read by support; nothing on
    // the scan page ever reads them back.
    tagReports: db.collection(withPrefix(prefix, "tag_reports")),
    passwordResetTokens: db.collection(withPrefix(prefix, "password_reset_tokens")),
    otpTokens: db.collection(withPrefix(prefix, "otp_tokens")),
    // Tracks per-scanner verification attempts, lockouts, and contact grants.
    verificationSessions: db.collection(withPrefix(prefix, "verification_sessions")),
    // Temporary routing bridge for inbound Exotel calls (TTL 10 min).
    pendingCalls: db.collection(withPrefix(prefix, "pending_calls")),
    // Server-created shop orders — the source of truth for what price was
    // actually charged, re-checked at verify time (M15 hardening).
    shopOrders: db.collection(withPrefix(prefix, "shop_orders")),
    // Delivery addresses for physical sticker fulfilment — one active doc per
    // owner (upserted on ownerId), snapshotted onto each order at purchase time.
    addresses: db.collection(withPrefix(prefix, "addresses")),
    // Atomic sequence counters (e.g. the running shop order number). Each doc is
    // { _id: <name>, seq: <n> }, incremented with findOneAndUpdate($inc).
    counters: db.collection(withPrefix(prefix, "counters")),
    // Pending Google OAuth `state` values (CSRF nonces). Persisted rather than
    // held in process memory so a deploy or restart mid-login doesn't fail the
    // callback with invalid_state, and so the flow still works if the service
    // ever runs more than one instance. TTL-expired.
    oauthStates: db.collection(withPrefix(prefix, "oauth_states")),
    // Cross-replica counters for the per-route rate limits. @fastify/rate-limit
    // counts in process memory by default, so with several replicas every
    // declared limit was really `max × replicas` — see lib/auth/rate-limit-store.js.
    // TTL-expired the moment a window closes.
    rateLimits: db.collection(withPrefix(prefix, "rate_limits")),
    // Failed sign-in counters and lockouts, keyed per ACCOUNT rather than per
    // IP so the control still applies when an attacker rotates addresses.
    loginAttempts: db.collection(withPrefix(prefix, "login_attempts")),
    // Metadata for the owner's private document vault (RC, insurance, PUC,
    // licence). The FILES live in GridFS — see getVaultBucket below — and this
    // holds only the descriptive record plus the GridFS id that points at them,
    // so a listing never has to touch file bytes.
    vaultDocuments: db.collection(withPrefix(prefix, "vault_documents")),
    // Short-lived proof that the owner re-entered their vault PIN, keyed by
    // session id. Kept server-side and out of the session document on purpose:
    // readSession serves from an in-process cache for up to 30s, so an unlock
    // written onto the session would not be visible to the very next request.
    vaultGrants: db.collection(withPrefix(prefix, "vault_grants"))
  };
}

// GridFS bucket holding the vault's file bytes. Prefixed like every other
// collection, so it becomes `<prefix>vault.files` / `<prefix>vault.chunks` and
// a dev run can never read or overwrite production documents.
export async function getVaultBucket(env) {
  const db = await getMongoDb(env);
  if (!db) return null;
  const prefix = env.mongoCollectionPrefix || "";
  return new GridFSBucket(db, { bucketName: withPrefix(prefix, "vault") });
}

// ── Core indexes ──────────────────────────────────────────────────────────
// Everything below was previously UNINDEXED apart from _id, so the app's
// hottest queries were full collection scans. `tags.token` is the worst of
// them: it is looked up on every QR scan, every plate verification, every
// contact request and every call registration, and with no index each of those
// reads the entire tags collection. Invisible at a few dozen tags, fatal at the
// scale a printed sticker run implies. `owners.email` / `owners.mobile` are on
// the path of every single sign-in.
//
// Run once at boot (see server.js). createIndex is idempotent, so restarts and
// redeploys are no-ops, and a failure here is logged but never fatal — a slow
// app still beats an app that refuses to start.
//
// Note the two TTL indexes: otp_tokens and password_reset_tokens both hold
// live secrets and had no expiry at all, so used and expired codes accumulated
// in the database indefinitely. Both documents carry their own expiry checks in
// code, so the TTL is purely about not retaining secrets we no longer need.
const CORE_INDEXES = [
  ["tags", { token: 1 }, { unique: true, name: "token_unique" }],
  ["tags", { ownerId: 1, deletedAt: 1 }, { name: "owner_live" }],
  ["tags", { status: 1, printStatus: 1 }, { name: "print_queue" }],
  ["tags", { batchNumber: 1 }, { name: "batch" }],
  ["owners", { email: 1 }, { name: "email" }],
  ["owners", { mobile: 1 }, { name: "mobile" }],
  ["owners", { phone: 1 }, { name: "phone" }],
  ["contactRequests", { token: 1, createdAt: -1 }, { name: "token_recent" }],
  ["contactRequests", { ownerId: 1, createdAt: -1 }, { name: "owner_recent" }],
  ["contactRequests", { providerRequestId: 1 }, { name: "provider_request" }],
  // Backs the per-tag SOS daily ceiling in routes/public/index.js.
  ["contactRequests", { token: 1, action: 1, createdAt: -1 }, { name: "token_action_recent" }],
  ["shopOrders", { ownerId: 1, status: 1 }, { name: "owner_status" }],
  ["shopOrders", { orderId: 1 }, { name: "razorpay_order" }],
  ["shopOrders", { orderNumber: 1 }, { name: "order_number" }],
  ["addresses", { ownerId: 1 }, { unique: true, name: "owner_unique" }],
  ["passwordResetTokens", { token: 1 }, { name: "token" }],
  ["passwordResetTokens", { email: 1, createdAt: -1 }, { name: "email_recent" }],
  ["otpTokens", { identifier: 1, createdAt: -1 }, { name: "identifier_recent" }],
  // TTL cleanup for the two collections that store live secrets.
  ["otpTokens", { expiresAt: 1 }, { expireAfterSeconds: 86400, name: "ttl" }],
  ["passwordResetTokens", { expiresAt: 1 }, { expireAfterSeconds: 86400, name: "ttl" }],
  ["oauthStates", { createdAt: 1 }, { expireAfterSeconds: 900, name: "ttl" }],
  // Rate-limit counters are read and written on every request to a limited
  // route, always by _id, so no extra lookup index is needed — only the TTL,
  // which drops each bucket as its window closes (expireAfterSeconds: 0 means
  // "expire AT the date in this field", not "expire immediately").
  ["rateLimits", { resetAt: 1 }, { expireAfterSeconds: 0, name: "ttl" }],
  // Lockout records refresh updatedAt on every failure, so an active lock is
  // never near expiry; a week is just garbage collection for stale counters.
  ["loginAttempts", { updatedAt: 1 }, { expireAfterSeconds: 604800, name: "ttl" }],
  // Every vault read is scoped to one owner and usually one vehicle, and the
  // per-owner storage quota sums this collection on each upload.
  ["vaultDocuments", { ownerId: 1, tagId: 1, createdAt: -1 }, { name: "owner_vehicle" }],
  ["vaultDocuments", { ownerId: 1 }, { name: "owner" }],
  // A vault unlock is deliberately short-lived; the TTL is what actually
  // re-locks it, so this index is load-bearing rather than housekeeping.
  ["vaultGrants", { expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl" }]
];

let coreIndexesEnsured = false;
export async function ensureCoreIndexes(collections, logger) {
  if (coreIndexesEnsured || !collections) return;
  coreIndexesEnsured = true;

  for (const [name, keys, options] of CORE_INDEXES) {
    const collection = collections[name];
    if (!collection) continue;
    try {
      await collection.createIndex(keys, { background: true, ...options });
    } catch (error) {
      // A unique index can legitimately fail on existing duplicate data. Log
      // which one and carry on rather than blocking startup.
      logger?.warn?.(
        { err: error, collection: name, index: options?.name },
        "[indexes] could not create index — continuing without it"
      );
    }
  }
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

// Idempotently ensure indexes for the pendingCalls collection.
// TTL index auto-deletes records after expiresAt (undialled registrations).
// callerPhone index is the hot lookup path for the Dial Whom webhook.
let pendingCallsIndexEnsured = false;
export async function ensurePendingCallsIndexes(collections) {
  if (pendingCallsIndexEnsured || !collections) return;
  try {
    await collections.pendingCalls.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await collections.pendingCalls.createIndex({ callerPhone: 1, consumed: 1 });
    pendingCallsIndexEnsured = true;
  } catch (_) {
    // Non-fatal.
  }
}
