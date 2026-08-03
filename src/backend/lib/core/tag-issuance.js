import { ObjectId } from "mongodb";

import { createSecureToken } from "../auth/security.js";
import { createQrDataUrl } from "./qr-output.js";
import { getEnv } from "../env.js";

// Canonical display ID for an E-Tag (last 8 chars of MongoDB ObjectId, uppercased).
export function etagIdFor(id) {
  return `PT-${String(id).slice(-8).toUpperCase()}`;
}

// Batch half of a sticker serial, normalised to two digits. Shared by the serial
// formatter and the issuance counter so both always agree on which batch a tag
// belongs to ("B12", "12" and 12 all resolve to "12").
export function batchKeyFor(batchNumber) {
  return String(batchNumber ?? 0).replace(/\D/g, "").padStart(2, "0");
}

// Human-readable serial printed on the physical premium sticker: PT-<batch>-<unit>,
// e.g. PT-01-000001 for the first tag of batch 01. Both halves are reduced to
// digits, so the result only ever contains [A-Z0-9-] and is safe to interpolate
// into printed HTML.
//
// Returns "" for a tag with no serialNumber rather than inventing one. Tags
// issued before serials existed have none until the backfill script has run
// (npm run backfill:tag-serials) — printing a made-up number would be worse
// than printing none, because the whole point is that it maps to a record.
export function stickerSerialFor(tag) {
  if (tag?.serialNumber == null) {
    return "";
  }
  const unit = String(tag.serialNumber).replace(/\D/g, "").padStart(6, "0");
  return `PT-${batchKeyFor(tag.batchNumber)}-${unit}`;
}

export const VEHICLE_LABELS = {
  car: "Car", bike: "Bike", scooter: "Scooter", auto_rickshaw: "Auto Rickshaw",
  truck: "Truck", bus: "Bus", bicycle: "Bicycle", e_scooter: "E-Scooter"
};

function labelForType(type, fallback = "Registered vehicle") {
  return VEHICLE_LABELS[type] || fallback;
}

