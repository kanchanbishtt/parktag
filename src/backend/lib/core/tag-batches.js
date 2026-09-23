// Issued-stock batches, for tracing a run of stickers from print to activation.
//
// A batch is a key, not a stored document: the digits of `batchNumber`, padded
// to two — exactly what batchKeyFor() prints in the serial (PT-<key>-<unit>).
// batchNumber itself is stored raw and inconsistently ("01", "1", 12,
// "Batch-002"), so every lookup resolves a key to the raw values that share it
// through that same function, the way the serial search does. That keeps "the
// batch in the serial" and "the batch this page filters on" the same thing.

import { batchKeyFor, etagIdFor, stickerSerialFor } from "./tag-issuance.js";
import { NOT_MARKETING_STOCK } from "./marketing-stock.js";

// What a caller may send as a batch key: the digits batchKeyFor() produces.
// Anything else is refused rather than coerced, so a crafted value can never
// reach a query.
export function parseBatchKey(raw) {
  const key = typeof raw === "string" ? raw.trim() : "";
  return /^\d{2,9}$/.test(key) ? key : null;
}

// Issued stock only: a tag with a batch, not soft-deleted, and not the
// field-demo shelf (which has its own page and would otherwise read as stock).
export function issuedStockFilter() {
  return { batchNumber: { $nin: [null, ""] }, deletedAt: { $in: [null, undefined] }, ...NOT_MARKETING_STOCK };
}

// The raw batchNumber values stored under `key`. Over every tag, deleted ones
// included, so a caller that shows deleted tags still finds their batch.
export async function rawBatchValuesFor(collections, key) {
  const values = await collections.tags.distinct("batchNumber", { batchNumber: { $nin: [null, ""] } });
  return values.filter((value) => value != null && value !== "" && batchKeyFor(value) === key);
}

// One row per batch key: how much was issued and how much of it is in use.
export async function summariseBatches(collections) {
  const groups = await collections.tags
    .aggregate([
      { $match: issuedStockFilter() },
      {
        $group: {
          _id: "$batchNumber",
          total: { $sum: 1 },
          activated: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$ownerId", null] }, null] }, 1, 0] } },
          premium: { $sum: { $cond: [{ $eq: ["$premium", true] }, 1, 0] } },
          printed: { $sum: { $cond: [{ $eq: ["$printStatus", "printed"] }, 1, 0] } },
          labels: { $addToSet: "$batchLabel" },
          firstIssuedAt: { $min: { $ifNull: ["$issuedAt", "$createdAt"] } },
          lastIssuedAt: { $max: { $ifNull: ["$issuedAt", "$createdAt"] } },
          lastActivatedAt: { $max: "$activatedAt" }
        }
      }
    ])
    .toArray();

  // Raw values that share a key ("1" and "01") are one batch: one serial
  // sequence, one row.
  const byKey = new Map();
  for (const g of groups) {
    const key = batchKeyFor(g._id);
    const row = byKey.get(key) || {
      key, total: 0, activated: 0, premium: 0, printed: 0, labels: new Set(),
      firstIssuedAt: null, lastIssuedAt: null, lastActivatedAt: null
    };
    row.total += g.total;
    row.activated += g.activated;
    row.premium += g.premium;
    row.printed += g.printed;
    for (const label of g.labels || []) if (label) row.labels.add(String(label));
    row.firstIssuedAt = minIso(row.firstIssuedAt, g.firstIssuedAt);
    row.lastIssuedAt = maxIso(row.lastIssuedAt, g.lastIssuedAt);
    row.lastActivatedAt = maxIso(row.lastActivatedAt, g.lastActivatedAt);
    byKey.set(key, row);
  }

  return [...byKey.values()]
    .map((row) => ({
      key: row.key,
      labels: [...row.labels],
      total: row.total,
      activated: row.activated,
      unclaimed: row.total - row.activated,
      premium: row.premium,
      etag: row.total - row.premium,
      printed: row.printed,
      firstIssuedAt: row.firstIssuedAt,
      lastIssuedAt: row.lastIssuedAt,
      lastActivatedAt: row.lastActivatedAt
    }))
    .sort((a, b) => String(b.lastIssuedAt || "").localeCompare(String(a.lastIssuedAt || "")));
}

function minIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) < String(b) ? a : b;
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) > String(b) ? a : b;
}

// Last four digits only. The CSV is a file that leaves the admin panel, so it
// carries enough to match a row to a person the admin can look up, not a
// contact list. Full details stay behind the admin login.
export function maskMobile(mobile) {
  const digits = String(mobile || "").replace(/\D/g, "");
  return digits.length >= 4 ? `******${digits.slice(-4)}` : "";
}

// One CSV cell. Quoted always, quotes doubled, and a leading = + - @ (or a
// tab / carriage return) neutralised with an apostrophe: a plate or name typed
// by a stranger during activation must not run as a formula when the sheet is
// opened in Excel or Google Sheets. Leading whitespace does not hide one —
// some spreadsheet apps trim it before deciding.
export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@]|^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const BATCH_CSV_COLUMNS = [
  "Serial", "E-Tag ID", "Batch label", "Type", "Sticker", "Status", "Print status",
  "Issued at", "Activated at", "Plate", "Vehicle", "Owner name", "Owner mobile", "Free contact used"
];

// Every tag in the batch as CSV rows, in serial order. The QR token is never
// included: it IS the sticker's key, and a CSV gets forwarded.
export async function batchCsv(collections, key) {
  const rawValues = await rawBatchValuesFor(collections, key);
  const lines = [BATCH_CSV_COLUMNS.map(csvCell).join(",")];
  if (!rawValues.length) return { found: false, csv: lines.join("\r\n") };

  const tags = await collections.tags
    .find(
      { ...issuedStockFilter(), batchNumber: { $in: rawValues } },
      {
        projection: {
          batchNumber: 1, batchLabel: 1, serialNumber: 1, premium: 1, mountType: 1, status: 1,
          printStatus: 1, issuedAt: 1, createdAt: 1, activatedAt: 1, plateNumber: 1,
          vehicleLabel: 1, vehicleType: 1, ownerId: 1, freeContactUsed: 1
        }
      }
    )
    .sort({ serialNumber: 1, _id: 1 })
    .toArray();

  const ownerIds = tags.filter((t) => t.ownerId).map((t) => t.ownerId);
  const owners = ownerIds.length
    ? await collections.owners
        .find({ _id: { $in: ownerIds } }, { projection: { displayName: 1, mobile: 1, phone: 1 } })
        .toArray()
    : [];
  const ownerMap = new Map(owners.map((o) => [String(o._id), o]));

  for (const t of tags) {
    const owner = t.ownerId ? ownerMap.get(String(t.ownerId)) || {} : {};
    lines.push([
      stickerSerialFor(t),
      etagIdFor(t._id),
      t.batchLabel || "",
      t.premium ? "Premium" : "E-Tag",
      t.mountType === "exterior_surface" ? "Bike" : "Car",
      t.ownerId ? t.status || "" : "unclaimed",
      t.printStatus || "",
      t.issuedAt || t.createdAt || "",
      t.activatedAt || "",
      t.plateNumber || "",
      t.vehicleLabel || t.vehicleType || "",
      owner.displayName || "",
      maskMobile(owner.mobile || owner.phone),
      t.ownerId ? (t.freeContactUsed ? "yes" : "no") : ""
    ].map(csvCell).join(","));
  }
  return { found: true, csv: lines.join("\r\n") };
}
