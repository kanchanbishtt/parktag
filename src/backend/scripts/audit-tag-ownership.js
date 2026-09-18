// Read-only incident report. Run against the intended environment:
// node src/backend/scripts/audit-tag-ownership.js --plate=UP16BM8251 --batch=Batch-002
// No QR tokens, phone numbers, email addresses, or credentials are printed.
import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { normalizeIdentifier, storedPhoneVariants, findOwnerByMobile } from "../lib/auth/otp.js";
import { stickerSerialFor } from "../lib/core/tag-issuance.js";

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const plate = (option("plate") || "").replace(/\s/g, "").toUpperCase();
const batch = option("batch");
if (!plate || !batch) {
  console.error("Usage: node src/backend/scripts/audit-tag-ownership.js --plate=PLATE --batch=Batch-002");
  process.exitCode = 1;
} else {
  try {
    const env = getEnv();
    const c = await getCollections(env);
    if (!c) throw new Error("Database unavailable");
    const projection = { _id: 1, ownerId: 1, plateNumber: 1, batchNumber: 1, serialNumber: 1,
      status: 1, premium: 1, deletedAt: 1, activatedAt: 1, createdAt: 1 };
    const initial = await c.tags.find({ $or: [{ plateNumber: plate }, { batchNumber: batch }] }, { projection }).toArray();
    const ids = initial.filter(t => t.plateNumber === plate && t.ownerId).map(t => t.ownerId);
    const owners = await c.owners.find({ _id: { $in: ids } }).toArray();
    const related = new Map(owners.map(o => [String(o._id), o]));
    const identities = [];
    for (const owner of owners) {
      const mobile = owner.mobile || owner.phone;
      if (!mobile) continue;
      const normalized = normalizeIdentifier(mobile);
      const variants = storedPhoneVariants(normalized);
      const siblings = await c.owners.find({ $or: [
        { mobile: { $in: variants } }, { phone: { $in: variants } }
      ] }).toArray();
      for (const sibling of siblings) related.set(String(sibling._id), sibling);
      identities.push({ sourceOwnerId: String(owner._id),
        resolvedMobileOwnerId: String((await findOwnerByMobile(c, normalized))?._id || ""),
        matchingOwnerIds: siblings.map(o => String(o._id)) });
    }
    const relatedTags = await c.tags.find({ ownerId: { $in: [...related.values()].map(o => o._id) } }, { projection }).toArray();
    const tags = [...new Map([...initial, ...relatedTags].map(t => [String(t._id), t])).values()];
    console.log(JSON.stringify({ database: env.mongoDbName, prefix: env.mongoCollectionPrefix,
      identities, owners: [...related.values()].map(o => ({ id: String(o._id),
        hasMobile: Boolean(o.mobile), mobileVerified: o.mobileVerified === true,
        hasPassword: Boolean(o.passwordHash), hasGoogle: Boolean(o.googleId),
        hasEmail: Boolean(o.email), createdAt: o.createdAt })),
      tags: tags.map(t => ({ ...t, serial: stickerSerialFor(t) }))
    }, null, 2));
  } catch (error) {
    console.error(`Ownership audit failed (${error.name}); check database access/configuration.`);
    process.exitCode = 1;
  } finally {
    await closeMongoConnection().catch(() => {});
  }
}
