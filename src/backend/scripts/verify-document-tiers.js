// Empirical check of the document allowance, against the real upload route and
// a real database. Not a unit test: it uploads until it is refused and reports
// the number it actually reached, so the answer is measured rather than
// asserted from the same constants the code reads.
//
//   node --env-file=.env src/backend/scripts/verify-document-tiers.js
//
// Requires MONGODB_COLLECTION_PREFIX (test_/ci_), like the test suite.
import { createSession } from "../lib/auth/session.js";
import { getVaultBucket } from "../lib/db/repositories.js";
import { startTestApp, stopTestApp, createTestOwner, uniqueAddress } from "../tests/helpers.js";
import { PREMIUM_TRIAL_DAYS } from "../lib/core/vault.js";

const ORIGIN = process.env.APP_BASE_URL || "http://localhost:3000";
const BOUNDARY = "----verifyTiers";
const PIN = "8317";
const DAY = 24 * 60 * 60 * 1000;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478" +
    "9c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);

const { app, env, collections } = await startTestApp();
const bucket = await getVaultBucket(env);
const email = `qa-verify-tiers-${Date.now()}@parktag-test.invalid`;
const owner = await createTestOwner(collections, { email });
const cookie = await createSession(app, { id: String(owner._id), role: "owner", email });

function multipart(fields, body) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="d.png"\r\nContent-Type: image/png\r\n\r\n`
  ));
  parts.push(body, Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

const call = (method, url, payload) => app.inject({
  method, url, remoteAddress: uniqueAddress(),
  cookies: { wavetag_session: cookie }, headers: { origin: ORIGIN },
  ...(payload === undefined ? {} : { payload })
});

const upload = (tagId) => app.inject({
  method: "POST", url: "/api/owner/vault/documents", remoteAddress: uniqueAddress(),
  cookies: { wavetag_session: cookie },
  headers: { origin: ORIGIN, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  payload: multipart({ tagId, docType: "other", label: "QA" }, PNG)
});

let n = 0;
async function makeTag(extra) {
  n += 1;
  const r = await collections.tags.insertOne({
    ownerId: owner._id, plateNumber: `QAVF${String(n).padStart(6, "0")}`,
    status: "active", token: `qa-verify-tiers-${Date.now()}-${n}`,
    createdAt: new Date().toISOString(), ...extra
  });
  return String(r.insertedId);
}

// Upload until refused; report how many actually landed.
async function capacityOf(tagId) {
  let stored = 0;
  for (let i = 0; i < 15; i += 1) {
    const r = await upload(tagId);
    if (r.statusCode !== 200) return { stored, refusal: JSON.parse(r.body).error };
    stored += 1;
  }
  return { stored, refusal: "never refused within 15 attempts" };
}

const pin = await call("POST", "/api/owner/vault/pin", { pin: PIN });
if (pin.statusCode !== 200) throw new Error(`could not set PIN: ${pin.body}`);

const now = Date.now();
// Every date below is a distance from the real window rather than a literal
// number of days. The window has already moved once, 45 days to 90, and a
// script that hard-codes "50 days ago" as its expired case quietly becomes a
// second in-trial case when that happens: it reports NO free period while the
// free period is working perfectly.
const bought = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
const JUST_INSIDE = PREMIUM_TRIAL_DAYS - 1;
const JUST_OUTSIDE = PREMIUM_TRIAL_DAYS + 1;
const WELL_OUTSIDE = PREMIUM_TRIAL_DAYS + 5;
const EXPIRED_LABEL = `Premium, bought ${WELL_OUTSIDE} days ago`;

// The subscription cases are dated OUTSIDE the free period on purpose. A tag
// bought today is inside its trial, so a subscription stamped on one would be
// indistinguishable from the trial granting the same allowance.
const OLD = bought(PREMIUM_TRIAL_DAYS + 15);
const CASES = [
  ["E-Tag", { premium: false }],
  ["Premium, bought today", { premium: true, premiumSince: new Date(now).toISOString() }],
  ["Premium, bought 20 days ago", { premium: true, premiumSince: bought(20) }],
  [`Premium, bought ${JUST_INSIDE} days ago`, { premium: true, premiumSince: bought(JUST_INSIDE) }],
  [`Premium, bought ${JUST_OUTSIDE} days ago`, { premium: true, premiumSince: bought(JUST_OUTSIDE) }],
  [EXPIRED_LABEL, { premium: true, premiumSince: bought(WELL_OUTSIDE) }],
  ["Past trial + live subscription", {
    premium: true, premiumSince: OLD,
    documentSubscription: { status: "active", currentPeriodEnd: new Date(now + 30 * DAY).toISOString() }
  }],
  ["Past trial + expired subscription", {
    premium: true, premiumSince: OLD,
    documentSubscription: { status: "active", currentPeriodEnd: new Date(now - DAY).toISOString() }
  }]
];

console.log("\n  tag                              stored  refused with");
console.log("  " + "-".repeat(88));
const results = {};
for (const [label, extra] of CASES) {
  const tagId = await makeTag(extra);
  const { stored, refusal } = await capacityOf(tagId);
  results[label] = stored;
  console.log(`  ${label.padEnd(32)} ${String(stored).padStart(4)}    ${refusal}`);
}

// The free-period question, answered from the measurements above rather than from
// reading the source: a trial shows as a brand-new premium tag holding more
// than one bought after the window closed.
const fresh = results["Premium, bought today"];
const old = results[EXPIRED_LABEL];
console.log(`\n  ${PREMIUM_TRIAL_DAYS}-day free period for a new premium tag: ` +
  (fresh > old ? `YES — a new tag holds ${fresh}, a ${WELL_OUTSIDE}-day-old one holds ${old}`
               : `NO — a new tag and a ${WELL_OUTSIDE}-day-old one both hold ${old}`));

// Leave nothing behind.
await collections.vaultDocuments.deleteMany({ ownerId: owner._id });
await collections.vaultUsage.deleteOne({ _id: String(owner._id) });
await collections.vaultGrants.deleteMany({ ownerId: String(owner._id) });
await collections.tags.deleteMany({ ownerId: owner._id });
await collections.owners.deleteOne({ _id: owner._id });
for (const f of await bucket.find({ "metadata.ownerId": String(owner._id) }).toArray()) {
  await bucket.delete(f._id).catch(() => {});
}
await stopTestApp(app);
