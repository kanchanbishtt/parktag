// The person behind an owner's backup number is told, once, and can say no.
//
// A backup number is saved without a code (owner's rule, 2026-10-05), so the
// person it belongs to never agreed to anything, and a mistyped digit sends a
// stranger's missed calls to somebody else with nobody noticing. So when an
// owner saves a number, that number gets one WhatsApp message (template
// `parktag_backup_contact_v1`, docs/WHATSAPP_TEMPLATES.md 2.12): who added
// them, what it means, and a "Remove my number" button. The button opens
// /backup/<token>; confirming there takes the number off the owner and stops
// that owner adding it again.
//
// Fields on the owner document:
//   backupNotice           { mobile, tokenHash, at, whatsapp }  the latest notice
//   backupNoticesAt        [at, ...]  the last few notices, for the daily cap
//   backupDeclinedMobiles  [E.164, ...]  numbers that said no; refused on save
//   backupDeclined         { mobile, at }  shown on the dashboard until the
//                          owner saves another number
//
// Only a hash of the token is stored, so a database read cannot be turned
// into working "remove" links.

import crypto from "node:crypto";

import { firstNameOf, resolveOwnerName } from "./owner-name.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappBackupContact } from "../integrations/meta.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Each notice is a message to somebody who never asked for one, so an owner
// flipping between numbers cannot turn this into a way to message people.
// Past the cap the number is still saved; it just goes untold.
export const BACKUP_NOTICES_PER_DAY = 5;

export function hashBackupToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Tell `mobile` that this owner has made it their backup. Run after the save,
 * never awaited by the route (a provider send can take seconds). Resolves to
 * `{ status }`; `token` comes back too when a notice was written, for tests.
 *
 *   "stale"         the owner's backup is no longer this number
 *   "already-told"  this number has had its notice already
 *   "capped"        too many notices from this owner today; nothing written
 *   "sent"          the message went
 *   "not-sent"      the notice is written but WhatsApp did not deliver it
 *                   (not configured, template not yet approved, provider error)
 */
export async function notifyBackupContact(env, collections, { ownerId, mobile, log = null, send = sendMetaWhatsappBackupContact, now = Date.now() }) {
  const owner = await collections.owners.findOne({ _id: ownerId });
  if (!owner || owner.backupMobile !== mobile) return { status: "stale" };
  if (owner.backupNotice?.mobile === mobile) return { status: "already-told" };

  const recent = (owner.backupNoticesAt || []).filter((at) => new Date(at).getTime() > now - DAY_MS);
  if (recent.length >= BACKUP_NOTICES_PER_DAY) {
    log?.warn?.({ event: "backup-notice-capped", ownerId: String(ownerId) }, "[backup] notice skipped: daily cap");
    return { status: "capped" };
  }

  const token = crypto.randomBytes(16).toString("hex");
  const tokenHash = hashBackupToken(token);
  const at = new Date(now).toISOString();

  // Conditional, so two saves racing each other cannot both send.
  const claimed = await collections.owners.updateOne(
    { _id: ownerId, backupMobile: mobile, "backupNotice.mobile": { $ne: mobile } },
    {
      $set: { backupNotice: { mobile, tokenHash, at } },
      $push: { backupNoticesAt: { $each: [at], $slice: -BACKUP_NOTICES_PER_DAY } }
    }
  );
  if (!claimed.modifiedCount) return { status: "already-told" };

  let whatsapp = "not-sent";
  if (isMetaWhatsappConfigured(env)) {
    try {
      // Never the raw displayName: the OTP signup path used to store the phone
      // number in it. See resolveOwnerName.
      await send(env, { to: mobile, ownerName: firstNameOf(resolveOwnerName(owner)) || "a ParkTag user", token });
      whatsapp = "sent";
    } catch (err) {
      log?.warn?.({ err, event: "backup-notice-whatsapp-failed", ownerId: String(ownerId) }, "[backup] WhatsApp not sent");
    }
  }

  await collections.owners.updateOne(
    { _id: ownerId, "backupNotice.tokenHash": tokenHash },
    { $set: { "backupNotice.whatsapp": whatsapp } }
  );
  return { status: whatsapp, token };
}

/**
 * The backup person tapped "Remove my number" and confirmed. Resolves to
 * `{ status }`: "removed", or "invalid" for a token that is unknown or has
 * been used already.
 */
export async function declineBackupContact(collections, token, { now = Date.now() } = {}) {
  if (typeof token !== "string" || !/^[a-f0-9]{32}$/.test(token)) return { status: "invalid" };
  const tokenHash = hashBackupToken(token);

  const owner = await collections.owners.findOne({ "backupNotice.tokenHash": tokenHash }, { projection: { backupNotice: 1 } });
  if (!owner) return { status: "invalid" };
  const { mobile } = owner.backupNotice;
  const at = new Date(now).toISOString();

  // Off the calling route, but only if it is still this number: the owner may
  // have changed it since the message went.
  await collections.owners.updateOne(
    { _id: owner._id, backupMobile: mobile },
    { $unset: { backupMobile: "" }, $set: { backupMobileUpdatedAt: at, backupDeclined: { mobile, at } } }
  );
  await collections.owners.updateOne(
    { _id: owner._id, "backupNotice.tokenHash": tokenHash },
    { $unset: { backupNotice: "" }, $addToSet: { backupDeclinedMobiles: mobile } }
  );
  return { status: "removed" };
}
