// The vault-lifecycle sweep, finished.
//
// The first pass fixed the deletion paths the security findings NAMED: the
// owner deleting their account, and the owner deleting a vehicle. It did not
// sweep the other places a tag or an owner goes away, and a follow-up check
// found three more — the same root cause reaching further than the fix:
//
//  * DELETE /api/admin/etags/:tagId — an admin soft-deleting an owner's tag
//    orphaned its documents exactly as the owner path used to. Measured: the
//    metadata row and the GridFS blob both survived, the owner's listing 404'd,
//    and the bytes stayed charged against their quota.
//
//  * TAG REPLACEMENT (M18) — and this one is not a retention bug, it is data
//    loss. Buying a premium tag to replace a free one soft-deletes the old tag
//    and mints a new one FOR THE SAME CAR. The documents stayed pinned to the
//    dead tag, which the vault refuses, so an owner's RC became unreachable at
//    the moment they paid for an upgrade. Purging would be wrong here; the
//    documents have to MOVE.
//
//  * The field-demo wipe and the demo reset both delete owners outright and
//    left the vault behind.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { createSession } from "../lib/auth/session.js";
import { getVaultBucket } from "../lib/db/repositories.js";
import { fulfilPaidOrder } from "../lib/core/order-fulfilment.js";
import { reassignVaultDocuments } from "../lib/core/vault.js";
import { createPasswordHash } from "../lib/auth/security.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-vault-cascade@parktag-test.invalid");
const ADMIN_EMAIL = "qa-vault-cascade-admin@parktag-test.invalid";
const VAULT_PIN = "6472";
const ORIGIN = "http://localhost:3000";
const BOUNDARY = "----vaultCascadeBoundary";
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
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
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

function call(method, url, sessionCookie, { payload } = {}) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: sessionCookie },
    headers: { origin: ORIGIN },
    ...(payload === undefined ? {} : { payload })
  });
}

function upload(tag, sessionCookie, label = "RC") {
  return app.inject({
    method: "POST",
    url: "/api/owner/vault/documents",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: sessionCookie },
    headers: { origin: ORIGIN, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart({ tagId: tag, docType: "rc", label }, { filename: "rc.png", contentType: "image/png", body: PNG })
  });
}

async function blobCount() {
  return (await bucket.find({}).toArray()).length;
}

async function wipe() {
  await purgeLoginCollections(collections);
  for (const name of ["tags", "vaultDocuments", "vaultGrants", "vaultUsage", "shopOrders", "admins", "contactRequests"]) {
    await collections[name].deleteMany({}).catch(() => {});
  }
  for (const f of await bucket.find({}).toArray()) await bucket.delete(f._id).catch(() => {});
}

async function ownerSession(doc) {
  return createSession(app, {
    id: String(doc._id),
    role: "owner",
    email: doc.email,
    displayName: doc.displayName
  });
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
  owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  cookie = await ownerSession(owner);
  const tag = await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: "QA01CD0001",
    vehicleType: "car",
    vehicleLabel: "Car",
    status: "active",
    premium: false,
    token: "qa-vault-cascade-0001",
    createdAt: new Date().toISOString()
  });
  tagId = String(tag.insertedId);
  const pin = await call("POST", "/api/owner/vault/pin", cookie, { payload: { pin: VAULT_PIN } });
  assert.equal(pin.statusCode, 200, `precondition: PIN not set — ${pin.body}`);
});

describe("an admin deleting an E-Tag takes its documents too", () => {
  test("metadata and stored bytes both go", async () => {
    const up = await upload(tagId, cookie);
    assert.equal(up.statusCode, 200, up.body);
    assert.equal(await blobCount(), 1, "precondition: nothing stored");

    const admin = await collections.admins.insertOne({
      email: ADMIN_EMAIL,
      role: "admin",
      displayName: "QA Admin",
      passwordHash: await createPasswordHash("AdminPass1!"),
      createdAt: new Date().toISOString()
    });
    const adminCookie = await createSession(app, {
      id: String(admin.insertedId),
      role: "admin",
      email: ADMIN_EMAIL,
      displayName: "QA Admin"
    });

    const del = await call("DELETE", `/api/admin/etags/${tagId}`, adminCookie);
    assert.equal(del.statusCode, 200, del.body);

    assert.equal(
      await collections.vaultDocuments.countDocuments({ tagId }),
      0,
      "documents survived an admin deleting the E-Tag"
    );
    assert.equal(await blobCount(), 0, "the document's bytes are still in GridFS");

    const usage = await collections.vaultUsage.findOne({ _id: String(owner._id) });
    assert.equal(usage.bytes, 0, "the owner is still charged for a tag an admin deleted");
  });
});

