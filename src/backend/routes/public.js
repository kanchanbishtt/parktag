import { ObjectId } from "mongodb";

import { createContactAction } from "../lib/contact-actions.js";
import { createPasswordHash, createSecureToken, safeEqual, hashIp } from "../lib/security.js";
import { getCollections, ensureVerificationIndexes } from "../lib/repositories.js";
import { VEHICLE_LABELS } from "../lib/tag-issuance.js";

// Verification security parameters (spec: 3 attempts, then temporary lockout).
const MAX_VERIFY_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 15;
const GRANT_TTL_MINUTES = 15;
const SESSION_TTL_MINUTES = 30;

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function getClientIp(request) {
  return (
    (request.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    request.ip ||
    "unknown"
  );
}

function maskPlateNumber(plateNumber) {
  if (!plateNumber) {
    return null;
  }

  const compact = plateNumber.replace(/\s+/g, "").toUpperCase();

  if (compact.length <= 4) {
    return "####";
  }

  return `${compact.slice(0, -4)}####`;
}

function getPlateLastFour(plateNumber) {
  if (!plateNumber) {
    return null;
  }

  const compact = plateNumber.replace(/\s+/g, "").toUpperCase();
  return compact.slice(-4);
}

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
  app.post("/api/tags/:token/verify", async (request, reply) => {
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

  app.post("/api/tags/:token/claim", async (request, reply) => {
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

    if (!email || !password || !displayName || !phone || !plateNumber) {
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

  app.post("/api/contact-requests", async (request, reply) => {
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

    if (!token) {
      reply.code(400);
      return { ok: false, error: "token is required" };
    }

    // A call needs the scanner's number (to masked-call them). A WhatsApp
    // notification goes to the owner, so the scanner's number is not required.
    if (resolvedAction === "call" && !phone) {
      reply.code(400);
      return { ok: false, error: "phone is required for a call" };
    }

    // Enforce verification server-side: a valid, unexpired grant is mandatory.
    // The grant is only issued by /verify after the correct last-4 was entered,
    // so the contact flow cannot be triggered by calling this API directly.
    if (!grant) {
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
      return await createContactAction(env, {
        token,
        phone: phone || null,
        action: resolvedAction,
        messageChannel: resolvedAction === "message" ? (messageChannel || "whatsapp") : null,
        reason: reason || null,
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"] || null
      });
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Contact action failed"
      };
    }
  });
}
