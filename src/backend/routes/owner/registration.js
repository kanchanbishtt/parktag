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

    // `email` is used as a raw Mongo filter value just below — reject non-string
    // input above so a crafted body can't be interpreted as a query operator.
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
