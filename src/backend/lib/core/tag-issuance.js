import { ObjectId } from "mongodb";

import { createSecureToken } from "../auth/security.js";
import { createQrDataUrl } from "./qr-output.js";
import { getEnv } from "../env.js";

// Canonical display ID for an E-Tag (last 8 chars of MongoDB ObjectId, uppercased).
export function etagIdFor(id) {
  return `PT-${String(id).slice(-8).toUpperCase()}`;
}

// Batch half of a sticker serial, normalised to two digits. Shared by the serial
// formatter and the issuance counter so both always agree on which batch a tag
// belongs to ("B12", "12" and 12 all resolve to "12").
export function batchKeyFor(batchNumber) {
  return String(batchNumber ?? 0).replace(/\D/g, "").padStart(2, "0");
}

// Human-readable serial printed on the physical premium sticker: PT-<batch>-<unit>,
// e.g. PT-01-000001 for the first tag of batch 01. Both halves are reduced to
// digits, so the result only ever contains [A-Z0-9-] and is safe to interpolate
// into printed HTML.
//
// Returns "" for a tag with no serialNumber rather than inventing one. Tags
// issued before serials existed have none until the backfill script has run
// (npm run backfill:tag-serials) — printing a made-up number would be worse
// than printing none, because the whole point is that it maps to a record.
export function stickerSerialFor(tag) {
  if (tag?.serialNumber == null) {
    return "";
  }
  const unit = String(tag.serialNumber).replace(/\D/g, "").padStart(6, "0");
  return `PT-${batchKeyFor(tag.batchNumber)}-${unit}`;
}

// The complete list of vehicle types ParkTag supports. This is the only list:
// the add-vehicle dropdown mirrors it, and assertVehicleType below accepts
// nothing outside it, so the form and the API cannot drift apart.
export const VEHICLE_LABELS = {
  car: "Car", bike: "Bike", scooter: "Scooter", auto_rickshaw: "Auto Rickshaw",
  truck: "Truck", bus: "Bus"
};

function labelForType(type, fallback = "Registered vehicle") {
  return VEHICLE_LABELS[type] || fallback;
}

// Which physical sticker a run produces. This is a MANUFACTURING property, not
// the owner's vehicle: the glue is on the front for a windscreen tag (it goes on
// from inside the glass) and on the back for one that sits on a tank or headlamp.
// It is decided at print time, months before anyone says what vehicle the tag
// ends up on — which is why it cannot be derived from vehicleType, a field that
// is still null on every tag this function creates.
export const MOUNT_TYPES = {
  windscreen_interior: "Windscreen — interior (front glue)",
  exterior_surface: "Exterior surface — tank / headlamp (back glue)"
};

// ── Mount type as a vehicle-type HINT ─────────────────────────────────────
// An Indian registration number does not encode vehicle class: the series
// letters are handed out sequentially as each series exhausts, not by class, so
// the plate can never tell us whether this is a car or a bike.
//
// The mount type can — partially. A windscreen sticker goes on from inside the
// glass, so it is a four-wheeler; an exterior sticker goes on a tank or a
// headlamp, so it is a two-wheeler. That is decided at print time and is
// already stamped on every tag, which makes it a free and reliable signal for
// which half of the picker to open on.
//
// It narrows the CATEGORY, never the exact type — a windscreen tag could be a
// car, an auto, a truck or a bus. So this pre-selects and orders the choices,
// and the owner still confirms. Tags issued before mount types existed return
// null, and the picker then opens with nothing chosen rather than guessing: a
// wrong-but-plausible type reads as a bug, an empty one reads as a question.
export const VEHICLE_CATEGORIES = {
  two_wheeler: ["bike", "scooter"],
  four_wheeler: ["car", "auto_rickshaw", "truck", "bus"]
};

const MOUNT_TO_CATEGORY = {
  exterior_surface: "two_wheeler",
  windscreen_interior: "four_wheeler"
};

export function vehicleCategoryForMount(mountType) {
  return MOUNT_TO_CATEGORY[String(mountType ?? "")] || null;
}

// The most common type inside each category, used as the pre-selection.
// Grounded in the live data rather than taste: among claimed production tags
// car outnumbers every other four-wheeler type, and bike outnumbers scooter.
const CATEGORY_DEFAULT_TYPE = {
  two_wheeler: "bike",
  four_wheeler: "car"
};

