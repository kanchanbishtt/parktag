import { ObjectId } from "mongodb";

import { requireSession } from "../../lib/auth/auth.js";
import { isNonEmptyString } from "../../lib/auth/security.js";
import { getCollections } from "../../lib/db/repositories.js";
import { findByCanonicalEmail, canonicalEmail } from "../../lib/auth/identity.js";
import {
  buildIssuedTagOutput,
  buildClaimUrl,
  createUnclaimedTags,
  etagIdFor,
  batchKeyFor,
  stickerSerialFor
} from "../../lib/core/tag-issuance.js";
import { NOT_MARKETING_STOCK, NOT_DEMO_OWNER } from "../../lib/core/marketing-stock.js";

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
          .find({ $or: [{ email: rx }, { mobile: rx }, { phone: rx }] }, { projection: { _id: 1 } })
          .limit(500)
          .toArray()
      ).map((o) => o._id);

      filter.$or = [{ plateNumber: rx }, { token: rx }];
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
    const tags = await collections.tags
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(300)
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
        token: t.token,
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
        createdAt: t.createdAt
      };
    });

    // `total` is the count of everything matching the filter; `etags` is the
    // first page of it. The response cap was always 300 — it is just applied in
    // the query now instead of after loading the whole collection.
    return { ok: true, total, etags: list, limit: 300 };
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
        token: tag.token,
        plateNumber: tag.plateNumber || null,
        vehicleType: tag.vehicleType || null,
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
    const existing = await collections.tags.findOne({ _id: tagId }, { projection: { ownerId: 1 } });
    if (!existing) { reply.code(404); return { ok: false, error: "E-Tag not found" }; }
    if (existing.ownerId == null) {
      reply.code(409);
      return { ok: false, error: "This tag has no owner yet, so it has no active/inactive state." };
    }

    const result = await collections.tags.findOneAndUpdate(
      { _id: tagId },
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
    return { ok: true };
  });

  // ── Tag activations dashboard ─────────────────────────────────────
  // Two lists for the admin: premium tags that have been ACTIVATED (who + when),
  // and shop orders that are SOLD but not yet activated — the reminder targets.
  app.get("/api/admin/activations", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);

    // ACTIVATED = live premium tags. `premium: true` is the single source of
    // truth for "this is an activated premium tag" — it is only ever stamped by
    // real premium activation (the paid upgrade that mints the tag). We surface
    // ALL premium tags and label each by whether it is live (status active) or
    // sitting inactive, so the list is accurate to the tag data, not inferred.
    // Demo stock is premium too, so without this exclusion the shelf shows up
    // here as ordinary premium inventory: sitting "inactive" at rest, and
    // mid-demo appearing as a live activation belonging to a customer who may
    // well have walked away without buying anything.
    const premiumTags = await collections.tags
      .find({ premium: true, deletedAt: { $in: [null, undefined] }, ...NOT_MARKETING_STOCK })
      .sort({ premiumSince: -1, createdAt: -1 })
      .toArray();

    // UNACTIVATED = genuinely SOLD orders (paid = prepaid completed, or cod = real
    // COD order — never "created", an abandoned checkout) whose buyer has NOT yet
    // ended up with a live premium tag.
    const orders = await collections.shopOrders
      .find({ status: { $in: ["paid", "cod"] }, deletedAt: { $in: [null, undefined] } })
      .sort({ createdAt: -1 })
      .toArray();

    // Only the owners actually referenced by the rows above, rather than the
    // whole collection. Both lists are joined by Map lookup, so this was linear
    // rather than quadratic — but it still pulled every owner document (and
    // every field on it, including credentials) across the wire on each load,
    // growing with the customer base for no benefit.
    const referencedOwnerIds = [
      ...new Set(
        [...premiumTags, ...orders]
          .map((row) => (row.ownerId ? String(row.ownerId) : null))
          .filter(Boolean)
      )
    ]
      .map((id) => { try { return new ObjectId(id); } catch { return null; } })
      .filter(Boolean);

    const owners = referencedOwnerIds.length
      ? await collections.owners
          .find(
            { _id: { $in: referencedOwnerIds } },
            { projection: { displayName: 1, email: 1, mobile: 1, phone: 1 } }
          )
          .toArray()
      : [];
    const ownerMap = Object.fromEntries(owners.map((o) => [String(o._id), o]));

    const activated = premiumTags.map((t) => {
      const o = ownerMap[String(t.ownerId)] || {};
      return {
        id: String(t._id),
        etagId: etagIdFor(t._id),
        // This list is where the serialled stock actually lives: it filters on
        // `premium` alone, with no ownerId condition, so it also covers printed
        // stickers nobody has activated yet. The E-Tags list cannot — it
        // requires an owner, and today every serialled tag is still unclaimed.
        serial: stickerSerialFor(t),
        plateNumber: t.plateNumber || null,
        vehicleLabel: t.vehicleLabel || t.vehicleType || null,
        status: t.status,
        ownerName: o.displayName || null,
        ownerEmail: o.email || null,
        ownerMobile: o.mobile || o.phone || null,
        activatedAt: t.premiumSince || t.createdAt || null
      };
    });

    // Owners who already hold at least one LIVE premium tag have demonstrably
    // activated — so a sold order from them is fulfilled and must NOT appear as a
    // reminder. This is the accurate cross-check, because in the real data most
    // orders are physical-tag packs that carry no mintedTagId/replaceTagId link
    // to the tag they eventually activate; the owner→premium-tag relationship is
    // the reliable signal that activation happened.
    const ownersWithActivePremium = new Set(
      premiumTags
        .filter((t) => t.status === "active" && t.ownerId)
        .map((t) => String(t.ownerId))
    );

    // `orders` is fetched above, before the owner lookup, so that the owner
    // query can be scoped to the ids these rows actually reference. An order
    // counts as activated when it minted a premium tag (mintedTagId), its
    // replace-target free tag was upgraded away, OR the owner now holds a live
    // premium tag.
    const unactivated = [];
    for (const ord of orders) {
      const ownerKey = ord.ownerId ? String(ord.ownerId) : null;
      let isActivated = Boolean(ord.mintedTagId) ||
        (ownerKey ? ownersWithActivePremium.has(ownerKey) : false);
      if (!isActivated && ord.replaceTagId) {
        let rtId = null;
        try { rtId = new ObjectId(String(ord.replaceTagId)); } catch { rtId = null; }
        const rt = rtId ? await collections.tags.findOne({ _id: rtId }) : null;
        // The free tag is gone or now premium ⇒ this order was fulfilled.
        if (!rt || rt.deletedAt || rt.premium) isActivated = true;
      }
      if (isActivated) continue;

      const o = ownerMap[ownerKey] || {};
      const ship = ord.shippingAddress || {};
      const mobile = ship.phone || o.mobile || o.phone || null;
      // Skip pure junk rows (no owner AND no contact number = un-actionable).
      if (!ownerKey && !mobile) continue;
      unactivated.push({
        id: String(ord._id),
        orderNumber: ord.orderNumber || ord.orderId || null,
        productName: ord.productName || null,
        paymentMethod: ord.paymentMethod || (ord.status === "cod" ? "cod" : "prepaid"),
        orderStatus: ord.status || null,
        waybill: ord.waybill || null,
        ownerName: o.displayName || ship.name || null,
        ownerEmail: o.email || null,
        ownerMobile: mobile,
        placedAt: ord.createdAt || null
      });
    }

    return {
      ok: true,
      counts: { activated: activated.length, unactivated: unactivated.length },
      activated,
      unactivated
    };
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
    // Now: one page of owners, only THEIR tags (projected to the four fields
    // used below), and a Map for grouping — O(owners + tags).
    const OWNER_PAGE = 500;
    const totalOwners = await collections.owners.countDocuments();
    const owners = await collections.owners
      .find({})
      .sort({ createdAt: -1 })
      .limit(OWNER_PAGE)
      .toArray();

    const ownerObjectIds = owners.map((o) => o._id);
    const tags = ownerObjectIds.length
      ? await collections.tags
          .find(
            { ownerId: { $in: ownerObjectIds }, deletedAt: { $in: [null, undefined] } },
            { projection: { ownerId: 1, status: 1, token: 1, deletedAt: 1 } }
          )
          .toArray()
      : [];

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

    // Never truncate silently — an admin looking at a short list must be able
    // to tell "that's everyone" from "that's the first page".
    if (totalOwners > owners.length) {
      request.log.warn(
        { totalOwners, returned: owners.length },
        "[admin] owners list truncated to one page"
      );
    }

    return {
      ok: true,
      total: totalOwners,
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
          tagTokens: ownerTags.map((t) => t.token),
          createdAt: owner.createdAt
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
          .find({ token: { $in: pageTokens } }, { projection: { token: 1, vehicleLabel: 1 } })
          .toArray()
      : [];
    const tokenToLabel = Object.fromEntries(
      tags.map((t) => [t.token, t.vehicleLabel || t.token])
    );

    return {
      ok: true,
      activity: requests.map((item) => ({
        id: String(item._id),
        token: item.token,
        vehicleLabel: tokenToLabel[item.token] || item.token,
        phone: item.phone,
        action: item.action,
        messageChannel: item.messageChannel || null,
        message: item.message || null,
        status: item.status,
        provider: item.provider || null,
        providerError: item.providerError || null,
        createdAt: item.createdAt
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
        createdAt: a.createdAt
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
