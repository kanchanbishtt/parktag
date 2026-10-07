// Admin CRUD for negotiated-price promo codes.
//
//   GET   /api/admin/promo-codes             the list (optional ?q= substring on code)
//   POST  /api/admin/promo-codes             create
//   PATCH /api/admin/promo-codes/:code       partial update
//   POST  /api/admin/promo-codes/:code/revoke   sets active: false
//   GET   /api/admin/promo-codes/report      redemptions, paid orders, revenue per code
//
// Revocation is its own named-action route rather than a PATCH { active:
// false } — the same reason marketing.js gives /deactivate and /sold their
// own verbs: the action deserves to read as a decision in the audit trail,
// not a field edit that happens to touch the same flag a PATCH could.
//
// This route only WRITES the shape resolvePromo/discountPaiseFor/
// shippingFeePaiseFor already read (see lib/core/promo-codes.js) — it adds no
// new interpretation of a code, only a guarded way to create one.
import { promoLimitError } from "../../lib/auth/token-limits.js";
import { requireSession } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import {
  DISCOUNT_MODES,
  FULFILMENT_HANDOVER,
  FULFILMENT_SHIP,
  normalisePromoCode,
  PROMO_CODE_PATTERN
} from "../../lib/core/promo-codes.js";

// Fields a request body may set. The single allowlist both POST and PATCH
// validate against, so a caller cannot smuggle in `usedCount`, `usedByOrders`
// or `code` (renaming a code out from under its own PATCH URL) by including
// them in the body.
const WRITABLE_FIELDS = [
  "discountMode",
  "discountPaise",
  "discountPercent",
  "shippingFeePaise",
  "freeShippingAbovePaise",
  "productIds",
  "singleUse",
  "boundPhone",
  "maxUses",
  "startsAt",
  "expiresAt",
  "fulfilment",
  // "Auto-apply on the website": see resolveAutoOffer in promo-codes.js.
  "autoApply"
];

// Escape a string for safe use inside a RegExp — the substring search below is
// user input reaching a query, and an unescaped one is a live regex.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickWritableFields(body) {
  const patch = {};
  for (const field of WRITABLE_FIELDS) {
    if (body[field] !== undefined) patch[field] = body[field];
  }
  return patch;
}

// Re-validates the MERGED document (existing + patch, or the whole thing on
// create) so a partial edit can never leave e.g. discountMode: "percent" with
// no discountPercent set — the mode/value pairing has to hold on every write,
// not just the first one.
function validatePromoFields(doc) {
  if (doc.discountMode !== undefined && !DISCOUNT_MODES.includes(doc.discountMode)) {
    return `discountMode must be one of ${DISCOUNT_MODES.join(", ")}.`;
  }
  const mode = doc.discountMode || "flat";

  if (mode === "percent") {
    const pct = Number(doc.discountPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return "discountPercent must be greater than 0 and at most 100 for a percent code.";
    }
  } else {
    const paise = Number(doc.discountPaise);
    if (!Number.isFinite(paise) || paise <= 0) {
      return "discountPaise must be a positive number for a flat or per_unit code.";
    }
  }

  for (const field of ["shippingFeePaise", "freeShippingAbovePaise"]) {
    if (doc[field] != null) {
      const value = Number(doc[field]);
      if (!Number.isFinite(value) || value < 0) {
        return `${field} must be a non-negative number.`;
      }
    }
  }

  if (doc.productIds !== undefined && !Array.isArray(doc.productIds)) {
    return "productIds must be a list.";
  }

  // A date that does not parse would read as NaN in resolvePromo and silently
  // never gate, so it is refused here instead.
  for (const field of ["startsAt", "expiresAt"]) {
    if (doc[field] != null && Number.isNaN(new Date(doc[field]).getTime())) {
      return `${field} must be a valid date.`;
    }
  }
  if (doc.startsAt && doc.expiresAt && new Date(doc.startsAt) >= new Date(doc.expiresAt)) {
    return "startsAt must be before expiresAt.";
  }

  if (doc.fulfilment !== undefined && ![FULFILMENT_SHIP, FULFILMENT_HANDOVER].includes(doc.fulfilment)) {
    return `fulfilment must be one of ${FULFILMENT_SHIP}, ${FULFILMENT_HANDOVER}.`;
  }

  // A website offer is shown to everybody and applied to everybody, so it
  // cannot be a code that only one buyer, one order or one hand-over may use.
  if (doc.autoApply !== undefined && typeof doc.autoApply !== "boolean") {
    return "autoApply must be true or false.";
  }
  if (doc.autoApply === true) {
    if (doc.boundPhone) return "A website offer cannot be tied to one phone number. Remove the bound phone or turn off auto-apply.";
    if (doc.singleUse) return "A website offer cannot be single-use. Use a maximum number of uses instead.";
    if (doc.fulfilment === FULFILMENT_HANDOVER) return "A hand-over code cannot be a website offer.";
  }

  return null;
}

