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

// Pin the runtime mode, for the same reason the prefix above is pinned: what
// these suites exercise must not depend on whose shell they were launched from.
//
// getEnv() reads APP_ENV, and everything downstream branches on it — production
// refuses to boot without RAZORPAY_KEY_ID/_SECRET (which checkout-pricing and
// shop-idempotency delete on purpose, so they can never reach the live account),
// the Exotel webhook fails closed without a matching ?token=, and the session
// cookie is Secure regardless of the connection. All three are correct
// production behaviour and all three are the opposite of what these suites
// assert, because they are written against the dev-mode app — which is what CI
// runs them as (`APP_ENV: dev` in .github/workflows/ci.yml).
//
// A local run through `railway run --environment production` inherits
// APP_ENV=production from the injected variables, so the same checkout, call
// and login suites that pass in CI fail on a developer machine on a green
// commit. Setting it here means the harness decides, not the ambient shell.
//
// A suite that genuinely wants production behaviour builds its own env object
// and passes it in directly (see guest-checkout-bot-gate), and env-validation
// sets APP_ENV per test around a bare getEnv() — neither goes through here.
//
// The same argument applies to every other integration credential, and for a
// second reason on top of reproducibility. A configured secret does not just
// change a branch, it points the branch at a live account: EXOTEL_WEBHOOK_SECRET
// makes the status webhook demand a ?token= the suites do not send (401 instead
// of the fail-open dev path), APP_BASE_URL set to the live site makes the CSRF
// origin check reject TEST_ORIGIN and marks session cookies Secure over plain
// HTTP, and META_WHATSAPP_* is what assertUndeliverableIdentifier() exists to
// keep away from a real handset. CI has none of them set — the job block in
// .github/workflows/ci.yml is APP_ENV, the three MONGODB_* and EXOTEL_CALLER_ID,
// and nothing else — so the suites are written for their absence, while a
// developer's ~/.parktag/.env and `railway run --environment production` both
// supply the live values.
//
// Clearing them here is the same bargain as DISPOSABLE_PREFIX above: the tests
// get to say what they run against instead of inheriting it. Matched by family
// so a newly added EXOTEL_/META_/RAZORPAY_ variable is covered on the day it is
// introduced rather than the day someone debugs a local-only failure.
const AMBIENT_CREDENTIALS =
  /^(EXOTEL_|META_|WHATSAPP_|RAZORPAY_|DELHIVERY_|GOOGLE_|FIREBASE_|RECAPTCHA_|EMAIL_|ANALYTICS_|GA4_|GEOIP_|SUPER_ADMIN_|REVIEWER_SETUP_|DEMO_SEED_|SCHEDULER_|CAMPAIGN_)|^(APP_BASE_URL|LANDING_BASE_URL|SCAN_BASE_URL|INTERNAL_TEST_PHONES|SUPPORT_WHATSAPP_NUMBER)$/;

for (const key of Object.keys(process.env)) {
  if (AMBIENT_CREDENTIALS.test(key)) delete process.env[key];
}

process.env.APP_ENV = "dev";
// Restored after the sweep because CI sets it deliberately: both register-call
// routes answer 503 with no virtual number configured, so without it the
// contact rows the routing and callback suites read back are never written.
// Not a real Exotel line, and nothing dials — the routes only record where a
// call should go and hand the number back.
process.env.EXOTEL_CALLER_ID = "08000000000";

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

// The Origin header a test must send on a state-changing request.
//
// app.js refuses any POST/PUT/PATCH/DELETE under /api/auth/, /api/owner/,
// /api/admin/ or /api/shop/ whose Origin is neither APP_BASE_URL nor the
// request's own Host. Under fastify's inject() there is no socket, so Host
// defaults to "localhost" on the default port and the app's self-origin is
// exactly this string. APP_BASE_URL is not usable as the reference here: it is
// unset in CI (so it falls back to :4000) and points at the live site in a
// developer's .env, so neither would match a hardcoded one.
//
// A suite that invents its own origin — "http://localhost:3000" was the one
// that got copied around — gets a 403 on every authenticated write, which
// surfaces as an unrelated-looking failure in a fixture ("admin fixture must be
// able to sign in") rather than as a CSRF error. Import this instead.
export const TEST_ORIGIN = "http://localhost";

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

// sendOtp() dispatches for real. On the mobile branch it calls the Meta
// WhatsApp API whenever META_WHATSAPP_PHONE_NUMBER_ID and
// META_WHATSAPP_ACCESS_TOKEN are set — and a developer .env here does set them,
// pointing at the live account. A test that passes a made-up mobile number
// therefore sends a genuine WhatsApp message to whoever owns that number, and
// the request succeeds, so nothing about the run looks wrong.
//
// The email branch is fire-and-forget to an unroutable .invalid domain, so it
// reaches nobody. Any test that needs sendOtp must go through here.
export function assertUndeliverableIdentifier(identifier) {
  const value = String(identifier || "");

  if (!value.includes("@")) {
    throw new Error(
      `Refusing to send an OTP to "${value}": tests must use an email identifier. ` +
        `The mobile path calls the live WhatsApp API and messages a real handset.`
    );
  }

  if (!value.endsWith(".invalid")) {
    throw new Error(
      `Refusing to send an OTP to "${value}": test identifiers must use the ` +
        `.invalid TLD, which is guaranteed never to resolve.`
    );
  }

  return value;
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
//
// `password` is optional. Omitting it produces an owner with NO passwordHash,
// which is what the OTP sign-up path creates and is the default kind of account
// in production — several rules branch on its absence, so tests need to be able
// to build one.
export async function createTestOwner(collections, { email, password, ...rest }) {
  const owner = {
    email,
    role: "owner",
    displayName: "QA Fixture",
    createdAt: new Date().toISOString(),
    ...rest
  };
  if (password !== undefined) owner.passwordHash = await createPasswordHash(password);

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

  // rateLimits is included because those counters live in Mongo and are keyed by
  // address: left behind, a second run inside the same window starts partway
  // through its allowance and the 429 assertions become order-dependent.
  for (const name of ["owners", "sessions", "otpTokens", "loginAttempts", "rateLimits"]) {
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
