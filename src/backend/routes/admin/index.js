import { ObjectId } from "mongodb";

import { requireSession } from "../../lib/auth/auth.js";
import { isNonEmptyString } from "../../lib/auth/security.js";
import { getCollections, getVaultBucket } from "../../lib/db/repositories.js";
import { purgeVaultDocuments } from "../../lib/core/vault.js";
import { findByCanonicalEmail, canonicalEmail } from "../../lib/auth/identity.js";
import {
  buildIssuedTagOutput,
  buildClaimUrl,
  createUnclaimedTags,
  etagIdFor,
  batchKeyFor,
  stickerSerialFor
} from "../../lib/core/tag-issuance.js";
import { NOT_MARKETING_STOCK, NOT_DEMO_OWNER, demoState } from "../../lib/core/marketing-stock.js";
import {
  parseBatchKey,
  rawBatchValuesFor,
  issuedStockFilter,
  summariseBatches,
  batchCsv
} from "../../lib/core/tag-batches.js";
import { orderBreakdown, breakdownText } from "../../lib/core/order-breakdown.js";
import { landingTotals } from "./traffic.js";
import { membershipCountdown } from "../../lib/core/membership-fulfilment.js";
import { capacityOf } from "../../lib/core/order-linking.js";
import { refreshStaleTracking } from "../../lib/core/order-tracking.js";

// Order the print queue the way the sheets should come off the printer: newest
// batch first, and inside a batch ascending by the serial printed on the sticker.
//
// Sorting on createdAt alone is not enough, which is what the queue used to do.
// A batch is inserted in one burst — a 1000-tag run lands on about seven distinct
// millisecond timestamps — so a descending createdAt sort reversed the run AND
// left the tags sharing a millisecond in whatever order the server returned them.
// The queue opened somewhere in the middle of the batch (PT-01-000840 rather than
// PT-01-000001), which makes a printed run impossible to count against a serial
// range.
// A tag's serial as a number, or null when it has none. Deliberately mirrors
// stickerSerialFor's `== null` test rather than leaning on Number(), which turns
// both null and "" into 0 — a tag the sticker prints no serial for would
// otherwise sort as serial zero, ahead of the whole batch.
function serialOrNull(tag) {
  if (tag.serialNumber == null || tag.serialNumber === "") return null;
  const value = Number(tag.serialNumber);
  return Number.isFinite(value) ? value : null;
}

function orderForPrinting(tags) {
  // Rank batches by their newest tag, so a batch always stays together and the
  // most recently issued one still sits at the top of the queue.
  const newestByBatch = new Map();
  for (const tag of tags) {
    const key = tag.batchNumber || "";
    const at = String(tag.createdAt || "");
    if (at > (newestByBatch.get(key) || "")) {
      newestByBatch.set(key, at);
    }
  }

  return tags.sort((a, b) => {
    const aBatch = a.batchNumber || "";
    const bBatch = b.batchNumber || "";

    if (aBatch !== bBatch) {
      const aNewest = newestByBatch.get(aBatch);
      const bNewest = newestByBatch.get(bBatch);
      if (aNewest !== bNewest) return aNewest < bNewest ? 1 : -1;
      return aBatch < bBatch ? -1 : 1;
    }

    // Tags issued before serials existed have none. Keep them after the numbered
    // ones in issue order rather than letting NaN scramble the comparison.
    const aSerial = serialOrNull(a);
    const bSerial = serialOrNull(b);
    if (aSerial !== null && bSerial !== null) return aSerial - bSerial;
    if ((aSerial === null) !== (bSerial === null)) return aSerial === null ? 1 : -1;

    const aAt = String(a.createdAt || "");
    const bAt = String(b.createdAt || "");
    if (aAt !== bAt) return aAt < bAt ? -1 : 1;
    return String(a._id) < String(b._id) ? -1 : 1;
  });
}

// How many tags one export request may render QR images for. Bounded because
// rendering is the expensive part — the original endpoint rendered every
// unprinted tag in one go and timed out the gateway.
//
// The print queue reports this value to the client so the two cannot drift: a
// client chunking larger than the server accepts would get a 400 on every
// request of a long print run.
const EXPORT_MAX_PER_REQUEST = 250;

// Admin lists (Tags, Activations > Activated, Owners) come in numbered pages
// of this size. Working lists that need the whole set at once, such as the
// print queue, are not paged.
const ADMIN_PAGE_SIZE = 100;

// ?page=<n>, 1-based. Anything unparseable is page 1, and a page past the end
// is the last page, so a list that shrank under an admin (a tag deleted on the
// last page) still shows rows instead of an empty page.
function listPage(rawPage, total) {
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const wanted = Number.parseInt(typeof rawPage === "string" ? rawPage : "1", 10);
  const page = Math.min(pages, Number.isFinite(wanted) && wanted >= 1 ? wanted : 1);
  return { page, pages, pageSize: ADMIN_PAGE_SIZE, skip: (page - 1) * ADMIN_PAGE_SIZE };
}

// ── Activations: shared by the Activations page and the overview summary ──
//
// Premium tags that an OWNER holds. `premium: true` alone also matches unsold
// premium stock — production carries thousands of those, unclaimed — and
// counting that as "activated" is what made this page's headline wrong.
// Demo stock is premium too and has its own page.
function ownedPremiumFilter() {
  return { premium: true, ownerId: { $ne: null }, deletedAt: { $in: [null, undefined] }, ...NOT_MARKETING_STOCK };
}

// Issued E-Tag stickers somebody has activated (GET /api/admin/etag-activations).
function ownedEtagFilter() {
  return { ...issuedStockFilter(), premium: { $ne: true }, ownerId: { $ne: null } };
}

// Orders that are real sales: paid, or a placed COD, never an abandoned
// checkout. Test orders are left out the way every other report here leaves
// them out, so the reminder queue is people who actually bought something.
function soldOrderFilter() {
  return {
    status: { $in: ["paid", "cod"] },
    deletedAt: { $in: [null, undefined] },
    internal: { $ne: true },
    channel: { $ne: "internal" }
  };
}

// Where the parcel is, from what is already stored on the order. Never calls
// Delhivery: this list is read on every visit, and the courier is live.
function deliveryStateOf(order) {
  if (order.deliveredInPerson || order.fulfilment === "handover") {
    return { state: "handed_over", at: order.deliveredAt || order.createdAt || null };
  }
  if (order.deliveredAt) return { state: "delivered", at: order.deliveredAt };
  if (order.waybill) {
    return {
      state: "shipped",
      courierStatus: order.trackingCache?.status || null,
      at: order.trackingCache?.fetchedAt || null
    };
  }
  if (order.shipmentError) {
    return { state: "shipment_failed", at: null, error: String(order.shipmentError).slice(0, 200) };
  }
  return { state: "not_shipped", at: null };
}

// The headline numbers, as counts rather than by loading every tag.
async function activationCounts(collections) {
  const [premiumActivated, premiumLive, premiumStock, etagActivated] = await Promise.all([
    collections.tags.countDocuments(ownedPremiumFilter()),
    collections.tags.countDocuments({ ...ownedPremiumFilter(), status: "active" }),
    collections.tags.countDocuments({
      premium: true, ownerId: { $in: [null] }, deletedAt: { $in: [null, undefined] }, ...NOT_MARKETING_STOCK
    }),
    collections.tags.countDocuments(ownedEtagFilter())
  ]);
  return { premiumActivated, premiumLive, premiumStock, etagActivated };
}

