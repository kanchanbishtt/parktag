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

export function isAllowedMime(mime) {
  return ALLOWED_MIME.has(String(mime || "").toLowerCase());
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

export function pinRequirementMessage() {
  return `PIN must be ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`;
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

// Opaque per-document id used in URLs. The GridFS _id is never exposed: it is
// the storage key, and keeping it server-side means a leaked URL cannot be
// turned into a direct bucket reference.
export function newDocumentId() {
  return crypto.randomBytes(16).toString("hex");
}