export function suggestedVehicleTypeForMount(mountType) {
  const category = vehicleCategoryForMount(mountType);
  return category ? CATEGORY_DEFAULT_TYPE[category] : null;
}

// Exported so the activation route can reject an unsupported type without
// reaching for the label map itself — same list, one owner.
export function isSupportedVehicleType(type) {
  return Object.prototype.hasOwnProperty.call(VEHICLE_LABELS, String(type ?? ""));
}

// Whether a sticker can physically go on the vehicle the owner picked.
//
// Mount type is a manufacturing fact, not a preference: windscreen stock is
// printed and glued for the inside of glass, exterior stock for a painted or
// plastic surface out in the weather. Cross them and the owner gets a sticker
// that peels, or one facing the wrong way through glass — so activation
// refuses the pairing rather than recording it.
//
// Tags issued before mount types existed carry none, and nothing is enforced
// for them: there is no fact to check against, and refusing them would strand
// owners who bought a tag before the field existed.
export function vehicleTypeMatchesMount(mountType, vehicleType) {
  const category = vehicleCategoryForMount(mountType);
  if (!category) return true;
  return (VEHICLE_CATEGORIES[category] || []).includes(String(vehicleType ?? ""));
}

// Wording for the refusal, kept beside the rule that triggers it so the two
// cannot drift apart. `fits` describes what the sticker is made for; `needs`
// names the stock the owner's vehicle actually wants.
export const MOUNT_COPY = {
  windscreen_interior: {
    sticker: "windscreen tag",
    fits: "the inside of a car, auto, truck or bus windscreen",
    needs: "an exterior tag"
  },
  exterior_surface: {
    sticker: "exterior tag",
    fits: "the body of a bike or scooter",
    needs: "a windscreen tag"
  }
};

// The refusal, worded once. Used by the activation route and mirrored by the
// scanner's error screen, so the owner reads the same sentence either way.
export function mountMismatchMessage(mountType, vehicleType) {
  const copy = MOUNT_COPY[String(mountType ?? "")];
  const vehicle = VEHICLE_LABELS[String(vehicleType ?? "")] || "vehicle";
  if (!copy) return `This tag cannot be activated for a ${vehicle}.`;
  return `This is a ${copy.sticker}, made for ${copy.fits}. A ${vehicle} needs ${copy.needs}.`;
}

// Required on every batch, with no default. A wrong guess here does not produce
// a wrong record, it produces a pallet of stickers whose glue is on the wrong
// face — so silently inheriting a value would be worse than refusing to issue.
function assertMountType(type) {
  if (type == null || type === "") {
    throw new Error("Choose which sticker this run prints: windscreen or exterior");
  }
  if (!Object.prototype.hasOwnProperty.call(MOUNT_TYPES, type)) {
    throw new Error("Unsupported mount type");
  }
  return type;
}

// Reject a type we do not offer. Removing the dropdown option alone would not
// stop a direct POST, and nothing validated this field before. No type at all
// stays allowed: retail tags are issued before anyone says what the vehicle is.
function assertVehicleType(type) {
  if (type == null || type === "") return null;
  if (!Object.prototype.hasOwnProperty.call(VEHICLE_LABELS, type)) {
    throw new Error("Unsupported vehicle type");
  }
  return type;
}

// Same list, but for a tag being re-minted from one the owner already has. A
// type that is no longer offered is dropped rather than thrown on: an owner
// whose old tag predates this list must still be able to buy a premium
// replacement, and vehicleLabel carries the original wording over.
function sanitiseVehicleType(type) {
  if (type == null || type === "") return null;
  return Object.prototype.hasOwnProperty.call(VEHICLE_LABELS, type) ? type : null;
}

