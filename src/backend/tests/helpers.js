// Shared harness for the backend test suites.
//
// These tests exercise real routes against a real MongoDB, because the things
// they lock in — an operator object reaching a query filter, a per-account
// lockout counter, a TTL on a token — only exist at the database boundary. A
// mock would assert that the mock behaves, not that the app does.
import crypto from "node:crypto";
import { buildApp } from "../app.js";
import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { createPasswordHash } from "../lib/auth/security.js";

// Refuse to touch a database that isn't obviously disposable.
//
// The local .env on a developer machine points at the LIVE Atlas cluster, and
// these tests insert and delete owners. Requiring a prefix that reads as
// throwaway means an unprefixed (production) run aborts before it opens a
// connection rather than after it has deleted somebody's account.
const DISPOSABLE_PREFIX = /^(test|ci)[_-]/i;

export function assertDisposableDatabase() {
  const prefix = process.env.MONGODB_COLLECTION_PREFIX || "";

  if (!DISPOSABLE_PREFIX.test(prefix)) {
    throw new Error(
      `Refusing to run tests against collection prefix "${prefix}". ` +
        `These tests write and delete documents. Set MONGODB_COLLECTION_PREFIX ` +
        `to something matching ${DISPOSABLE_PREFIX} (e.g. "test_") first.`
    );
  }
}

// Every request that matters here is rate limited per IP, and the counters live
// in Mongo — so they outlive the process and would leak between runs. Handing
// each call its own source address keeps one test's 429s out of the next test's
// assertions, and keeps a re-run from inheriting the previous run's counters.
let addressCounter = 0;
const runSalt = Date.now() % 60000;

export function uniqueAddress() {
  addressCounter += 1;
  const b = (runSalt >> 8) & 0xff;
  const c = (runSalt + addressCounter) & 0xff;
  const d = (addressCounter >> 8) & 0xff;
  return `10.${b}.${c}.${d === 0 ? 1 : d}`;
}

export async function startTestApp() {
  assertDisposableDatabase();

  const env = getEnv();
  const app = await buildApp();
  await app.ready();
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured — these tests require a database.");
  }

  return { app, env, collections };
}

export async function stopTestApp(app) {
  await app.close();
  await closeMongoConnection();
}

// Owners created by a test, torn down in the same test's cleanup.
export async function createTestOwner(collections, { email, password }) {
  const owner = {
    email,
    role: "owner",
    displayName: "QA Fixture",
    passwordHash: await createPasswordHash(password),
    createdAt: new Date().toISOString()
  };
  const { insertedId } = await collections.owners.insertOne(owner);
  return { ...owner, _id: insertedId };
}

// Every successful login in the suite mints a session row, and every failed one
// touches a lockout counter — neither is addressable by the test's own email, so
// deleting per-fixture leaves residue behind on a shared cluster. The prefix is
// already proven disposable by assertDisposableDatabase(), so empty the
// collections the login path writes to outright.
//
// Deliberately narrow: only the collections these tests actually write. It is
// not a "drop everything with this prefix" helper, so adding a suite that seeds
// tags or orders will not silently start wiping them.
export async function purgeLoginCollections(collections) {
  assertDisposableDatabase();

  for (const name of ["owners", "sessions", "otpTokens", "loginAttempts"]) {
    await collections[name].deleteMany({}).catch(() => {});
  }
}

// login-lockout stores one document per account, keyed by a sha256 of
// `${role}|${lowercased email}` (see accountKey in lib/auth/login-lockout.js).
// Recomputed here rather than exported from there so a change to that scheme
// fails these tests loudly instead of silently leaving lock state behind.
export async function clearLoginLock(collections, email, role = "owner") {
  const identifier = String(email || "").trim().toLowerCase();
  const key = crypto.createHash("sha256").update(`${role}|${identifier}`).digest("hex");
  await collections.loginAttempts.deleteOne({ _id: key });
}