// Base for scan/QR URLs: use env.scanBaseUrl if set (production pin), else the
// host the request came in on (local→local, production→production).
function scanBase(request) {
  const pinned = getEnv().scanBaseUrl;
  if (pinned) return pinned;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const proto = request.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

export function buildClaimUrl(request, token) {
  return `${scanBase(request)}/vehicle/${token}`;
}

// New secure scan URL used for all freshly generated E-Tags (spec: /tag/{token}).
export function buildTagScanUrl(request, token) {
  return `${scanBase(request)}/tag/${token}`;
}

// Default gating / lifecycle fields stamped on every newly created tag so the
// free-usage, premium, and soft-delete logic has consistent shape to read.
export function tagLifecycleDefaults() {
  const now = new Date().toISOString();
  return {
    freeContactUsed: false,
    freeContactUsedAt: null,
    contactAttempts: 0,
    purchaseStatus: "none", // "none" | "paid"
    physicalTagPurchased: false,
    premium: false,
    lastContactAt: null,
    deletedAt: null,
    updatedAt: now
  };
}

export async function createUnclaimedTags(collections, input) {
  const quantity = Math.max(1, Number(input.quantity || 1));

  // Reserve this run's sticker serials in one atomic bump, so two admins issuing
  // into the same batch can never be handed the same number. Same counters
  // collection and $inc pattern the shop order number uses.
  const batch = batchKeyFor(input.batchNumber);
  const res = await collections.counters.findOneAndUpdate(
    { _id: `tagSerial:${batch}` },
    { $inc: { seq: quantity } },
    { upsert: true, returnDocument: "after" }
  );
  // The v6 driver returns the doc directly; older behaviour wraps it in `.value`.
  const seqEnd = (res && (res.seq ?? (res.value && res.value.seq))) || quantity;
  const seqStart = seqEnd - quantity + 1;

  const tags = [];

  for (let index = 0; index < quantity; index += 1) {
    tags.push({
      _id: new ObjectId(),
      token: createSecureToken(),
      ownerId: null,
      vehicleLabel: null,
      vehicleType: null,
      plateNumber: null,
      status: "unclaimed",
      batchNumber: input.batchNumber || null,
      batchLabel: input.batchLabel || null,
      // Sequential within the batch: PT-<batch>-<serialNumber>.
      serialNumber: seqStart + index,
      printStatus: "pending_print",
      stickerRequested: Boolean(input.stickerRequested),
      createdAt: new Date().toISOString(),
      ...tagLifecycleDefaults(),
      premium: Boolean(input.premiumBatch)
    });
  }

  // Bulk-insert with insertMany (one round-trip per chunk) instead of the old
  // one-insertOne-per-tag loop — a 1000-tag batch used to make 1000 sequential
  // trips to Atlas, which blew past the hosting gateway's request timeout
  // ("upstream error"). Chunking also keeps a very large batch from building one
  // oversized write payload.
  const INSERT_CHUNK = 500;
  for (let i = 0; i < tags.length; i += INSERT_CHUNK) {
    await collections.tags.insertMany(tags.slice(i, i + INSERT_CHUNK), { ordered: false });
  }

  return tags;
}

export async function buildIssuedTagOutput(request, tag) {
  const claimUrl = buildClaimUrl(request, tag.token);
  const qrDataUrl = await createQrDataUrl(claimUrl);

  return {
    id: String(tag._id),
    token: tag.token,
    serial: stickerSerialFor(tag),
    status: tag.status,
    batchNumber: tag.batchNumber,
    batchLabel: tag.batchLabel || null,
    printStatus: tag.printStatus,
    stickerRequested: tag.stickerRequested,
    premium: Boolean(tag.premium),
    claimUrl,
    qrDataUrl
  };
}

export async function createRegisteredOwnerTag(collections, ownerId, input) {
  const tag = {
    _id: new ObjectId(),
    token: createSecureToken(),
    ownerId,
    vehicleLabel: input.vehicleLabel || labelForType(input.vehicleType),
    vehicleType: input.vehicleType || null,
    plateNumber: input.plateNumber,
    status: "active",
    batchNumber: null,
    printStatus: Boolean(input.stickerRequested) ? "pending_print" : "not_requested",
    stickerRequested: Boolean(input.stickerRequested),
    createdAt: new Date().toISOString(),
    ...tagLifecycleDefaults()
  };

  await collections.tags.insertOne(tag);
  return tag;
}

// Create (or return existing) a real, scannable E-Tag for one of an owner's
// vehicles. This replaces the old demo-QR placeholder: every generated E-Tag is
// now permanently linked to a single vehicle via a 256-bit secure token.
export async function createEtagForVehicle(collections, ownerId, input) {
  const plateNumber = String(input.number || "").trim().toUpperCase();
  const vehicleType = input.type || null;

  if (!plateNumber) {
    throw new Error("Vehicle number is required");
  }

  // Reuse an existing tag for this exact vehicle so re-printing doesn't mint
  // duplicate E-Tags (and so the QR stays stable for an already-stuck sticker).
  const existing = await collections.tags.findOne({
    ownerId,
    plateNumber,
    deletedAt: null
  });

  if (existing) {
    return { tag: existing, created: false };
  }

  const tag = {
    _id: new ObjectId(),
    token: createSecureToken(),
    ownerId,
    vehicleLabel: input.vehicleLabel || labelForType(vehicleType),
    vehicleType,
    plateNumber,
    status: "active",
    batchNumber: null,
    printStatus: "not_requested",
    stickerRequested: false,
    createdAt: new Date().toISOString(),
    ...tagLifecycleDefaults()
  };

  await collections.tags.insertOne(tag);
  return { tag, created: true };
}

// Mint a brand-new PREMIUM tag for one of an owner's vehicles. Used when an
// owner buys a premium tag from the shop to replace a spent free-trial tag:
// the caller soft-removes the old free tag, then mints this one (new token +
// QR). Inserts directly — it must NOT reuse an existing tag by plate the way
// createEtagForVehicle does, so the new premium tag is always distinct.
export async function createPremiumTagForVehicle(collections, ownerId, input) {
  const plateNumber = String(input.plateNumber || "").trim().toUpperCase();
  const vehicleType = input.vehicleType || null;
  const now = new Date().toISOString();

  const tag = {
    _id: new ObjectId(),
    token: createSecureToken(),
    ownerId,
    vehicleLabel: input.vehicleLabel || labelForType(vehicleType),
    vehicleType,
    plateNumber,
    status: "active",
    batchNumber: null,
    stickerRequested: true,
    createdAt: now,
    ...tagLifecycleDefaults(),
    // Premium overrides — this tag is paid and official from birth.
    premium: true,
    plan: "premium",
    physicalTagPurchased: true,
    purchaseStatus: "paid",
    premiumSince: now,
    printStatus: "pending_print",
    updatedAt: now
  };

  await collections.tags.insertOne(tag);
  return tag;
}
