// Nothing owned the document vault's lifecycle.
//
// A vault document was created by the upload route and removed ONLY by the
// per-document delete route. The two deletions that should have taken them
// along did not know they existed, and a security pass found both:
//
//  HIGH — deleting the ACCOUNT wiped tags, contact requests, orders, addresses
//  and pending calls, and left `vault_documents`, the GridFS bytes, the vault
//  grants and the account's OTHER sessions in place. Those sessions still
//  authenticated (readSession validates the session document, not the owner),
//  so a second signed-in device could still download the deleted owner's RC —
//  observed returning HTTP 200 with the file bytes. Identity documents
//  surviving an erasure request, with no sweeper anywhere to collect them.
//
//  HIGH — deleting a VEHICLE soft-deletes its tag, and ownedTag() then refuses
//  a soft-deleted tag. The documents filed under it became invisible AND
//  undeletable to the owner while still occupying their 40MB quota.
//
// Both now cascade through purgeVaultDocuments(). These tests assert on the
// stored bytes as well as the metadata rows, because deleting the row and
// leaving the blob is the failure mode that looks fixed from the API.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import { getVaultBucket } from "../lib/db/repositories.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-vault-life@parktag-test.invalid");
const OWNER_PASSWORD = "VaultLifecycle1!";
const VAULT_PIN = "5533";
const ORIGIN = "http://localhost:3000";
const BOUNDARY = "----vaultLifecycleBoundary";

// A one-pixel PNG. Real magic bytes, so it survives the content sniff.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478" +
    "9c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);

let app;
let env;
let collections;
let bucket;
let owner;
let cookie;
let tagId;

