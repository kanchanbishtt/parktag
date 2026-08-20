import { ObjectId } from "mongodb";

import { requireSession } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import { etagIdFor, stickerSerialFor } from "../../lib/core/tag-issuance.js";
import {
  MARKETING_AVAILABLE_STATUS,
  DEMO_TAG_FIELDS,
  blockedFromDemo,
  demoOwnerIsDisposable,
  demoState,
  isDemoActivated,
  isSold,
  printedCopies
} from "../../lib/core/marketing-stock.js";

// Admin surface for the field-demo stickers.
//
//   GET  /api/admin/marketing            the shelf (optional ?q= serial search)
//   POST /api/admin/marketing/:id/deactivate   wipe the customer, reuse the unit
//   POST /api/admin/marketing/:id/sold         record the sale
//
// Activation itself is NOT driven from here. The customer scans the sticker and
// runs the real wizard; recordDemoActivation() in lib/core/marketing-stock.js
// is what makes this shelf notice.
export function registerAdminMarketingRoutes(app, env) {
  async function loadForDemo(request, reply, collections) {
    let tagId;
    try {
      tagId = new ObjectId(request.params.tagId);
    } catch {
      reply.code(400);
      return { error: { ok: false, error: "Bad id" } };
    }

    const tag = await collections.tags.findOne({ _id: tagId });
    const reason = blockedFromDemo(tag);
    if (reason) {
      reply.code(tag ? 409 : 404);
      return { error: { ok: false, error: reason } };
    }
    return { tag, tagId };
  }

  app.get("/api/admin/marketing", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const filter = { marketingStock: true, deletedAt: { $in: [null, undefined] } };

    // Serial search. Serials print as PT-<batch>-<unit> but store as a plain
    // number, so match on the digits the salesperson can actually read off the
    // sticker — typing "1004" or "PT-01-001004" both work.
    const q = typeof request.query?.q === "string" ? request.query.q.trim() : "";
    if (q) {
      const or = [{ token: q }];

      // Serials print as PT-<batch>-<unit> but store as the bare unit number.
      // Two shapes have to work:
      //   "PT-01-001004" — take the last dash-segment, or the batch digits
      //                    would merge into the unit and match nothing
      //   "1004" / "004" — someone reading digits off the sticker, matched as a
      //                    substring because they rarely type the whole thing
      const candidates = new Set();
      const addDigits = (raw) => {
        const d = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
        if (d) candidates.add(d);
      };
      addDigits(q.split("-").pop());
      addDigits(q);

      for (const digits of candidates) {
        // Digits only, so the regex is safe to build without escaping.
        or.push({ $expr: { $regexMatch: { input: { $toString: "$serialNumber" }, regex: digits } } });
      }
      filter.$or = or;
    }

    const tags = await collections.tags.find(filter).sort({ serialNumber: 1, createdAt: 1 }).toArray();

    // One round trip for the names rather than one per row.
    const ownerIds = tags.map((t) => t.demoOwnerId).filter(Boolean);
    const owners = ownerIds.length
      ? await collections.owners.find({ _id: { $in: ownerIds } }).toArray()
      : [];
    const ownerById = new Map(owners.map((o) => [String(o._id), o]));

    const items = tags.map((tag) => {
      const state = demoState(tag);
      const owner = tag.demoOwnerId ? ownerById.get(String(tag.demoOwnerId)) : null;
      return {
        id: String(tag._id),
        serial: stickerSerialFor(tag) || etagIdFor(tag._id),
        token: tag.token,
        state,
        copiesPrinted: printedCopies(tag),
        demoCount: Number(tag.demoCount) || 0,
        activatedAt: tag.demoActivatedAt || null,
        // Who is on the sticker right now, so he can confirm he is looking at
        // the person in front of him before taking payment.
        activatedBy: owner ? owner.displayName || owner.email || owner.mobile || null : null,
        plateNumber: state === "available" ? null : tag.plateNumber || null,
        soldAt: tag.soldAt || null,
        soldBy: tag.soldBy || null,
        blockedReason: blockedFromDemo(tag)
      };
    });

    // Counts are over the whole shelf, not the current search, so the numbers
    // still reconcile against the bag while filtering.
    const all = q
      ? await collections.tags
          .find({ marketingStock: true, deletedAt: { $in: [null, undefined] } })
          .toArray()
      : tags;

    return {
      ok: true,
      query: q,
      summary: {
        units: all.length,
        stickers: all.reduce((sum, t) => sum + printedCopies(t), 0),
        available: all.filter((t) => demoState(t) === "available").length,
        activated: all.filter((t) => demoState(t) === "activated").length,
        sold: all.filter((t) => demoState(t) === "sold").length
      },
      items
    };
  });

  // They didn't buy it. Wipe everything activation collected so the unit is
  // indistinguishable from a new sticker for the next customer.
  app.post("/api/admin/marketing/:tagId/deactivate", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const loaded = await loadForDemo(request, reply, collections);
    if (loaded.error) return loaded.error;
    const { tag } = loaded;

    if (isSold(tag)) {
      reply.code(409);
      return { ok: false, error: "This unit is marked sold. It belongs to a customer now." };
    }
    if (!isDemoActivated(tag)) {
      reply.code(409);
      return { ok: false, error: "This sticker is not activated, so there is nothing to wipe." };
    }

    const unset = {};
    for (const field of DEMO_TAG_FIELDS) unset[field] = "";

    await collections.tags.updateOne(
      { _id: tag._id },
      {
        $set: {
          ownerId: null,
          // Back to the state every un-activated sticker sits in, so the next
          // activation is indistinguishable from a brand-new one.
          status: MARKETING_AVAILABLE_STATUS,
          updatedAt: new Date().toISOString()
        },
        $unset: unset
      }
    );

    const demoOwnerId = tag.demoOwnerId;
    const owner = await collections.owners.findOne({ _id: demoOwnerId });
    // Counted AFTER the detach above, so the sticker we just released does not
    // count itself as a reason to keep the account alive.
    const remainingTagCount = await collections.tags.countDocuments({ ownerId: demoOwnerId });

    let removedAccount = false;
    if (demoOwnerIsDisposable(owner, remainingTagCount)) {
      await collections.owners.deleteOne({ _id: demoOwnerId, demoCreatedOwner: true });
      removedAccount = true;
    }

    return { ok: true, state: "available", removedAccount };
  });

  // They bought it. The unit stays listed so the shelf remains a record of what
  // was sold, but it is finished as demo stock.
  app.post("/api/admin/marketing/:tagId/sold", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const loaded = await loadForDemo(request, reply, collections);
    if (loaded.error) return loaded.error;
    const { tag, tagId } = loaded;

    if (isSold(tag)) {
      reply.code(409);
      return { ok: false, error: "This unit is already marked sold." };
    }
    // Selling means handing the sticker to whoever activated it. With nobody
    // activated there is no one to sell it to.
    if (!isDemoActivated(tag)) {
      reply.code(409);
      return {
        ok: false,
        error: "Nobody has activated this sticker yet, so there is no customer to sell it to."
      };
    }

    const now = new Date().toISOString();

    // Promote the account out of demo status. Without this it stays flagged as
    // demo-created and some later deactivate could delete a paying customer.
    await collections.owners.updateOne(
      { _id: tag.demoOwnerId },
      { $unset: { demoCreatedOwner: "" }, $set: { updatedAt: now } }
    );

    const result = await collections.tags.updateOne(
      { _id: tagId, marketingStock: true, soldAt: { $in: [null, undefined] } },
      { $set: { soldAt: now, soldBy: request.session?.email || null, updatedAt: now } }
    );
    if (result.matchedCount === 0) {
      reply.code(409);
      return { ok: false, error: "This sticker changed while you were looking at it. Refresh and try again." };
    }

    return { ok: true, state: "sold" };
  });
}
