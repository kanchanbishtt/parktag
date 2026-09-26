// /admin/sticker-designer: edit the QR sticker artwork in a layer editor and
// choose which design prints. Storage and validation live in
// lib/core/sticker-design.js; this file is the admin API around them.
import { ObjectId } from "mongodb";
import QRCode from "qrcode";

import { requireSession } from "../../lib/auth/auth.js";
import {
  DEFAULT_ARTWORK_URL,
  DEFAULT_LAYOUT,
  QR_MIN_SIZE,
  STICKER_FONTS,
  STICKER_HEIGHT,
  STICKER_WIDTH,
  StickerDesignError,
  getPublishedStickerDesign,
  overlayStyles,
  printSpecFor,
  validateArtworkSvg,
  validateCanvasJson,
  validateLayout,
  validateName
} from "../../lib/core/sticker-design.js";
import { getCollections } from "../../lib/db/repositories.js";

// Artwork and layers each carry embedded images; 6 MB apiece plus headroom.
const SAVE_BODY_LIMIT = 14 * 1024 * 1024;

const LIST_PROJECTION = { canvasJson: 0, artworkSvg: 0 };

function parseId(raw) {
  return /^[a-f0-9]{24}$/i.test(String(raw)) ? new ObjectId(raw) : null;
}

function summary(design) {
  return {
    id: String(design._id),
    name: design.name,
    status: design.status,
    layout: design.layout,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    publishedAt: design.publishedAt || null,
    updatedBy: design.updatedBy || null
  };
}

function badRequest(reply, message) {
  reply.code(400);
  return { ok: false, error: message };
}

// Validation failures are the admin's to fix, so they come back as a 400 with
// the reason; anything else is a real server error.
async function withValidation(reply, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StickerDesignError) return badRequest(reply, error.message);
    throw error;
  }
}

function readDesignBody(body) {
  return {
    name: validateName(body?.name),
    canvasJson: validateCanvasJson(body?.canvasJson),
    artworkSvg: validateArtworkSvg(body?.artworkSvg),
    layout: validateLayout(body?.layout)
  };
}

