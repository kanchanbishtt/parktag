import { ObjectId } from "mongodb";

import { createPasswordHash } from "../lib/security.js";
import { getCollections } from "../lib/repositories.js";
import {
  buildIssuedTagOutput,
  createRegisteredOwnerTag
} from "../lib/tag-issuance.js";

export function registerRegistrationRoutes(app, env) {
  app.post("/api/register-owner", async (request, reply) => {
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

    if (!displayName || !email || !password || !phone || !plateNumber) {
      reply.code(400);
      return {
        ok: false,
        error:
          "displayName, email, password, phone, and plateNumber are required"
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
      passwordHash: createPasswordHash(password),
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
