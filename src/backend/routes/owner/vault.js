import { pipeline } from "node:stream/promises";

import { requireSession, toObjectId, tryObjectId } from "../../lib/auth/auth.js";
import { getCollections, getVaultBucket } from "../../lib/db/repositories.js";
import { getSessionCookieName } from "../../lib/auth/session.js";
import {
  DOCS_PER_ETAG,
  DOCS_PER_PREMIUM_TAG,
  DOCS_PER_SUBSCRIBED_TAG,
  DOC_TYPES,
  MAX_BYTES_PER_OWNER,
  MAX_FILE_BYTES,
  PREMIUM_TRIAL_LABEL,
  PREMIUM_TRIAL_MONTHS,
  checkQuota,
  cleanLabel,
  cleanThumbnail,
  createMimeSniffer,
  documentEntitlement,
  extensionForMime,
  grantVaultAccess,
  hasVaultPin,
  isAllowedMime,
  isInlineViewable,
  isValidDocType,
  isValidPin,
  isWeakPin,
  newDocumentId,
  pinRequirementMessage,
  readVaultGrant,
  releaseStorage,
  reserveStorage,
  revokeVaultAccess,
  setVaultPin,
  verifyVaultPin,
  weakPinMessage
} from "../../lib/core/vault.js";

// An image above this has almost certainly skipped the browser's compression
// pass: the ladder in scripts/owner/document-compress.js aims at 250KB and a
// realistic RC photo lands at 89KB. Set well clear of that so ordinary
// variation is quiet and only a genuine miss is logged.
const LARGE_IMAGE_WARN_BYTES = 1024 * 1024;

// Shape sent to the client. The GridFS id never leaves the server — see
// newDocumentId in lib/core/vault.js for why.
function shapeDocument(doc) {
  return {
    id: doc.docId,
    tagId: doc.tagId,
    docType: doc.docType,
    label: doc.label,
    mimeType: doc.mimeType,
    size: doc.size,
    viewable: isInlineViewable(doc.mimeType),
    thumb: doc.thumb || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt || null
  };
}