// Base for scan/QR URLs: use env.scanBaseUrl if set (production pin), else the
// host the request came in on (local→local, production→production).
function scanBase(request) {
  const pinned = getEnv().scanBaseUrl;
  if (pinned) return pinned;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const proto = request.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

export function buildClaimUrl(request, token) {
  return `${scanBase(request)}/vehicle/${token}`;
}

// New secure scan URL used for all freshly generated E-Tags (spec: /tag/{token}).
export function buildTagScanUrl(request, token) {
  return `${scanBase(request)}/tag/${token}`;
}

// Default gating / lifecycle fields stamped on every newly created tag so the
// free-usage, premium, and soft-delete logic has consistent shape to read.
export function tagLifecycleDefaults() {
  const now = new Date().toISOString();
  return {
    freeContactUsed: false,
    freeContactUsedAt: null,
    contactAttempts: 0,
    purchaseStatus: "none", // "none" | "paid"
    physicalTagPurchased: false,
    premium: false,
    lastContactAt: null,
    deletedAt: null,
    updatedAt: now
  };
}

// Upper bound on a single issuance request. Without one, `quantity` went
// straight into a loop that materialises an object per tag, so a mistyped
// 10000000 would build ten million documents in memory and take the process
// down before a single write. 20k is far above any real print run (the largest
// batches in use are in the low thousands) while keeping the peak allocation
// bounded.
const MAX_ISSUE_QUANTITY = 20000;

export async function createUnclaimedTags(collections, input) {
  const requested = Number(input.quantity ?? 1);

  // `Number("abc")` is NaN, and `Math.max(1, NaN)` is NaN — which made the loop
  // below run zero times and the endpoint answer `{ ok: true, count: 0 }`. A
  // batch that silently doesn't exist is worse than a rejected one, so a
  // non-numeric quantity is now an explicit error.
  if (!Number.isFinite(requested)) {
    throw new Error("Quantity must be a number");
  }

  const quantity = Math.floor(requested);

  if (quantity < 1) {
    throw new Error("Quantity must be at least 1");
  }

  if (quantity > MAX_ISSUE_QUANTITY) {
    throw new Error(`Quantity cannot exceed ${MAX_ISSUE_QUANTITY} tags in one batch`);
  }

  // Validation deliberately runs BEFORE the serial reservation below. The
  // counter bump is atomic and irreversible, so validating afterwards would let
  // a rejected batch (bad quantity, missing mount type) still consume a block of
  // sticker serials and leave a permanent gap in the printed sequence.
  const mountType = assertMountType(input.mountType);

  //
  // Reserve this run's sticker serials in one atomic bump, so two admins issuing
  // into the same batch can never be handed the same number. Same counters
  // collection and $inc pattern the shop order number uses.
  const batch = batchKeyFor(input.batchNumber);
  const res = await collections.counters.findOneAndUpdate(
    { _id: `tagSerial:${batch}` },
    { $inc: { seq: quantity } },
    { upsert: true, returnDocument: "after" }
  );
  // The v6 driver returns the doc directly; older behaviour wraps it in `.value`.
  const seqEnd = (res && (res.seq ?? (res.value && res.value.seq))) || quantity;
  const seqStart = seqEnd - quantity + 1;

  const tags = [];

  // Identity for THIS issuance run. A batch is filled over many sittings — 1000
  // tags one day, 2000 more into the same batch the next — and a sitting is
  // what actually goes to the printer. Without a run id the only thing telling
  // sittings apart is createdAt, which is stamped per tag and spreads across
  // the insert, so the print queue could group no finer than the batch and
  // every export re-included everything printed before it.
  //
  // issuedAt is stamped ONCE for the whole run rather than per tag, so every
  // tag in a run carries an identical timestamp and the run can be grouped and
  // labelled by it exactly.
  const issuanceRunId = new ObjectId();
  const issuedAt = new Date().toISOString();

  for (let index = 0; index < quantity; index += 1) {
    tags.push({
      _id: new ObjectId(),
      token: createSecureToken(),
      ownerId: null,
      vehicleLabel: null,
      vehicleType: null,
      plateNumber: null,
      status: "unclaimed",
      batchNumber: input.batchNumber || null,
      batchLabel: input.batchLabel || null,
      // Denormalised onto every tag, the same way runSerialStart/End are: a run
      // is only an id on its tags, there is no runs collection to hold it. A
      // batch may now mix both mount types across sittings, so the batch number
      // no longer tells you which sticker a tag is — this field does.
      mountType,
      // Sequential within the batch: PT-<batch>-<serialNumber>.
      serialNumber: seqStart + index,
      issuanceRunId,
      issuedAt,
      // The run's own serial block, denormalised onto each tag so the queue can
      // label a run "PT-01-001004 → PT-01-002003" without re-reading its siblings.
      runSerialStart: seqStart,
      runSerialEnd: seqEnd,
      printStatus: "pending_print",
      stickerRequested: Boolean(input.stickerRequested),
      createdAt: new Date().toISOString(),
      ...tagLifecycleDefaults(),
      premium: Boolean(input.premiumBatch)
    });
  }

  // Bulk-insert with insertMany (one round-trip per chunk) instead of the old
  // one-insertOne-per-tag loop — a 1000-tag batch used to make 1000 sequential
  // trips to Atlas, which blew past the hosting gateway's request timeout
  // ("upstream error"). Chunking also keeps a very large batch from building one
  // oversized write payload.
  const INSERT_CHUNK = 500;
  for (let i = 0; i < tags.length; i += INSERT_CHUNK) {
    await collections.tags.insertMany(tags.slice(i, i + INSERT_CHUNK), { ordered: false });
  }

  return tags;
}

export async function buildIssuedTagOutput(request, tag) {
  const claimUrl = buildClaimUrl(request, tag.token);
  const qrDataUrl = await createQrDataUrl(claimUrl);

  return {
    id: String(tag._id),
    token: tag.token,
    serial: stickerSerialFor(tag),
    status: tag.status,
    batchNumber: tag.batchNumber,
    batchLabel: tag.batchLabel || null,
    printStatus: tag.printStatus,
    stickerRequested: tag.stickerRequested,
    premium: Boolean(tag.premium),
    claimUrl,
    qrDataUrl
  };
}

export async function createRegisteredOwnerTag(collections, ownerId, input) {
  const tag = {
    _id: new ObjectId(),
    token: createSecureToken(),
    ownerId,
    vehicleLabel: input.vehicleLabel || labelForType(input.vehicleType),
    vehicleType: input.vehicleType || null,
    plateNumber: input.plateNumber,
    status: "active",
    batchNumber: null,
    printStatus: Boolean(input.stickerRequested) ? "pending_print" : "not_requested",
    stickerRequested: Boolean(input.stickerRequested),
    createdAt: new Date().toISOString(),
    ...tagLifecycleDefaults()
  };

  await collections.tags.insertOne(tag);
  return tag;
}

// Create (or return existing) a real, scannable E-Tag for one of an owner's
// vehicles. This replaces the old demo-QR placeholder: every generated E-Tag is
// now permanently linked to a single vehicle via a 256-bit secure token.
export async function createEtagForVehicle(collections, ownerId, input) {
  const plateNumber = String(input.number || "").trim().toUpperCase();
  const vehicleType = assertVehicleType(input.type || null);

  if (!plateNumber) {
    throw new Error("Vehicle number is required");
  }

  // Reuse an existing tag for this exact vehicle so re-printing doesn't mint
  // duplicate E-Tags (and so the QR stays stable for an already-stuck sticker).
  const existing = await collections.tags.findOne({
    ownerId,
    plateNumber,
    deletedAt: null
  });

  if (existing) {
    return { tag: existing, created: false };
  }

  const tag = {
    _id: new ObjectId(),
    token: createSecureToken(),
    ownerId,
    vehicleLabel: input.vehicleLabel || labelForType(vehicleType),
    vehicleType,
    plateNumber,
    status: "active",
    batchNumber: null,
    printStatus: "not_requested",
    stickerRequested: false,
    createdAt: new Date().toISOString(),
    ...tagLifecycleDefaults()
  };

  await collections.tags.insertOne(tag);
  return { tag, created: true };
}

// Mint a brand-new PREMIUM tag for one of an owner's vehicles. Used when an
// owner buys a premium tag from the shop to replace a spent free-trial tag:
// the caller soft-removes the old free tag, then mints this one (new token +
// QR). Inserts directly — it must NOT reuse an existing tag by plate the way
// createEtagForVehicle does, so the new premium tag is always distinct.
export async function createPremiumTagForVehicle(collections, ownerId, input) {
  const plateNumber = String(input.plateNumber || "").trim().toUpperCase();
  const vehicleType = sanitiseVehicleType(input.vehicleType || null);
  const now = new Date().toISOString();

  const tag = {
    _id: new ObjectId(),
    token: createSecureToken(),
    ownerId,
    vehicleLabel: input.vehicleLabel || labelForType(vehicleType),
    vehicleType,
    plateNumber,
    status: "active",
    batchNumber: null,
    stickerRequested: true,
    createdAt: now,
    ...tagLifecycleDefaults(),
    // Premium overrides — this tag is paid and official from birth.
    premium: true,
    plan: "premium",
    physicalTagPurchased: true,
    purchaseStatus: "paid",
    premiumSince: now,
    printStatus: "pending_print",
    updatedAt: now
  };

  await collections.tags.insertOne(tag);
  return tag;
}
