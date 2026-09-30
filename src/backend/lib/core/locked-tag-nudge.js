// A scanner has reached a tag whose free contacts are spent.
//
// An E-Tag locks after its free contacts (one, or two on door hanger stock),
// and that is the product working: the lock is the whole reason to buy the
// sticker. Locked means locked. No masked call, no WhatsApp alert and no
// Emergency call are placed through it.
//
// What was broken was what happened next, which was nothing. The owner was
// never told, so a driver blocked in behind their car waited for a call the
// owner did not know anybody had tried to make, and the owner had no reason to
// think the free tag had stopped doing anything.
//
// So a verified scan of a locked tag is now COUNTED, and the owner is TOLD.
//
// ── The scanner is told nothing about this ────────────────────────────────
//
// The scan page says the tag's free limit is used up, and stops there. It does
// not say the owner has been informed. That line would sometimes be false: the
// message is capped at one a day, a send can fail, and an owner may have no
// number on file. A page that promises an alert which did not go is worse than
// one that promises nothing, because the person reading it is standing at a
// car deciding whether to wait. So this runs on the server, from the verify
// route, with no button and no status on the page.
//
// ── What the owner's message leaves out ───────────────────────────────────
//
//   THE OWNER LEARNS THAT SOMEONE TRIED. NOT WHY, AND NOT HOW TO CALL BACK.
//
// A WhatsApp alert with the scanner's reason in it is precisely the free
// contact the tag no longer has. If this message carried the reason, a locked
// tag would work exactly as an unlocked one does, for ever, for nothing.
// Finding out what they wanted is what the Premium tag is for.
//
// ── One message a day ─────────────────────────────────────────────────────
//
// A car parked on a busy street is scanned by whoever walks past. Every attempt
// is COUNTED, because the count on the dashboard is the honest version of the
// pitch ("four people could not reach you"). Only the first in any 24 hours is
// SENT, because ParkTag has one WhatsApp number and it also carries login codes
// and real alerts: a message people learn to mute is a number that stops
// working for the things that matter.
//
// ── The wording, and the risk in it ───────────────────────────────────────
//
// It goes out on the approved owner alert, whose second variable is free text.
// That template is UTILITY and needs no marketing opt-in. The sentence in the
// variable is written to SELL the Premium tag (owner's decision, 30 Sep 2026):
// it names what is switched off and what upgrading gives back.
//
// It stops short of a price or a discount, and that line should hold. Meta
// does not review a variable at send time, but it does act on how recipients
// respond, and a utility template that draws blocks or reports can be paused.
// This one also carries every real owner alert. `parktag_upgrade_offer` is the
// template built for an outright offer; it is MARKETING and needs an opt-in a
// door hanger owner was never asked for. docs/WHATSAPP_TEMPLATES.md 2.8 has a
// dedicated template to submit, which is where stronger copy belongs.

import { callEntitlement, CALL_TIER_ETAG_USED } from "./call-access.js";
import { canSendUtility } from "./messaging-consent.js";
import { firstNameOf, resolveOwnerName } from "./owner-name.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappAlert } from "../integrations/meta.js";
import { sendOwnerAlertEmail } from "../integrations/email.js";

// How long after telling an owner before they are told again.
export const LOCKED_NUDGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// What fills {{2}} of the owner alert: "…scanned the ParkTag QR sticker on
// your vehicle and reported: {{2}}." No full stop, the template supplies it.
// No newline or tab either: Meta rejects both inside a variable.
//
// Read with the template around it: "Hello Girish, someone scanned the ParkTag
// QR sticker on your vehicle and reported: <this>. Please check your vehicle
// when you can."
export const LOCKED_NUDGE_REASON =
  "they tried to contact you and could not get through. " +
  "Your ParkTag's free contacts are finished, so calls, WhatsApp alerts and the emergency call are all switched off. " +
  "Upgrade to a Premium tag in the ParkTag app for unlimited private calls and alerts for a full year, " +
  "and never miss someone at your vehicle again";

/**
 * Is this an E-Tag that has used up its free contacts?
 *
 * Only that. A premium tag whose year has lapsed is also blocked, but it is a
 * different conversation (a renewal, not a first purchase) with its own panel
 * on the scan page, and it is deliberately not swept in here.
 */
