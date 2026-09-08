// What nobody wrote down.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Everything else in this feature is automatic: a sale goes through the
// checkout, a sticker links itself on activation. This is the part that says
// when that did NOT happen, because the failure mode of an automatic system is
// silence, and silence looks exactly like success.
//
// It is not hypothetical. On production, five activated tags belonged to real
// people with no order behind them: a giveaway to Abhishek Bhardwaj, the
// owner's own tag, and three more. Nothing flagged them. They surfaced because
// somebody happened to remember a name.
//
// ── The two directions ─────────────────────────────────────────────────────
//
//   unlinkedTags   a sticker somebody is USING with no record of why it left.
//                  Either it was given away and never logged, or a sale went
//                  around the checkout. Every row here is a question.
//
//   unfilledOrders an order somebody PAID FOR whose stickers are not all
//                  activated. Usually a parcel in transit, which is why each
//                  row carries how long it has been waiting rather than being
//                  presented as a fault.
//
// ── It reports, it does not repair ─────────────────────────────────────────
//
// Nothing here writes. A report that quietly fixed what it found would hide the
// pattern that caused the drift, and the pattern is the interesting part: a
// giveaway nobody logs twice is a habit, not an accident.

import { stickerSerialFor } from "./tag-issuance.js";
import { getShopProduct } from "../integrations/payments.js";
import { resolveOwnerName } from "./owner-name.js";

const PAID_STATES = ["paid", "cod"];
const DAY_MS = 24 * 60 * 60 * 1000;

// Enough to see a pattern, few enough to read. If either list is ever longer
// than this, the number is the story rather than the individual rows.
const LIMIT = 50;

function capacityOf(order) {
  const product = getShopProduct(order.productId);
  return Math.max(1, Number(product && product.tags) || 1);
}

/**
 * Both directions of drift between stickers in use and orders paid for.
 *
 * Read-only. Safe to call from an admin page, a scheduled digest, or a script.
 */
export async function reconcile(collections) {
  const [tags, orders] = await Promise.all([
    collections.tags
      .find(
        {
          // Activated, so somebody is relying on it. Unclaimed stock is not
          // drift, it is inventory: there are ~3,000 printed stickers waiting,
          // and listing them would bury the handful of rows that matter.
          status: "active",
          assignedOrderNumber: { $in: [null, undefined] },
          deletedAt: { $in: [null, undefined] }
        },
        {
          projection: { serialNumber: 1, batchNumber: 1, ownerId: 1, activatedAt: 1, createdAt: 1 },
          limit: LIMIT,
          sort: { activatedAt: 1 }
        }
      )
      .toArray(),

    collections.shopOrders
      .find(
        {
          status: { $in: PAID_STATES },
          deletedAt: { $in: [null, undefined] },
          // Our own testing is not an unfulfilled customer order. Five COD
          // tests to our own address would otherwise sit at the top of this
          // list forever, waiting for stickers nobody will ever activate,
          // and burying the rows that are real.
          internal: { $ne: true }
        },
        {
          projection: {
            orderNumber: 1, productId: 1, productName: 1, createdAt: 1,
            assignedTagIds: 1, channel: 1, shippingAddress: 1
          },
          sort: { createdAt: 1 }
        }
      )
      .toArray()
  ]);

  // Names, so a row is somebody rather than an id. One query for the whole
  // list rather than one per tag: this runs on an admin page load.
  const ownerIds = tags.map((tag) => tag.ownerId).filter(Boolean);
  const owners = ownerIds.length
    ? await collections.owners
        .find({ _id: { $in: ownerIds } }, { projection: { displayName: 1, name: 1, email: 1, mobile: 1, phone: 1 } })
        .toArray()
    : [];
  const ownerById = new Map(owners.map((owner) => [String(owner._id), owner]));

  const unlinkedTags = tags.map((tag) => {
    const owner = ownerById.get(String(tag.ownerId));
    return {
      tagId: String(tag._id),
      // stickerSerialFor returns "" for a tag issued before serials existed.
      // Reported as null rather than an invented number: the whole point of a
      // serial is that it maps to a record, so a made-up one is worse than none.
      serial: stickerSerialFor(tag) || null,
      ownerName: owner ? resolveOwnerName(owner) : null,
      activatedAt: tag.activatedAt || tag.createdAt || null
    };
  });

  const now = Date.now();
  const unfilledOrders = orders
    .map((order) => ({
      orderNumber: order.orderNumber,
      productName: order.productName || order.productId,
      channel: order.channel || "shop",
      filled: (order.assignedTagIds || []).length,
      capacity: capacityOf(order),
      createdAt: order.createdAt || null,
      // Most of these are simply in the post. Somebody reading the list needs
      // to tell "sent yesterday" from "sent in July", so the age is the signal
      // rather than the presence of the row.
      daysWaiting: order.createdAt
        ? Math.max(0, Math.floor((now - Date.parse(order.createdAt)) / DAY_MS))
        : null
    }))
    .filter((row) => row.filled < row.capacity)
    .sort((a, b) => (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0))
    .slice(0, LIMIT);

  return { unlinkedTags, unfilledOrders };
}
