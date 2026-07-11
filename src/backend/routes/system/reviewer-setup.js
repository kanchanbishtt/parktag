import { ObjectId } from "mongodb";
import { getCollections } from "../../lib/db/repositories.js";
import { createPasswordHash, createToken } from "../../lib/auth/security.js";

const REVIEWER_EMAIL = "reviewer@parktag.me";
const REVIEWER_PASSWORD = "***REMOVED-PASSWORD***";
const REVIEWER_MOBILE = "+910000000099";
const SECRET = "***REMOVED-SECRET***";

export function registerReviewerSetupRoute(app, env) {
  // One-time safe upsert — never deletes existing data.
  // Protected by a secret param. Remove this route after App Review is approved.
  app.post("/api/system/reviewer-setup", async (request, reply) => {
    if ((request.body || {}).secret !== SECRET) {
      reply.code(403);
      return { ok: false, error: "Forbidden" };
    }

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(500);
      return { ok: false, error: "MongoDB not configured" };
    }

    const passwordHash = await createPasswordHash(REVIEWER_PASSWORD);

    // Upsert owner — safe, never touches other documents
    const ownerId = new ObjectId();
    const existing = await collections.owners.findOne({ email: REVIEWER_EMAIL });

    let resolvedOwnerId;
    if (existing) {
      resolvedOwnerId = existing._id;
    } else {
      await collections.owners.insertOne({
        _id: ownerId,
        email: REVIEWER_EMAIL,
        passwordHash,
        displayName: "Meta Reviewer",
        mobile: REVIEWER_MOBILE,
        credits: 0,
        role: "owner",
        createdAt: new Date().toISOString()
      });
      resolvedOwnerId = ownerId;
    }

    // Check for existing active tag for this reviewer
    const existingTag = await collections.tags.findOne({ ownerId: resolvedOwnerId });

    let tagToken;
    if (existingTag) {
      tagToken = existingTag.token;
    } else {
      tagToken = createToken(12);
      await collections.tags.insertOne({
        _id: new ObjectId(),
        token: tagToken,
        ownerId: resolvedOwnerId,
        vehicleLabel: "Demo Car",
        plateNumber: "DL01PT9999",
        status: "active",
        premium: true,
        createdAt: new Date().toISOString()
      });
    }

    return {
      ok: true,
      credentials: {
        loginUrl: "https://app.parktag.me/owner/login",
        email: REVIEWER_EMAIL,
        password: REVIEWER_PASSWORD,
        tagScanUrl: `https://app.parktag.me/t/${tagToken}`,
        plateLastFour: "9999"
      }
    };
  });
}
