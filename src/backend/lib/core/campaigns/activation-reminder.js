// "Your ParkTag is delivered — activate it so it works." The onboarding nudge.
//
// A tag ships as a generic sticker: its QR carries a token, but until the buyer
// scans it and runs the activation wizard the tag has no owner, so a scan
// reaches nobody. A buyer who never activates paid for a sticker that does
// nothing, and until now nothing reminded them. This is the single biggest
// lever on activation rate, and the one loop a competitor (Sampark) leans on
// hardest ("your tag is still pending").
//
// ── UTILITY, not marketing ─────────────────────────────────────────────────
//
// It reports a fact about something the customer already has — a delivered tag
// that needs one setup step — names no price and makes no offer, so it is
// UTILITY and needs no marketing opt-in (canSendUtility, honouring hard-stop).
// The call-to-action is a STATIC "Activate" button baked into the template.
//
// ── Dormant until the template is live ─────────────────────────────────────
//
// sendOnce() claims its dedupe row BEFORE the send and never retries, so a send
// against a template Meta has not approved would burn each order for good: one
// failed attempt, no reminder ever. So this selects recipients but sends to
// NOBODY until env.activationRemindersEnabled is turned on, which should happen
// only once parktag_activation_reminder shows APPROVED + UTILITY in WhatsApp
// Manager. Validate first with `npm run campaigns:dry-run`.

import { sendOnce } from "../message-log.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappActivationReminder } from "../../integrations/meta.js";
import { firstNameOf } from "../owner-name.js";
import { canSendUtility } from "../messaging-consent.js";

// The window, and why it has BOTH ends (the rule from scheduler.js).
//
// Lower bound: the buyer needs the sticker in hand and a moment to not get to
// it. Two days after it is marked delivered is early enough to catch them while
// the parcel is still on the table, late enough that "activate it now" is not
// nagging someone who just opened the box.
//
// Upper bound: a campaign query must be bounded, never "older than X", or it
// re-matches the same order every tick forever and outlives the dedupe row that
// keeps it quiet. Nine days gives a wide band of ticks so a redeploy or a held
// lease cannot make us miss an order, while the dedupe key collapses all those
// matches into one message.
const MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 9 * 24 * 60 * 60 * 1000;

export const id = "activation-reminder";

// Match the buyer's delivery phone to an owner record by its last ten digits,
// so +91/91/0 prefix differences between what checkout stored and what the
// activation OTP normalised do not hide an owner who did activate.
function lastTen(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export async function run(env, collections, { now, limit, dryRun, log }) {
  if (!isMetaWhatsappConfigured(env)) return { sent: 0, skipped: "not-configured" };

  // ISO strings, matching how order-tracking.js writes deliveredAt. A Date here
  // would match nothing at all in Mongo rather than erroring.
  const notBefore = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const notAfter = new Date(now.getTime() - MIN_AGE_MS).toISOString();

  const orders = await collections.shopOrders
    .find({
      status: { $in: ["paid", "cod"] },
      deliveredAt: { $gte: notBefore, $lte: notAfter }
    })
    .limit(limit)
    .toArray();

  let sent = 0;
  let alreadyActive = 0;
  const selected = [];

  for (const order of orders) {
    if (sent >= limit) break;

    const phone = order?.shippingAddress?.phone;
    if (!phone) continue; // no way to reach them, which is correct for a tag with no contact on file

    // Already activated? The owner record is created at activation, so a buyer
    // with an active tag is done and must not be nudged. Prefer the order's own
    // ownerId (a signed-in buyer), else match the delivery phone by suffix.
    const ten = lastTen(phone);
    const owner = order.ownerId
      ? await collections.owners.findOne({ _id: order.ownerId }, { projection: { messagingHardStop: 1 } })
      : ten
        ? await collections.owners.findOne(
            { $or: [{ mobile: { $regex: `${ten}$` } }, { phone: { $regex: `${ten}$` } }] },
            { projection: { messagingHardStop: 1 } }
          )
        : null;

    if (owner) {
      const activeTags = await collections.tags.countDocuments({ ownerId: owner._id, status: "active" });
      if (activeTags > 0) { alreadyActive += 1; continue; }
    }

    // Hard-stop is the one consent rule a utility message still honours. A null
    // owner (guest who never activated) has none, so this allows the send.
    if (!canSendUtility(owner)) continue;

    const name = firstNameOf(order?.shippingAddress?.fullName) || "there";
    const product = order.productName || "your ParkTag";

    selected.push({ orderNumber: order.orderNumber, name, product });

    // Dormant until the template is approved and the switch is on (see header).
    // Skipping BEFORE sendOnce() is deliberate: no dedupe row is claimed, so the
    // order is still waiting when the campaign goes live, not silently spent.
    if (!env.activationRemindersEnabled || dryRun) continue;

    const result = await sendOnce(
      env,
      collections,
      {
        campaign: id,
        // The order id is the natural key: one reminder per order, ever. Never a
        // timestamp — a key that changes between ticks is a serial number, not a
        // dedupe key.
        dedupeKey: `activation:${order.orderId || order._id}`,
        ownerId: order.ownerId || null,
        to: phone,
        channel: "whatsapp",
        templateName: "parktag_activation_reminder",
        send: () => sendMetaWhatsappActivationReminder(env, { to: phone, name, product })
      },
      log
    );

    if (result.sent) sent += 1;
  }

  log?.info?.({ campaign: id, candidates: orders.length, selected: selected.length, sent, alreadyActive, dryRun: Boolean(dryRun), enabled: Boolean(env.activationRemindersEnabled) }, "[campaign] activation-reminder tick");

  return { sent, selected: selected.length, alreadyActive };
}
