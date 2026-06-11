import { ObjectId } from "mongodb";

import { createToken } from "./security.js";
import { createQrDataUrl } from "./qr-output.js";

export function buildClaimUrl(request, token) {
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const proto = request.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}/vehicle/${token}`;
}

export async function createUnclaimedTags(collections, input) {
  const quantity = Math.max(1, Number(input.quantity || 1));
  const tags = [];

  for (let index = 0; index < quantity; index += 1) {
    const tag = {
      _id: new ObjectId(),
      token: createToken(12),
      ownerId: null,
      vehicleLabel: null,
      plateNumber: null,
      status: "unclaimed",
      batchNumber: input.batchNumber || null,
      batchLabel: input.batchLabel || null,
      printStatus: "pending_print",
      stickerRequested: Boolean(input.stickerRequested),
      createdAt: new Date().toISOString()
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
    token: createToken(12),
    ownerId,
    vehicleLabel: input.vehicleLabel || "Registered vehicle",
    plateNumber: input.plateNumber,
    status: "active",
    batchNumber: null,
    printStatus: Boolean(input.stickerRequested) ? "pending_print" : "not_requested",
    stickerRequested: Boolean(input.stickerRequested),
    createdAt: new Date().toISOString()
  };

  await collections.tags.insertOne(tag);
  return tag;
}
