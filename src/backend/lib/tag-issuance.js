import { ObjectId } from "mongodb";

import { createSecureToken } from "./security.js";
import { createQrDataUrl } from "./qr-output.js";

export const VEHICLE_LABELS = {
  car: "Car", bike: "Bike", scooter: "Scooter", auto_rickshaw: "Auto Rickshaw",
  truck: "Truck", bus: "Bus", bicycle: "Bicycle", e_scooter: "E-Scooter"
};

function labelForType(type, fallback = "Registered vehicle") {
  return VEHICLE_LABELS[type] || fallback;
}

export function buildClaimUrl(request, token) {
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const proto = request.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}/vehicle/${token}`;
}

// New secure scan URL used for all freshly generated E-Tags (spec: /tag/{token}).
export function buildTagScanUrl(request, token) {
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const proto = request.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}/tag/${token}`;
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
  const tags = [];

  for (let index = 0; index < quantity; index += 1) {
    const tag = {
      _id: new ObjectId(),
      token: createSecureToken(),
      ownerId: null,
      vehicleLabel: null,
      vehicleType: null,
      plateNumber: null,
      status: "unclaimed",
      batchNumber: input.batchNumber || null,
      batchLabel: input.batchLabel || null,
      printStatus: "pending_print",
      stickerRequested: Boolean(input.stickerRequested),
      createdAt: new Date().toISOString(),
      ...tagLifecycleDefaults()
    };

    await collections.tags.insertOne(tag);
    tags.push(tag);
  }

  return tags;
}

export async function buildIssuedTagOutput(request, tag) {
  const claimUrl = buildClaimUrl(request, tag.token);
  const qrDataUrl = await createQrDataUrl(claimUrl);

  return {
    id: String(tag._id),
    token: tag.token,
    status: tag.status,
    batchNumber: tag.batchNumber,
    batchLabel: tag.batchLabel || null,
    printStatus: tag.printStatus,
    stickerRequested: tag.stickerRequested,
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
