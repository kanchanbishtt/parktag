// Joining a physical sticker to the order that paid for it.
//
// ── The problem ────────────────────────────────────────────────────────────
//
// Measured on production before this existed: `mintedTagId` was set on 0 of 36
// orders. Not one sticker could be traced to a reason for leaving, and five
// activated tags belonged to real people with no record at all, including a
// giveaway and the owner's own tag.
//
// The obvious fix is a form with a box for the sticker serial. It is the wrong
// fix. The serial is printed under the adhesive, so reading it means peeling a
// sticker you are about to hand somebody, and a field nobody can fill is a
// field that stays empty.
//
// ── Why the phone is the join ──────────────────────────────────────────────
//
// Nothing extra needs collecting. The tag learns its owner at activation, and
// the order already captures a delivery phone, so the link derives itself.
// Checked against production before this was written: tag PT-01-004004 already
// matched order PT-260730-00004 on phone alone, and all 20 owners carry a
// number.
//
// It matters most for a handover sale, which has no address at all. There the
// phone is the ONLY thing connecting a buyer to their order.
//
// ── The rule that shapes every decision below ──────────────────────────────
//
// A WRONG LINK IS WORSE THAN NO LINK.
//
// An unlinked tag turns up on the reconciliation report and somebody looks at
// it. A tag linked to the wrong person's order is a quiet lie in the ledger
// that nothing will ever flag. So every ambiguity here resolves to linking
// nothing: no phone, no paid order, an order already holding a tag, or a tag
// that already names one.

import { toE164 } from "./phone.js";

// Payment states that mean a sticker was genuinely bought. COD counts: the
// parcel went out and cash is due at the door, which is still a sale.
const PAID_STATES = ["paid", "cod"];

/**
 * Find the order this freshly activated sticker belongs to, and record it on
 * both.
 *
 * NEVER THROWS. This runs inside the request a customer is waiting on,
 * immediately after they have activated the sticker they just bought.
 * Bookkeeping failing must never turn that into a failed activation, so every
 * path returns a result object and the caller can ignore it entirely.
 *
 * Returns `{ linked, orderNumber, reason }`.
 */
export async function linkTagToOrder(collections, { tagId, phone }, log) {
  try {
    // Compared in E.164 throughout, because stored formats differ by signup
    // path. This is the same trap resolveReferral's self-referral check
    // documents: a raw string comparison would fail to match "9812345678"
    // against "+919812345678" and silently link nothing for half the buyers.
    const buyer = toE164(phone);
    if (!buyer) return { linked: false, reason: "no-phone" };

    const tag = await collections.tags.findOne({ _id: tagId });
    if (!tag) return { linked: false, reason: "no-tag" };

    // Re-registering a sticker after a deactivation must not move it onto a
    // different order and rewrite what already happened.
    if (tag.assignedOrderNumber) {
      return { linked: false, reason: "already-linked", orderNumber: tag.assignedOrderNumber };
    }

    // Read the candidates and compare in E.164 in memory rather than querying
    // on the raw string. A regex on the last ten digits would match a stored
    // number that merely ENDS the same way, which across a growing customer
    // base is exactly the wrong link this module exists to avoid.
    const candidates = await collections.shopOrders
      .find(
        {
          status: { $in: PAID_STATES },
          assignedTagId: { $in: [null, undefined] },
          deletedAt: { $in: [null, undefined] }
        },
        { projection: { orderNumber: 1, createdAt: 1, shippingAddress: 1 } }
      )
      .toArray();

    // Newest first, so somebody buying a second tag a month later is linked to
    // the order they just placed rather than the one they already have a
    // sticker for.
    const match = candidates
      .filter((order) => toE164(order.shippingAddress && order.shippingAddress.phone) === buyer)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];

    if (!match) return { linked: false, reason: "no-order" };

    // Claim the ORDER first, conditionally on it still being unclaimed.
    //
    // Two stickers from a Pack of 2 get activated minutes apart by the same
    // person, on the same phone, and both would otherwise find this order. The
    // database decides which one wins, the same way the created → paid flip in
    // fulfilPaidOrder does; a read-then-write here would let both through.
    const claimed = await collections.shopOrders.updateOne(
      { orderNumber: match.orderNumber, assignedTagId: { $in: [null, undefined] } },
      { $set: { assignedTagId: tagId, assignedTagAt: new Date().toISOString() } }
    );
    if (claimed.modifiedCount !== 1) return { linked: false, reason: "raced" };

    await collections.tags.updateOne(
      { _id: tagId },
      {
        $set: {
          assignedOrderNumber: match.orderNumber,
          assignedAt: new Date().toISOString(),
          // The tag's own record of having been bought. Every activated tag on
          // production still read "none", including ones somebody had paid for,
          // because nothing ever wrote it after issuance.
          purchaseStatus: "paid",
          physicalTagPurchased: true
        }
      }
    );

    return { linked: true, orderNumber: match.orderNumber };
  } catch (err) {
    log?.warn?.({ err, tagId }, "[linking] could not link tag to an order");
    return { linked: false, reason: "error" };
  }
}