export function registerVaultRoutes(app, env) {
  // Owner session + a live PIN grant. Returns the resolved context on success,
  // or null once it has already written the failure response.
  //
  // The 423 on a missing grant is load-bearing: the client uses it to know it
  // should show the PIN prompt, as distinct from a 401 (session gone, go and
  // sign in again). Collapsing the two would make an expired vault look like an
  // expired login and bounce the owner out of the app.
  async function requireUnlockedVault(request, reply) {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return { blocked };

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(500);
      return { blocked: { ok: false, error: "Database not configured." } };
    }

    const ownerId = toObjectId(request.session.userId);

    // The owner must still exist. A session does not prove that: readSession
    // validates the session document alone, so a session that outlives its
    // account authenticates perfectly well. Deleting an account now revokes its
    // sessions and its grants, which closes that path at the source — this is
    // the second lock on the door, and it is worth one indexed read because
    // what is behind it is an RC, a driving licence and an insurance policy.
    const ownerExists = await collections.owners.findOne(
      { _id: ownerId },
      { projection: { _id: 1 } }
    );
    if (!ownerExists) {
      reply.code(401);
      return { blocked: { ok: false, error: "Authentication required" } };
    }

    const sessionId = request.cookies[getSessionCookieName()];
    const grant = await readVaultGrant(collections, sessionId, ownerId);
    if (!grant) {
      reply.code(423);
      return { blocked: { ok: false, locked: true, error: "Enter your vault PIN to continue." } };
    }

    return { collections, ownerId, sessionId };
  }

  // Confirm a tag really belongs to this owner before anything is filed under
  // it. Without this an owner could attach documents to — or read them from —
  // another owner's vehicle by passing its id.
  async function ownedTag(collections, ownerId, rawTagId) {
    const oid = tryObjectId(rawTagId);
    if (!oid) return null;
    return collections.tags.findOne({
      _id: oid,
      ownerId,
      deletedAt: { $in: [null, undefined] }
    });
  }

  // Does this owner have a vault PIN yet, and is it currently unlocked? Drives
  // whether the sheet opens on "create a PIN", "enter your PIN", or the list.
  app.get("/api/owner/vault/status", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    const sessionId = request.cookies[getSessionCookieName()];
    const [pinSet, grant] = await Promise.all([
      hasVaultPin(collections, ownerId),
      readVaultGrant(collections, sessionId, ownerId)
    ]);

    // The document allowance is per TAG, so it can only be answered for a
    // vehicle. The page always asks about one; without a tagId this reports the
    // tiers and no allowance, rather than guessing a number the upload would
    // then contradict.
    const tag = await ownedTag(collections, ownerId, (request.query || {}).tagId);

    return {
      ok: true,
      hasPin: pinSet,
      unlocked: Boolean(grant),
      limits: {
        maxFileBytes: MAX_FILE_BYTES,
        maxBytesPerOwner: MAX_BYTES_PER_OWNER,
        docTypes: DOC_TYPES,
        // What each tier is worth, so the page can name the next one without
        // hard-coding numbers that would then drift from the server's.
        tiers: {
          etag: DOCS_PER_ETAG,
          premium: DOCS_PER_PREMIUM_TAG,
          subscribed: DOCS_PER_SUBSCRIBED_TAG
        },
        premiumTrialMonths: PREMIUM_TRIAL_MONTHS,
        premiumTrialLabel: PREMIUM_TRIAL_LABEL
      },
      entitlement: tag ? documentEntitlement(tag) : null
    };
  });

  // Create the PIN, or change an existing one. Changing REQUIRES the current
  // PIN — otherwise anyone holding an unlocked phone could simply overwrite it
  // and read everything, which would make the whole second factor decorative.
  app.post("/api/owner/vault/pin", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    const { pin, currentPin } = request.body || {};

    if (!isValidPin(pin)) { reply.code(400); return { ok: false, error: pinRequirementMessage() }; }
    if (isWeakPin(pin)) { reply.code(400); return { ok: false, error: weakPinMessage() }; }

    if (await hasVaultPin(collections, ownerId)) {
      const check = await verifyVaultPin(collections, ownerId, currentPin);
      if (check.locked) {
        reply.code(429);
        return { ok: false, error: "Too many incorrect PIN attempts. Try again later.", retryAfterSeconds: check.retryAfterSeconds };
      }
      if (!check.ok) { reply.code(400); return { ok: false, error: "Current PIN is incorrect." }; }
    }

    await setVaultPin(collections, ownerId, pin);

    // Setting a PIN proves you know it, so open the vault straight away rather
    // than asking for it again one screen later.
    const sessionId = request.cookies[getSessionCookieName()];
    await grantVaultAccess(collections, sessionId, ownerId);

    return { ok: true, unlocked: true };
  });

  app.post("/api/owner/vault/unlock", { config: { rateLimit: { max: 15, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    const ownerId = toObjectId(request.session.userId);
    const result = await verifyVaultPin(collections, ownerId, (request.body || {}).pin);

    if (result.locked) {
      reply.code(429);
      return { ok: false, error: "Too many incorrect PIN attempts. Try again later.", retryAfterSeconds: result.retryAfterSeconds };
    }
    if (result.noPin) { reply.code(400); return { ok: false, error: "Set a vault PIN first." }; }
    if (!result.ok) { reply.code(401); return { ok: false, error: "Incorrect PIN." }; }

    const sessionId = request.cookies[getSessionCookieName()];
    const expiresAt = await grantVaultAccess(collections, sessionId, ownerId);
    return { ok: true, unlocked: true, expiresAt: expiresAt.toISOString() };
  });

  // Explicit re-lock, for the "Lock vault" button and for closing the sheet.
  app.post("/api/owner/vault/lock", async (request, reply) => {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) { reply.code(500); return { ok: false, error: "Database not configured." }; }

    await revokeVaultAccess(collections, request.cookies[getSessionCookieName()]);
    return { ok: true, unlocked: false };
  });

  // Documents for one vehicle. Metadata only — bytes come from the file route.
  app.get("/api/owner/vault/documents", async (request, reply) => {
    const ctx = await requireUnlockedVault(request, reply);
    if (ctx.blocked) return ctx.blocked;
    const { collections, ownerId } = ctx;

    const tag = await ownedTag(collections, ownerId, (request.query || {}).tagId);
    if (!tag) { reply.code(404); return { ok: false, error: "Vehicle not found." }; }

    const docs = await collections.vaultDocuments
      .find({ ownerId, tagId: String(tag._id) })
      .sort({ createdAt: -1 })
      .toArray();

    const totals = await collections.vaultDocuments
      .aggregate([{ $match: { ownerId } }, { $group: { _id: null, bytes: { $sum: "$size" } } }])
      .toArray();

    // Sent with the list so the page draws the allowance it will actually be
    // held to. Deriving it client-side from the dashboard's `premium` flag
    // would be a second copy of the rule, free to disagree with this one.
    const entitlement = documentEntitlement(tag);

    return {
      ok: true,
      documents: docs.map(shapeDocument),
      usedBytes: (totals[0] && totals[0].bytes) || 0,
      entitlement,
      // Counted from the documents themselves rather than the usage row: this
      // is what the owner is looking at, and a counter that has drifted high
      // (see ensureUsageRow) must not make the page claim slots are gone that
      // the screen plainly shows are free.
      documentCount: docs.length
    };
  });

  // Upload. Multipart, ONE file per request.
  //
  // The text fields must be sent BEFORE the file part: @fastify/multipart
  // streams parts in order, so `data.fields` only contains what arrived ahead
  // of the file. The client in scripts/owner/documents.js appends them in that
  // order for exactly this reason.
  app.post("/api/owner/vault/documents", { config: { rateLimit: { max: 20, timeWindow: "5 minutes" } } }, async (request, reply) => {
    const ctx = await requireUnlockedVault(request, reply);
    if (ctx.blocked) return ctx.blocked;
    const { collections, ownerId } = ctx;

    if (!request.isMultipart()) {
      reply.code(400);
      return { ok: false, error: "Upload the document as a file." };
    }

    let data;
    try {
      data = await request.file();
    } catch (err) {
      request.log.error({ err }, "Vault upload could not be read");
      reply.code(400);
      return { ok: false, error: "Could not read the uploaded file." };
    }
    if (!data) { reply.code(400); return { ok: false, error: "No file received." }; }

    const field = (name) => {
      const f = data.fields && data.fields[name];
      return f && typeof f.value === "string" ? f.value : "";
    };

    const tag = await ownedTag(collections, ownerId, field("tagId"));
    if (!tag) {
      await data.file.resume(); // drain, or the connection hangs
      reply.code(404);
      return { ok: false, error: "Vehicle not found." };
    }

    const docType = field("docType").toLowerCase();
    if (!isValidDocType(docType)) {
      await data.file.resume();
      reply.code(400);
      return { ok: false, error: "Choose a document type." };
    }

    if (!isAllowedMime(data.mimetype)) {
      await data.file.resume();
      reply.code(415);
      return { ok: false, error: "Only PDF, JPG, PNG or WEBP files can be stored." };
    }

    // Read ONCE, here, and carried through to the reservation below. The tier
    // that authorised the upload is then the tier that binds the write.
    const entitlement = documentEntitlement(tag);

    const quota = await checkQuota(collections, ownerId, String(tag._id), entitlement);
    if (!quota.ok) {
      await data.file.resume();
      reply.code(409);
      return {
        ok: false,
        code: quota.limit === "documents" ? "DOCUMENT_LIMIT_REACHED" : "STORAGE_FULL",
        entitlement,
        error: quota.error
      };
    }

    const bucket = await getVaultBucket(env);
    if (!bucket) {
      await data.file.resume();
      reply.code(500);
      return { ok: false, error: "Document storage is not available." };
    }

    const docId = newDocumentId();
    const storedName = `${docType}-${docId}.${extensionForMime(data.mimetype)}`;
    const uploadStream = bucket.openUploadStream(storedName, {
      contentType: data.mimetype,
      metadata: { ownerId: String(ownerId), tagId: String(tag._id), docId }
    });

    // Corroborates the CLIENT-DECLARED content type against the actual bytes.
    // See createMimeSniffer — it records a verdict rather than erroring, so the
    // request body is always fully consumed and the connection cannot hang.
    const sniffer = createMimeSniffer(data.mimetype);

    try {
      await pipeline(data.file, sniffer, uploadStream);
    } catch (err) {
      request.log.error({ err }, "Vault upload failed while writing to storage");
      await bucket.delete(uploadStream.id).catch(() => {});
      reply.code(500);
      return { ok: false, error: "Could not save the document. Please try again." };
    }

    // @fastify/multipart stops at the configured limit and flags the stream
    // rather than throwing, so a file over the cap arrives here as a SILENTLY
    // TRUNCATED upload. Without this check we would store a corrupt half-file
    // and tell the owner it saved fine.
    if (data.file.truncated) {
      await bucket.delete(uploadStream.id).catch(() => {});
      reply.code(413);
      return { ok: false, error: `Each document must be under ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB.` };
    }

    // The bytes did not match what the upload said they were. Checked after the
    // write for the streaming reason above; the blob goes straight back out.
    if (!sniffer.matches) {
      await bucket.delete(uploadStream.id).catch(() => {});
      request.log.warn(
        { event: "vault-content-mismatch", declared: data.mimetype },
        "[vault] upload rejected — file contents do not match the declared type"
      );
      reply.code(415);
      return {
        ok: false,
        error: "That file isn't a valid PDF, JPG, PNG or WEBP. Please upload the original document."
      };
    }

    // Trust the byte count storage actually recorded, never a client-declared
    // size — the per-owner quota is summed from these values.
    const stored = await bucket.find({ _id: uploadStream.id }).next();
    const size = (stored && stored.length) || 0;

    // Images are compressed in the browser before they are sent — see
    // scripts/owner/document-compress.js, where a 4.79MB photo becomes 89KB.
    // The server cannot re-encode without an image library in the API process,
    // so it cannot ENFORCE that. What it can do is notice: a large image
    // arriving means compression did not run, and the only way that becomes
    // visible before the cluster fills is if somebody says so here.
    if (size > LARGE_IMAGE_WARN_BYTES && isInlineViewable(data.mimetype)) {
      request.log.warn(
        { event: "vault-uncompressed-image", bytes: size, mime: data.mimetype },
        "[vault] a large image was stored — client-side compression did not run"
      );
    }

    const record = {
      docId,
      ownerId,
      tagId: String(tag._id),
      docType,
      label: cleanLabel(field("label"), docType.toUpperCase()),
      mimeType: data.mimetype,
      size,
      // Null for PDFs and for any image the browser could not render — the
      // page falls back to a type icon, so a missing thumbnail is cosmetic.
      thumb: isInlineViewable(data.mimetype) ? cleanThumbnail(field("thumb")) : null,
      fileId: uploadStream.id,
      createdAt: new Date().toISOString()
    };
    // The quota that actually holds. checkQuota() above ran before the bytes
    // were streamed and is only a cheap early reject — it reads a total that
    // any concurrent upload is about to invalidate. This one is a conditional
    // single-document update, so a burst of uploads fills the allowance exactly
    // once instead of every request seeing room. Claimed BEFORE the record is
    // written, so a document can never exist without the storage behind it.
    const reserved = await reserveStorage(collections, ownerId, String(tag._id), size, entitlement);
    if (!reserved.ok) {
      await bucket.delete(uploadStream.id).catch(() => {});
      reply.code(409);
      return {
        ok: false,
        code: reserved.limit === "documents" ? "DOCUMENT_LIMIT_REACHED" : "STORAGE_FULL",
        entitlement,
        error: reserved.error
      };
    }

    try {
      await collections.vaultDocuments.insertOne(record);
    } catch (err) {
      // Give the reservation back, or it would count against the owner forever
      // for a document that does not exist.
      await releaseStorage(collections, ownerId, { tagId: String(tag._id), size });
      await bucket.delete(uploadStream.id).catch(() => {});
      request.log.error({ err }, "Vault upload failed while recording the document");
      reply.code(500);
      return { ok: false, error: "Could not save the document. Please try again." };
    }

    return { ok: true, document: shapeDocument(record) };
  });

  // Rename or re-file a document. Only the label and type are editable — the
  // bytes are not, because "editing" a stored RC would mean the record no
  // longer matches what was uploaded. Replacing a document is delete + upload.
  app.patch("/api/owner/vault/documents/:docId", async (request, reply) => {
    const ctx = await requireUnlockedVault(request, reply);
    if (ctx.blocked) return ctx.blocked;
    const { collections, ownerId } = ctx;

    const doc = await collections.vaultDocuments.findOne({
      docId: String(request.params.docId || ""),
      ownerId
    });
    if (!doc) { reply.code(404); return { ok: false, error: "Document not found." }; }

    const body = request.body || {};
    const update = { updatedAt: new Date().toISOString() };

    if (body.docType !== undefined) {
      const docType = String(body.docType).toLowerCase();
      if (!isValidDocType(docType)) { reply.code(400); return { ok: false, error: "Choose a document type." }; }
      update.docType = docType;
    }
    if (body.label !== undefined) {
      update.label = cleanLabel(body.label, (update.docType || doc.docType).toUpperCase());
    }

    await collections.vaultDocuments.updateOne({ _id: doc._id }, { $set: update });
    return { ok: true, document: shapeDocument({ ...doc, ...update }) };
  });

  // Stream one document back. Scoped to the owner in the query itself, so a
  // guessed id belonging to somebody else is a 404 rather than a leak.
  app.get("/api/owner/vault/documents/:docId/file", async (request, reply) => {
    const ctx = await requireUnlockedVault(request, reply);
    if (ctx.blocked) return ctx.blocked;
    const { collections, ownerId } = ctx;

    const doc = await collections.vaultDocuments.findOne({
      docId: String(request.params.docId || ""),
      ownerId
    });
    if (!doc) { reply.code(404); return { ok: false, error: "Document not found." }; }

    const bucket = await getVaultBucket(env);
    if (!bucket) { reply.code(500); return { ok: false, error: "Document storage is not available." }; }

    const filename = `${doc.docType}-${doc.docId}.${extensionForMime(doc.mimeType)}`;

    reply.header("Content-Type", doc.mimeType);
    reply.header("Content-Length", doc.size);
    // Identity documents must never sit in a shared or disk cache.
    reply.header("Cache-Control", "private, no-store");
    // Images render in the sheet; PDFs download, because the CSP has no
    // frame-src 'self' and a browser would refuse to paint one in an iframe.
    reply.header(
      "Content-Disposition",
      `${isInlineViewable(doc.mimeType) ? "inline" : "attachment"}; filename="${filename}"`
    );

    return reply.send(bucket.openDownloadStream(doc.fileId));
  });

  app.delete("/api/owner/vault/documents/:docId", async (request, reply) => {
    const ctx = await requireUnlockedVault(request, reply);
    if (ctx.blocked) return ctx.blocked;
    const { collections, ownerId } = ctx;

    const doc = await collections.vaultDocuments.findOne({
      docId: String(request.params.docId || ""),
      ownerId
    });
    if (!doc) { reply.code(404); return { ok: false, error: "Document not found." }; }

    // Metadata first: if the bucket delete then fails, the owner sees the
    // document gone (which is what they asked for) and we are left with an
    // orphaned blob to sweep, rather than a listed document whose bytes have
    // already vanished.
    await collections.vaultDocuments.deleteOne({ _id: doc._id });
    // Hand the reserved storage back, or the owner would pay for this document
    // for the rest of the account's life.
    await releaseStorage(collections, ownerId, { tagId: doc.tagId, size: doc.size });
    try {
      await bucketDelete(env, doc.fileId);
    } catch (err) {
      request.log.error({ err, docId: doc.docId }, "Vault blob delete failed — metadata already removed");
    }

    return { ok: true };
  });
}

async function bucketDelete(env, fileId) {
  const bucket = await getVaultBucket(env);
  if (bucket) await bucket.delete(fileId);
}
