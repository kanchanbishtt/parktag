import { ObjectId } from "mongodb";

import { getCollections, getVaultBucket } from "./db/repositories.js";
import { createToken, createPasswordHash } from "./auth/security.js";

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
  // Hash both passwords in parallel before touching the DB so the connection
  // isn't left idle during slow bcrypt rounds (avoids ECONNRESET on Atlas).
  const [ownerHash, adminHash] = await Promise.all([
    createPasswordHash(DEMO_PASSWORD),
    createPasswordHash(DEMO_PASSWORD)
  ]);

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
    passwordHash: ownerHash,
    displayName: "Demo Owner",
    phone: "+910000000001",
    credits: 0,
    role: "owner",
    createdAt: new Date().toISOString()
  };

  const admin = {
    _id: adminId,
    email: DEMO_ADMIN_EMAIL,
    passwordHash: adminHash,
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
    // Free call already spent + non-premium → the owner dashboard renders the
    // M18 "trial ended → Buy Premium Tag" state so it can be tested immediately.
    premium: false,
    purchaseStatus: "none",
    freeContactUsed: true,
    freeContactUsedAt: new Date().toISOString(),
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

  // The vault too. This wipes every owner, so anything left in vault_documents
  // belongs to an account that no longer exists — and the stored bytes and the
  // storage counters would survive a "reset" that is supposed to leave a clean
  // slate. A stale counter is the one with teeth: it reserves storage against
  // an owner id that is never coming back.
  await collections.vaultDocuments.deleteMany({});
  await collections.vaultGrants.deleteMany({});
  await collections.vaultUsage.deleteMany({});
  const bucket = await getVaultBucket(env);
  if (bucket) {
    for (const file of await bucket.find({}).toArray()) {
      await bucket.delete(file._id).catch(() => {});
    }
  }

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
