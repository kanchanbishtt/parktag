// The owner is told, once, at the moment an E-Tag's free trial ends.
//
// An E-Tag locks when its last free contact is spent: the first on an ordinary
// E-Tag, the second on door hanger stock. Until now the owner learned of it
// only when a later scanner was turned away (locked-tag-nudge.js), which could
// be days on, and from a message about somebody else's failed attempt. This is
// the plain statement at the time it happens: the trial is over, and calls,
// alerts and the emergency call through this tag are switched off.
//
// WhatsApp only, on `parktag_free_trial_ended` (docs/WHATSAPP_TEMPLATES.md
// 2.9). There is no older template to borrow while it waits for approval: the
// owner alert's wording is "someone ... reported", which this is not. So until
// Meta approves it nothing is sent, exactly as before, and it switches itself
// on at approval with no deploy.
//
// ── Once per tag ──────────────────────────────────────────────────────────
//
// Called after a call connects and spends the tag's free allowance (the only
// thing that ever spends it — see call-access.js). It is the conditional
// update below that decides: `trialEndedNotice` is stamped only on a tag that
// is now locked and has none yet.
//
// The stamp stays whether or not the message went, and records which:
// `{ at, whatsapp: "sent" | "not-sent" }`. A locked tag spends nothing more,
// so there is no later moment to try again, and support can see on the tag
// whether its owner was told (the same reason emergency-alert.js records its
// outcome on the row).

import { canSendUtility } from "./messaging-consent.js";
import { firstNameOf, resolveOwnerName } from "./owner-name.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappFreeTrialEnded } from "../integrations/meta.js";

async function sendNotice(env, collections, tag, log) {
  const owner = tag.ownerId ? await collections.owners.findOne({ _id: tag.ownerId }) : null;
  if (!owner || !canSendUtility(owner)) return false;

  const mobile = owner.phone || owner.mobile;
  if (!mobile || !tag.plateNumber || !isMetaWhatsappConfigured(env)) return false;

  try {
    await sendMetaWhatsappFreeTrialEnded(env, {
      to: mobile,
      // Never the raw displayName: the OTP signup path used to store the phone
      // number in it. See resolveOwnerName.
      name: firstNameOf(resolveOwnerName(owner)) || "there",
      // The FULL plate: this goes to the owner's own number, and it is what
      // tells an owner with several tags which one has locked.
      plate: tag.plateNumber,
      tagId: String(tag._id)
    });
    return true;
  } catch (err) {
    log?.warn?.({ err, event: "trial-ended-whatsapp-failed", tagId: String(tag._id) }, "[trial ended] WhatsApp not sent");
    return false;
  }
}

// Notices started and not yet finished. Kept only so tests can wait for them;
// production fires and returns, exactly as emergency-alert.js does.
const inFlight = new Set();

/**
 * Tell the owner their tag's free trial has ended, if it just has. Call it
 * after spending a free contact; THE ROUTE MUST NOT AWAIT IT, because the
 * scanner is waiting and a provider send can take seconds. It never rejects.
 * Resolves to `{ status }`, for logs and tests:
 *
 *   "not-due"      the tag is premium, still has a contact left, or its owner
 *                  has already been told
 *   "sent"         the owner has just been told
 *   "unavailable"  nobody could be reached (no number, a hard stop, the
 *                  template not approved yet, a provider outage)
 *
 * `send` is the delivery, passed in so the claim can be tested without a
 * provider. Nothing in the app overrides it.
 */
export function notifyTrialEnded(env, collections, tag, log, { now = Date.now(), send = sendNotice } = {}) {
  const task = (async () => {
    // Premium tags set freeContactUsed too (register-call), and it means
    // nothing there: masking is decided by the trial and the subscription.
    if (!tag || tag.premium) return { status: "not-due" };

    const at = new Date(now).toISOString();
    const claimed = await collections.tags.updateOne(
      // `null` matches a stamp that is absent as well as one that is null.
      { _id: tag._id, freeContactUsed: true, trialEndedNotice: null },
      { $set: { trialEndedNotice: { at, whatsapp: "pending" } } }
    );
    if (claimed.modifiedCount !== 1) return { status: "not-due" };

    let reached = false;
    try {
      reached = await send(env, collections, tag, log);
    } catch (err) {
      log?.error?.({ err, tagId: String(tag._id) }, "[trial ended] notice failed");
    }

    await collections.tags.updateOne(
      { _id: tag._id },
      { $set: { "trialEndedNotice.whatsapp": reached ? "sent" : "not-sent" } }
    );
    if (!reached) return { status: "unavailable" };

    log?.info?.({ event: "trial-ended-owner-told", tagId: String(tag._id) }, "[trial ended] owner told the free trial is over");
    return { status: "sent" };
  })().catch((err) => {
    // Nobody is left to tell: the response has gone.
    log?.error?.({ err, event: "trial-ended-notice-failed" }, "[trial ended] notice aborted");
    return { status: "unavailable" };
  });

  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
  return task;
}

// Wait for every notice started so far. Tests only.
export async function settleTrialEndedNotices() {
  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }
}
