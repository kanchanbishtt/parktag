import { ObjectId } from "mongodb";

import { createContactAction } from "../lib/contact-actions.js";
import { createPasswordHash } from "../lib/security.js";
import { getCollections } from "../lib/repositories.js";

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

    return {
      ok: true,
      tag: {
        token: tag.token,
        status: tag.status,
        vehicleLabel: tag.vehicleLabel,
        maskedPlateNumber:
          tag.status === "active" ? maskPlateNumber(tag.plateNumber) : null,
        plateLastFour:
          tag.status === "active" ? getPlateLastFour(tag.plateNumber) : null,
        callPreviewNumber:
          tag.status === "active" ? env.exotelCallerId || null : null,
        claimable: ["unclaimed", "inactive"].includes(tag.status)
      }
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

    const { token, phone, action, message, messageChannel } = request.body || {};

    if (!token || !phone) {
      reply.code(400);
      return {
        ok: false,
        error: "token and phone are required"
      };
    }

    if (action && !["call", "message"].includes(action)) {
      reply.code(400);
      return {
        ok: false,
        error: "action must be call or message"
      };
    }

    if ((action || "call") === "message" && !message) {
      reply.code(400);
      return {
        ok: false,
        error: "message is required for message action"
      };
    }

    if (
      (action || "call") === "message" &&
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

    try {
      return await createContactAction(env, {
        token,
        phone,
        action: action || "call",
        messageChannel: messageChannel || null,
        message: message || null
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
