// Backfills issuanceRunId / issuedAt / runSerialStart / runSerialEnd onto tags
// issued before issuance runs were recorded.
//
// Runs are reconstructed from createdAt: a single issuance inserts its whole
// batch within the same second, so tags separated by more than GAP_MINUTES
// came from different sittings. The reconstruction is then CHECKED against the
// serial counter — each run reserved one contiguous block of serials in a
// single atomic bump, so a correctly reconstructed run must occupy exactly one
// unbroken range. A run that fails that check is reported and skipped rather
// than written, because a wrong grouping here would send the wrong tags to the
// printer.
//
// Idempotent: tags that already carry an issuanceRunId are left alone.
//
//   node src/backend/scripts/backfill-issuance-runs.js          # dry run
//   node src/backend/scripts/backfill-issuance-runs.js --write  # apply
import { ObjectId } from "mongodb";

import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { batchKeyFor } from "../lib/core/tag-issuance.js";

const GAP_MINUTES = 5;
const APPLY = process.argv.includes("--write");

async function main() {
  const env = getEnv();
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  const pending = await collections.tags
    .find({
      serialNumber: { $ne: null },
      issuanceRunId: { $in: [null, undefined] }
    })
    .project({ serialNumber: 1, batchNumber: 1, createdAt: 1 })
    .sort({ createdAt: 1, serialNumber: 1 })
    .toArray();

  console.log(
    `prefix=${env.mongoCollectionPrefix || "(none)"} | tags needing a run id: ${pending.length}`
  );

  if (!pending.length) {
    console.log("nothing to do");
    return;
  }

  const gapMs = GAP_MINUTES * 60 * 1000;
  const runs = [];

  for (const tag of pending) {
    const at = new Date(tag.createdAt).getTime();
    const batch = batchKeyFor(tag.batchNumber);
    const current = runs[runs.length - 1];

    if (current && current.batch === batch && at - current.lastAt <= gapMs) {
      current.tags.push(tag);
      current.lastAt = at;
    } else {
      runs.push({ batch, startedAt: tag.createdAt, lastAt: at, tags: [tag] });
    }
  }

  let written = 0;
  let skipped = 0;

  for (const run of runs) {
    const serials = run.tags.map((t) => Number(t.serialNumber)).sort((a, b) => a - b);
    const start = serials[0];
    const end = serials[serials.length - 1];
    const contiguous = end - start + 1 === serials.length;

    const label = `batch ${run.batch} | ${run.startedAt} | ${run.tags.length} tags | serials ${start}-${end}`;

    if (!contiguous) {
      // The serial block has a hole, so this grouping does not match what the
      // counter actually handed out — two sittings have been merged, or one
      // split. Refuse rather than guess.
      console.log(`  SKIP  ${label} — serial range is not contiguous`);
      skipped += 1;
      continue;
    }

    console.log(`  ${APPLY ? "WRITE" : "would write"}  ${label}`);

    if (APPLY) {
      const runId = new ObjectId();
      const result = await collections.tags.updateMany(
        { _id: { $in: run.tags.map((t) => t._id) } },
        {
          $set: {
            issuanceRunId: runId,
            // One timestamp for the whole run, matching how issuance stamps it.
            issuedAt: run.startedAt,
            runSerialStart: start,
            runSerialEnd: end
          }
        }
      );
      written += result.modifiedCount;
    }
  }

  console.log(
    APPLY
      ? `\ndone: ${runs.length - skipped} run(s) written, ${written} tags updated, ${skipped} skipped`
      : `\ndry run: ${runs.length - skipped} run(s) would be written, ${skipped} skipped. Re-run with --write to apply.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
