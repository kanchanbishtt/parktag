// Door hanger print file: 4.5in x 11in, hung on a parked car's door handle.
//
// Used by scripts/print-doorhangers.js and the admin Print Queue's "Door
// hanger PDF" button (routes/admin/doorhangers.js).
//
// The design lives in Figma ("ParkTag Door Hanger", Edit Tree Projects). Each
// side is exported from Figma as a VECTOR PDF (art/front.pdf, art/back.pdf),
// with the sample QR and serial on the front card hidden. Text and shapes stay
// vector, so nothing pixelates at any zoom or print size; only the photos in
// the design are images. This file places each side once as a reusable page
// object and draws the two per-hanger things on top of the front: the tag's QR,
// as vector squares, and its serial.
//
// Every hanger carries a REAL unclaimed tag, not a demo. The owner scans the QR,
// activates it with their own plate and phone (the normal /tag/<token> wizard),
// then tears off the bottom card and keeps it on the dashboard.
//
// To change the design: edit it in Figma, export both frames as PDF (Figma's
// export, or the REST images endpoint with format=pdf) with the card's QR and
// serial hidden, and replace the two files. If the QR box moved, update SLOTS.
//
// Output is one PDF, 4.75in x 11.25in pages (0.125in bleed on every edge),
// front then back for each hanger.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PT = 72; // points per inch
const PAGE = { w: 4.75 * PT, h: 11.25 * PT };

// Where the per-hanger pieces go, in inches from the top-left of the page
// (bleed included), measured from the Figma front frame.
const SLOTS = {
  qr: { x: 0.4593, y: 8.4259, size: 1.4564 },
  // The serial is centred under the QR, inside the white QR box.
  serial: { centerX: 0.3484 + 1.6781 / 2, y: 9.9249, sizePt: 6.14 }
};

// Hole and slit, for vendor proofs only. Must match the die-cut in Figma.
const DIE = { trimInset: 0.125, holeCx: 2.375, holeCy: 1.175, holeR: 0.7, slitDeg: 20, cornerR: 0.2 };

const BLACK = rgb(0, 0, 0);
const NAVY = rgb(3 / 255, 22 / 255, 45 / 255);
const MAGENTA = rgb(230 / 255, 0, 126 / 255);

export const DOORHANGER_ART = {
  front: path.join(HERE, "art/front.pdf"),
  back: path.join(HERE, "art/back.pdf")
};

// The QR as one SVG path in page points (y down): horizontal runs of dark
// modules merged into single rectangles. Error correction M, no quiet zone of
// its own (the white QR box is the quiet zone), same as the sticker print.
function qrPath(url, x0, y0, size) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const m = size / n;
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!modules.get(r, c)) { c++; continue; }
      const start = c;
      while (c < n && modules.get(r, c)) c++;
      const x = x0 + start * m, y = y0 + r * m, w = (c - start) * m;
      d += `M${x.toFixed(3)} ${y.toFixed(3)}h${w.toFixed(3)}v${m.toFixed(3)}h${(-w).toFixed(3)}z`;
    }
  }
  return d;
}

function dielinePath() {
  const i = (v) => v * PT;
  const { trimInset: t, holeCx, holeCy, holeR, slitDeg, cornerR: cr } = DIE;
  const L = i(t), T = i(t), R = i(t + 4.5), B = i(t + 11), rr = i(cr);
  const rect = `M${L + rr} ${T}H${R - rr}Q${R} ${T} ${R} ${T + rr}V${B - rr}Q${R} ${B} ${R - rr} ${B}H${L + rr}Q${L} ${B} ${L} ${B - rr}V${T + rr}Q${L} ${T} ${L + rr} ${T}Z`;
  const cx = i(holeCx), cy = i(holeCy), r = i(holeR);
  const circle = `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
  const exitY = holeCy - (t + 4.5 - holeCx) * Math.tan((slitDeg * Math.PI) / 180);
  const slit = `M${cx} ${cy}L${R} ${i(exitY)}`;
  return `${rect}${circle}${slit}`;
}

// hangers: [{ serial, scanUrl }]. Returns the PDF as a Uint8Array.
export async function renderDoorhangersPdf(hangers, { sample = false, dieline = false } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle("ParkTag door hangers");
  doc.setCreator("ParkTag");

  // Each side is embedded ONCE and drawn on every page, so a 1000-hanger run
  // carries one copy of the artwork, not a thousand.
  const [front] = await doc.embedPdf(fs.readFileSync(DOORHANGER_ART.front));
  const [back] = await doc.embedPdf(fs.readFileSync(DOORHANGER_ART.back));
  const courier = await doc.embedFont(StandardFonts.CourierBold);
  const helv = await doc.embedFont(StandardFonts.HelveticaBold);
  const die = dieline ? dielinePath() : null;

  const place = (page, art) => page.drawPage(art, { x: 0, y: 0, width: PAGE.w, height: PAGE.h });
  const top = { x: 0, y: PAGE.h }; // drawSvgPath origin: page top-left, y down

  for (const h of hangers) {
    const f = doc.addPage([PAGE.w, PAGE.h]);
    place(f, front);
    const q = SLOTS.qr;
    f.drawSvgPath(qrPath(h.scanUrl, q.x * PT, q.y * PT, q.size * PT), { ...top, color: BLACK, borderWidth: 0 });

    const s = SLOTS.serial;
    const text = String(h.serial || "");
    const w = courier.widthOfTextAtSize(text, s.sizePt);
    f.drawText(text, {
      x: s.centerX * PT - w / 2,
      y: PAGE.h - (s.y * PT + s.sizePt * 0.8),
      size: s.sizePt,
      font: courier,
      color: NAVY
    });

    if (sample) {
      f.drawText("SAMPLE - NOT A REAL TAG", { x: 40, y: PAGE.h * 0.55, size: 26, font: helv, color: rgb(1, 0.15, 0), opacity: 0.25, rotate: degrees(28) });
    }
    if (die) f.drawSvgPath(die, { ...top, borderColor: MAGENTA, borderWidth: 1 });

    const b = doc.addPage([PAGE.w, PAGE.h]);
    place(b, back);
    if (die) b.drawSvgPath(die, { ...top, borderColor: MAGENTA, borderWidth: 1 });
  }

  return doc.save();
}
