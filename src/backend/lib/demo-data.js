import { ObjectId } from "mongodb";

import { getCollections } from "./repositories.js";
import { createToken, createPasswordHash } from "./security.js";

const DEMO_OWNER_EMAIL = "owner@wavetag.local";
const DEMO_ADMIN_EMAIL = "admin@wavetag.local";
const DEMO_PASSWORD = "demo1234";

export function getDemoCredentials() {
  return {
    owner: {
      email: DEMO_OWNER_EMAIL,
      password: DEMO_PASSWORD
    },
    admin: {
      email: DEMO_ADMIN_EMAIL,
      password: DEMO_PASSWORD
    }
  };
}

export async function seedDemoData(env) {
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  const ownerId = new ObjectId();
  const adminId = new ObjectId();
  const tagId = new ObjectId();
  const unclaimedTagId = new ObjectId();
  const token = createToken(12);
  const claimToken = createToken(12);

  const owner = {
    _id: ownerId,
    email: DEMO_OWNER_EMAIL,
    passwordHash: createPasswordHash(DEMO_PASSWORD),
    displayName: "Demo Owner",
    phone: "+910000000001",
    credits: 0,
    role: "owner",
    createdAt: new Date().toISOString()
  };

  const admin = {
    _id: adminId,
    email: DEMO_ADMIN_EMAIL,
    passwordHash: createPasswordHash(DEMO_PASSWORD),
    displayName: "Demo Admin",
    role: "admin",
    createdAt: new Date().toISOString()
  };

  const tag = {
    _id: tagId,
    token,
    ownerId,
    vehicleLabel: "Demo Honda City",
    plateNumber: "DL01AB1234",
    status: "active",
    createdAt: new Date().toISOString()
  };

  const unclaimedTag = {
    _id: unclaimedTagId,
    token: claimToken,
    ownerId: null,
    vehicleLabel: "Unclaimed WaveTag",
    plateNumber: null,
    status: "unclaimed",
    batchNumber: "DEMO-BATCH-001",
    batchLabel: "Demo sticker batch",
    printStatus: "pending_print",
    stickerRequested: true,
    createdAt: new Date().toISOString()
  };

  await collections.contactRequests.deleteMany({});
  await collections.tags.deleteMany({});
  await collections.owners.deleteMany({});
  await collections.admins.deleteMany({});

  await collections.owners.insertOne(owner);
  await collections.admins.insertOne(admin);
  await collections.tags.insertOne(tag);
  await collections.tags.insertOne(unclaimedTag);

  return {
    owner: {
      email: DEMO_OWNER_EMAIL,
      password: DEMO_PASSWORD
    },
    admin: {
      email: DEMO_ADMIN_EMAIL,
      password: DEMO_PASSWORD
    },
    tag: {
      token,
      status: tag.status,
      vehicleLabel: tag.vehicleLabel
    },
    claimableTag: {
      token: claimToken,
      status: unclaimedTag.status,
      vehicleLabel: unclaimedTag.vehicleLabel
    }
  };
}
