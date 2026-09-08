// The premium year is ending. The commercial spine of the whole programme.
//
// A ParkTag premium sticker includes twelve months of masked calls and a
// ten-document vault. Until now that year ended in silence: masking switched
// off, the vault shrank, and the first the customer knew of it was a feature
// that had stopped working. Nothing asked them to renew, because nothing in
// this app was scheduled.
//
// ── Both channels, saying different things on purpose ──────────────────────
//
// WhatsApp carries `parktag_trial_ending`, which is a UTILITY template and
// stayed utility partly because the price was taken out of it at submission.
// Meta's categories govern what a template may say.
//
// Nobody governs an e-mail. So the mail names the price, shows what lapsing
// costs, and asks for the renewal, while the message names the fact and the
// date. Running both is not redundancy: it is the only way to have the reach of
// WhatsApp and the freedom of e-mail at the same time.
//
// ── The query, and why it is shaped like this ──────────────────────────────
//
// `premiumTrialEndsAt()` is COMPUTED from `activatedAt`, not stored, so there
// is no date field to filter on. Mongo therefore gets a coarse window on
// activatedAt, and the exact test is done in memory by the same function every
// entitlement check uses. Recomputing the boundary here instead would be a
// second definition of when premium ends, and the two would eventually
// disagree about somebody's account.

import { sendOnce } from "../message-log.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappTrialEnding } from "../../integrations/meta.js";
import { sendTrialEndingEmail } from "../../integrations/email.js";
import { firstNameOf, resolveOwnerName } from "../owner-name.js";
import { premiumTrialEndsAt, PREMIUM_TRIAL_MONTHS } from "../vault.js";
import { hasActiveSubscription } from "../subscription.js";
import { addMonths } from "../calendar.js";
import { canSendUtility } from "../messaging-consent.js";

const DAY = 24 * 60 * 60 * 1000;

// Three notices, and no more. A fourth would be nagging, and the third only
// earns its place because after it the feature is genuinely gone.
//
// Each is a ONE-DAY window, which is what keeps the query bounded: "the trial
// ends between 30 and 31 days from now", never "in under 30 days". An
// open-ended version would re-match the same tag every day for a month and lean
// entirely on the dedupe key to stay quiet.
const STAGES = [
  { key: "t30", days: 30 },
  { key: "t7", days: 7 },
  { key: "t1", days: 1 }
];

export const id = "trial-ending";

export async function run(env, collections, { now, limit, dryRun, log }) {
  let sent = 0;
  const selected = [];

  for (const stage of STAGES) {
    if (sent >= limit) break;

    // Coarse window on the stored field. A trial ends PREMIUM_TRIAL_MONTHS
    // after activation, so a trial ending `days` from now belongs to a tag
    // activated that far back. Widened by a day at each end and then narrowed
    // exactly in memory, because month arithmetic does not divide evenly into
    // days and a tight string window would drop tags at month boundaries.
    const from = addMonths(now.getTime() + stage.days * DAY, -PREMIUM_TRIAL_MONTHS) - DAY;
    const to = addMonths(now.getTime() + (stage.days + 1) * DAY, -PREMIUM_TRIAL_MONTHS) + DAY;

    const candidates = await collections.tags
      .find({
        premium: true,
        status: "active",
        deletedAt: { $in: [null, undefined] },
        // ISO strings, matching what routes/public/index.js writes. A Date here
        // would match nothing at all rather than erroring.
        activatedAt: { $gte: new Date(from).toISOString(), $lt: new Date(to).toISOString() }
      })
      .limit(limit * 4)
      .toArray();

    for (const tag of candidates) {
      if (sent >= limit) break;

      // Already paying. Telling a subscriber their trial is ending would be
      // both wrong and alarming, and hasActiveSubscription is the one place
      // that decides what "paying" means.
      if (hasActiveSubscription(tag, now.getTime())) continue;

      const endsAt = premiumTrialEndsAt(tag, now.getTime());
      if (!endsAt) continue;

      // The exact test the coarse query could not do.
      const daysOut = (new Date(endsAt).getTime() - now.getTime()) / DAY;
      if (daysOut < stage.days || daysOut >= stage.days + 1) continue;

      const owner = tag.ownerId ? await collections.owners.findOne({ _id: tag.ownerId }) : null;
      if (!owner) continue;

      // Utility, not marketing: this reports a dated change to a service the
      // customer currently holds. A marketing opt-out does not silence it, for
      // the same reason it does not silence an insurance reminder. A hard stop
      // does.
      if (!canSendUtility(owner)) continue;

      const name = firstNameOf(resolveOwnerName(owner)) || "there";
      const vehicle = tag.vehicleLabel || "vehicle";
      const endsOn = readableDate(endsAt);
      const mobile = owner.mobile || owner.phone;

      selected.push({ tagId: String(tag._id), stage: stage.key, endsOn });
      if (dryRun) continue;

      // Both channels, each with its own dedupe key, so a WhatsApp failure
      // does not suppress the mail and neither can be retried into a duplicate.
      if (mobile && isMetaWhatsappConfigured(env)) {
        const r = await sendOnce(env, collections, {
          campaign: id,
          dedupeKey: `trial-${stage.key}:wa:${tag._id}`,
          ownerId: tag.ownerId,
          to: mobile,
          channel: "whatsapp",
          templateName: "parktag_trial_ending",
          send: () =>
            sendMetaWhatsappTrialEnding(env, {
              to: mobile,
              name,
              vehicle,
              // "30 days" / "7 days" / "1 day". Said in words rather than as a
              // bare number so the approved template reads correctly at every
              // stage without three separate templates.
              remaining: stage.days === 1 ? "1 day" : `${stage.days} days`,
              tagId: String(tag._id)
            })
        }, log);
        if (r.sent) sent += 1;
      }

      if (owner.email) {
        const r = await sendOnce(env, collections, {
          campaign: id,
          dedupeKey: `trial-${stage.key}:email:${tag._id}`,
          ownerId: tag.ownerId,
          to: owner.email,
          channel: "email",
          send: () =>
            sendTrialEndingEmail(env, {
              to: owner.email,
              name,
              vehicle,
              endsOn,
              daysLeft: stage.days,
              tagId: String(tag._id)
            })
        }, log);
        if (r.sent) sent += 1;
      }
    }
  }

  if (dryRun) {
    log?.info?.({ campaign: id, wouldSend: selected.length, selected }, "[campaign] dry run");
    // `selected` is returned, not just logged. A dry run exists to be read,
    // and a count alone cannot answer "is it picking the RIGHT people",
    // which is the only question worth asking before a first live tick.
    return { sent: 0, dryRun: true, wouldSend: selected.length, selected };
  }

  return { sent };
}

// "12 October 2026". Written out rather than a locale string, so the date reads
// the same in a message, in an e-mail and in a log line whatever the server's
// locale happens to be.
function readableDate(ms) {
  const d = new Date(ms);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