export function registerAdminPromoCodeRoutes(app, env) {
  app.get("/api/admin/shop-settings", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;
    const collections = await getCollections(env);
    if (!collections) { reply.code(503); return { ok: false, error: "Database is not available." }; }
    const settings = await collections.storeSettings.findOne({ _id: "public-shop" });
    return { ok: true, data: settings?.dashboardPlate || { enabled: false, pricePaise: null } };
  });

  app.patch("/api/admin/shop-settings", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;
    const collections = await getCollections(env);
    if (!collections) { reply.code(503); return { ok: false, error: "Database is not available." }; }

    const enabled = request.body?.enabled === true;
    const pricePaise = Math.round(Number(request.body?.pricePaise));
    if (!Number.isFinite(pricePaise) || pricePaise < 100) {
      reply.code(400);
      return { ok: false, error: "Enter an add-on price of at least ₹1." };
    }

    const dashboardPlate = {
      enabled,
      pricePaise,
      updatedAt: new Date().toISOString(),
      updatedBy: request.session?.email || null
    };
    await collections.storeSettings.updateOne(
      { _id: "public-shop" },
      { $set: { dashboardPlate } },
      { upsert: true }
    );
    return { ok: true, data: dashboardPlate };
  });

  app.get("/api/admin/promo-codes", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const q = typeof request.query?.q === "string" ? request.query.q.trim() : "";
    const filter = q ? { code: { $regex: escapeRegExp(q), $options: "i" } } : {};

    const items = await collections.promoCodes.find(filter).sort({ createdAt: -1 }).toArray();
    return { ok: true, data: items };
  });

  // What each code actually brought in, read off the orders that carry it.
  // usedCount is the promo row's own counter; the rest is summed from paid,
  // real (non-internal) shop orders, so a test order never inflates a campaign.
  app.get("/api/admin/promo-codes/report", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const [codes, totals] = await Promise.all([
      collections.promoCodes.find({}, { projection: { code: 1, usedCount: 1 } }).toArray(),
      collections.shopOrders.aggregate([
        { $match: {
          promoCode: { $type: "string" },
          status: "paid",
          internal: { $ne: true },
          channel: { $nin: ["internal", "giveaway"] },
          deletedAt: null
        } },
        { $group: {
          _id: "$promoCode",
          paidOrders: { $sum: 1 },
          revenuePaise: { $sum: { $ifNull: ["$amount", 0] } },
          discountPaise: { $sum: { $ifNull: ["$promoDiscountPaise", 0] } }
        } }
      ]).toArray()
    ]);

    const byCode = new Map(totals.map((row) => [row._id, row]));
    const data = codes.map(({ code, usedCount }) => ({
      code,
      usedCount: Number(usedCount) || 0,
      paidOrders: byCode.get(code)?.paidOrders || 0,
      revenuePaise: byCode.get(code)?.revenuePaise || 0,
      discountPaise: byCode.get(code)?.discountPaise || 0
    }));
    return { ok: true, data };
  });

  app.post("/api/admin/promo-codes", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const body = request.body || {};
    const code = normalisePromoCode(body.code);
    if (!code || !PROMO_CODE_PATTERN.test(code)) {
      reply.code(400);
      return { ok: false, error: "Enter a valid promo code (letters and numbers, 4-16 characters)." };
    }

    const doc = {
      code,
      ...pickWritableFields(body),
      singleUse: Boolean(body.singleUse),
      boundPhone: typeof body.boundPhone === "string" ? body.boundPhone : null,
      maxUses: body.maxUses != null ? Number(body.maxUses) : null,
      usedCount: 0,
      usedByOrders: [],
      startsAt: typeof body.startsAt === "string" ? body.startsAt : null,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: request.session?.email || null
    };

    const error = validatePromoFields(doc) || promoLimitError(request, doc);
    if (error) {
      reply.code(400);
      return { ok: false, error };
    }

    try {
      await collections.promoCodes.insertOne(doc);
    } catch (err) {
      // The unique index on `code` (see repositories.js, promo_code_unique) is
      // the race handling here, not an application-level "does it already
      // exist" pre-check — a check-then-insert has a gap two concurrent admins
      // could both slip through. Any other insert failure is a real 500.
      if (err?.code === 11000) {
        reply.code(409);
        return { ok: false, error: `A promo code ${code} already exists.` };
      }
      request.log.error({ err, code }, "[admin promo-codes] create failed");
      reply.code(500);
      return { ok: false, error: "Could not create the promo code." };
    }

    return { ok: true, data: doc };
  });

  app.patch("/api/admin/promo-codes/:code", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const code = normalisePromoCode(request.params.code);
    const existing = await collections.promoCodes.findOne({ code });
    if (!existing) {
      reply.code(404);
      return { ok: false, error: `No promo code ${code}.` };
    }

    const patch = pickWritableFields(request.body || {});
    const merged = { ...existing, ...patch };

    const error = validatePromoFields(merged) || promoLimitError(request, merged, patch);
    if (error) {
      reply.code(400);
      return { ok: false, error };
    }

    await collections.promoCodes.updateOne(
      { code },
      { $set: { ...patch, updatedAt: new Date().toISOString() } }
    );

    const updated = await collections.promoCodes.findOne({ code });
    return { ok: true, data: updated };
  });

  app.post("/api/admin/promo-codes/:code/revoke", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const code = normalisePromoCode(request.params.code);
    const result = await collections.promoCodes.updateOne(
      { code },
      { $set: { active: false, revokedAt: new Date().toISOString(), revokedBy: request.session?.email || null } }
    );
    if (result.matchedCount === 0) {
      reply.code(404);
      return { ok: false, error: `No promo code ${code}.` };
    }

    return { ok: true };
  });

  app.post("/api/admin/promo-codes/:code/activate", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const code = normalisePromoCode(request.params.code);
    const result = await collections.promoCodes.updateOne(
      { code },
      {
        $set: {
          active: true,
          activatedAt: new Date().toISOString(),
          activatedBy: request.session?.email || null
        },
        $unset: { revokedAt: "", revokedBy: "" }
      }
    );
    if (result.matchedCount === 0) {
      reply.code(404);
      return { ok: false, error: `No promo code ${code}.` };
    }

    return { ok: true };
  });
}
