// ── Private document vault ─────────────────────────────────────────────────
//
// Owners keep soft copies of their vehicle paperwork here — RC, insurance, PUC,
// driving licence — so they are reachable at a police stop or after an accident
// without digging through the glovebox.
//
// OWNER-ONLY, deliberately. Nothing in this module is reachable from a tag
// scan: every route that uses it sits behind an owner session AND a re-entered
// PIN. Someone who scans a parked car's QR gets the existing masked-contact
// flow and no hint that documents exist at all. That is the whole security
// model — a scannable document store would turn a parking tag into a way to
// harvest identity documents off any car in a car park.
//
// The PIN is a SECOND factor over the login session, not a password: the threat
// it answers is an unlocked, unattended phone that is already signed in. It is
// short by design, so the brute-force defence is the lockout below rather than
// the digit count.

import crypto from "node:crypto";
import { Transform } from "node:stream";

import { createPasswordHash, verifyPassword } from "../auth/security.js";
import {
  getLoginLock,
  recordLoginFailure,
  clearLoginFailures
} from "../auth/login-lockout.js";

// Reuses the per-account lockout that already guards sign-in, keyed under its
// own "vault" role so vault guesses and login guesses never share a counter —
// failing your PIN must not lock you out of the app itself, and vice versa.
const LOCKOUT_ROLE = "vault";

// How long one PIN entry keeps the vault open. Long enough to upload a few
// documents or show a policeman two of them, short enough that a phone left on
// a table re-locks on its own.
const GRANT_TTL_MS = 15 * 60 * 1000;

const PIN_MIN_DIGITS = 4;
const PIN_MAX_DIGITS = 8;

// Storage ceilings. These are not arbitrary: the files live in GridFS, i.e. in
// the same Atlas cluster as everything else, where storage is tier-capped and
// far dearer per GB than object storage. A phone photo of an RC is 2-5MB, so
// without a ceiling a few hundred owners would fill the cluster and take the
// whole app down with them. Revisit these if the vault ever moves to S3/R2.
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB per document
export const MAX_DOCS_PER_VEHICLE = 6;
export const MAX_BYTES_PER_OWNER = 40 * 1024 * 1024; // 40MB across all vehicles

// Allowlist, not a blocklist. SVG is excluded on purpose despite being an
// image: it can carry script, and these files are served back from our own
// origin, where that would run as us.
const ALLOWED_MIME = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export const DOC_TYPES = ["rc", "insurance", "puc", "licence", "other"];

// Card previews on the documents page come from a small thumbnail the browser
// renders at upload time, NOT from the document itself. Six full-size photos is
// up to 30MB of image to paint a single list — unusable on mobile data — and
// generating thumbnails server-side would mean pulling in an image library.
// A canvas-scaled JPEG is a few KB, so the whole page costs less than one photo.
//
// It is client-supplied and therefore untrusted: it is capped hard, must be a
// JPEG data URI, and is only ever rendered as an <img>. The real document is
// stored and served separately, so a junk thumbnail costs a wrong picture on a
// card and nothing else.
const MAX_THUMB_CHARS = 40 * 1024;
const THUMB_PREFIX = "data:image/jpeg;base64,";

