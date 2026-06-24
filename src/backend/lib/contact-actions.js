import { ObjectId } from "mongodb";

import { triggerExotelCall } from "./exotel.js";
import { sendMetaWhatsapp, isMetaWhatsappConfigured } from "./meta.js";
import { getCollections } from "./repositories.js";

async function loadTagWithOwner(collections, token) {
  const tag = await collections.tags.findOne({ token });

  if (!tag) {
    throw new Error("Tag not found");
  }

  if (!tag.ownerId) {
    throw new Error("Tag has no owner");
  }

  const owner = await collections.owners.findOne({ _id: tag.ownerId });

  if (!owner) {
    throw new Error("Owner not found");
  }

  return { tag, owner };
}

export async function createContactAction(env, input) {
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  const { tag, owner } = await loadTagWithOwner(collections, input.token);

  const requestId = new ObjectId();
  const contactRequest = {
    _id: requestId,
    token: tag.token,
    ownerId: tag.ownerId,
    phone: input.phone,
    action: input.action,
    messageChannel: input.messageChannel || null,
    message: input.message || null,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  await collections.contactRequests.insertOne(contactRequest);

  let provider = null;
  let providerStatus = "pending";
  let providerName = "exotel";
  if (input.action === "message") providerName = "meta";

  try {
    if (input.action === "call") {
      provider = await triggerExotelCall(env, {
        requestId: String(requestId),
        from: input.phone,
        to: owner.phone || owner.mobile
      });
      providerStatus = "provider_started";
    }

    if (input.action === "message") {
      if (input.messageChannel !== "whatsapp") {
        throw new Error("Only WhatsApp messaging is supported");
      }

      if (!isMetaWhatsappConfigured(env)) {
        throw new Error("WhatsApp is not configured");
      }

      provider = await sendMetaWhatsapp(env, {
        to: owner.phone || owner.mobile,
        body: input.message
      });
      providerStatus = "provider_started";
    }
  } catch (error) {
    providerStatus = "provider_failed";

    await collections.contactRequests.updateOne(
      { _id: requestId },
      {
        $set: {
          status: providerStatus,
          provider: providerName,
          providerError: error instanceof Error ? error.message : "Provider failed",
          providerErrorDetail:
            error && typeof error === "object" && "providerDetail" in error
              ? error.providerDetail
              : null,
          providerStatusCode:
            error && typeof error === "object" && "providerStatusCode" in error
              ? error.providerStatusCode
              : null
        }
      }
    );

    console.error(
      "[WaveTag]",
      JSON.stringify({
        requestId: String(requestId),
        action: input.action,
        messageChannel: input.messageChannel || null,
        providerError:
          error instanceof Error ? error.message : "Provider failed",
        providerDetail:
          error && typeof error === "object" && "providerDetail" in error
            ? error.providerDetail
            : null,
        providerStatusCode:
          error && typeof error === "object" && "providerStatusCode" in error
            ? error.providerStatusCode
            : null
      })
    );

    throw error;
  }

  await collections.contactRequests.updateOne(
    { _id: requestId },
    {
      $set: {
        status: providerStatus,
        provider: providerName,
        providerRequestId:
          provider?.Call?.Sid ||
          provider?.whatsapp?.messages?.[0]?.sid ||
          provider?.messages?.[0]?.id ||
          provider?.sid ||
          null
      }
    }
  );

  return {
    ok: true,
    request: {
      id: String(requestId),
      token: tag.token,
      action: input.action,
      messageChannel: input.messageChannel || null,
      status: providerStatus,
      createdAt: contactRequest.createdAt
    }
  };
}