function multipart(fields, file) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`
    )
  );
  parts.push(file.body);
  parts.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

function call(method, url, { payload, sessionCookie } = {}) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: sessionCookie || cookie },
    headers: { origin: ORIGIN },
    ...(payload === undefined ? {} : { payload })
  });
}

function upload({ tag = tagId, docType = "rc", label = "RC", sessionCookie } = {}) {
  return app.inject({
    method: "POST",
    url: "/api/owner/vault/documents",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: sessionCookie || cookie },
    headers: { origin: ORIGIN, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart(
      { tagId: tag, docType, label },
      { filename: "rc.png", contentType: "image/png", body: PNG }
    )
  });
}

async function sessionFor(ownerDoc) {
  return createSession(app, {
    id: String(ownerDoc._id),
    role: "owner",
    email: ownerDoc.email,
    displayName: ownerDoc.displayName
  });
}

// Was this document's blob actually removed from GridFS, not just its row?
async function blobsFor(fileId) {
  return (await bucket.find({ _id: fileId }).toArray()).length;
}

async function wipe() {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
  await collections.vaultDocuments.deleteMany({}).catch(() => {});
  await collections.vaultGrants.deleteMany({}).catch(() => {});
  const files = await bucket.find({}).toArray();
  for (const f of files) await bucket.delete(f._id).catch(() => {});
}

before(async () => {
  ({ app, env, collections } = await startTestApp());
  bucket = await getVaultBucket(env);
});

after(async () => {
  await wipe();
  await stopTestApp(app);
});

beforeEach(async () => {
  await wipe();

  owner = await createTestOwner(collections, { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  cookie = await sessionFor(owner);

  const tag = await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: "QA01VL0001",
    status: "active",
    token: "qa-vault-life-0001",
    createdAt: new Date().toISOString()
  });
  tagId = String(tag.insertedId);

  const pin = await call("POST", "/api/owner/vault/pin", { payload: { pin: VAULT_PIN } });
  assert.equal(pin.statusCode, 200, "precondition: the vault PIN could not be set");
});

describe("HIGH — deleting the account takes the documents with it", () => {
  test("metadata, stored bytes and the unlock grant are all removed", async () => {
    const up = await upload();
    assert.equal(up.statusCode, 200, "precondition: the upload failed");
    const stored = await collections.vaultDocuments.findOne({ ownerId: owner._id });
    assert.ok(stored, "precondition: nothing was stored");
    assert.equal(await blobsFor(stored.fileId), 1, "precondition: no blob was written");

    const del = await call("DELETE", "/api/owner/account", { payload: { password: OWNER_PASSWORD } });
    assert.equal(del.statusCode, 200, del.body);

    assert.equal(
      await collections.vaultDocuments.countDocuments({ ownerId: owner._id }),
      0,
      "the deleted owner's document metadata survived the account"
    );
    assert.equal(
      await blobsFor(stored.fileId),
      0,
      "the document METADATA was removed but its bytes are still in GridFS"
    );
    assert.equal(
      await collections.vaultGrants.countDocuments({ ownerId: String(owner._id) }),
      0,
      "a vault unlock grant outlived the account it belonged to"
    );
  });

  test("every other session of the account is revoked, not just the caller's", async () => {
    const secondDevice = await sessionFor(owner);
    const unlock = await call("POST", "/api/owner/vault/unlock", {
      payload: { pin: VAULT_PIN },
      sessionCookie: secondDevice
    });
    assert.equal(unlock.statusCode, 200, "precondition: the second device could not unlock");

    const del = await call("DELETE", "/api/owner/account", { payload: { password: OWNER_PASSWORD } });
    assert.equal(del.statusCode, 200, del.body);

    assert.equal(
      await collections.sessions.countDocuments({ userId: String(owner._id) }),
      0,
      "a session for the deleted account is still in the store"
    );
  });

  test("a surviving session cannot download the deleted owner's documents", async () => {
    const secondDevice = await sessionFor(owner);
    await call("POST", "/api/owner/vault/unlock", {
      payload: { pin: VAULT_PIN },
      sessionCookie: secondDevice
    });

    const up = await upload();
    const docId = JSON.parse(up.body).document.id;

    await call("DELETE", "/api/owner/account", { payload: { password: OWNER_PASSWORD } });

    // This is the exact request that used to answer 200 with the RC bytes.
    const replay = await call("GET", `/api/owner/vault/documents/${docId}/file`, {
      sessionCookie: secondDevice
    });
    assert.notEqual(replay.statusCode, 200, "the deleted owner's document was served to a stale session");
    assert.equal(replay.statusCode, 401, `expected 401, got ${replay.statusCode}`);
  });

  test("the dashboard answers 401 rather than 500 when the owner record is gone", async () => {
    const secondDevice = await sessionFor(owner);
    await call("DELETE", "/api/owner/account", { payload: { password: OWNER_PASSWORD } });

    // Sessions are revoked above, so reach the handler with one deliberately
    // re-created afterwards — this pins the null-owner branch itself, which
    // used to dereference `owner.localVehicles` and answer HTTP 500.
    const orphan = await sessionFor(owner);
    const dash = await call("GET", "/api/owner/dashboard", { sessionCookie: orphan });
    assert.equal(dash.statusCode, 401, `expected 401, got ${dash.statusCode}: ${dash.body}`);
  });

  test("an account with no documents still deletes cleanly", async () => {
    const del = await call("DELETE", "/api/owner/account", { payload: { password: OWNER_PASSWORD } });
    assert.equal(del.statusCode, 200, del.body);
    assert.equal(await collections.owners.countDocuments({ _id: owner._id }), 0);
  });
});

describe("HIGH — deleting a vehicle takes its documents with it", () => {
  test("the documents filed under it are removed, bytes included", async () => {
    const up = await upload();
    assert.equal(up.statusCode, 200, "precondition: the upload failed");
    const stored = await collections.vaultDocuments.findOne({ tagId });
    assert.ok(stored, "precondition: nothing was stored");

    const del = await call("DELETE", `/api/owner/tags/${tagId}`);
    assert.equal(del.statusCode, 200, del.body);

    assert.equal(
      await collections.vaultDocuments.countDocuments({ tagId }),
      0,
      "documents survived the vehicle they were filed under"
    );
    assert.equal(await blobsFor(stored.fileId), 0, "the document's bytes are still in GridFS");
  });

  test("another vehicle's documents are left alone", async () => {
    const other = await collections.tags.insertOne({
      ownerId: owner._id,
      plateNumber: "QA01VL0002",
      status: "active",
      token: "qa-vault-life-0002",
      createdAt: new Date().toISOString()
    });
    const otherTagId = String(other.insertedId);

    await upload();
    const keep = await upload({ tag: otherTagId, label: "Other RC" });
    assert.equal(keep.statusCode, 200, "precondition: the second upload failed");

    await call("DELETE", `/api/owner/tags/${tagId}`);

    assert.equal(
      await collections.vaultDocuments.countDocuments({ tagId: otherTagId }),
      1,
      "deleting one vehicle removed another vehicle's documents"
    );
    const survivor = await collections.vaultDocuments.findOne({ tagId: otherTagId });
    assert.equal(await blobsFor(survivor.fileId), 1, "the surviving document lost its bytes");
  });

  test("the freed space is returned to the owner's quota", async () => {
    await upload();
    const before = JSON.parse(
      (await call("GET", `/api/owner/vault/documents?tagId=${tagId}`)).body
    ).usedBytes;
    assert.ok(before > 0, "precondition: nothing counted against the quota");

    await call("DELETE", `/api/owner/tags/${tagId}`);

    const other = await collections.tags.insertOne({
      ownerId: owner._id,
      plateNumber: "QA01VL0003",
      status: "active",
      token: "qa-vault-life-0003",
      createdAt: new Date().toISOString()
    });
    const listing = await call(
      "GET",
      `/api/owner/vault/documents?tagId=${String(other.insertedId)}`
    );
    assert.equal(
      JSON.parse(listing.body).usedBytes,
      0,
      "a deleted vehicle's documents are still counted against the storage quota"
    );
  });
});