describe("upgrading a tag moves the vehicle's documents, it does not lose them", () => {
  test("after a paid replacement the documents are on the NEW tag", async () => {
    const up = await upload(tagId, cookie, "RC front");
    assert.equal(up.statusCode, 200, up.body);
    const docId = JSON.parse(up.body).document.id;

    const order = {
      orderId: "order_cascade_m18",
      ownerId: owner._id,
      status: "created",
      replaceTagId: tagId,
      productId: "premium-tag",
      amount: 49900
    };
    await collections.shopOrders.insertOne({ ...order });

    const outcome = await fulfilPaidOrder(env, collections, {
      order,
      paymentId: "pay_cascade",
      log: { info() {}, warn() {}, error() {} }
    });

    assert.equal(outcome.replaced, true, "precondition: the replacement did not happen");
    const newTagId = outcome.newTagId;
    assert.ok(newTagId, "precondition: no replacement tag was minted");

    // The document still exists...
    assert.equal(
      await collections.vaultDocuments.countDocuments({ docId }),
      1,
      "the upgrade destroyed the owner's document"
    );
    // ...and it is filed under the tag the owner can actually reach.
    assert.equal(await collections.vaultDocuments.countDocuments({ tagId: newTagId }), 1);
    assert.equal(await collections.vaultDocuments.countDocuments({ tagId }), 0);
    assert.equal(await blobCount(), 1, "the document's bytes were lost in the move");

    // The owner-facing check: it is listed against the new vehicle.
    const listing = await call("GET", `/api/owner/vault/documents?tagId=${newTagId}`, cookie);
    assert.equal(listing.statusCode, 200, listing.body);
    const documents = JSON.parse(listing.body).documents;
    assert.equal(documents.length, 1, "the owner cannot see their document after upgrading");
    assert.equal(documents[0].label, "RC front");

    // And it still downloads.
    const file = await call("GET", `/api/owner/vault/documents/${docId}/file`, cookie);
    assert.equal(file.statusCode, 200, "the document no longer downloads after the upgrade");
  });

  test("the per-vehicle count follows the documents", async () => {
    // One document, because that is an E-Tag's whole allowance — and an E-Tag
    // is what this path requires: fulfilPaidOrder only mints a replacement for
    // a tag that is not already premium.
    const up = await upload(tagId, cookie);
    assert.equal(up.statusCode, 200, `precondition: the document did not upload — ${up.body}`);

    const order = {
      orderId: "order_cascade_counts",
      ownerId: owner._id,
      status: "created",
      replaceTagId: tagId,
      productId: "premium-tag",
      amount: 49900
    };
    await collections.shopOrders.insertOne({ ...order });
    const outcome = await fulfilPaidOrder(env, collections, {
      order,
      paymentId: "pay_counts",
      log: { info() {}, warn() {}, error() {} }
    });

    const usage = await collections.vaultUsage.findOne({ _id: String(owner._id) });
    assert.equal(usage.tags[tagId], 0, "the old tag still reserves vehicle slots");
    assert.equal(usage.tags[outcome.newTagId], 1, "the new tag did not inherit the slots");
  });
});

