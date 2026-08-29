// Move already-printed stickers into field-demo stock.
//
//   node src/backend/scripts/designate-marketing-stock.js --serials PT-01-000001,PT-01-000002
//   node src/backend/scripts/designate-marketing-stock.js --tokens abc123...,def456...
//   node src/backend/scripts/designate-marketing-stock.js --serials ... --copies 2 --apply
//
// Runs as a DRY RUN unless --apply is passed: it prints what it would change
// and exits. These stickers physically exist in someone's bag, so a mistake
// here is a mistake you cannot see until a customer scans one.
//
// Designating a sticker only flags it and leaves it unowned and unclaimed —
// exactly what a fresh printed sticker is — so the customer can scan it and run
// the normal activation flow with no unlocking step. See
// lib/core/marketing-stock.js.
import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { MARKETING_AVAILABLE_STATUS } from "../lib/core/marketing-stock.js";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

function listArg(flag) {
  const raw = argValue(flag);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const serials = listArg("--serials");
  const tokens = listArg("--tokens");
  const copies = Number(argValue("--copies") ?? 2);

  if (!serials.length && !tokens.length) {
    console.error("Nothing to do. Pass --serials PT-01-000001,... or --tokens <token>,...");
    process.exit(1);
  }
  if (!Number.isInteger(copies) || copies < 1) {
    console.error(`--copies must be a positive integer (got ${argValue("--copies")}).`);
    process.exit(1);
  }

  const env = getEnv();
  const collections = await getCollections(env);
  if (!collections) {
    console.error("MongoDB is not configured (MONGODB_URI).");
    process.exit(1);
  }

  // Serials are printed as PT-<batch>-<unit> but stored as a plain number, so
  // match on the trailing unit digits rather than the formatted string.
  const serialNumbers = serials
    .map((s) => Number(String(s).split("-").pop()))
    .filter((n) => Number.isInteger(n));

  const or = [];
  if (serialNumbers.length) or.push({ serialNumber: { $in: serialNumbers } });
  if (tokens.length) or.push({ token: { $in: tokens } });

  const found = await collections.tags.find({ $or: or }).toArray();

  const missing =
    serials.length + tokens.length - found.length > 0
      ? serials.length + tokens.length - found.length
      : 0;

  // Refuse anything already belonging to a real customer. Re-pointing a live
  // customer's sticker at the marketing account would silently take their tag
  // away from them.
  const claimedElsewhere = found.filter((t) => t.ownerId != null && !t.marketingStock);

  console.log(`Matched ${found.length} tag(s); ${missing} identifier(s) matched nothing.`);
  if (claimedElsewhere.length) {
    console.error(
      `\nREFUSING: ${claimedElsewhere.length} tag(s) already belong to a customer:\n` +
        claimedElsewhere.map((t) => `   ${t.token} (serial ${t.serialNumber ?? "-"})`).join("\n")
    );
    process.exit(1);
  }

  const eligible = found.filter((t) => !t.deletedAt);
  for (const tag of eligible) {
    console.log(`   ${tag.token}  serial=${tag.serialNumber ?? "-"}  status=${tag.status} -> ${MARKETING_AVAILABLE_STATUS}`);
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to commit.`);
    process.exit(0);
  }

  const now = new Date().toISOString();
  const ids = eligible.map((t) => t._id);

  const result = await collections.tags.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        marketingStock: true,
        copiesPrinted: copies,
        // Unowned and claimable: a demo sticker at rest is just a new sticker.
        ownerId: null,
        status: MARKETING_AVAILABLE_STATUS,
        updatedAt: now
      }
    }
  );

  // Seed the counter only where it is absent. A re-run must not reset it — the
  // retirement rule depends on the exposure history it accumulates.
  await collections.tags.updateMany(
    { _id: { $in: ids }, demoCount: { $exists: false } },
    { $set: { demoCount: 0 } }
  );

  console.log(`\nListed ${result.modifiedCount} sticker(s) in Field Demo, available.`);
  console.log(`They appear at /admin/marketing and turn ACTIVATED on their own once scanned.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
