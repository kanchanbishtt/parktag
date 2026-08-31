// Grandfathers every premium tag that exists BEFORE call masking became a
// subscription.
//
// Those tags were sold on the old promise: buy the sticker, keep masked contact
// for good. The new rule gives 45 days from `premiumSince`, so on the day this
// ships every premium tag older than that would lose masking at once — a
// feature people paid for, withdrawn without notice. This stamps them with an
// open-ended subscription so the new rule only ever applies to tags sold after
// it.
//
//   tag.callSubscription = { status: "active", currentPeriodEnd: null, ... }
//
// `currentPeriodEnd: null` is read by hasActiveCallSubscription as open-ended —
// the same shape a comped tag uses. `grandfatheredAt` is stamped alongside so
// these are distinguishable later from tags that genuinely bought one; nothing
// reads it, it is there so the question can be answered.
//
// Safe to re-run: tags that already carry a callSubscription are skipped, so a
// second pass cannot overwrite a real paid subscription with an unlimited one.
//
// Usage:  node src/backend/scripts/grandfather-call-subscriptions.js [--apply]
// Without --apply it reports what it would do and writes nothing.

import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";

const apply = process.argv.includes("--apply");
const env = getEnv();

try {
  const collections = await getCollections(env);
  const now = new Date().toISOString();

  // Premium tags with no callSubscription of any kind. Deleted tags are left
  // alone: they cannot take a call, and stamping them would misreport how many
  // live tags were grandfathered.
  const filter = {
    premium: true,
    callSubscription: { $in: [null, undefined] },
    deletedAt: { $in: [null, undefined] }
  };

  const affected = await collections.tags.countDocuments(filter);
  const totalPremium = await collections.tags.countDocuments({
    premium: true,
    deletedAt: { $in: [null, undefined] }
  });

  console.log(`premium tags (live)          : ${totalPremium}`);
  console.log(`already have callSubscription: ${totalPremium - affected}`);
  console.log(`to grandfather               : ${affected}`);

  if (!apply) {
    console.log("\nDry run. Nothing written. Re-run with --apply to make the change.");
  } else {
    const result = await collections.tags.updateMany(filter, {
      $set: {
        callSubscription: {
          status: "active",
          currentPeriodEnd: null,
          source: "grandfathered",
          grandfatheredAt: now
        },
        updatedAt: now
      }
    });
    console.log(`\nmatched ${result.matchedCount}, modified ${result.modifiedCount}`);

    const left = await collections.tags.countDocuments(filter);
    console.log(left === 0
      ? "Every live premium tag now carries a call subscription."
      : `WARNING: ${left} still without one.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