export function isLockedEtag(tag, now = Date.now()) {
  return callEntitlement(tag, now).tier === CALL_TIER_ETAG_USED;
}

// Both channels, like every other owner alert: an owner who signed up with an
// e-mail and no number must not be the one person never told. Each attempt
// absorbs its own failure and reports a boolean.
async function sendNudge(env, collections, tag, log) {
  const owner = tag.ownerId ? await collections.owners.findOne({ _id: tag.ownerId }) : null;
  if (!owner || !canSendUtility(owner)) return false;

  // Never the raw displayName: the OTP signup path used to store the phone
  // number in it. See resolveOwnerName.
  const ownerName = firstNameOf(resolveOwnerName(owner)) || "there";
  const mobile = owner.phone || owner.mobile;
  const attempts = [];

  if (mobile && isMetaWhatsappConfigured(env)) {
    attempts.push(
      sendMetaWhatsappAlert(env, { to: mobile, ownerName, reason: LOCKED_NUDGE_REASON, tagId: String(tag._id) })
        .then(() => true)
        .catch((err) => {
          log?.warn?.({ err, event: "locked-nudge-whatsapp-failed", tagId: String(tag._id) }, "[locked tag] WhatsApp not sent");
          return false;
        })
    );
  }

  if (owner.email) {
    attempts.push(
      sendOwnerAlertEmail(env, {
        to: owner.email,
        ownerName,
        reason: LOCKED_NUDGE_REASON,
        plateNumber: tag.plateNumber || null,
        tagId: String(tag._id)
      })
        .then(() => true)
        .catch((err) => {
          log?.warn?.({ err, event: "locked-nudge-email-failed", tagId: String(tag._id) }, "[locked tag] e-mail not sent");
          return false;
        })
    );
  }

  return (await Promise.all(attempts)).some(Boolean);
}

/**
 * Count a blocked attempt on a locked tag and, at most once a day, tell the
 * owner. Called from the verify route when a scanner has read the plate off a
 * locked tag. The status is for logs and tests; it is never shown to the
 * scanner. Returns `{ status }`:
 *
 *   "sent"         the owner has just been told
 *   "already"      they were told inside the last 24 hours; counted, not sent
 *   "unavailable"  nobody could be reached (no channel, a hard stop, a
 *                  provider outage); counted, and the next attempt may try
 *
 * The send is CLAIMED before it is made: a conditional update stamps
 * `lockedNudgeAt` only if it is absent or older than the interval, and only
 * the caller whose update matched goes on to send. Two scanners arriving
 * together therefore produce one message. If that message then cannot be
 * delivered the stamp is put back, so an outage does not silence the tag for
 * a day.
 *
 * `send` is the delivery, passed in so the claim, the cap and the release can
 * be tested without a provider. Nothing in the app overrides it.
 */
export async function recordLockedAttempt(env, collections, tag, log, { now = Date.now(), send = sendNudge } = {}) {
  const at = new Date(now).toISOString();

  await collections.tags.updateOne(
    { _id: tag._id },
    { $inc: { blockedAttempts: 1 }, $set: { lastBlockedAt: at } }
  );

  const cutoff = new Date(now - LOCKED_NUDGE_INTERVAL_MS).toISOString();
  const claimed = await collections.tags.updateOne(
    // `null` matches a stamp that is absent as well as one that is null. ISO
    // timestamps compare in date order as strings.
    { _id: tag._id, $or: [{ lockedNudgeAt: null }, { lockedNudgeAt: { $lte: cutoff } }] },
    { $set: { lockedNudgeAt: at } }
  );
  if (claimed.modifiedCount !== 1) return { status: "already" };

  let reached = false;
  try {
    reached = await send(env, collections, tag, log);
  } catch (err) {
    log?.error?.({ err, tagId: String(tag._id) }, "[locked tag] nudge failed");
  }

  if (!reached) {
    // Only our own stamp: a concurrent winner's must not be undone.
    await collections.tags.updateOne(
      { _id: tag._id, lockedNudgeAt: at },
      { $set: { lockedNudgeAt: tag.lockedNudgeAt || null } }
    );
    return { status: "unavailable" };
  }

  log?.info?.({ event: "locked-tag-owner-told", tagId: String(tag._id) }, "[locked tag] owner told a scanner could not reach them");
  return { status: "sent" };
}