export function registerAdminStickerDesignRoutes(app, env) {
  const admin = requireSession(app, "admin");

  app.get("/api/admin/sticker-designs", async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const designs = await collections.stickerDesigns
      .find({}, { projection: LIST_PROJECTION })
      .sort({ updatedAt: -1 })
      .limit(200)
      .toArray();
    const published = designs.find((d) => d.status === "published") || null;

    return {
      ok: true,
      designs: designs.map(summary),
      current: printSpecFor(published),
      limits: {
        width: STICKER_WIDTH,
        height: STICKER_HEIGHT,
        qrMinSize: QR_MIN_SIZE,
        fonts: STICKER_FONTS,
        defaultArtworkUrl: DEFAULT_ARTWORK_URL,
        defaultLayout: DEFAULT_LAYOUT
      }
    };
  });

  // What the Print Queue export and the single-sticker page print with.
  app.get("/api/admin/sticker-designs/current", async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const spec = printSpecFor(await getPublishedStickerDesign(collections));
    return { ok: true, ...spec, styles: overlayStyles(spec.layout) };
  });

  // A stand-in QR for the editor canvas, so the placeholder looks like the
  // real thing. Encodes nothing that resolves to a tag.
  app.get("/api/admin/sticker-designs/sample-qr.svg", async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const svg = await QRCode.toString("https://parktag.in/tag/SAMPLE-STICKER-DESIGN", {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "M",
      // Explicit size: an SVG with only a viewBox has no natural size as an
      // image, and the editor scales the placeholder from it.
      width: 512
    });
    reply.type("image/svg+xml").header("Cache-Control", "private, max-age=86400");
    return svg;
  });

  app.get("/api/admin/sticker-designs/:id", async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const id = parseId(request.params.id);
    if (!id) return badRequest(reply, "Unknown design.");
    const collections = await getCollections(env);
    const design = await collections.stickerDesigns.findOne({ _id: id }, { projection: { artworkSvg: 0 } });
    if (!design) {
      reply.code(404);
      return { ok: false, error: "That design no longer exists." };
    }
    // `print` is what the preview shows: the saved artwork with the overlays
    // placed by the same code the print paths use.
    const spec = printSpecFor(design);
    return {
      ok: true,
      design: {
        ...summary(design),
        canvasJson: design.canvasJson,
        print: { artworkUrl: spec.artworkUrl, styles: overlayStyles(design.layout) }
      }
    };
  });

  app.post("/api/admin/sticker-designs", { bodyLimit: SAVE_BODY_LIMIT }, async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    return withValidation(reply, async () => {
      const fields = readDesignBody(request.body);
      const now = new Date().toISOString();
      const doc = {
        ...fields,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        createdBy: request.session.userId,
        updatedBy: request.session.userId
      };
      const collections = await getCollections(env);
      const { insertedId } = await collections.stickerDesigns.insertOne(doc);
      request.log.info({ event: "sticker_design_created", adminId: request.session.userId, designId: String(insertedId) }, "[sticker-design] created");
      return { ok: true, design: summary({ ...doc, _id: insertedId }) };
    });
  });

  // Drafts only. The published design is what the next print run uses, so it
  // is changed by publishing an edited copy, never edited in place under a run
  // that is already being exported.
  app.put("/api/admin/sticker-designs/:id", { bodyLimit: SAVE_BODY_LIMIT }, async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const id = parseId(request.params.id);
    if (!id) return badRequest(reply, "Unknown design.");

    return withValidation(reply, async () => {
      const fields = readDesignBody(request.body);
      const collections = await getCollections(env);
      const updated = await collections.stickerDesigns.findOneAndUpdate(
        { _id: id, status: { $ne: "published" } },
        { $set: { ...fields, updatedAt: new Date().toISOString(), updatedBy: request.session.userId } },
        { returnDocument: "after", projection: LIST_PROJECTION }
      );
      if (!updated) {
        const exists = await collections.stickerDesigns.countDocuments({ _id: id });
        reply.code(exists ? 409 : 404);
        return {
          ok: false,
          error: exists
            ? "This design is live. Save it as a copy, then publish the copy."
            : "That design no longer exists."
        };
      }
      return { ok: true, design: summary(updated) };
    });
  });

  app.post("/api/admin/sticker-designs/:id/publish", async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const id = parseId(request.params.id);
    if (!id) return badRequest(reply, "Unknown design.");
    const collections = await getCollections(env);
    const design = await collections.stickerDesigns.findOne({ _id: id }, { projection: LIST_PROJECTION });
    if (!design) {
      reply.code(404);
      return { ok: false, error: "That design no longer exists." };
    }
    if (design.status === "published") return { ok: true, design: summary(design) };

    // Retire the live one first: the unique index allows one published design,
    // so the order matters. Between the two writes nothing is published and a
    // print in that instant uses the original artwork, which is still correct.
    const now = new Date().toISOString();
    await collections.stickerDesigns.updateMany(
      { status: "published" },
      { $set: { status: "retired", retiredAt: now, updatedBy: request.session.userId } }
    );
    try {
      await collections.stickerDesigns.updateOne(
        { _id: id },
        { $set: { status: "published", publishedAt: now, publishedBy: request.session.userId, updatedAt: now, updatedBy: request.session.userId } }
      );
    } catch (error) {
      if (error?.code === 11000) {
        reply.code(409);
        return { ok: false, error: "Another design was published at the same moment. Reload and try again." };
      }
      throw error;
    }

    request.log.info({ event: "sticker_design_published", adminId: request.session.userId, designId: String(id) }, "[sticker-design] published");
    return { ok: true, design: summary({ ...design, status: "published", publishedAt: now, updatedAt: now }) };
  });

  // Back to the original artwork: nothing published.
  app.post("/api/admin/sticker-designs/unpublish", async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const now = new Date().toISOString();
    const result = await collections.stickerDesigns.updateMany(
      { status: "published" },
      { $set: { status: "retired", retiredAt: now, updatedBy: request.session.userId } }
    );
    request.log.info({ event: "sticker_design_unpublished", adminId: request.session.userId, count: result.modifiedCount }, "[sticker-design] back to original artwork");
    return { ok: true, current: printSpecFor(null) };
  });

  app.delete("/api/admin/sticker-designs/:id", async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const id = parseId(request.params.id);
    if (!id) return badRequest(reply, "Unknown design.");
    const collections = await getCollections(env);
    const result = await collections.stickerDesigns.deleteOne({ _id: id, status: { $ne: "published" } });
    if (!result.deletedCount) {
      const exists = await collections.stickerDesigns.countDocuments({ _id: id });
      reply.code(exists ? 409 : 404);
      return { ok: false, error: exists ? "The live design cannot be deleted. Publish another one first." : "That design no longer exists." };
    }
    return { ok: true };
  });

  // The artwork itself, for <img> on the print pages and the editor preview.
  // Admin only, like everything else about print runs. The CSP sandbox means
  // that even opened directly as a document it can run nothing.
  app.get("/admin/sticker-art/:file", async (request, reply) => {
    const blocked = await admin(request, reply);
    if (blocked) return blocked;

    const match = /^([a-f0-9]{24})\.svg$/i.exec(request.params.file);
    if (!match) {
      reply.code(404);
      return { ok: false, error: "Not found." };
    }
    const collections = await getCollections(env);
    const design = await collections.stickerDesigns.findOne({ _id: new ObjectId(match[1]) }, { projection: { artworkSvg: 1 } });
    if (!design?.artworkSvg) {
      reply.code(404);
      return { ok: false, error: "Not found." };
    }
    reply
      .type("image/svg+xml; charset=utf-8")
      .header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox")
      .header("X-Content-Type-Options", "nosniff")
      // The URL carries ?v=<updatedAt>, so a changed design is a new URL.
      .header("Cache-Control", "private, max-age=31536000, immutable");
    return design.artworkSvg;
  });
}
