import { ObjectId } from "mongodb";

import { sendMetaWhatsappAlert, isMetaWhatsappConfigured } from "../integrations/meta.js";
import { sendOwnerAlertEmail } from "../integrations/email.js";
import { getCollections } from "../db/repositories.js";
import { captureScannerLocation } from "./scan-location.js";

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

// Looked up with hasOwn rather than as a plain property read.
//
// `REASON_LABELS[reason]` walks the prototype chain, so "constructor",
// "toString", "valueOf", "hasOwnProperty" and "__proto__" all come back truthy
// — and what comes back is a function, which the template below stringifies
// into the message the owner receives: "someone reported that function
// Object() { [native code] }". The scanner cannot author this message, and
// that has to include authoring it indirectly.
function reasonLabel(reason) {
  return typeof reason === "string" && Object.hasOwn(REASON_LABELS, reason)
    ? REASON_LABELS[reason]
    : null;
}

// The set the scan page offers, exported so the route can refuse anything else
// at the boundary instead of storing it and discovering it here. Mirrors
// isSupportedVehicleType in tag-issuance.js.
export function isSupportedContactReason(reason) {
  return reasonLabel(reason) !== null;
}

function buildOwnerWhatsappMessage(reason) {
  const label = reasonLabel(reason);
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
    // Normalised, not just validated upstream: this is what lands in the
    // record support reads, so an unrecognised value is stored as absent
    // however the function was called.
    reason: isSupportedContactReason(input.reason) ? input.reason : null,
    message: ownerMessage,
    status: "pending",
    ipAddress: input.ipAddress || null,
    // Born null and filled in by the background capture below, if the tag is
    // entitled and the address resolves. Always present so a row that never
    // gets one is shaped like a row written before this feature existed.
    scannerLocation: null,
    userAgent: input.userAgent || null,
    createdAt: new Date().toISOString()
  };

  await collections.contactRequests.insertOne(contactRequest);

  // Deliberately NOT awaited. The scanner is waiting on this response and the
  // provider takes about 1.5s; the owner reads the row later, so the location
  // can arrive after the reply without anybody noticing it was late.
  captureScannerLocation(env, collections, requestId, tag, input.ipAddress);

  let provider = null;
  let providerStatus = "pending";
  let providerName = input.action === "message" ? "meta" : null;

  try {
    if (input.action === "message") {
      if (input.messageChannel !== "whatsapp") {
        throw new Error("Only WhatsApp messaging is supported");
      }

      // EVERY channel the owner has, not just the one they are most likely to
      // read. This is the most time-critical message the app sends — lights
      // left on, a car blocking a gate — and it used to require WhatsApp: an
      // owner with only an e-mail on file got nothing, and the scanner who
      // took the trouble to report it was told the request had failed.
      //
      // Each attempt absorbs its own rejection and reports a boolean, so a dead
      // provider costs its own message and nothing else. The throw below fires
      // only when NOBODY could be reached, which is the condition that
      // genuinely deserves an error at the scanner.
      const mobile = owner.phone || owner.mobile;
      const ownerName = owner.displayName || "there";
      const reasonText = reasonLabel(input.reason) || "an issue has been reported";
      const attempts = [];

      if (mobile && isMetaWhatsappConfigured(env)) {
        attempts.push(
          sendMetaWhatsappAlert(env, { to: mobile, ownerName, reason: reasonText })
            .then((result) => { provider = result; return true; })
            .catch((err) => {
              console.error("[WaveTag] owner alert WhatsApp failed:", err?.message, err?.providerDetail);
              return false;
            })
        );
      }

      if (owner.email) {
        attempts.push(
          sendOwnerAlertEmail(env, {
            to: owner.email,
            ownerName,
            reason: reasonText,
            plateNumber: tag.plateNumber || null
          })
            .then(() => true)
            .catch((err) => {
              console.error("[WaveTag] owner alert e-mail failed:", err?.message);
              return false;
            })
        );
      }

      if (!attempts.length) {
        throw new Error("This owner has no contact channel on file");
      }

      const reached = (await Promise.all(attempts)).some(Boolean);
      if (!reached) {
        throw new Error("Could not reach the owner on any channel");
      }

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