// Sold orders whose stickers have not all been activated: the reminder queue.
async function buildActivationQueue(collections) {
  const [liveOwnerIds, orders] = await Promise.all([
    // Owners holding at least one LIVE premium tag. In the older data most
    // orders are physical packs with no link to the tag they became, so an
    // owner with a live premium tag is the signal that they did activate.
    collections.tags.distinct("ownerId", { ...ownedPremiumFilter(), status: "active" }),
    collections.shopOrders.find(soldOrderFilter()).toArray()
  ]);
  const ownersWithActivePremium = new Set(liveOwnerIds.map(String));

  // Replace-target tags for every order that has one, in one query rather
  // than one lookup per order.
  const toObjectId = (value) => { try { return new ObjectId(String(value)); } catch { return null; } };
  const replaceIds = orders
    .filter((ord) => !ord.mintedTagId && ord.replaceTagId)
    .map((ord) => toObjectId(ord.replaceTagId))
    .filter(Boolean);
  const replaceTags = replaceIds.length
    ? await collections.tags
        .find({ _id: { $in: replaceIds } }, { projection: { deletedAt: 1, premium: 1 } })
        .toArray()
    : [];
  const replaceTagById = new Map(replaceTags.map((t) => [String(t._id), t]));

  const pending = [];
  for (const ord of orders) {
    const ownerKey = ord.ownerId ? String(ord.ownerId) : null;
    // Fulfilled when it minted a premium tag, the owner holds a live premium
    // tag, or its replace-target free tag was upgraded away or removed.
    let fulfilled = Boolean(ord.mintedTagId) || (ownerKey ? ownersWithActivePremium.has(ownerKey) : false);
    if (!fulfilled && ord.replaceTagId) {
      const id = toObjectId(ord.replaceTagId);
      const rt = id ? replaceTagById.get(String(id)) : null;
      if (!rt || rt.deletedAt || rt.premium) fulfilled = true;
    }
    if (fulfilled) continue;

    // Stickers activated since order linking began are recorded on the order
    // itself (assignedTagIds), which covers E-Tag packs and guest buyers the
    // premium signal above cannot see. A multi-pack is done only when every
    // sticker in it is live.
    const stickers = capacityOf(ord);
    const activatedStickers = Math.min(stickers, (ord.assignedTagIds || []).length);
    if (activatedStickers >= stickers) continue;

    pending.push({ ord, ownerKey, stickers, activatedStickers });
  }

  // Only the owners these rows reference, and only the fields shown.
  const ownerIds = [...new Set(pending.map((p) => p.ownerKey).filter(Boolean))]
    .map(toObjectId)
    .filter(Boolean);
  const owners = ownerIds.length
    ? await collections.owners
        .find({ _id: { $in: ownerIds } }, { projection: { displayName: 1, email: 1, mobile: 1, phone: 1 } })
        .toArray()
    : [];
  const ownerMap = new Map(owners.map((o) => [String(o._id), o]));

  const queue = [];
  for (const { ord, ownerKey, stickers, activatedStickers } of pending) {
    const o = (ownerKey && ownerMap.get(ownerKey)) || {};
    const ship = ord.shippingAddress || {};
    const mobile = ship.phone || o.mobile || o.phone || null;
    // No owner and no number: nobody to remind.
    if (!ownerKey && !mobile) continue;
    queue.push({
      id: String(ord._id),
      orderNumber: ord.orderNumber || ord.orderId || null,
      productName: ord.productName || null,
      // What the buyer was charged, line by line, off the stored order.
      priceBreakdown: breakdownText(orderBreakdown(ord)) || null,
      paymentMethod: ord.paymentMethod || (ord.status === "cod" ? "cod" : "prepaid"),
      orderStatus: ord.status || null,
      waybill: ord.waybill || null,
      delivery: deliveryStateOf(ord),
      stickers,
      activatedStickers,
      // The checkout stores the name as fullName; `name` is kept for any
      // older order written before that.
      ownerName: o.displayName || ship.fullName || ship.name || null,
      ownerEmail: o.email || null,
      ownerMobile: mobile,
      placedAt: ord.createdAt || null,
      lastReminder: ord.lastActivationReminder || null,
      reminderCount: Array.isArray(ord.activationReminders) ? ord.activationReminders.length : 0,
      // The history behind the count, for the row's Details (capped at 20 on write).
      reminders: Array.isArray(ord.activationReminders) ? ord.activationReminders.slice(-20) : []
    });
  }

  // Waiting longest first: the default order on the page.
  queue.sort((a, b) => String(a.placedAt || "").localeCompare(String(b.placedAt || "")));
  return queue;
}

