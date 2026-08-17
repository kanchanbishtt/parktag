// Backfill sticker serial numbers onto tags issued before serials existed.
//
// Tags created from now on get a serialNumber at issuance (createUnclaimedTags),
// but anything already in the database has none, and stickerSerialFor prints
// nothing for those rather than inventing a number. This assigns them one.
//
//   node src/backend/scripts/backfill-tag-serials.js          # dry run
//   node src/backend/scripts/backfill-tag-serials.js --apply   # write
//
// Numbering is per batch and continues from whichever is higher: the batch's
// existing counter, or the highest serialNumber already assigned in that batch.
// Within a batch, tags are ordered by createdAt (then _id) so the sequence
// follows the order they were actually issued. Re-running is safe — tags that
// already have a serialNumber are skipped.

import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { batchKeyFor } from "../lib/core/tag-issuance.js";
import { getEnv } from "../lib/env.js";

const apply = process.argv.includes("--apply");

async function main() {
  const env = getEnv();
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("No database connection — check MONGODB_URI.");
  }

  const pending = await collections.tags
    .find({ serialNumber: { $exists: false } })
    .project({ _id: 1, batchNumber: 1, createdAt: 1 })
    .toArray();

  if (!pending.length) {
    console.log("Nothing to do — every tag already has a serialNumber.");
    return;
  }

  // Group by the same two-digit batch key the printed serial uses.
  const byBatch = new Map();
  for (const tag of pending) {
    const key = batchKeyFor(tag.batchNumber);
    if (!byBatch.has(key)) byBatch.set(key, []);
    byBatch.get(key).push(tag);
  }

  console.log(
    `${pending.length} tag(s) without a serial across ${byBatch.size} batch(es).` +
      (apply ? "" : "  [dry run — pass --apply to write]")
  );

  let written = 0;

  for (const [key, tags] of [...byBatch.entries()].sort()) {
    // Highest serial already used in this batch, and the batch counter. Start
    // above both so a backfill can never collide with an issued tag or with the
    // next tag the counter hands out.
    const highest = await collections.tags
      .find({ serialNumber: { $exists: true } })
      .project({ serialNumber: 1, batchNumber: 1 })
      .toArray();
    const maxAssigned = highest
      .filter((t) => batchKeyFor(t.batchNumber) === key)
      .reduce((max, t) => Math.max(max, Number(t.serialNumber) || 0), 0);

    const counterDoc = await collections.counters.findOne({ _id: `tagSerial:${key}` });
    const counterSeq = Number(counterDoc?.seq) || 0;

    let next = Math.max(maxAssigned, counterSeq) + 1;

    tags.sort((a, b) => {
      const at = String(a.createdAt || "");
      const bt = String(b.createdAt || "");
      if (at !== bt) return at < bt ? -1 : 1;
      return String(a._id) < String(b._id) ? -1 : 1;
    });

    const first = next;
    for (const tag of tags) {
      if (apply) {
        await collections.tags.updateOne(
          { _id: tag._id, serialNumber: { $exists: false } },
          { $set: { serialNumber: next } }
        );
      }
      next += 1;
    }

    const last = next - 1;
    if (apply) {
      // Move the counter past everything we just handed out.
      await collections.counters.updateOne(
        { _id: `tagSerial:${key}` },
        { $max: { seq: last } },
        { upsert: true }
      );
    }

    written += tags.length;
    console.log(
      `  batch ${key}: ${tags.length} tag(s) → PT-${key}-${String(first).padStart(6, "0")}` +
        ` .. PT-${key}-${String(last).padStart(6, "0")}`
    );
  }

  console.log(apply ? `Done — ${written} tag(s) updated.` : `Dry run — ${written} tag(s) would be updated.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoConnection();
  });
