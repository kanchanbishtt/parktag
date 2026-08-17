// Lowercase every stored account email so a single address is a single account.
//
// Sign-in used to match the email exactly as typed while the OTP path lowercased
// it, so "Name@example.com" and "name@example.com" resolved to different
// accounts — and signing in with a code at the lowercased spelling created a
// second, empty one. The code now canonicalises on both sides; this brings the
// rows already written into line so the compatibility fallback in
// lib/auth/identity.js can eventually be deleted.
//
//   node src/backend/scripts/backfill-owner-emails.js            # report only
//   node src/backend/scripts/backfill-owner-emails.js --apply    # write
//
// Collisions are REPORTED, never merged. Two accounts differing only by case
// are two sets of tags, vehicles and documents, and choosing which survives is
// a decision for a person who can look at them — not for a migration.
import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { canonicalEmail } from "../lib/auth/identity.js";
import { maskEmail } from "../lib/auth/security.js";

const apply = process.argv.includes("--apply");

async function backfillCollection(collection, label) {
  const needsChange = [];
  const cursor = collection.find(
    { email: { $type: "string" } },
    { projection: { email: 1 } }
  );

  for await (const doc of cursor) {
    const canonical = canonicalEmail(doc.email);
    if (canonical && canonical !== doc.email) {
      needsChange.push({ _id: doc._id, from: doc.email, to: canonical });
    }
  }

  if (!needsChange.length) {
    console.log(`${label}: nothing to change`);
    return { changed: 0, collisions: 0 };
  }

  let changed = 0;
  let collisions = 0;

  for (const row of needsChange) {
    // Does an account already hold the canonical spelling? Then lowercasing
    // this one would create two documents with the same email.
    const existing = await collection.findOne(
      { email: row.to, _id: { $ne: row._id } },
      { projection: { _id: 1 } }
    );

    if (existing) {
      collisions += 1;
      console.log(
        `${label}: COLLISION — ${maskEmail(row.from)} would collide with an ` +
          `existing account. Left untouched. ids: ${String(row._id)} and ${String(existing._id)}`
      );
      continue;
    }

    if (apply) {
      await collection.updateOne({ _id: row._id }, { $set: { email: row.to } });
    }
    changed += 1;
    console.log(`${label}: ${apply ? "updated" : "would update"} ${maskEmail(row.from)}`);
  }

  return { changed, collisions };
}

const env = getEnv();
const collections = await getCollections(env);

if (!collections) {
  console.error("MongoDB is not configured.");
  process.exit(1);
}

console.log(
  `Collection prefix: "${env.mongoCollectionPrefix || "(none)"}"  mode: ${apply ? "APPLY" : "dry run"}\n`
);

const owners = await backfillCollection(collections.owners, "owners");
const admins = await backfillCollection(collections.admins, "admins");

const totalCollisions = owners.collisions + admins.collisions;

console.log(
  `\n${apply ? "Updated" : "Would update"} ${owners.changed + admins.changed} document(s). ` +
    `${totalCollisions} collision(s) left for manual review.`
);

if (!apply) {
  console.log("Re-run with --apply to write the changes.");
}

await closeMongoConnection();
process.exit(totalCollisions > 0 ? 2 : 0);