export function registerAdminRoutes(app, env) {
  // ── E-Tag management (spec §10) ───────────────────────────────────
  // List / search all owner E-Tags with purchase + contact summary.
  app.get("/api/admin/etags", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const q = String(request.query.q || "").trim().toLowerCase();
    const statusFilter = String(request.query.status || "");
    // "all" (or anything unrecognised) means no category condition at all.
    const categoryFilter = String(request.query.category || "");
    const includeDeleted = request.query.includeDeleted === "1";

    // This endpoint used to pull EVERY tag, EVERY owner and EVERY contact
    // request into memory and filter in JavaScript. contact_requests grows
    // fastest of the three — one document per scan — so that load was the first
    // thing here that would exhaust the process. Filtering now happens in Mongo
    // (against the indexes added in repositories.js), the owner join is limited
    // to the owners actually referenced by the returned page, and contact
    // counts come from an aggregation over only the tokens on that page.
    // Claim state. This page has always listed CLAIMED tags only, which quietly
    // made the category filter useless where it mattered most: production holds
    // 3000 premium tags as unclaimed stock, so "Premium tags" returned the one
    // premium tag that happened to have an owner. Unclaimed stock was visible
    // nowhere else either — the print queue only shows what is still unprinted.
    //
    // Default stays "claimed", so existing links and habits are unchanged.
    const claimFilter = String(request.query.claim || "claimed");
    const filter = {};
    // $in: [null] matches both an explicit null and a missing field; $ne: null
    // excludes both, which is what "claimed" has always meant here.
    if (claimFilter === "unclaimed") filter.ownerId = { $in: [null] };
    else if (claimFilter !== "all") filter.ownerId = { $ne: null };

    if (!includeDeleted) filter.deletedAt = { $in: [null, undefined] };
    if (statusFilter) filter.status = statusFilter;

    // Field-demo stock is not inventory and has its own page (/admin/marketing).
    // It has to be excluded here explicitly, not just left to the claim filter:
    // an ACTIVATED demo sticker has a real ownerId, so it would otherwise show
    // up in the default "claimed" view as an ordinary customer tag — and the
    // customer it names may well have walked away without buying.
    Object.assign(filter, NOT_MARKETING_STOCK);

    // Category filter. `premium: true` is the single source of truth for a
    // premium tag, so an E-Tag is anything NOT flagged premium — written as
    // { $ne: true } rather than { premium: false } because tags issued before
    // the flag existed have no `premium` field at all and would otherwise
    // vanish from both categories at once.
    if (categoryFilter === "premium") filter.premium = true;
    else if (categoryFilter === "etag") filter.premium = { $ne: true };

    // Which physical sticker, kept as its own filter rather than folded into
    // `category`: the two are orthogonal, since a windscreen tag can be premium
    // or an E-Tag. Every tag issued before mount types existed is windscreen
    // stock, and those carry no field at all, so "windscreen" has to match a
    // missing value too — the same reasoning as `premium: { $ne: true }` above.
    const mountFilter = String(request.query.mount || "");
    if (mountFilter === "windscreen_interior") {
      filter.mountType = { $in: ["windscreen_interior", null] };
    } else if (mountFilter === "exterior_surface") {
      filter.mountType = "exterior_surface";
    }

    // One issued batch, by the key printed in its serials (PT-<key>-…). An
    // invalid key is refused rather than ignored, so a typo never silently
    // shows every tag as if it were the batch.
    const rawBatch = request.query.batch;
    let batchKey = null;
    if (rawBatch !== undefined && rawBatch !== "") {
      batchKey = parseBatchKey(typeof rawBatch === "string" ? rawBatch : "");
      if (!batchKey) { reply.code(400); return { ok: false, error: "Invalid batch." }; }
      filter.batchNumber = { $in: await rawBatchValuesFor(collections, batchKey) };
    }

    if (q) {
      // Escape the user's text before it becomes a regex — otherwise a search
      // for something like "a(" throws, and a crafted pattern could be made
      // pathologically slow (ReDoS) against every document scanned.
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      // Owner-side matches resolve to ids first so the tag query stays a single
      // indexed lookup rather than a per-document join.
      const matchingOwnerIds = (
        await collections.owners
          .find({ $or: [{ displayName: rx }, { email: rx }, { mobile: rx }, { phone: rx }] }, { projection: { _id: 1 } })
          .limit(500)
          .toArray()
      ).map((o) => o._id);

      // Plates are stored without spaces, so "DL 14 SM" has to match "DL14SM".
      const plateRx = new RegExp(safe.replace(/\s+/g, ""), "i");
      filter.$or = [{ plateNumber: plateRx }, { vehicleLabel: rx }, { token: rx }];
      if (matchingOwnerIds.length) filter.$or.push({ ownerId: { $in: matchingOwnerIds } });

      // E-Tag IDs are derived (PT- + the last 8 hex of the ObjectId), so they
      // aren't a stored field and can't be indexed. Only run the $expr suffix
      // match when the query actually looks like one, so the ordinary searches
      // above stay index-backed and this scan is the rare case.
      const etagQuery = q.replace(/^pt-/i, "");
      if (/^[0-9a-f]{4,8}$/i.test(etagQuery)) {
        filter.$or.push({
          $expr: {
            $regexMatch: { input: { $toString: "$_id" }, regex: `${etagQuery}$`, options: "i" }
          }
        });
      }

      // Sticker serials (PT-<batch>-<unit>) are what a caller reads off a
      // premium tag, so they have to be searchable too. Unlike the E-Tag ID
      // both halves ARE stored, so this stays a plain indexed query.
      //
      // The batch half is not optional. serialNumber restarts per batch — dev
      // already has two tags numbered 1 — so matching the unit alone would
      // return a tag from the wrong batch as confidently as the right one.
      const serialMatch = /^(\d{1,3})-(\d{1,6})$/.exec(etagQuery);
      if (serialMatch) {
        const wantedBatch = batchKeyFor(serialMatch[1]);
        const unit = Number(serialMatch[2]);

        // batchNumber is stored raw and inconsistently ("01", "1", 12,
        // "DEMO-BATCH-001"), and batchKeyFor is what reconciles them for
        // display. Resolving the raw values through that SAME function is what
        // guarantees a serial the sticker shows is a serial this search finds —
        // rather than reimplementing the normalisation and letting the two
        // drift. There are only a handful of distinct values, so the extra
        // lookup is cheap and keeps the tag query itself indexed.
        const rawBatches = (await collections.tags.distinct("batchNumber")).filter(
          (value) => batchKeyFor(value) === wantedBatch
        );

        if (rawBatches.length) {
          filter.$or.push({ $and: [{ serialNumber: unit }, { batchNumber: { $in: rawBatches } }] });
        }
      }
    }

    const total = await collections.tags.countDocuments(filter);
    const { page, pages, pageSize, skip } = listPage(request.query.page, total);
    const tags = await collections.tags
      .find(filter)
      // A batch reads in serial order, the order it was printed in. _id breaks
      // ties so a tag never shows on two pages or on none.
      .sort(batchKey ? { serialNumber: 1, _id: 1 } : { createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    const ownerIds = [...new Set(tags.map((t) => String(t.ownerId)))]
      .filter((id) => id && id !== "null")
      .map((id) => new ObjectId(id));
    const owners = ownerIds.length
      ? await collections.owners.find({ _id: { $in: ownerIds } }).toArray()
      : [];
    const ownerMap = Object.fromEntries(owners.map((o) => [String(o._id), o]));

    const tokens = tags.map((t) => t.token).filter(Boolean);
    const countsByToken = {};
    if (tokens.length) {
      const counts = await collections.contactRequests
        .aggregate([
          { $match: { token: { $in: tokens } } },
          { $group: { _id: "$token", n: { $sum: 1 } } }
        ])
        .toArray();
      for (const c of counts) countsByToken[c._id] = c.n;
    }

    const list = tags.map((t) => {
      const owner = ownerMap[String(t.ownerId)] || {};
      return {
        id: String(t._id),
        etagId: etagIdFor(t._id),
        // Serial printed on the physical sticker, or "" for a tag that has
        // none. stickerSerialFor is used unchanged — it is the same call the
        // print sheet and the owner dashboard make.
        serial: stickerSerialFor(t),
        // No `token`: it is the secret in the sticker's QR, and anyone holding
        // it can open that tag's scan page. Search still matches it server-side.
        plateNumber: t.plateNumber || null,
        vehicleType: t.vehicleType || null,
        vehicleLabel: t.vehicleLabel || null,
        // Absent on everything issued before mount types existed; that stock is
        // all windscreen, so it reads as such rather than as "unknown".
        mountType: t.mountType || "windscreen_interior",
        status: t.status,
        premium: Boolean(t.premium),
        purchaseStatus: t.purchaseStatus || "none",
        physicalTagPurchased: Boolean(t.physicalTagPurchased),
        freeContactUsed: Boolean(t.freeContactUsed),
        deletedAt: t.deletedAt || null,
        // Authoritative claim state. The client must not infer this from the
        // owner fields below — a claimed tag whose owner record is missing a
        // display name, email and mobile would read as unclaimed.
        claimed: t.ownerId != null,
        ownerName: owner.displayName || null,
        ownerEmail: owner.email || null,
        ownerMobile: owner.mobile || owner.phone || null,
        contactCount: countsByToken[t.token] || 0,
        createdAt: t.createdAt,
        // Same rule as the Activations list: a premium tag counts from when it
        // became premium.
        activatedAt: (t.premium ? t.premiumSince || t.activatedAt : t.activatedAt) || null
      };
    });

    // `total` is the count of everything matching the filter; `etags` is one
    // page of it.
    return { ok: true, total, etags: list, page, pages, pageSize };
  });

  // E-Tag detail with full contact / call / WhatsApp logs.
  app.get("/api/admin/etags/:tagId", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    let tagId;
    try { tagId = new ObjectId(request.params.tagId); } catch { reply.code(400); return { ok: false, error: "Bad id" }; }

    const tag = await collections.tags.findOne({ _id: tagId });
    if (!tag) { reply.code(404); return { ok: false, error: "E-Tag not found" }; }

    const owner = tag.ownerId ? await collections.owners.findOne({ _id: tag.ownerId }) : null;
    const logs = await collections.contactRequests
      .find({ token: tag.token })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    return {
      ok: true,
      etag: {
        id: String(tag._id),
        etagId: etagIdFor(tag._id),
        serial: stickerSerialFor(tag),
        plateNumber: tag.plateNumber || null,
        vehicleType: tag.vehicleType || null,
        vehicleLabel: tag.vehicleLabel || null,
        mountType: tag.mountType || "windscreen_interior",
        status: tag.status,
        premium: Boolean(tag.premium),
        purchaseStatus: tag.purchaseStatus || "none",
        physicalTagPurchased: Boolean(tag.physicalTagPurchased),
        freeContactUsed: Boolean(tag.freeContactUsed),
        freeContactUsedAt: tag.freeContactUsedAt || null,
        contactAttempts: tag.contactAttempts || 0,
        lastContactAt: tag.lastContactAt || null,
        deletedAt: tag.deletedAt || null,
        createdAt: tag.createdAt,
        owner: owner ? { name: owner.displayName || null, email: owner.email || null, mobile: owner.mobile || owner.phone || null } : null
      },
      logs: logs.map((item) => ({
        id: String(item._id),
        action: item.action,
        messageChannel: item.messageChannel || null,
        reason: item.reason || null,
        status: item.status,
        callResult: item.callResult || null,
        callDuration: typeof item.callDuration === "number" ? item.callDuration : null,
        recordingUrl: item.recordingUrl || null,
        ipAddress: item.ipAddress || null,
        userAgent: item.userAgent || null,
        createdAt: item.createdAt
      }))
    };
  });

  // Activate / deactivate an E-Tag.
  app.post("/api/admin/etags/:tagId/status", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const { status } = request.body || {};
    if (!["active", "inactive"].includes(status)) {
      reply.code(400);
      return { ok: false, error: "status must be active or inactive" };
    }

    const collections = await getCollections(env);
    let tagId;
    try { tagId = new ObjectId(request.params.tagId); } catch { reply.code(400); return { ok: false, error: "Bad id" }; }

    // Only a claimed tag has an active/inactive state to change. An unclaimed
    // tag sits at status "unclaimed" until an owner claims it, and forcing it to
    // "active" would leave a tag that is live with nobody to contact — it would
    // no longer be picked up as claimable, and a scan would find no owner.
    //
    // Unreachable while this page listed claimed tags only; the claim filter
    // puts unclaimed stock on screen, so the guard belongs here rather than in
    // the UI alone.
    const existing = await collections.tags.findOne({ _id: tagId }, { projection: { ownerId: 1, deletedAt: 1 } });
    if (!existing) { reply.code(404); return { ok: false, error: "E-Tag not found" }; }
    if (existing.ownerId == null) {
      reply.code(409);
      return { ok: false, error: "This tag has no owner yet, so it has no active/inactive state." };
    }
    // A deleted tag stays off. Scans only check `status`, while the owner's
    // dashboard hides anything with `deletedAt`, so switching one back on made
    // it reach the owner through a tag they could no longer see or turn off.
    // (The page's old Restore button did exactly that.)
    if (existing.deletedAt) {
      reply.code(409);
      return { ok: false, error: "This tag was deleted, so its status can't be changed." };
    }

    const result = await collections.tags.findOneAndUpdate(
      { _id: tagId, deletedAt: { $in: [null, undefined] } },
      { $set: { status, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    if (!result) { reply.code(404); return { ok: false, error: "E-Tag not found" }; }
    return { ok: true, status };
  });

  // Soft-delete an E-Tag (hidden from owner + admin default views).
  app.delete("/api/admin/etags/:tagId", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    let tagId;
    try { tagId = new ObjectId(request.params.tagId); } catch { reply.code(400); return { ok: false, error: "Bad id" }; }

    const result = await collections.tags.updateOne(
      { _id: tagId },
      { $set: { deletedAt: new Date().toISOString(), status: "inactive", updatedAt: new Date().toISOString() } }
    );
    if (!result.matchedCount) { reply.code(404); return { ok: false, error: "E-Tag not found" }; }

    // The vehicle's documents go with it, exactly as when the owner deletes it
    // themselves. A soft-deleted tag is refused by the vault's ownedTag(), so
    // anything left here is unreachable to the owner AND undeletable by them,
    // while still holding their storage — and these are identity documents, so
    // "unreachable" is not the same as "gone".
    const purged = await purgeVaultDocuments(
      collections,
      await getVaultBucket(env),
      { tagId: String(tagId) }
    );
    if (purged.orphanedBlobs) {
      request.log.error(
        { event: "vault-purge-orphans", tagId: String(tagId), orphanedBlobs: purged.orphanedBlobs },
        "[vault] admin deleted an E-Tag but some document blobs could not be removed — sweep required"
      );
    }

    return { ok: true };
  });

  // ── Tag activations dashboard ─────────────────────────────────────
  // The reminder queue: sold, not yet activated. The headline numbers live on
  // the overview; the list of activated tags is its own paged endpoint below.
  app.get("/api/admin/activations", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const unactivated = await buildActivationQueue(collections);

    return {
      ok: true,
      counts: { unactivated: unactivated.length },
      unactivated
    };
  });

  // Refresh the courier status of in-transit orders in the reminder queue, so a
  // delivered parcel shows as delivered without waiting for the buyer to open
  // tracking. The page calls this once after it loads. Tracking lookups are
  // read-only at Delhivery; the helper caps the batch, times each call out and
  // refuses in a test run. Rate-limited so a reload loop cannot fan out.
  app.post(
    "/api/admin/activations/refresh-tracking",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "admin")(request, reply);
      if (blocked) return blocked;

      const collections = await getCollections(env);
      const queue = await buildActivationQueue(collections);
      const ids = queue
        .filter((row) => row.delivery?.state === "shipped")
        .map((row) => { try { return new ObjectId(row.id); } catch { return null; } })
        .filter(Boolean);

      const orders = ids.length
        ? await collections.shopOrders.find({ _id: { $in: ids }, ...soldOrderFilter() }).toArray()
        : [];
      const result = await refreshStaleTracking(collections, env, orders);
      return { ok: true, ...result };
    }
  );

  // Newest activations, premium and E-Tag in one list, searched on the server
  // so the page never loads every tag to filter a handful.
  //   ?type=all|premium|etag   ?q=<text>   ?batch=<key>   ?page=<n>
  app.get("/api/admin/activations/recent", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const type = String(request.query.type || "all");
    const base = type === "premium"
      ? ownedPremiumFilter()
      : type === "etag"
        ? ownedEtagFilter()
        : { $or: [ownedPremiumFilter(), ownedEtagFilter()] };
    const and = [base];

    // One issued batch, by the key printed in its serials (from the Issuance
    // page). An invalid key is refused rather than ignored.
    const rawBatch = request.query.batch;
    if (rawBatch !== undefined && rawBatch !== "") {
      const key = parseBatchKey(typeof rawBatch === "string" ? rawBatch : "");
      if (!key) { reply.code(400); return { ok: false, error: "Invalid batch." }; }
      and.push({ batchNumber: { $in: await rawBatchValuesFor(collections, key) } });
    }

    // Plate, vehicle, owner name/email/phone, sticker serial or E-Tag ID.
    // Escaped before it becomes a regex, as on the Tags page.
    const q = String(request.query.q || "").trim().slice(0, 100);
    if (q) {
      const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(escape(q), "i");
      const or = [{ plateNumber: new RegExp(escape(q.replace(/\s+/g, "")), "i") }, { vehicleLabel: rx }];

      const ownerIds = (
        await collections.owners
          .find({ $or: [{ displayName: rx }, { email: rx }, { mobile: rx }, { phone: rx }] }, { projection: { _id: 1 } })
          .limit(500)
          .toArray()
      ).map((o) => o._id);
      if (ownerIds.length) or.push({ ownerId: { $in: ownerIds } });

      const idPart = q.replace(/^pt-/i, "");
      // E-Tag ID: PT- plus the last 8 hex of the id.
      if (/^[0-9a-f]{4,8}$/i.test(idPart)) {
        or.push({ $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: `${idPart}$`, options: "i" } } });
      }
      // Sticker serial PT-<batch>-<unit>. The batch half is required: units
      // restart per batch.
      const serial = /^(\d{1,3})-(\d{1,6})$/.exec(idPart);
      if (serial) {
        const wanted = batchKeyFor(serial[1]);
        const rawBatches = (await collections.tags.distinct("batchNumber")).filter((v) => batchKeyFor(v) === wanted);
        if (rawBatches.length) or.push({ serialNumber: Number(serial[2]), batchNumber: { $in: rawBatches } });
      }
      and.push({ $or: or });
    }

    const filter = and.length === 1 ? and[0] : { $and: and };
    // Counted first: the page number is clamped to the last page.
    const total = await collections.tags.countDocuments(filter);
    const { page, pages, pageSize, skip } = listPage(request.query.page, total);
    const tags = await collections.tags
      .aggregate([
        { $match: filter },
        // When the tag went live: for premium the same chain the free year
        // counts from; an E-Tag only ever has activatedAt.
        {
          $addFields: {
            activatedOn: {
              $cond: [
                { $eq: ["$premium", true] },
                { $ifNull: ["$premiumSince", { $ifNull: ["$activatedAt", "$createdAt"] }] },
                "$activatedAt"
              ]
            }
          }
        },
        { $sort: { activatedOn: -1, _id: -1 } },
        { $skip: skip },
        { $limit: pageSize },
        {
          $project: {
            batchNumber: 1, batchLabel: 1, serialNumber: 1, plateNumber: 1, vehicleLabel: 1, vehicleType: 1,
            status: 1, ownerId: 1, premium: 1, freeContactUsed: 1, activatedOn: 1
          }
        }
      ])
      .toArray();

    const ownerIds = [...new Set(tags.map((t) => String(t.ownerId)))]
      .map((id) => { try { return new ObjectId(id); } catch { return null; } })
      .filter(Boolean);
    const owners = ownerIds.length
      ? await collections.owners
          .find({ _id: { $in: ownerIds } }, { projection: { displayName: 1, email: 1, mobile: 1, phone: 1 } })
          .toArray()
      : [];
    const ownerMap = new Map(owners.map((o) => [String(o._id), o]));

    return {
      ok: true,
      total,
      page,
      pages,
      pageSize,
      activations: tags.map((t) => {
        const o = ownerMap.get(String(t.ownerId)) || {};
        return {
          id: String(t._id),
          type: t.premium === true ? "premium" : "etag",
          etagId: etagIdFor(t._id),
          serial: stickerSerialFor(t),
          batchLabel: t.batchLabel || null,
          plateNumber: t.plateNumber || null,
          vehicleLabel: t.vehicleLabel || t.vehicleType || null,
          status: t.status,
          freeContactUsed: Boolean(t.freeContactUsed),
          ownerName: o.displayName || null,
          ownerEmail: o.email || null,
          ownerMobile: o.mobile || o.phone || null,
          activatedAt: t.activatedOn || null
        };
      })
    };
  });

  // Record that someone was reminded to activate, so the next admin can see it
  // happened and not message the same buyer twice. Written when the WhatsApp or
  // Call button is used; the last 20 are kept on the order.
  app.post("/api/admin/activations/:orderId/reminder", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const channel = request.body?.channel;
    if (!["whatsapp", "call"].includes(channel)) {
      reply.code(400);
      return { ok: false, error: "channel must be whatsapp or call" };
    }
    let orderId;
    try { orderId = new ObjectId(request.params.orderId); } catch { reply.code(400); return { ok: false, error: "Bad id" }; }

    const collections = await getCollections(env);
    const entry = { at: new Date().toISOString(), by: request.session?.email || null, channel };
    const result = await collections.shopOrders.updateOne(
      { _id: orderId, ...soldOrderFilter() },
      {
        $push: { activationReminders: { $each: [entry], $slice: -20 } },
        $set: { lastActivationReminder: entry }
      }
    );
    if (!result.matchedCount) { reply.code(404); return { ok: false, error: "Order not found" }; }
    return { ok: true, lastReminder: entry };
  });

  // ── Issued batches: trace a run from print to activation ────────────
  // One row per batch: issued, activated, unclaimed, printed.
  app.get("/api/admin/tag-batches", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    return { ok: true, batches: await summariseBatches(collections) };
  });

  // Every tag in one batch as CSV. Owner mobiles are masked and the QR token is
  // left out (see batchCsv); full details stay behind the admin login.
  app.get("/api/admin/tag-batches/:key/export.csv", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const key = parseBatchKey(request.params.key);
    if (!key) { reply.code(400); return { ok: false, error: "Invalid batch." }; }

    const collections = await getCollections(env);
    const { found, csv } = await batchCsv(collections, key);
    if (!found) { reply.code(404); return { ok: false, error: "No tags in this batch." }; }

    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="parktag-batch-${key}.csv"`)
      .header("cache-control", "no-store");
    // The BOM makes Excel read the file as UTF-8 (names with ₹, Hindi, etc.).
    return `﻿${csv}`;
  });

  // Issued E-Tag stickers somebody has activated, newest first. The premium
  // list in /api/admin/activations does not cover these: it filters on
  // `premium: true`, and campaign stock is issued with premium off.
  app.get("/api/admin/etag-activations", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const filter = { ...issuedStockFilter(), premium: { $ne: true }, ownerId: { $ne: null } };

    const rawBatch = request.query.batch;
    if (rawBatch !== undefined && rawBatch !== "") {
      const key = parseBatchKey(typeof rawBatch === "string" ? rawBatch : "");
      if (!key) { reply.code(400); return { ok: false, error: "Invalid batch." }; }
      filter.batchNumber = { $in: await rawBatchValuesFor(collections, key) };
    }

    const LIMIT = 1000;
    const total = await collections.tags.countDocuments(filter);
    const tags = await collections.tags
      .find(filter, {
        projection: {
          batchNumber: 1, batchLabel: 1, serialNumber: 1, plateNumber: 1, vehicleLabel: 1,
          vehicleType: 1, status: 1, ownerId: 1, activatedAt: 1, createdAt: 1, freeContactUsed: 1
        }
      })
      .sort({ activatedAt: -1, _id: -1 })
      .limit(LIMIT)
      .toArray();

    const ownerIds = tags.map((t) => t.ownerId).filter(Boolean);
    const owners = ownerIds.length
      ? await collections.owners
          .find({ _id: { $in: ownerIds } }, { projection: { displayName: 1, email: 1, mobile: 1, phone: 1 } })
          .toArray()
      : [];
    const ownerMap = new Map(owners.map((o) => [String(o._id), o]));

    const activated = tags.map((t) => {
      const o = ownerMap.get(String(t.ownerId)) || {};
      return {
        id: String(t._id),
        etagId: etagIdFor(t._id),
        serial: stickerSerialFor(t),
        batch: batchKeyFor(t.batchNumber),
        batchLabel: t.batchLabel || null,
        plateNumber: t.plateNumber || null,
        vehicleLabel: t.vehicleLabel || t.vehicleType || null,
        status: t.status,
        freeContactUsed: Boolean(t.freeContactUsed),
        ownerName: o.displayName || null,
        ownerEmail: o.email || null,
        ownerMobile: o.mobile || o.phone || null,
        activatedAt: t.activatedAt || null
      };
    });

    return { ok: true, total, limit: LIMIT, activated };
  });

  app.get("/api/admin/overview", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);

    if (blocked) {
      return blocked;
    }

    const collections = await getCollections(env);
    // Headline counts come from the server, not from measuring arrays we had to
    // load first. `requests` in particular used to report the length of a
    // 20-item page as if it were the total.
    // Headline counts describe the real business, so demo stock and the
    // throwaway accounts a demo creates are excluded from both.
    const [ownerCount, tagCount, requestCount] = await Promise.all([
      collections.owners.countDocuments(NOT_DEMO_OWNER),
      collections.tags.countDocuments(NOT_MARKETING_STOCK),
      collections.contactRequests.countDocuments()
    ]);

    const owners = await collections.owners
      .find(NOT_DEMO_OWNER)
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    // Only this page's owners, and only the fields the summary needs — rather
    // than every tag in the system.
    const ownerObjectIds = owners.map((o) => o._id);
    const tags = await collections.tags
      .find(
        { ownerId: { $in: ownerObjectIds } },
        { projection: { ownerId: 1, status: 1, deletedAt: 1, token: 1, createdAt: 1 } }
      )
      .toArray();
    const requests = await collections.contactRequests
      .find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    const pendingPrint = await collections.tags.countDocuments({
      status: "unclaimed",
      printStatus: { $ne: "printed" },
      ...NOT_MARKETING_STOCK
    });
    const pendingPrintTags = await collections.tags
      .find({ status: "unclaimed", printStatus: { $ne: "printed" }, ...NOT_MARKETING_STOCK })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    const ownerSummaries = owners
      .map((owner) => {
      const ownerTags = tags.filter(
        (tag) => tag.ownerId && String(tag.ownerId) === String(owner._id) && !tag.deletedAt
      );

      return {
        id: String(owner._id),
        displayName: owner.displayName,
        email: owner.email,
        credits: owner.credits || 0,
        tags: ownerTags.length,
        activeTags: ownerTags.filter((tag) => tag.status === "active").length,
        createdAt: owner.createdAt,
        latestTagToken: ownerTags[0]?.token || null
      };
      })
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    const recentRegistrations = ownerSummaries.slice(0, 8).map((owner) => ({
      id: owner.id,
      displayName: owner.displayName,
      email: owner.email,
      createdAt: owner.createdAt,
      tags: owner.tags,
      activeTags: owner.activeTags,
      latestTagToken: owner.latestTagToken
    }));

    return {
      ok: true,
      counts: {
        owners: ownerCount,
        tags: tagCount,
        requests: requestCount,
        pendingPrint
      },
      owners: ownerSummaries,
      recentRequests: requests.map((item) => ({
        id: String(item._id),
        token: item.token,
        phone: item.phone,
        action: item.action,
        messageChannel: item.messageChannel || null,
        status: item.status,
        provider: item.provider || null,
        providerRequestId: item.providerRequestId || null,
        providerWebhookStatus: item.providerWebhookStatus || null,
        providerError: item.providerError || null,
        providerErrorDetail: item.providerErrorDetail || null,
        providerStatusCode: item.providerStatusCode || null,
        createdAt: item.createdAt
      })),
      recentRegistrations,
      pendingPrintTags: pendingPrintTags.map((tag) => ({
        id: String(tag._id),
        token: tag.token,
        batchNumber: tag.batchNumber || null,
        printStatus: tag.printStatus || "pending_print",
        createdAt: tag.createdAt
      }))
    };
  });

  // The overview page: one number per admin page, each computed with the same
  // filter that page uses, so a card and the page it links to always agree.
  // Counts only — the lists live on their own pages.
  app.get("/api/admin/overview/summary", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const WINDOW_DAYS = 7;
    const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    // createdAt is an ISO string almost everywhere, but a Date on some older
    // rows; a string bound alone would silently skip those.
    const createdSince = {
      $or: [{ createdAt: { $gte: windowStart.toISOString() } }, { createdAt: { $gte: windowStart } }]
    };
    const notDeleted = { deletedAt: { $in: [null, undefined] } };
    // Same filter as the Tags page's default (claimed) view.
    const customerTagFilter = { ownerId: { $ne: null }, ...notDeleted, ...NOT_MARKETING_STOCK };

    const [
      owners,
      ownersNew,
      customerTags,
      customerTagsActive,
      activations,
      activationQueue,
      batches,
      unprinted,
      printedAwaitingClaim,
      demoStock,
      contacts,
      contactsNew,
      contactsFailed,
      traffic
    ] = await Promise.all([
      collections.owners.countDocuments(NOT_DEMO_OWNER),
      collections.owners.countDocuments({ ...NOT_DEMO_OWNER, ...createdSince }),
      collections.tags.countDocuments(customerTagFilter),
      collections.tags.countDocuments({ ...customerTagFilter, status: "active" }),
      // GET /api/admin/activations: its counts and its reminder queue.
      activationCounts(collections),
      buildActivationQueue(collections),
      summariseBatches(collections),
      // GET /api/admin/print-queue, default and ?printed=1
      collections.tags.countDocuments({ status: "unclaimed", printStatus: { $ne: "printed" }, ...NOT_MARKETING_STOCK }),
      collections.tags.countDocuments({ status: "unclaimed", printStatus: "printed", ...NOT_MARKETING_STOCK }),
      // GET /api/admin/marketing
      collections.tags
        .find(
          { marketingStock: true, ...notDeleted },
          { projection: { marketingStock: 1, soldAt: 1, demoOwnerId: 1 } }
        )
        .toArray(),
      collections.contactRequests.countDocuments(),
      collections.contactRequests.countDocuments(createdSince),
      collections.contactRequests.countDocuments({ status: "provider_failed", ...createdSince }),
      landingTotals(collections, WINDOW_DAYS)
    ]);

    return {
      ok: true,
      windowDays: WINDOW_DAYS,
      summary: {
        owners: { total: owners, new: ownersNew },
        tags: { customer: customerTags, active: customerTagsActive },
        activations: {
          premiumActivated: activations.premiumActivated,
          premiumLive: activations.premiumLive,
          etag: activations.etagActivated,
          awaiting: activationQueue.length
        },
        batches: {
          count: batches.length,
          issued: batches.reduce((sum, b) => sum + b.total, 0),
          activated: batches.reduce((sum, b) => sum + b.activated, 0)
        },
        printQueue: { unprinted, printedAwaitingClaim },
        // Premium tags nobody holds yet: GET /api/admin/etags?claim=unclaimed&category=premium
        stock: { premiumUnsold: activations.premiumStock },
        fieldDemo: {
          units: demoStock.length,
          available: demoStock.filter((t) => demoState(t) === "available").length,
          activated: demoStock.filter((t) => demoState(t) === "activated").length,
          sold: demoStock.filter((t) => demoState(t) === "sold").length
        },
        contacts: { total: contacts, new: contactsNew, failed: contactsFailed },
        traffic: { visitors: traffic.visitors, views: traffic.views }
      }
    };
  });

  app.post("/api/admin/tags/issue", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);

    if (blocked) {
      return blocked;
    }

    const { batchNumber, batchLabel, quantity, stickerRequested, premiumBatch, mountType } =
      request.body || {};

    const collections = await getCollections(env);
    let tags;
    try {
      tags = await createUnclaimedTags(collections, {
        batchNumber,
        batchLabel,
        quantity,
        stickerRequested,
        premiumBatch,
        mountType
      });
    } catch (error) {
      // Quantity and mount-type validation (non-numeric, < 1, over the per-batch
      // ceiling, or no sticker chosen) — surface it so the operator sees why
      // nothing was issued instead of a silent zero-tag "success".
      reply.code(400);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not issue tags."
      };
    }

    // Return only a lightweight summary — do NOT render a QR image per tag here.
    // Rendering thousands of QR PNGs into a single response is what timed out the
    // gateway ("upstream error"). The print-ready images are generated on demand,
    // in bounded chunks, by the Print Queue export flow instead.
    return {
      ok: true,
      count: tags.length,
      batchNumber: batchNumber || null,
      batchLabel: batchLabel || null,
      mountType: tags[0]?.mountType || null
    };
  });

  app.get("/api/admin/print-queue", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    // ?printed=1 → unclaimed tags already printed (awaiting owner claim).
    // default    → unclaimed tags still waiting to be printed (the print queue).
    const printedOnly = request.query.printed === "1";
    const tags = orderForPrinting(
      await collections.tags
        .find({
          status: "unclaimed",
          printStatus: printedOnly ? "printed" : { $ne: "printed" },
          // A demo sticker's resting state IS "unclaimed", so without this every
          // Deactivate hands the salesperson's sticker back to the print queue
          // as something still to be printed. It is already printed and in a bag.
          ...NOT_MARKETING_STOCK
        })
        .toArray()
    );

    return {
      ok: true,
      // Chunk size for the export endpoint, so the client never sends a batch
      // the server will reject.
      exportMaxPerRequest: EXPORT_MAX_PER_REQUEST,
      tags: tags.map((tag) => ({
        id: String(tag._id),
        token: tag.token,
        batchNumber: tag.batchNumber || null,
        batchLabel: tag.batchLabel || null,
        printStatus: tag.printStatus || "pending_print",
        premium: Boolean(tag.premium),
        claimUrl: buildClaimUrl(request, tag.token),
        // Which issuance run this tag came from, so the queue can offer one
        // sitting at a time instead of the whole batch. Null for tags issued
        // before runs were recorded and not yet backfilled — the client groups
        // those together as one legacy run rather than hiding them.
        issuanceRunId: tag.issuanceRunId ? String(tag.issuanceRunId) : null,
        issuedAt: tag.issuedAt || null,
        serial: stickerSerialFor(tag),
        // A run is one print job, so its mount type is what the printer needs
        // to know: which face the glue goes on.
        mountType: tag.mountType || "windscreen_interior",
        runSerialStart: tag.runSerialStart ?? null,
        runSerialEnd: tag.runSerialEnd ?? null,
        createdAt: tag.createdAt
      }))
    };
  });

  // Rate limit sized for the job this endpoint actually does. A full print run
  // is thousands of stickers fetched in chunks, so the old 30/minute made a
  // 3000-tag export impossible: at 100 tags per chunk that is exactly 30
  // requests, and the limiter rejected the last of them — the export failed
  // with "Too many requests" after doing almost all the work.
  //
  // At the current chunk size (EXPORT_MAX_PER_REQUEST) this allows ~15,000 tags
  // a minute, and the client backs off and retries on a 429 rather than
  // failing, so a run larger than that still completes — just slower.
  app.post("/api/admin/print-queue/export", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    // Render QR images only for the specific tags requested, and cap how many a
    // single request will render. The old version rendered a QR for EVERY
    // unprinted tag (thousands) and let the client filter — which timed out the
    // gateway. The client sends its selection in bounded chunks.
    const rawIds = Array.isArray(request.body?.ids) ? request.body.ids : [];
    const ids = rawIds
      .filter((id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id))
      .map((id) => new ObjectId(id));

    // Refuse an over-sized request rather than trimming it. This used to
    // .slice() to the cap and return 200, so a caller asking for 300 tags got
    // 250 and no indication that 50 were dropped — in a printing path that is
    // stickers silently missing from the run. Loud failure is the only safe
    // behaviour here.
    if (ids.length > EXPORT_MAX_PER_REQUEST) {
      reply.code(400);
      return {
        ok: false,
        error: `Too many tags in one request: ${ids.length}. Send at most ${EXPORT_MAX_PER_REQUEST} per request.`
      };
    }

    if (!ids.length) {
      return { ok: true, tags: [] };
    }

    const collections = await getCollections(env);
    // Only export tags that are still unclaimed and not already printed.
    //
    // Sorted by serial, not left to natural order: `$in` returns documents in
    // whatever order the index walk produces, ignoring the order the ids were
    // sent in, so the sheets came out shuffled inside every chunk. The client
    // sends the queue's order in contiguous chunks, so sorting each chunk here
    // makes the whole export run 000001, 000002, 000003… Legacy tags with no
    // serial sort first (a missing field is lowest in Mongo) and fall back to
    // _id, which is issue order.
    const tags = await collections.tags
      .find({ _id: { $in: ids }, status: "unclaimed", printStatus: { $ne: "printed" } })
      .sort({ serialNumber: 1, _id: 1 })
      .toArray();

    const output = await Promise.all(tags.map((tag) => buildIssuedTagOutput(request, tag)));

    return { ok: true, tags: output };
  });

  app.delete("/api/admin/tags/batch/:batchNumber", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    // Safeguard: destructive, so require an explicit confirm flag. This blocks
    // accidental or drive-by calls; the UI sends it after a typed confirmation.
    if (request.query.confirm !== "1") {
      reply.code(400);
      return { ok: false, error: "Confirmation required to delete a batch." };
    }

    const collections = await getCollections(env);
    // Never delete field-demo stock as part of a batch. Those stickers are
    // physically in a salesperson's bag; deleting the record does not recall
    // the sticker, it just makes the QR on it resolve to nothing in front of a
    // customer. They are retired from /admin/marketing instead.
    const result = await collections.tags.deleteMany({
      status: "unclaimed",
      batchNumber: request.params.batchNumber,
      ...NOT_MARKETING_STOCK
    });

    return { ok: true, deleted: result.deletedCount };
  });

  app.delete("/api/admin/tags/unclaimed/all", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    // Safeguard: require an explicit confirm flag before this mass delete.
    if (request.query.confirm !== "all") {
      reply.code(400);
      return { ok: false, error: "Confirmation required to clear unprinted tags." };
    }

    // Only delete UNPRINTED tags — already-printed unclaimed tags are preserved
    // (they live in the separate "Printed" view) so this can't wipe them.
    const collections = await getCollections(env);
    // Same reasoning as the batch delete: demo stock rests in "unclaimed" and
    // is not marked printed, so it sits squarely inside this filter and would
    // be wiped by a routine "clear unprinted stock".
    const result = await collections.tags.deleteMany({
      status: "unclaimed",
      printStatus: { $ne: "printed" },
      ...NOT_MARKETING_STOCK
    });

    return { ok: true, deleted: result.deletedCount };
  });

  // Mark a whole issuance run printed in one write.
  //
  // Marking was per-tag only, which is why nothing was ever marked: a 1000-tag
  // run meant a thousand HTTP calls, so in practice the queue was never
  // drained and every later export re-included every earlier run. That is the
  // other half of the repeat-printing problem — grouping alone would organise
  // the pile without ever shrinking it.
  app.post("/api/admin/print-queue/mark-run-printed", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const runId = String((request.body || {}).issuanceRunId || "");
    const printedAt = new Date().toISOString();

    // Only ever touches tags still waiting: an already-printed tag keeps its
    // original printedAt, so re-running this cannot rewrite print history.
    const base = { status: "unclaimed", printStatus: { $ne: "printed" } };
    let filter;

    if (runId === "__legacy__") {
      // Tags issued before runs were recorded. Grouped and actionable as one,
      // rather than left unmarkable because they predate the field.
      filter = { ...base, issuanceRunId: { $in: [null, undefined] } };

      // The client shows legacy tags as one group PER BATCH, so it names the
      // batch it means. Without this, marking one batch's legacy group printed
      // marked every batch's — every legacy tag in the queue shares the single
      // "__legacy__" id. Left unscoped only when the client sends no batch, so
      // an older client keeps its previous whole-queue behaviour.
      const raw = (request.body || {}).batchNumbers;
      if (Array.isArray(raw) && raw.length) {
        const values = raw
          .filter((value) => value === null || typeof value === "string" || typeof value === "number")
          .slice(0, 200);
        if (!values.length) {
          reply.code(400);
          return { ok: false, error: "Bad batch numbers" };
        }
        filter.batchNumber = { $in: values };
      }
    } else {
      if (!ObjectId.isValid(runId)) {
        reply.code(400);
        return { ok: false, error: "Bad issuance run id" };
      }
      filter = { ...base, issuanceRunId: new ObjectId(runId) };
    }

    const result = await collections.tags.updateMany(filter, {
      $set: { printStatus: "printed", printedAt }
    });

    return { ok: true, marked: result.modifiedCount };
  });

  app.post("/api/admin/print-queue/:tagId/mark-printed", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(request.params.tagId)) {
      reply.code(400);
      return { ok: false, error: "Bad id" };
    }
    const collections = await getCollections(env);
    const tagId = new ObjectId(request.params.tagId);

    await collections.tags.updateOne(
      { _id: tagId },
      { $set: { printStatus: "printed", printedAt: new Date().toISOString() } }
    );

    return { ok: true };
  });

  app.get("/api/admin/owners", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);

    // This route used to load EVERY owner and EVERY tag, then run
    // `tags.filter(...)` once per owner — an O(owners × tags) scan on the event
    // loop. Node is single-threaded, so while that ran, nothing else was
    // served: not a scan, not a login, not a webhook. Measured on this data
    // shape: 3k×3k ≈ 81 ms, 10k×20k ≈ 1.5 s, 20k×50k ≈ 5.9 s of total service
    // stall, and the tags collection grows with every sticker manufactured.
    //
    // Now: one page of owners (100, numbered like the other admin lists), only
    // THEIR tags, and a Map for grouping — O(owners + tags).

    // Accounts a field demo created stay out unless asked for, the same way the
    // overview counts owners; the flag is cleared on sale, so a buyer shows.
    const ownerFilter = request.query.demo === "include" ? {} : { ...NOT_DEMO_OWNER };

    // Search by name, email, phone, the plate on one of their tags, or a tag's
    // token / sticker link. Escaped before it becomes a regex, as on the Tags
    // page. Long enough for a full link (host + /tag/ + a 64-char token).
    const q = String(request.query.q || "").trim().slice(0, 200);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const or = [{ displayName: rx }, { email: rx }, { mobile: rx }, { phone: rx }];
      // The token is never shown on this page, but a customer may send their
      // sticker link, so it can be pasted here. Exact match only: the token is
      // the tag's secret, and a partial match would let a few characters
      // narrow one down.
      const token = (/\/tag\/([A-Za-z0-9]{12,64})(?:[/?#]|$)/.exec(q) || /^([A-Za-z0-9]{12,64})$/.exec(q))?.[1];
      if (token) {
        const tokenTag = await collections.tags.findOne(
          { token, ownerId: { $ne: null } },
          { projection: { ownerId: 1 } }
        );
        if (tokenTag) or.push({ _id: tokenTag.ownerId });
      }
      // Plates are stored without spaces; people type them with.
      const plate = q.replace(/\s+/g, "");
      if (plate) {
        const plateRx = new RegExp(plate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        const plateOwnerIds = (
          await collections.tags
            .find({ plateNumber: plateRx, ownerId: { $ne: null } }, { projection: { ownerId: 1 } })
            .limit(500)
            .toArray()
        ).map((t) => t.ownerId);
        if (plateOwnerIds.length) or.push({ _id: { $in: plateOwnerIds } });
      }
      ownerFilter.$or = or;
    }

    const totalOwners = await collections.owners.countDocuments(ownerFilter);
    const { page, pages, pageSize, skip } = listPage(request.query.page, totalOwners);
    const owners = await collections.owners
      .find(ownerFilter)
      // _id breaks ties so an owner never shows on two pages or on none.
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    const ownerObjectIds = owners.map((o) => o._id);
    const tags = ownerObjectIds.length
      ? await collections.tags
          .find(
            { ownerId: { $in: ownerObjectIds }, deletedAt: { $in: [null, undefined] } },
            {
              projection: {
                ownerId: 1, status: 1, deletedAt: 1,
                // What identifies the tag to a person, and what its membership
                // countdown reads.
                plateNumber: 1, vehicleLabel: 1, vehicleType: 1, serialNumber: 1, batchNumber: 1,
                premium: 1, premiumSince: 1, activatedAt: 1, createdAt: 1, marketingStock: 1,
                subscription: 1, callSubscription: 1, documentSubscription: 1
              }
            }
          )
          .toArray()
      : [];

    // Real orders only (paid, or a placed COD), as on the Activations page.
    // ownerId is an ObjectId on most orders and a string on some older ones.
    const orderCounts = new Map();
    if (ownerObjectIds.length) {
      const grouped = await collections.shopOrders
        .aggregate([
          {
            $match: {
              ownerId: { $in: [...ownerObjectIds, ...ownerObjectIds.map(String)] },
              status: { $in: ["paid", "cod"] },
              deletedAt: { $in: [null, undefined] }
            }
          },
          { $group: { _id: { $toString: "$ownerId" }, n: { $sum: 1 } } }
        ])
        .toArray();
      for (const g of grouped) orderCounts.set(g._id, g.n);
    }

    // Group once, then look up per owner, instead of re-scanning every tag for
    // every owner.
    const tagsByOwner = new Map();
    for (const tag of tags) {
      if (!tag.ownerId) continue;
      const key = String(tag.ownerId);
      const bucket = tagsByOwner.get(key);
      if (bucket) bucket.push(tag);
      else tagsByOwner.set(key, [tag]);
    }

    return {
      ok: true,
      total: totalOwners,
      page,
      pages,
      pageSize,
      returned: owners.length,
      truncated: totalOwners > owners.length,
      owners: owners.map((owner) => {
        const ownerTags = tagsByOwner.get(String(owner._id)) || [];
        return {
          id: String(owner._id),
          displayName: owner.displayName,
          email: owner.email,
          phone: owner.phone,
          credits: owner.credits || 0,
          tags: ownerTags.length,
          activeTags: ownerTags.filter((t) => t.status === "active").length,
          createdAt: owner.createdAt,
          mobile: owner.mobile || owner.phone || null,
          demo: Boolean(owner.demoCreatedOwner),
          orders: orderCounts.get(String(owner._id)) || 0,
          // How a person identifies each tag. The token is the QR's secret and
          // is not meant to be read off a screen.
          tagList: ownerTags.map((t) => {
            const membership = membershipCountdown(t);
            return {
              id: String(t._id),
              serial: stickerSerialFor(t) || etagIdFor(t._id),
              plateNumber: t.plateNumber || null,
              vehicleLabel: t.vehicleLabel || t.vehicleType || null,
              premium: Boolean(t.premium),
              status: t.status,
              demoSticker: Boolean(t.marketingStock),
              membership: membership ? { state: membership.state, daysLeft: membership.daysLeft } : null
            };
          })
        };
      })
    };
  });

  app.get("/api/admin/activity", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const parsedLimit = parseInt(request.query.limit || "50", 10);
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50, 200);
    const collections = await getCollections(env);

    const requests = await collections.contactRequests
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // Only look up labels for the tokens on this page. This used to load the
    // ENTIRE tags collection to build a lookup map for at most 200 rows.
    const pageTokens = [...new Set(requests.map((r) => r.token).filter(Boolean))];
    const tags = pageTokens.length
      ? await collections.tags
          .find(
            { token: { $in: pageTokens } },
            { projection: { token: 1, vehicleLabel: 1, plateNumber: 1, serialNumber: 1, batchNumber: 1 } }
          )
          .toArray()
      : [];
    const tagByToken = new Map(tags.map((t) => [t.token, t]));

    return {
      ok: true,
      // No `token`: it is the secret in the sticker's QR, and anyone holding it
      // can open that tag's scan page. A tag is named by what a person reads.
      activity: requests.map((item) => {
        const tag = tagByToken.get(item.token);
        return {
        id: String(item._id),
        plateNumber: tag?.plateNumber || null,
        serial: tag ? stickerSerialFor(tag) || etagIdFor(tag._id) : null,
        vehicleLabel: tag?.plateNumber || tag?.vehicleLabel || null,
        phone: item.phone,
        action: item.action,
        messageChannel: item.messageChannel || null,
        message: item.message || null,
        status: item.status,
        provider: item.provider || null,
        providerError: item.providerError || null,
        createdAt: item.createdAt
        };
      })
    };
  });

  // Admin sign-in log, newest first, 100 a page like the other admin lists.
  //   ?page=<n>   ?email=<admin email>
  app.get("/api/admin/audit", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const filter = {};
    const email = typeof request.query.email === "string" ? request.query.email.trim().toLowerCase().slice(0, 120) : "";
    if (email) filter.email = email;

    const total = await collections.adminAudit.countDocuments(filter);
    const { page, pages, pageSize, skip } = listPage(request.query.page, total);
    const rows = await collections.adminAudit
      .find(filter, { projection: { adminId: 0 } })
      .sort({ at: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    return {
      ok: true,
      total,
      page,
      pages,
      pageSize,
      events: rows.map((r) => ({
        id: String(r._id),
        at: r.at instanceof Date ? r.at.toISOString() : r.at || null,
        event: r.event,
        email: r.email || null,
        method: r.method || null,
        reason: r.reason || null,
        ip: r.ip || null,
        browser: r.browser || null,
        count: r.count || 1
      }))
    };
  });

  app.get("/api/admin/me", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;
    return {
      ok: true,
      email: request.session.email,
      displayName: request.session.displayName
    };
  });

  app.get("/api/admin/admins", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const admins = await collections.admins.find({}).sort({ createdAt: -1 }).toArray();

    return {
      ok: true,
      admins: admins.map((a) => ({
        id: String(a._id),
        email: a.email,
        displayName: a.displayName,
        createdAt: a.createdAt,
        lastSignInAt: a.lastSignInAt instanceof Date ? a.lastSignInAt.toISOString() : a.lastSignInAt || null
      }))
    };
  });

  app.post(
    "/api/admin/admins",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const { email, password, displayName } = request.body || {};

    if (!isNonEmptyString(email) || !isNonEmptyString(password) || !isNonEmptyString(displayName)) {
      reply.code(400);
      return {
        ok: false,
        error: "email, password, and displayName are required"
      };
    }

    // Admin accounts hold the most powerful role in the product, yet this route
    // accepted any non-empty string as a password while owners have required 8+
    // characters since the last audit. Hold admins to at least the same bar.
    if (password.length < 8) {
      reply.code(400);
      return {
        ok: false,
        error: "Password must be at least 8 characters"
      };
    }

    // `email` is used as a raw Mongo filter value just below — reject non-string
    // input above (defense in depth; this route is already admin-authenticated).
    const collections = await getCollections(env);
    const existing = await findByCanonicalEmail(collections.admins, email);

    if (existing) {
      reply.code(400);
      return {
        ok: false,
        error: "Admin email already exists"
      };
    }

    const { createPasswordHash } = await import("../../lib/auth/security.js");

    await collections.admins.insertOne({
      // Canonical, matching the lookup in findByCanonicalEmail — the admin table
      // had the same case-sensitivity split as owners.
      email: canonicalEmail(email),
      passwordHash: await createPasswordHash(password),
      displayName,
      role: "admin",
      createdAt: new Date().toISOString()
    });

    return { ok: true };
    }
  );

  app.delete("/api/admin/admins/:id", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const { id } = request.params;

    if (id === request.session.userId) {
      reply.code(400);
      return { ok: false, error: "You cannot remove your own admin account" };
    }

    if (!ObjectId.isValid(id)) {
      reply.code(400);
      return { ok: false, error: "Bad id" };
    }

    const collections = await getCollections(env);

    // Refuse to remove the last admin — every admin route is role-guarded, so
    // deleting the final one locks the console permanently and leaves no
    // in-app way back in. (The self-delete guard above doesn't cover this: two
    // admins can delete each other down to zero.)
    const adminCount = await collections.admins.countDocuments();
    if (adminCount <= 1) {
      reply.code(400);
      return {
        ok: false,
        error: "You cannot remove the last admin account. Create another admin first."
      };
    }

    const result = await collections.admins.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      reply.code(404);
      return { ok: false, error: "Admin not found" };
    }

    return { ok: true };
  });
}
