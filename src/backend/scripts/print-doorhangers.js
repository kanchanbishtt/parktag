// Build the print file for car door hangers, one real unclaimed tag per hanger.
//
//   node src/backend/scripts/print-doorhangers.js --sample 2 --out proof.html
//   node --env-file=.env src/backend/scripts/print-doorhangers.js --batch 07 --out batch-07.html
//   node --env-file=.env src/backend/scripts/print-doorhangers.js --batch 07 --out batch-07.html --apply
//
// Issue the batch first (Admin → Issuance, car / windscreen mount), then run
// this with its batch number. Without --apply it only writes the print file
// and reports what it would stamp. With --apply it also gives every unclaimed
// tag in the batch the door hanger allowance of free contacts
// (freeContactAllowance, read by lib/core/call-access.js), which is what the
// hanger promises: "First 2 contacts free".
//
// --sample N needs no database: it prints N hangers with made-up tokens and a
// SAMPLE watermark, for design proofs. Never send a sample file to the printer.
//
// --dieline overlays the trim, hole and slit in magenta for the vendor proof.
//
// Open the output in Chrome and Save as PDF (page size is set in the file:
// 4.75in x 11.25in, i.e. 4.5x11 plus 0.125in bleed). Front and back alternate.
import crypto from "node:crypto";
import fs from "node:fs";
import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { stickerSerialFor, batchKeyFor } from "../lib/core/tag-issuance.js";
import { DOORHANGER_FREE_CONTACTS } from "../lib/core/call-access.js";
import { renderDoorhangers } from "../lib/print/doorhanger/template.js";

const DEFAULT_SCAN_BASE = "https://app.parktag.me";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

function scanUrlFor(base, token) {
  return `${base}/tag/${token}`;
}

async function sampleHangers(count, base) {
  return Array.from({ length: count }, (_, i) => ({
    serial: `PT-00-${String(i + 1).padStart(6, "0")}`,
    scanUrl: scanUrlFor(base, crypto.randomBytes(32).toString("hex"))
  }));
}

async function batchHangers(batchKey, base, apply) {
  const env = getEnv();
  const collections = await getCollections(env);
  if (!collections) {
    console.error("MongoDB is not configured (MONGODB_URI).");
    process.exit(1);
  }

  // Only tags nobody has claimed: printing an activated tag onto a hanger would
  // hand a stranger's car contact to whoever finds the hanger.
  const tags = (await collections.tags
    .find({ batchNumber: { $nin: [null, ""] }, ownerId: null, deletedAt: { $in: [null, undefined] }, status: { $in: ["unclaimed", "inactive"] } })
    .sort({ serialNumber: 1, _id: 1 })
    .toArray())
    .filter((t) => batchKeyFor(t.batchNumber) === batchKey);

  if (!tags.length) {
    console.error(`No unclaimed tags found in batch ${batchKey}.`);
    process.exit(1);
  }
  if (tags.some((t) => t.mountType === "exterior_surface")) {
    console.error(`Batch ${batchKey} has bike (exterior) stock. Door hangers need car / windscreen tags.`);
    process.exit(1);
  }

  const ids = tags.map((t) => t._id);
  if (apply) {
    const res = await collections.tags.updateMany(
      { _id: { $in: ids }, ownerId: null },
      { $set: { freeContactAllowance: DOORHANGER_FREE_CONTACTS, updatedAt: new Date().toISOString() } }
    );
    console.log(`Stamped ${res.modifiedCount} tag(s) with ${DOORHANGER_FREE_CONTACTS} free contacts.`);
  } else {
    console.log(`DRY RUN: would stamp ${ids.length} tag(s) with ${DOORHANGER_FREE_CONTACTS} free contacts. Re-run with --apply.`);
  }

  return tags.map((t) => ({ serial: stickerSerialFor(t), scanUrl: scanUrlFor(base, t.token) }));
}

async function main() {
  const sample = argValue("--sample");
  const batch = argValue("--batch");
  const out = argValue("--out") || "doorhangers.html";
  const apply = process.argv.includes("--apply");
  const base = (getEnv().scanBaseUrl || DEFAULT_SCAN_BASE).replace(/\/+$/, "");

  if (!sample && !batch) {
    console.error("Pass --sample N for a design proof, or --batch <number> for a print run.");
    process.exit(1);
  }

  const hangers = sample
    ? await sampleHangers(Math.max(1, Number(sample) || 1), base)
    : await batchHangers(batchKeyFor(batch), base, apply);

  const html = await renderDoorhangers(hangers, { sample: Boolean(sample), dieline: process.argv.includes("--dieline") });
  fs.writeFileSync(out, html);
  console.log(`Wrote ${hangers.length} hanger(s), ${hangers.length * 2} pages, to ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
