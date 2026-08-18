import { ObjectId } from "mongodb";
import { getCollections } from "../../lib/db/repositories.js";
import { createPasswordHash, createSecureToken, safeEqual, isNonEmptyString } from "../../lib/auth/security.js";
import { findByCanonicalEmail } from "../../lib/auth/identity.js";

export function registerReviewerSetupRoute(app, env) {
  // One-time safe upsert — never deletes existing data.
  // Protected by a secret param (REVIEWER_SETUP_SECRET). Remove this route
  // after App Review is approved. All values are sourced from env vars —
  // never hardcode reviewer credentials or the bypass secret in source.
  // Rate-limited (in addition to the constant-time secret check) so the
  // secret itself can't be brute-forced over the network at volume.
  app.post("/api/system/reviewer-setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const {
      reviewerSetupSecret: SECRET,
      reviewerSetupEmail: REVIEWER_EMAIL,
      reviewerSetupPassword: REVIEWER_PASSWORD,
      reviewerSetupMobile: REVIEWER_MOBILE
    } = env;

    if (!SECRET || !REVIEWER_EMAIL || !REVIEWER_PASSWORD || !REVIEWER_MOBILE) {
      reply.code(500);
      return { ok: false, error: "Reviewer setup is not configured" };
    }

    const suppliedSecret = (request.body || {}).secret;
    if (!isNonEmptyString(suppliedSecret) || !safeEqual(suppliedSecret, SECRET)) {
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
    const existing = await findByCanonicalEmail(collections.owners, REVIEWER_EMAIL);

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
      // Use the same 256-bit secure token as every other real E-Tag (not the
      // legacy 48-bit createToken(12)) — this tag is a live "active"+"premium"
      // record, so its scan token should carry the same guess-resistance as
      // the rest of the fleet.
      tagToken = createSecureToken();
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

    // URLs are built from the configured base and the REAL route paths. Both
    // were wrong before: `/owner/login` is not a route (it is `/owner-login`)
    // and `/t/{token}` is not a route either (it is `/tag/{token}`), so a
    // reviewer following either link got a 404 — on the one flow this endpoint
    // exists to demonstrate. Hardcoding the production host also made the
    // response useless from any other environment.
    const base = (env.appBaseUrl || "https://app.parktag.me").replace(/\/+$/, "");

    return {
      ok: true,
      credentials: {
        loginUrl: `${base}/owner-login`,
        email: REVIEWER_EMAIL,
        password: REVIEWER_PASSWORD,
        tagScanUrl: `${base}/tag/${tagToken}`,
        plateLastFour: "9999"
      }
    };
  });
}
