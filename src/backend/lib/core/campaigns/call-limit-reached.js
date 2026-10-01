// "Someone just tried to reach you." An E-Tag's free masked-call trial ran
// out, and until now the only person told was the scanner, standing at a
// stranger's car — a "Purchase Official ParkTag QR Sticker" link aimed at
// exactly the person who has no reason to buy it. The owner, who could
// actually act on it, heard nothing.
//
// This is the campaign that tells the right person. `freeContactUsedAt` is
// stamped once, the moment `spendFreeContactPipeline` (call-access.js) tips
// the counter over the tag's allowance — see the Exotel webhook, which is
// where that stamp now happens, only once a call has actually bridged. The
// send waits MIN_AGE_MS past that stamp rather than firing immediately: an
// instant notification reads as a doorbell camera, a couple of hours later
// reads as a message from the business.
//
// One send, ever, per tag — not one per subsequent scan of an already-spent
// tag. A tag that keeps getting scanned after it is exhausted is not two
// pieces of news, and re-notifying on every attempt would be the nagging
// trial-ending.js deliberately caps at three stages to avoid.

import { sendOnce } from "../message-log.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappCallLimitReached } from "../../integrations/meta.js";
import { firstNameOf, resolveOwnerName } from "../owner-name.js";
import { canSendUtility } from "../messaging-consent.js";

// Lower bound: let the dust settle. A trial spent by a call two minutes ago
// is not yet "someone tried to reach you", it is the scanner still standing
// there.
//
// Upper bound: the scheduler.js rule — a campaign query must be bounded. Four
// hours gives sixteen ticks of slack (scheduler.js ticks every 15 minutes),
// so a redeploy or a held lease cannot make us miss a tag, while the dedupe
// key makes those sixteen matches into one message.
const MIN_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_AGE_MS = 4 * 60 * 60 * 1000;

export const id = "call-limit-reached";

export async function run(env, collections, { now, limit, dryRun, log }) {
  if (!isMetaWhatsappConfigured(env)) return { sent: 0, skipped: "not-configured" };

  const notBefore = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const notAfter = new Date(now.getTime() - MIN_AGE_MS).toISOString();

  // Non-premium only: a premium tag's `freeContactUsed` stamp (routes/public/
  // index.js's register-call) records that a call happened, it does not mean
  // masking is off — that tag's access comes from the trial/subscription, not
  // this flag. Sending an owner "your calls are off" while their masking is
  // very much on would be simply wrong.
  const tags = await collections.tags
    .find({
      premium: { $ne: true },
      status: "active",
      deletedAt: { $in: [null, undefined] },
      freeContactUsed: true,
      freeContactUsedAt: { $gte: notBefore, $lte: notAfter }
    })
    .limit(limit)
    .toArray();

  let sent = 0;
  const selected = [];

  for (const tag of tags) {
    if (sent >= limit) break;
    if (!tag.ownerId) continue;

    const owner = await collections.owners.findOne({ _id: tag.ownerId });
    if (!owner) continue;

    // Utility, not marketing: this reports a fact about the customer's own
    // tag, the same reasoning as parktag_trial_ending. A marketing opt-out
    // does not silence it; a hard stop does.
    if (!canSendUtility(owner)) continue;

    const mobile = owner.mobile || owner.phone;
    if (!mobile) continue;

    const name = firstNameOf(resolveOwnerName(owner)) || "there";
    const vehicle = tag.vehicleLabel || "your vehicle";
    const tagId = String(tag._id);

    selected.push({ tagId, name, vehicle });
    if (dryRun) continue;

    const result = await sendOnce(
      env,
      collections,
      {
        campaign: id,
        // The tag, not the timestamp: freeContactUsedAt does not change once
        // set, but a key built from it would still be a moving target if it
        // ever did, and the tag is the natural one-per-tag key this campaign
        // actually means.
        dedupeKey: `call-limit:${tagId}`,
        ownerId: tag.ownerId,
        to: mobile,
        channel: "whatsapp",
        templateName: "parktag_call_limit_reached",
        send: () => sendMetaWhatsappCallLimitReached(env, { to: mobile, name, vehicle, tagId })
      },
      log
    );

    if (result.sent) sent += 1;
  }

  if (dryRun) {
    log?.info?.({ campaign: id, wouldSend: selected.length, selected }, "[campaign] dry run");
    // `selected` is returned, not just logged — see trial-ending.js for why.
    return { sent: 0, dryRun: true, wouldSend: selected.length, selected };
  }

  return { sent, considered: tags.length };
}
