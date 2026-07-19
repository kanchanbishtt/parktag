// One-off test helper: mark the free contact as USED on active, non-premium
// tags so the owner dashboard shows the M18 "trial ended → Buy Premium Tag"
// state. Local-DB testing only. Reset by setting freeContactUsed back to false.
import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";

const env = getEnv();

try {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const filter = {
    status: "active",
    deletedAt: { $in: [null, undefined] },
    premium: { $ne: true }
  };

  const now = new Date().toISOString();
  const before = await collections.tags
    .find(filter)
    .project({ plateNumber: 1, vehicleLabel: 1, freeContactUsed: 1 })
    .toArray();

  const result = await collections.tags.updateMany(filter, {
    $set: { freeContactUsed: true, freeContactUsedAt: now, updatedAt: now }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        matched: result.matchedCount,
        modified: result.modifiedCount,
        tags: before.map((t) => ({
          plateNumber: t.plateNumber,
          vehicleLabel: t.vehicleLabel
        }))
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
