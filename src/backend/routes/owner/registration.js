import { ObjectId } from "mongodb";

import { createPasswordHash, isNonEmptyString } from "../../lib/auth/security.js";
import { getCollections } from "../../lib/db/repositories.js";
import {
  buildIssuedTagOutput,
  createRegisteredOwnerTag
} from "../../lib/core/tag-issuance.js";

export function registerRegistrationRoutes(app, env) {
  app.post("/api/register-owner", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return {
        ok: false,
        error: "MongoDB is not configured"
      };
    }

    const {
      displayName,
      email,
      password,
      phone,
      vehicleLabel,
      plateNumber,
      stickerRequested
    } = request.body || {};

    if (
      !isNonEmptyString(displayName) ||
      !isNonEmptyString(email) ||
      !isNonEmptyString(password) ||
      !isNonEmptyString(phone) ||
      !isNonEmptyString(plateNumber)
    ) {
      reply.code(400);
      return {
        ok: false,
        error:
          "displayName, email, password, phone, and plateNumber are required"
      };
    }

    // Match the password-reset flow's minimum so a weak password can't be set
    // at registration but blocked on reset.
    if (password.length < 8) {
      reply.code(400);
      return {
        ok: false,
        error: "Password must be at least 8 characters"
      };
    }

    // Hash the password BEFORE the existence check so a duplicate email and a
    // fresh one take about the same time (bcrypt dominates the request). Doing
    // the check first would let a duplicate return early and measurably faster,
    // re-enabling account enumeration by timing despite the generic message.
    const passwordHash = await createPasswordHash(password);

    // `email` is used as a raw Mongo filter value just below — reject non-string
    // input above so a crafted body can't be interpreted as a query operator.
    const existingOwner = await collections.owners.findOne({ email });

    if (existingOwner) {
      // Don't confirm the email is already registered — an explicit "email
      // already exists" turns this into an account-enumeration oracle. Return a
      // generic message (the forgot-password flow is likewise non-committal),
      // backed by the 5/min rate limit on this route.
      reply.code(400);
      return {
        ok: false,
        error:
          "We couldn't complete your registration. If you already have an account, please sign in or reset your password."
      };
    }

    const ownerId = new ObjectId();
    const owner = {
      _id: ownerId,
      email,
      passwordHash,
      displayName,
      phone,
      credits: 0,
      role: "owner",
      createdAt: new Date().toISOString()
    };

    await collections.owners.insertOne(owner);

    const tag = await createRegisteredOwnerTag(collections, ownerId, {
      vehicleLabel,
      plateNumber,
      stickerRequested
    });

    const qr = await buildIssuedTagOutput(request, tag);

    return {
      ok: true,
      owner: {
        email,
        displayName
      },
      tag: qr
    };
  });
}
