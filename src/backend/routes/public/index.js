import { ObjectId } from "mongodb";

import { createContactAction } from "../../lib/core/contact-actions.js";
import { createPasswordHash, createSecureToken, safeEqual, hashIp, minutesFromNow, getClientIp, maskPlateNumber, getPlateLastFour, isNonEmptyString } from "../../lib/auth/security.js";
import { getCollections, ensureVerificationIndexes, ensurePendingCallsIndexes } from "../../lib/db/repositories.js";
import { VEHICLE_LABELS } from "../../lib/core/tag-issuance.js";

// Verification security parameters (spec: 3 attempts, then temporary lockout).
const MAX_VERIFY_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 15;
const GRANT_TTL_MINUTES = 15;
const SESSION_TTL_MINUTES = 30;

export function registerPublicRoutes(app, env) {
  app.get("/api/tags/:token", async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return {
        ok: false,
        error: "MongoDB is not configured"
      };
    }

    const tag = await collections.tags.findOne({ token: request.params.token });

    if (!tag) {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found"
      };
    }

    // NOTE: plateLastFour is intentionally NOT returned — the last-4 answer must
    // never reach the client. Verification is done server-side via /verify below.
    return {
      ok: true,
      tag: {
        token: tag.token,
        status: tag.status,
        vehicleType: tag.vehicleType || null,
        // Show the real vehicle type per vehicle (e.g. "Bicycle"), falling back
        // to the stored label only for older tags without a type.
        vehicleLabel: VEHICLE_LABELS[tag.vehicleType] || tag.vehicleLabel || "Vehicle",
        maskedPlateNumber:
          tag.status === "active" ? maskPlateNumber(tag.plateNumber) : null,
        callPreviewNumber:
          tag.status === "active" ? env.exotelCallerId || null : null,
        claimable: ["unclaimed", "inactive"].includes(tag.status)
      }
    };
  });

  // Server-side vehicle verification. The scanner submits the last 4 digits of
  // the plate; we compare server-side, track failed attempts per (token + IP),
  // lock out after 3 failures for 15 minutes, and on success issue a short-lived
  // grant that the contact endpoints require. This cannot be bypassed from the UI.
  app.post("/api/tags/:token/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return { ok: false, error: "MongoDB is not configured" };
    }

    await ensureVerificationIndexes(collections);

    const { token } = request.params;
    const lastFour = String((request.body || {}).lastFour || "").trim();

    const tag = await collections.tags.findOne({ token });

    if (!tag || tag.status !== "active") {
      reply.code(404);
      return { ok: false, error: "Tag not found or not active" };
    }

    const ipHash = hashIp(getClientIp(request), token);
    const now = new Date();

    let session = await collections.verificationSessions.findOne({ token, ipHash });

    // Honour an active lockout.
    if (session?.lockedUntil && new Date(session.lockedUntil) > now) {
      const remainingMin = Math.ceil(
        (new Date(session.lockedUntil).getTime() - now.getTime()) / 60000
      );
      reply.code(423);
      return {
        ok: false,
        locked: true,
        error: `Too many incorrect attempts. Try again in ${remainingMin} minute(s).`
      };
    }

    if (!lastFour || !/^\d{4}$/.test(lastFour)) {
      reply.code(400);
      return { ok: false, error: "Enter the last 4 digits of the vehicle number." };
    }

    const expected = getPlateLastFour(tag.plateNumber) || "";
    const isMatch = expected.length === 4 && safeEqual(lastFour, expected);

    if (!session) {
      session = {
        _id: new ObjectId(),
        token,
        ipHash,
        attempts: 0,
        lockedUntil: null,
        verified: false,
        grantId: null,
        grantExpiresAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
      };
      await collections.verificationSessions.insertOne(session);
    }

    if (!isMatch) {
      const attempts = (session.attempts || 0) + 1;
      const willLock = attempts >= MAX_VERIFY_ATTEMPTS;

      await collections.verificationSessions.updateOne(
        { _id: session._id },
        {
          $set: {
            attempts: willLock ? 0 : attempts,
            lockedUntil: willLock ? minutesFromNow(LOCKOUT_MINUTES).toISOString() : null,
            updatedAt: now.toISOString(),
            expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
          }
        }
      );

      if (willLock) {
        reply.code(423);
        return {
          ok: false,
          locked: true,
          error: `Too many incorrect attempts. Try again in ${LOCKOUT_MINUTES} minutes.`
        };
      }

      reply.code(401);
      return {
        ok: false,
        error: "Those last 4 digits do not match this vehicle.",
        attemptsRemaining: MAX_VERIFY_ATTEMPTS - attempts
      };
    }

    // Success — issue a fresh grant.
    const grantId = createSecureToken();
    await collections.verificationSessions.updateOne(
      { _id: session._id },
      {
        $set: {
          attempts: 0,
          lockedUntil: null,
          verified: true,
          grantId,
          grantExpiresAt: minutesFromNow(GRANT_TTL_MINUTES).toISOString(),
          updatedAt: now.toISOString(),
          expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
        }
      }
    );

    return {
      ok: true,
      grant: grantId,
      vehicleLabel: tag.vehicleLabel || "Registered vehicle",
      maskedPlateNumber: maskPlateNumber(tag.plateNumber),
      // Free-usage state for the UI (authoritative check is still server-side
      // on the contact endpoint). Premium tags always have contact available.
      contactAvailable: Boolean(tag.premium) || !tag.freeContactUsed
    };
  });

  // Unauthenticated and creates a new owner account (bcrypt hash + insert) on
  // every call, same abuse shape as /api/register-owner — rate-limit it the
  // same way so it can't be used to flood the DB with accounts or to burn
  // CPU on repeated bcrypt hashing.
  app.post("/api/tags/:token/claim", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return {
        ok: false,
        error: "MongoDB is not configured"
      };
    }

    const { email, password, displayName, phone, vehicleLabel, plateNumber } =
      request.body || {};

    if (
      !isNonEmptyString(email) ||
      !isNonEmptyString(password) ||
      !isNonEmptyString(displayName) ||
      !isNonEmptyString(phone) ||
      !isNonEmptyString(plateNumber)
    ) {
      reply.code(400);
      return {
        ok: false,
        error: "email, password, displayName, phone, and plateNumber are required"
      };
    }

    const tag = await collections.tags.findOne({ token: request.params.token });

    if (!tag) {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found"
      };
    }

    if (!["unclaimed", "inactive"].includes(tag.status)) {
      reply.code(400);
      return {
        ok: false,
        error: "Tag is not claimable"
      };
    }

    const existingOwner = await collections.owners.findOne({ email });

    if (existingOwner) {
      reply.code(400);
      return {
        ok: false,
        error: "Owner email already exists"
      };
    }

    const ownerId = new ObjectId();
    const owner = {
      _id: ownerId,
      email,
      passwordHash: await createPasswordHash(password),
      displayName,
      phone,
      credits: 0,
      role: "owner",
      createdAt: new Date().toISOString()
    };

    await collections.owners.insertOne(owner);

    await collections.tags.updateOne(
      { _id: tag._id },
      {
        $set: {
          ownerId,
          status: "active",
          vehicleLabel: vehicleLabel || tag.vehicleLabel,
          plateNumber
        }
      }
    );

    return {
      ok: true,
      owner: {
        email,
        displayName
      },
      tag: {
        token: tag.token,
        status: "active",
        vehicleLabel: vehicleLabel || tag.vehicleLabel,
        maskedPlateNumber: maskPlateNumber(plateNumber)
      }
    };
  });

  app.post("/api/contact-requests", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return {
        ok: false,
        error: "MongoDB is not configured"
      };
    }

    const { token, phone, action, messageChannel, reason, grant } = request.body || {};
    const resolvedAction = action || "call";

    // `token` and `grant` are used as raw Mongo filter values below
    // (`findOne({ token, grantId: grant, ... })` / `findOne({ token })`).
    // They must be plain strings — otherwise a crafted body such as
    // `{ "token": { "$ne": null } }` would be interpreted by Mongo as a query
    // operator instead of a literal match, letting a request match an
    // arbitrary tag/session instead of the one the caller actually verified.
    if (!isNonEmptyString(token)) {
      reply.code(400);
      return { ok: false, error: "token is required" };
    }

    // A call needs the scanner's number (to masked-call them). A WhatsApp
    // notification goes to the owner, so the scanner's number is not required.
    if (resolvedAction === "call" && !isNonEmptyString(phone)) {
      reply.code(400);
      return { ok: false, error: "phone is required for a call" };
    }

    // Enforce verification server-side: a valid, unexpired grant is mandatory.
    // The grant is only issued by /verify after the correct last-4 was entered,
    // so the contact flow cannot be triggered by calling this API directly.
    if (!isNonEmptyString(grant)) {
      reply.code(403);
      return { ok: false, error: "Verify the vehicle before contacting the owner." };
    }

    const grantSession = await collections.verificationSessions.findOne({
      token,
      grantId: grant,
      verified: true
    });

    if (!grantSession || new Date(grantSession.grantExpiresAt) <= new Date()) {
      reply.code(403);
      return { ok: false, error: "Your verification expired. Please verify the vehicle again." };
    }

    if (action && !["call", "message"].includes(action)) {
      reply.code(400);
      return {
        ok: false,
        error: "action must be call or message"
      };
    }

    // The WhatsApp message body is built server-side (spec §6) — the client never
    // supplies it, so there is nothing to validate here beyond the channel.
    if (
      resolvedAction === "message" &&
      messageChannel &&
      messageChannel !== "whatsapp"
    ) {
      reply.code(400);
      return {
        ok: false,
        error: "messageChannel must be whatsapp"
      };
    }

    const tag = await collections.tags.findOne({ token });

    if (!tag) {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found"
      };
    }

    // Free-usage policy (server-enforced, cannot be bypassed from the client):
    // each E-Tag includes one free masked contact. Once used, contact is blocked
    // until the owner activates the official sticker (premium).
    if (tag.freeContactUsed && !tag.premium) {
      reply.code(402);
      return {
        ok: false,
        code: "FREE_USED",
        error: "This E-Tag's free contact has already been used. The owner can re-enable contact with the official ParkTag sticker."
      };
    }

    try {
      // Normalize to digits-only E.164 before persisting — this is a free-text
      // body field on a public, unauthenticated endpoint, and the raw value
      // used to be stored verbatim (only later fixed on the *output* side with
      // HTML-escaping in the admin dashboard). Constraining the input format
      // here removes the underlying bad data at the source too.
      const normalizedPhone = isNonEmptyString(phone) ? toE164(phone) : null;
      return await createContactAction(env, {
        token,
        phone: normalizedPhone,
        action: resolvedAction,
        messageChannel: resolvedAction === "message" ? (messageChannel || "whatsapp") : null,
        reason: reason || null,
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"] || null
      });
    } catch (error) {
      // Public, unauthenticated endpoint — never echo raw error.message here.
      // Known validation failures (bad token, missing owner, provider errors)
      // already use short, deliberately-safe strings, but this catch also
      // covers unexpected exceptions (DB, network), so default to a generic
      // message and keep the real detail server-side only.
      request.log.error({ err: error }, "Contact action failed");
      reply.code(400);
      return {
        ok: false,
        error: "Could not complete this request. Please try again."
      };
    }
  });

  // Pre-register an inbound call before the scanner dials the virtual number.
  // Stores a pendingCalls record so the Dial Whom webhook can resolve the owner's
  // phone from the scanner's A-party number. Returns the virtual number to dial.
  app.post("/api/tags/:token/register-call", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { phone, grant } = request.body || {};

    if (!isNonEmptyString(phone)) {
      reply.code(400);
      return { ok: false, error: "phone is required" };
    }
    // `grant` is used as a raw Mongo filter value below — must be a string.
    if (!isNonEmptyString(grant)) {
      reply.code(403);
      return { ok: false, error: "Verify the vehicle before contacting the owner." };
    }

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(500);
      return { ok: false, error: "MongoDB is not configured" };
    }

    await ensurePendingCallsIndexes(collections);

    const { token } = request.params;

    const grantSession = await collections.verificationSessions.findOne({
      token,
      grantId: grant,
      verified: true
    });
    if (!grantSession || new Date(grantSession.grantExpiresAt) <= new Date()) {
      reply.code(403);
      return { ok: false, error: "Your verification expired. Please verify the vehicle again." };
    }

    const tag = await collections.tags.findOne({ token });
    if (!tag || tag.status !== "active") {
      reply.code(404);
      return { ok: false, error: "Tag not found or not active" };
    }

    if (tag.freeContactUsed && !tag.premium) {
      reply.code(402);
      return {
        ok: false,
        code: "FREE_USED",
        error: "This E-Tag's free contact has already been used. The owner can re-enable contact with the official ParkTag sticker."
      };
    }

    if (!env.exotelCallerId) {
      reply.code(503);
      return { ok: false, error: "Call service is not configured." };
    }

    const owner = tag.ownerId ? await collections.owners.findOne({ _id: tag.ownerId }) : null;
    const ownerPhone = owner?.mobile || owner?.phone || null;
    if (!ownerPhone) {
      reply.code(422);
      return { ok: false, error: "Owner has not set a phone number. Call unavailable." };
    }

    // Normalize to E.164 so the Dial Whom lookup matches Exotel's CallFrom format.
    const callerPhone = toE164(phone);
    const now = new Date();

    const { insertedId: requestId } = await collections.contactRequests.insertOne({
      token,
      ownerId: tag.ownerId,
      phone: callerPhone,
      action: "call",
      status: "initiated",
      provider: "exotel",
      ipAddress: getClientIp(request),
      userAgent: request.headers["user-agent"] || null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    await collections.tags.updateOne(
      { _id: tag._id },
      { $set: { freeContactUsed: true, freeContactUsedAt: now.toISOString(), updatedAt: now.toISOString() } }
    );

    await collections.pendingCalls.insertOne({
      callerPhone,
      targetPhone: ownerPhone,
      token,
      ownerId: tag.ownerId,
      requestId,
      type: "scanner_to_owner",
      consumed: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000)
    });

    return { ok: true, virtualNumber: env.exotelCallerId };
  });
}

function toE164(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}