describe("reassignVaultDocuments", () => {
  test("moves documents and their per-vehicle counts", async () => {
    await upload(tagId, cookie);
    const target = new ObjectId();

    const { moved } = await reassignVaultDocuments(collections, owner._id, tagId, target);
    assert.equal(moved, 1);

    const usage = await collections.vaultUsage.findOne({ _id: String(owner._id) });
    assert.equal(usage.tags[tagId], 0);
    assert.equal(usage.tags[String(target)], 1);
    // The owner's total is unchanged — same owner, same documents.
    assert.ok(usage.bytes > 0, "the byte total should not change on a move");
  });

  test("is a no-op when the source and target are the same tag", async () => {
    await upload(tagId, cookie);
    const { moved } = await reassignVaultDocuments(collections, owner._id, tagId, tagId);
    assert.equal(moved, 0, "a self-move must not double-count");
    const usage = await collections.vaultUsage.findOne({ _id: String(owner._id) });
    assert.equal(usage.tags[tagId], 1);
  });

  test("is a no-op when there is nothing to move", async () => {
    const { moved } = await reassignVaultDocuments(collections, owner._id, new ObjectId(), new ObjectId());
    assert.equal(moved, 0);
  });

  test("does not touch another owner's documents", async () => {
    const other = await createTestOwner(collections, {
      email: assertUndeliverableIdentifier("qa-cascade-other@parktag-test.invalid")
    });
    const otherCookie = await ownerSession(other);
    const otherTag = await collections.tags.insertOne({
      ownerId: other._id,
      plateNumber: "QA01CD0009",
      status: "active",
      token: "qa-vault-cascade-0009",
      createdAt: new Date().toISOString()
    });
    await call("POST", "/api/owner/vault/pin", otherCookie, { payload: { pin: "8261" } });
    await upload(String(otherTag.insertedId), otherCookie);

    // Same tag id, wrong owner — must move nothing.
    const { moved } = await reassignVaultDocuments(
      collections,
      owner._id,
      String(otherTag.insertedId),
      new ObjectId()
    );
    assert.equal(moved, 0, "documents were moved out of another owner's vault");
    assert.equal(await collections.vaultDocuments.countDocuments({ ownerId: other._id }), 1);
  });
});

describe("wiping a field-demo sticker clears what the customer left behind", () => {
  test("the demo account's documents, bytes and counters all go", async () => {
    const demoOwner = await createTestOwner(collections, {
      email: assertUndeliverableIdentifier("qa-cascade-demo@parktag-test.invalid"),
      demoCreatedOwner: true
    });
    const demoCookie = await ownerSession(demoOwner);
    const demoTag = await collections.tags.insertOne({
      ownerId: demoOwner._id,
      demoOwnerId: demoOwner._id,
      marketingStock: true,
      plateNumber: "QA01DM0001",
      status: "active",
      token: "qa-vault-cascade-demo",
      createdAt: new Date().toISOString()
    });
    const demoTagId = String(demoTag.insertedId);
    await call("POST", "/api/owner/vault/pin", demoCookie, { payload: { pin: "3947" } });
    const up = await upload(demoTagId, demoCookie);
    assert.equal(up.statusCode, 200, `precondition: demo upload failed — ${up.body}`);

    const admin = await collections.admins.insertOne({
      email: "qa-cascade-demo-admin@parktag-test.invalid",
      role: "admin",
      displayName: "QA Admin",
      passwordHash: await createPasswordHash("AdminPass1!"),
      createdAt: new Date().toISOString()
    });
    const adminCookie = await createSession(app, {
      id: String(admin.insertedId),
      role: "admin",
      email: "qa-cascade-demo-admin@parktag-test.invalid",
      displayName: "QA Admin"
    });

    const wipeRes = await call("POST", `/api/admin/marketing/${demoTagId}/deactivate`, adminCookie);
    assert.equal(wipeRes.statusCode, 200, wipeRes.body);
    assert.equal(JSON.parse(wipeRes.body).removedAccount, true, "precondition: the demo account was kept");

    assert.equal(
      await collections.vaultDocuments.countDocuments({ ownerId: demoOwner._id }),
      0,
      "a wiped demo account's documents are still stored"
    );
    assert.equal(await blobCount(), 0, "a wiped demo account's document bytes are still in GridFS");
    assert.equal(
      await collections.vaultUsage.countDocuments({ _id: String(demoOwner._id) }),
      0,
      "a wiped demo account still has a storage counter"
    );
  });
});
