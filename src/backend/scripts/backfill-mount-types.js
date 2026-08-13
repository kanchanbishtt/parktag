// Stamp every tag issued before mount types existed as windscreen stock.
//
// Confirmed with the owner of the physical inventory: everything printed to
// date is the windscreen sticker, glue on the front. Nothing was ever printed
// with the glue on the back, so there is no mixed history to untangle — this is
// a straight fill of a field that did not exist yet.
//
// The reads in routes/admin already treat a missing mountType as windscreen, so
// this script changes no behaviour. It exists so the field is actually present
// on the documents, which the mount filter and any future aggregation need.
//
// Run with the prefix you mean to touch, and NOTHING else:
//   MONGODB_COLLECTION_PREFIX=prod_ node src/backend/scripts/backfill-mount-types.js
//   MONGODB_COLLECTION_PREFIX=prod_ node src/backend/scripts/backfill-mount-types.js --commit
//
// Without --commit it only reports. That default is deliberate: this writes to
// whichever cluster the environment points at, and the local .env points at the
// live one.
import "dotenv/config";
import { MongoClient } from "mongodb";

import { getEnv } from "../lib/env.js";

const COMMIT = process.argv.includes("--commit");
const DEFAULT_MOUNT = "windscreen_interior";

const env = getEnv();

if (!env.mongoUri) {
  console.error("MONGODB_URI is not set. Refusing to run.");
  process.exit(1);
}

const prefix = env.mongoCollectionPrefix ?? "";
const client = new MongoClient(env.mongoUri);

try {
  await client.connect();
  const db = client.db(env.mongoDbName || "wavetag");
  const tags = db.collection(`${prefix}tags`);

  const total = await tags.countDocuments({});
  const missing = await tags.countDocuments({ mountType: { $in: [null, undefined] } });
  const already = await tags.countDocuments({ mountType: { $nin: [null, undefined] } });

  console.log(`database         : ${env.mongoDbName || "wavetag"}`);
  console.log(`collection       : ${prefix}tags`);
  console.log(`tags total       : ${total}`);
  console.log(`already typed    : ${already}`);
  console.log(`missing mountType: ${missing}  → would become "${DEFAULT_MOUNT}"`);

  // Report what is already typed as something else, so a re-run against a
  // prefix that has real exterior stock can never be mistaken for a no-op.
  const exterior = await tags.countDocuments({ mountType: "exterior_surface" });
  if (exterior) {
    console.log(`  (${exterior} tag(s) are already exterior_surface and are left alone)`);
  }

  if (!missing) {
    console.log("\nNothing to backfill.");
  } else if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write.");
  } else {
    const result = await tags.updateMany(
      { mountType: { $in: [null, undefined] } },
      { $set: { mountType: DEFAULT_MOUNT } }
    );
    console.log(`\nBackfilled ${result.modifiedCount} tag(s) to "${DEFAULT_MOUNT}".`);
    const left = await tags.countDocuments({ mountType: { $in: [null, undefined] } });
    console.log(`remaining without mountType: ${left}`);
  }
} finally {
  await client.close();
}