export function cleanThumbnail(raw) {
  const value = String(raw || "");
  if (!value.startsWith(THUMB_PREFIX)) return null;
  if (value.length > MAX_THUMB_CHARS) return null;
  const body = value.slice(THUMB_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  return value;
}

export function isAllowedMime(mime) {
  return ALLOWED_MIME.has(String(mime || "").toLowerCase());
}

// ── Content sniffing ───────────────────────────────────────────────────────
//
// isAllowedMime() checks the mimetype @fastify/multipart reports, which is
// simply the Content-Type header the CLIENT wrote into the multipart part. It
// is not evidence of anything. A security pass demonstrated both halves of the
// gap: an HTML page carrying a <script> stored as "image/png" and served back
// inline from our own origin, and a Windows PE executable stored as
// "application/pdf" and handed back to the owner as a .pdf attachment.
//
// Neither is currently a live XSS — the file route is served with
// X-Content-Type-Options: nosniff and under the app's CSP, so a browser will
// not render those bytes as HTML. That is one header away from being wrong,
// and it does nothing about the vault being usable as arbitrary file storage on
// our own origin, or about an owner opening a "PDF" that is an executable.
//
// So the declared type must now be corroborated by the bytes. This is an
// allowlist of container signatures, checked against the head of the stream.
const SNIFF_BYTES = 1024;

function looksLikePdf(head) {
  // Not necessarily at offset 0: the PDF spec tolerates leading bytes before
  // the header, and real scanners emit them. Adobe's own rule is "within the
  // first 1024 bytes", which is exactly the window we buffer.
  return head.includes("%PDF-", 0, "latin1");
}

function startsWith(head, bytes) {
  if (head.length < bytes.length) return false;
  return bytes.every((b, i) => head[i] === b);
}

// Returns true when `head` (the first SNIFF_BYTES of the upload, or the whole
// file if it is shorter) is consistent with the declared type.
export function contentMatchesMime(head, mime) {
  const buf = Buffer.isBuffer(head) ? head : Buffer.from(head || []);
  if (!buf.length) return false;

  switch (String(mime || "").toLowerCase()) {
    case "application/pdf":
      return looksLikePdf(buf);
    case "image/png":
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case "image/webp":
      // "RIFF" ....(4-byte length).... "WEBP"
      return (
        buf.length >= 12 &&
        buf.toString("latin1", 0, 4) === "RIFF" &&
        buf.toString("latin1", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}

// A pass-through that inspects the head of the stream and records the verdict
// on `.matches`, WITHOUT ever erroring.
//
// Deliberately not a stream error: destroying the upload mid-flight leaves the
// multipart parser with an unconsumed request body, which is how an upload
// turns into a hung connection. The route lets the bytes land and then deletes
// them, exactly as it already does for a file that overran the size cap. The
// waste is bounded by that same cap.
export function createMimeSniffer(mime) {
  const chunks = [];
  let length = 0;
  let settled = false;

  const sniffer = new Transform({
    transform(chunk, _encoding, callback) {
      if (!settled) {
        chunks.push(chunk);
        length += chunk.length;
        if (length >= SNIFF_BYTES) settle();
      }
      callback(null, chunk);
    },
    flush(callback) {
      // Reached for a file shorter than the sniff window — including an empty
      // one, which settles to a mismatch and is refused.
      if (!settled) settle();
      callback();
    }
  });

  function settle() {
    settled = true;
    // Trimmed to exactly SNIFF_BYTES. A single chunk can be far larger than the
    // window — a small file arrives whole in one — and without this the search
    // area would be however much happened to be delivered at once, so the same
    // file could pass or fail depending on how it was chunked over the wire.
    const head = Buffer.concat(chunks, length).subarray(0, SNIFF_BYTES);
    sniffer.matches = contentMatchesMime(head, mime);
    chunks.length = 0; // release the buffered head
  }

  sniffer.matches = false;
  return sniffer;
}

export function extensionForMime(mime) {
  return ALLOWED_MIME.get(String(mime || "").toLowerCase()) || "bin";
}

// Images can be shown inline in the sheet; PDFs cannot, because the app's CSP
// has no `frame-src 'self'` and so will not render one in an iframe. Callers
// use this to decide between previewing and downloading rather than serving a
// PDF into a frame that the browser will refuse to paint.
export function isInlineViewable(mime) {
  return String(mime || "").toLowerCase().startsWith("image/");
}

export function isValidDocType(value) {
  return DOC_TYPES.includes(String(value || "").toLowerCase());
}

// Free-text label the owner types ("RC front", "Insurance 2026"). Kept short
// and stripped of control characters; it is rendered escaped on the client, so
// this is about storing something sane rather than about output safety.
export function cleanLabel(raw, fallback) {
  const text = Array.from(String(raw == null ? "" : raw))
    // Drop C0/C1 control characters rather than pattern-matching them, so this
    // file stays free of raw control bytes in its own source.
    .map((ch) => (ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return text || fallback;
}

// ── PIN ────────────────────────────────────────────────────────────────────

export function isValidPin(pin) {
  return new RegExp(`^\\d{${PIN_MIN_DIGITS},${PIN_MAX_DIGITS}}$`).test(String(pin || ""));
}

// The handful of PINs that a guesser tries first. With a 4-digit minimum the
// lockout is what bounds brute force, and it does its job — but it bounds an
// attacker who has to guess. It does nothing about "0000", which is not really
// a guess. Rejecting repeated digits and runs costs the owner nothing and
// removes the small set of values that a shoulder-surfer or an opportunist
// with the unlocked phone would try inside the ten attempts they are allowed.
//
// Applied only when SETTING a PIN. Verification is untouched, so an owner who
// already has a weak PIN keeps signing in with it and is not locked out by a
// deploy — they are simply held to this the next time they change it.
// A run in ONE direction: 1234 or 4321, not 1213. Every step must match the
// first step, rather than merely being +/-1 — otherwise 4543 and 2321 are
// refused too, and the owner is told to avoid "runs like 1234" about a PIN that
// is not one. Rejecting more than the message explains is its own kind of bug.
function isSequentialPin(digits) {
  const direction = Number(digits[1]) - Number(digits[0]);
  if (direction !== 1 && direction !== -1) return false;
  for (let i = 2; i < digits.length; i += 1) {
    if (Number(digits[i]) - Number(digits[i - 1]) !== direction) return false;
  }
  return true;
}

export function isWeakPin(pin) {
  const digits = String(pin || "");
  if (!isValidPin(digits)) return false; // shape is isValidPin's business
  if (/^(\d)\1*$/.test(digits)) return true; // 0000, 1111, 999999
  if (isSequentialPin(digits)) return true; // 1234, 4321, 3456
  return false;
}

export function pinRequirementMessage() {
  return `PIN must be ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`;
}

export function weakPinMessage() {
  return "Choose a less predictable PIN — avoid repeated digits like 1111 or runs like 1234.";
}

export async function hasVaultPin(collections, ownerId) {
  const owner = await collections.owners.findOne(
    { _id: ownerId },
    { projection: { vaultPinHash: 1 } }
  );
  return Boolean(owner && owner.vaultPinHash);
}

export async function setVaultPin(collections, ownerId, pin) {
  const vaultPinHash = await createPasswordHash(String(pin));
  await collections.owners.updateOne(
    { _id: ownerId },
    { $set: { vaultPinHash, vaultPinSetAt: new Date().toISOString() } }
  );
  // A freshly set PIN clears any standing lockout — the owner has just proven
  // control of the account through whichever path let them change it.
  await clearLoginFailures(collections, LOCKOUT_ROLE, String(ownerId));
}

// Returns { ok } on success, or { ok: false, locked, retryAfterSeconds } so the
// caller can tell "wrong PIN" apart from "stop trying for a while".
export async function verifyVaultPin(collections, ownerId, pin) {
  const key = String(ownerId);

  const lock = await getLoginLock(collections, LOCKOUT_ROLE, key);
  if (lock.locked) {
    return { ok: false, locked: true, retryAfterSeconds: lock.retryAfterSeconds };
  }

  const owner = await collections.owners.findOne(
    { _id: ownerId },
    { projection: { vaultPinHash: 1 } }
  );
  if (!owner || !owner.vaultPinHash) {
    return { ok: false, locked: false, noPin: true };
  }

  // verifyPassword returns { valid, needsUpgrade }, NOT a boolean — destructure
  // it. Testing the object itself is always truthy and would accept any PIN.
  const { valid } = await verifyPassword(String(pin || ""), owner.vaultPinHash);
  if (!valid) {
    await recordLoginFailure(collections, LOCKOUT_ROLE, key);
    return { ok: false, locked: false };
  }

  await clearLoginFailures(collections, LOCKOUT_ROLE, key);
  return { ok: true };
}

// ── Unlock grants ──────────────────────────────────────────────────────────
//
// Keyed by session id, so a grant cannot be lifted from one browser and
// replayed in another: it is only usable by a request that already carries the
// session cookie it was issued to. ownerId is stored alongside and re-checked
// on read, so a recycled session id can never inherit someone else's unlock.

export async function grantVaultAccess(collections, sessionId, ownerId) {
  const expiresAt = new Date(Date.now() + GRANT_TTL_MS);
  await collections.vaultGrants.updateOne(
    { _id: sessionId },
    {
      $set: {
        _id: sessionId,
        ownerId: String(ownerId),
        expiresAt,
        grantedAt: new Date()
      }
    },
    { upsert: true }
  );
  return expiresAt;
}

export async function readVaultGrant(collections, sessionId, ownerId) {
  if (!sessionId) return null;
  const doc = await collections.vaultGrants.findOne({ _id: sessionId });
  if (!doc) return null;
  // The TTL monitor only sweeps about once a minute, so an expired grant can
  // still be sitting in the collection. Check the clock rather than trusting
  // that the sweep has already run.
  if (!doc.expiresAt || doc.expiresAt.getTime() <= Date.now()) return null;
  if (String(doc.ownerId) !== String(ownerId)) return null;
  return doc;
}

export async function revokeVaultAccess(collections, sessionId) {
  if (!sessionId) return;
  await collections.vaultGrants.deleteOne({ _id: sessionId });
}

// ── Quota ──────────────────────────────────────────────────────────────────

// Checked BEFORE a file is streamed into GridFS, using the declared size, and
// again after the write against the real byte count — a multipart client can
// declare anything, so the pre-check is only there to reject the obvious case
// cheaply.
export async function checkQuota(collections, ownerId, tagId) {
  const [vehicleCount, totals] = await Promise.all([
    collections.vaultDocuments.countDocuments({ ownerId, tagId }),
    collections.vaultDocuments
      .aggregate([
        { $match: { ownerId } },
        { $group: { _id: null, bytes: { $sum: "$size" } } }
      ])
      .toArray()
  ]);

  const usedBytes = (totals[0] && totals[0].bytes) || 0;

  if (vehicleCount >= MAX_DOCS_PER_VEHICLE) {
    return {
      ok: false,
      error: `You can keep up to ${MAX_DOCS_PER_VEHICLE} documents per vehicle. Delete one to add another.`
    };
  }
  if (usedBytes >= MAX_BYTES_PER_OWNER) {
    return {
      ok: false,
      error: "You've used all your document storage. Delete a document to free up space."
    };
  }
  return { ok: true, usedBytes, vehicleCount };
}

// ── Storage reservation ────────────────────────────────────────────────────
//
// checkQuota() above reads counts and totals, and the route then writes. That
// is a check-then-write with nothing in between, and under a burst it simply
// does not hold: a security pass sent 12 concurrent uploads at a 6-per-vehicle
// cap and stored 12, and 15 concurrent 4MB uploads at a 40MB per-owner cap and
// stored 60MB. Every request read the same pre-write state, and every request
// was genuinely under the limit at the moment it looked. The rate limiter does
// not save it either — 20 uploads per 5 minutes is 100MB against a 40MB cap
// even served strictly one at a time.
//
// Re-counting after the insert does not fix this. Whichever way it is phrased,
// a count can miss a concurrent insert that has not landed yet, so it can still
// admit more than the cap allows.
//
// What does hold is a single-document conditional update. MongoDB applies one
// update to one document atomically, so making the LIMIT part of the update's
// filter means the increment happens if and only if there is room, with no gap
// for a second request to slip through. `vault_usage` holds one row per owner —
// total bytes, plus a document count per vehicle — and every upload has to win
// that update before its record is written.
//
// Bookkeeping is `$inc` in both directions and never a recomputation, because
// increments commute: two concurrent uploads and a concurrent delete land in
// any order and still arrive at the same total. A recompute racing an insert
// would lose it.
function usageKey(ownerId) {
  return String(ownerId);
}

// A vehicle's count lives at `tags.<tagId>`. tagId is the 24-character hex of
// an ObjectId, so it is always a legal field name — no dots, never a leading $.
function tagCountField(tagId) {
  return `tags.${String(tagId)}`;
}

// Owners who already had documents before this collection existed have no row.
// Seed it from what they actually hold rather than from zero, or their first
// upload after the deploy would start counting from an empty vault. Racing
// callers are harmless: $setOnInsert means only the first insert applies, and
// both compute the same pre-existing truth.
//
// This is also the RECOVERY path, and the reason there is no reconciliation on
// the request path. Documents removed out of band — a manual cleanup, a
// migration, anything that does not go through releaseStorage — leave the
// counter reading high, and the owner quietly loses storage they are entitled
// to. The repair is to delete that owner's `vault_usage` row: the next upload
// finds it missing and rebuilds it from the documents that actually exist.
// Recomputing automatically when a reservation is refused would be the obvious
// alternative and is a worse one — refusal is exactly the state an attacker can
// drive on demand, and it would hand them a recount to race.
async function ensureUsageRow(collections, ownerId) {
  const key = usageKey(ownerId);
  const existing = await collections.vaultUsage.findOne(
    { _id: key },
    { projection: { _id: 1 } }
  );
  if (existing) return;

  const docs = await collections.vaultDocuments
    .find({ ownerId }, { projection: { tagId: 1, size: 1 } })
    .toArray();

  const tags = {};
  let bytes = 0;
  for (const doc of docs) {
    bytes += doc.size || 0;
    const tagId = String(doc.tagId);
    tags[tagId] = (tags[tagId] || 0) + 1;
  }

  await collections.vaultUsage.updateOne(
    { _id: key },
    { $setOnInsert: { bytes, tags } },
    { upsert: true }
  );
}

// Claim room for one document of `size` bytes against `tagId`. Returns
// { ok: true } only if the reservation was actually taken.
export async function reserveStorage(collections, ownerId, tagId, size) {
  await ensureUsageRow(collections, ownerId);

  const field = tagCountField(tagId);
  const result = await collections.vaultUsage.updateOne(
    {
      _id: usageKey(ownerId),
      // A file larger than the whole allowance makes this bound negative, which
      // no non-negative total can satisfy — so it is refused, as it should be.
      bytes: { $lte: MAX_BYTES_PER_OWNER - size },
      // $not also matches a MISSING field, which is what the first document for
      // a vehicle looks like. A bare $lt would not match it and would reject
      // every owner's very first upload.
      [field]: { $not: { $gte: MAX_DOCS_PER_VEHICLE } }
    },
    { $inc: { bytes: size, [field]: 1 } }
  );

  if (result.matchedCount === 1) return { ok: true };

  // Refused. Read the row back only to say WHICH limit was hit — the decision
  // itself was already made, atomically, above.
  const row = await collections.vaultUsage.findOne({ _id: usageKey(ownerId) });
  const vehicleCount = (row && row.tags && row.tags[String(tagId)]) || 0;

  if (vehicleCount >= MAX_DOCS_PER_VEHICLE) {
    return {
      ok: false,
      error: `You can keep up to ${MAX_DOCS_PER_VEHICLE} documents per vehicle. Delete one to add another.`
    };
  }
  return {
    ok: false,
    error: "You've used all your document storage. Delete a document to free up space."
  };
}

// Hand storage back. Used when an upload is rolled back after reserving, and
// whenever documents are deleted — one at a time, or in a cascade.
export async function releaseStorage(collections, ownerId, entries) {
  const released = Array.isArray(entries) ? entries : [entries];
  if (!released.length) return;

  const inc = { bytes: 0 };
  for (const entry of released) {
    if (!entry) continue;
    inc.bytes -= entry.size || 0;
    // A record with no tagId should still give its bytes back rather than
    // decrementing a `tags.undefined` field into existence.
    if (entry.tagId === null || entry.tagId === undefined) continue;
    const field = tagCountField(entry.tagId);
    inc[field] = (inc[field] || 0) - 1;
  }

  if (!inc.bytes && Object.keys(inc).length === 1) return;

  await collections.vaultUsage
    .updateOne({ _id: usageKey(ownerId) }, { $inc: inc })
    .catch(() => {
      // Bookkeeping must never turn a successful delete into an error. A lost
      // decrement leaves the owner's counter reading HIGH, which costs them
      // storage they are entitled to but can never let them exceed the cap.
    });
}

// The whole owner is going away — drop their counter with them.
export async function deleteUsage(collections, ownerId) {
  await collections.vaultUsage.deleteOne({ _id: usageKey(ownerId) }).catch(() => {});
}

// Move a vehicle's documents onto a different tag.
//
// NOT every tag that goes away is a vehicle going away, and telling the two
// apart is the whole point of this function. When an owner buys a premium tag
// to replace a free-trial one (M18), the OLD tag is soft-deleted and a NEW tag
// is minted for the SAME car. Purging there would be exactly wrong: the owner
// still has the vehicle, still has the paperwork, and has just paid for the
// upgrade.
//
// Before this existed the documents stayed pinned to the dead tag, which
// ownedTag() refuses — so an owner's RC became unreachable at the moment they
// bought something. Silent data loss, triggered by a purchase.
//
// The owner's byte total does not change: the same owner holds the same
// documents. Only the per-vehicle counts move.
export async function reassignVaultDocuments(collections, ownerId, fromTagId, toTagId) {
  const from = String(fromTagId || "");
  const to = String(toTagId || "");
  if (!from || !to || from === to) return { moved: 0 };

  const result = await collections.vaultDocuments.updateMany(
    { ownerId, tagId: from },
    { $set: { tagId: to } }
  );

  const moved = result.modifiedCount || 0;
  if (!moved) return { moved: 0 };

  await collections.vaultUsage
    .updateOne(
      { _id: usageKey(ownerId) },
      { $inc: { [tagCountField(from)]: -moved, [tagCountField(to)]: moved } }
    )
    .catch(() => {
      // The documents have moved and are reachable, which is the part that
      // matters. A stale count reads high against the OLD tag, which no longer
      // exists — so it can only ever cost an upload slot on a vehicle the owner
      // can no longer reach anyway.
    });

  return { moved };
}

// Opaque per-document id used in URLs. The GridFS _id is never exposed: it is
// the storage key, and keeping it server-side means a leaked URL cannot be
// turned into a direct bucket reference.
export function newDocumentId() {
  return crypto.randomBytes(16).toString("hex");
}

// ── Cascading deletion ─────────────────────────────────────────────────────
//
// A vault document is created by the upload route and used to be removed ONLY
// by the per-document delete route. Nothing else in the app knew these records
// existed, so the two deletions that should have taken them with them did not:
//
//   • Deleting a VEHICLE soft-deletes its tag. ownedTag() then refuses the tag,
//     so the owner could no longer list or delete the documents filed under it
//     — but the rows and the GridFS bytes stayed, unreachable and permanent,
//     still counted against the owner's storage quota.
//   • Deleting an ACCOUNT wiped tags, contact requests, orders, addresses and
//     pending calls, and left the vault untouched. An RC, a driving licence and
//     an insurance policy therefore SURVIVED the account they belonged to, with
//     no sweeper anywhere to collect them. For an erasure request under the
//     DPDP Act that is precisely the data that must not be retained.
//
// Both paths now come through here. Metadata is removed FIRST, for the same
// reason the single-document route does it in that order: if the bucket delete
// then fails, what is left behind is an orphaned blob to sweep rather than a
// listed document whose bytes have already vanished.
//
// `bucket` may be null when document storage is unreachable. The metadata is
// still removed in that case — the alternative is refusing to delete an account
// because a blob store is down — and the blobs are reported as orphaned so the
// caller can log it.
export async function purgeVaultDocuments(collections, bucket, filter) {
  const docs = await collections.vaultDocuments
    .find(filter, { projection: { _id: 1, fileId: 1, ownerId: 1, tagId: 1, size: 1 } })
    .toArray();

  if (!docs.length) return { documents: 0, blobs: 0, orphanedBlobs: 0 };

  await collections.vaultDocuments.deleteMany({ _id: { $in: docs.map((d) => d._id) } });

  // Return the reserved storage. Grouped by owner because a cascade may span
  // several vehicles, and (in principle) the filter is not required to be
  // owner-scoped.
  const byOwner = new Map();
  for (const doc of docs) {
    const key = String(doc.ownerId);
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push({ tagId: doc.tagId, size: doc.size });
  }
  for (const [ownerId, entries] of byOwner) {
    await releaseStorage(collections, ownerId, entries);
  }

  let blobs = 0;
  let orphanedBlobs = 0;

  for (const doc of docs) {
    if (!doc.fileId) continue;
    if (!bucket) {
      orphanedBlobs += 1;
      continue;
    }
    try {
      await bucket.delete(doc.fileId);
      blobs += 1;
    } catch {
      // Already gone, or the bucket refused it. Either way the metadata row is
      // deleted, so this is a blob to sweep rather than a failed deletion.
      orphanedBlobs += 1;
    }
  }

  return { documents: docs.length, blobs, orphanedBlobs };
}
