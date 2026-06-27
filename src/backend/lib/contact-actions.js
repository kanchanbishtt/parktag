import { ObjectId } from "mongodb";

import { triggerExotelCall } from "./exotel.js";
import { sendMetaWhatsapp, isMetaWhatsappConfigured } from "./meta.js";
import { getCollections } from "./repositories.js";

// The WhatsApp message is built ENTIRELY server-side (spec §6) — the scanner can
// never author it. The optional reason is constrained to this fixed whitelist,
// so no arbitrary text from the client can reach the owner.
const WHATSAPP_BASE_MESSAGE =
  "Someone has reported an issue with your vehicle via your ParkTag E-Tag. Please log in to your ParkTag dashboard or contact support if needed.";

const REASON_LABELS = {
  lights: "the vehicle's lights appear to be on",
  towing: "the vehicle is blocking the way and may need to be moved",
  parking: "the vehicle is parked in a way that is causing difficulty",
  window: "a window appears to be open or unlocked",
  suspicious: "there is a suspicious situation near the vehicle"
};

function buildOwnerWhatsappMessage(reason) {
  const label = REASON_LABELS[reason];
  if (label) {
    return `ParkTag alert: someone reported that ${label}. Please check your vehicle. Log in to your ParkTag dashboard or contact support if needed.`;
  }
  return WHATSAPP_BASE_MESSAGE;
}

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

  // For WhatsApp, the message is server-built (never the scanner's words).
  const ownerMessage =
    input.action === "message" ? buildOwnerWhatsappMessage(input.reason) : null;

  const requestId = new ObjectId();
  const contactRequest = {
    _id: requestId,
    tagId: tag._id,
    token: tag.token,
    ownerId: tag.ownerId,
    phone: input.phone || null,
    action: input.action,
    messageChannel: input.messageChannel || null,
    reason: input.reason || null,
    message: ownerMessage,
    status: "pending",
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null,
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
        body: ownerMessage
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

  // Consume the free contact (non-premium tags) and record usage stats.
  const contactedAt = new Date().toISOString();
  const tagUpdate = {
    $set: { lastContactAt: contactedAt },
    $inc: { contactAttempts: 1 }
  };
  if (!tag.premium) {
    tagUpdate.$set.freeContactUsed = true;
    tagUpdate.$set.freeContactUsedAt = contactedAt;
  }
  await collections.tags.updateOne({ _id: tag._id }, tagUpdate);

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
