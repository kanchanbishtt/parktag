// Clear the OTP send-cap rows for ONE number, so a tester is not locked out.
//
// Deliberately a script and not an endpoint. The cap it clears (5 sends per
// hour per destination, otp.js MAX_SENDS_PER_WINDOW) is an anti-abuse control:
// it stops somebody bombing a stranger's phone with verification codes at our
// expense. An HTTP route that resets it is exactly what an attacker would want,
// and would then need its own auth, audit and rate limiting to be safe. A file
// that only runs on a laptop that already holds the database credentials adds
// no attack surface at all, and needs no deployment.
//
//   node scripts/reset-otp.mjs 8791638854          show what would be deleted
//   node scripts/reset-otp.mjs 8791638854 --yes    delete it
//
// Reads .env, so it clears whichever environment MONGODB_COLLECTION_PREFIX
// points at. Check that before running: prod_ is production.
process.loadEnvFile(".env");

const { getCollections } = await import("../src/backend/lib/db/repositories.js");
const { normalizeIdentifier } = await import("../src/backend/lib/auth/otp.js");

const raw = process.argv[2];
const confirmed = process.argv.includes("--yes");

if (!raw) {
  console.error("usage: node scripts/reset-otp.mjs <mobile-or-email> [--yes]");
  process.exit(2);
}

const env = {
  mongoUri: (process.env.MONGODB_URI || "").trim(),
  mongoDbName: process.env.MONGODB_DB_NAME,
  mongoCollectionPrefix: process.env.MONGODB_COLLECTION_PREFIX
};

const collections = await getCollections(env);
// Normalised by the same function sendOtp uses, so the filter matches the rows
// the cap actually counts rather than whatever shape was typed on the CLI.
const identifier = normalizeIdentifier(raw);
const hourAgo = new Date(Date.now() - 3600e3).toISOString();
const filter = { identifier, createdAt: { $gt: hourAgo } };

// Scoped to one identifier and one hour. Never a bare deleteMany on the
// collection: older rows are somebody's history, and other numbers are not ours
// to clear.
const rows = await collections.otpTokens.find(filter).toArray();

console.log(`environment : ${env.mongoCollectionPrefix} (${env.mongoDbName})`);
console.log(`identifier  : ${identifier}`);
console.log(`in window   : ${rows.length} of 5 allowed per hour`);
for (const r of rows) console.log(`   ${r.createdAt}  purpose=${r.purpose || "auth"}  used=${r.used}`);

if (!rows.length) {
  console.log("\nnothing to clear, sends are already available");
  process.exit(0);
}

if (!confirmed) {
  console.log(`\ndry run. re-run with --yes to delete these ${rows.length} rows.`);
  process.exit(0);
}

const res = await collections.otpTokens.deleteMany(filter);
const left = await collections.otpTokens.countDocuments(filter);
console.log(`\ndeleted ${res.deletedCount}; ${5 - left} sends now available`);
process.exit(0);
