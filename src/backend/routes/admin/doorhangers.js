// Print Queue → "Door hanger PDF".
//
// The same job as scripts/print-doorhangers.js, from the admin page instead of
// a terminal: the operator ticks tags in the queue, and this returns the
// print-ready PDF (vector Figma artwork + each tag's QR and serial) as a
// download. It also gives those tags the door hanger's free-contact allowance,
// because the hanger promises "First 2 contacts free" and a tag printed on one
// without the stamp would break that promise on the first scan.
import { ObjectId } from "mongodb";

import { requireSession } from "../../lib/auth/auth.js";
import { DOORHANGER_FREE_CONTACTS } from "../../lib/core/call-access.js";
import { NOT_MARKETING_STOCK } from "../../lib/core/marketing-stock.js";
import { buildTagScanUrl, stickerSerialFor } from "../../lib/core/tag-issuance.js";
import { getCollections } from "../../lib/db/repositories.js";
import { renderDoorhangersPdf } from "../../lib/print/doorhanger/template.js";

// One print run per request. Far above a real hanger run (the first is 1000)
// while keeping one PDF bounded: every hanger is two pages.
export const DOORHANGER_MAX_PER_REQUEST = 2000;

export function registerAdminDoorhangerRoutes(app, env) {
  app.post("/api/admin/print-queue/doorhangers", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const rawIds = Array.isArray(request.body?.ids) ? request.body.ids : [];
    const ids = rawIds
      .filter((id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id))
      .map((id) => new ObjectId(id));

    // Refuse rather than trim, as the sticker export does: a silently shortened
    // run is hangers missing from the print.
    if (ids.length > DOORHANGER_MAX_PER_REQUEST) {
      reply.code(400);
      return { ok: false, error: `Too many tags in one run: ${ids.length}. Print at most ${DOORHANGER_MAX_PER_REQUEST} at a time.` };
    }
    if (!ids.length) {
      reply.code(400);
      return { ok: false, error: "Select the tags to print on door hangers first." };
    }

    const collections = await getCollections(env);

    // Only stock nobody has claimed and that has not been printed yet. An owned
    // tag on a hanger would hand a stranger's car contact to whoever finds it.
    const tags = await collections.tags
      .find({ _id: { $in: ids }, ownerId: null, status: "unclaimed", printStatus: { $ne: "printed" }, ...NOT_MARKETING_STOCK })
      .sort({ serialNumber: 1, _id: 1 })
      .toArray();

    if (!tags.length) {
      reply.code(400);
      return { ok: false, error: "None of the selected tags can go on a hanger: they are claimed, already printed, or field-demo stock." };
    }

    // Hangers go on car door handles and the card sits on the dashboard, so
    // exterior (bike) stock would fail activation for the car it ends up in.
    const bike = tags.filter((t) => t.mountType === "exterior_surface");
    if (bike.length) {
      reply.code(400);
      return { ok: false, error: `${bike.length} selected tag(s) are bike stock. Door hangers need car / windscreen tags.` };
    }

    const stamp = await collections.tags.updateMany(
      { _id: { $in: tags.map((t) => t._id) }, ownerId: null },
      { $set: { freeContactAllowance: DOORHANGER_FREE_CONTACTS, updatedAt: new Date().toISOString() } }
    );

    const dieline = request.body?.dieline === true;
    const pdf = await renderDoorhangersPdf(
      tags.map((t) => ({ serial: stickerSerialFor(t), scanUrl: buildTagScanUrl(request, t.token) })),
      { dieline }
    );

    request.log.info(
      { event: "doorhangers_exported", adminId: request.session.userId, count: tags.length, dieline },
      "[doorhangers] print PDF exported"
    );

    const first = stickerSerialFor(tags[0]), last = stickerSerialFor(tags[tags.length - 1]);
    const name = `parktag-doorhangers-${first}_to_${last}${dieline ? "-dieline" : ""}.pdf`.replace(/[^A-Za-z0-9_.-]/g, "");
    reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${name}"`)
      .header("cache-control", "no-store")
      .header("x-doorhanger-count", String(tags.length))
      .header("x-doorhanger-skipped", String(ids.length - tags.length))
      .header("x-doorhanger-stamped", String(stamp.modifiedCount));
    return reply.send(Buffer.from(pdf));
  });
}
