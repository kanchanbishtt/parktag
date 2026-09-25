// Door hanger print template: 4.5in x 11in, hung on a parked car's door handle.
//
// The design lives in Figma ("ParkTag Door Hanger", Edit Tree Projects). Each
// side is exported at 300 dpi into art/front.png and art/back.png, with the
// sample QR and serial on the front card left blank. This file only places the
// two things that differ per hanger on top of that artwork: the tag's QR and
// its serial. Everything else is the Figma design, pixel for pixel.
//
// Every hanger carries a REAL unclaimed tag, not a demo. The owner scans the QR,
// activates it with their own plate and phone (the normal /tag/<token> wizard),
// then tears off the bottom card and keeps it on the dashboard.
//
// To change the design: edit it in Figma, re-export both sides at 300 dpi
// (4.75in x 11.25in = 1425 x 3375 px, bleed included) with the card's QR and
// serial hidden, and replace the two PNGs. If the QR box moved, update SLOTS.
//
// The output is one self-contained HTML file with one CSS page per side (front
// with its unique QR, then the shared back). Open it in Chrome and "Save as
// PDF", or render it headless.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAVY = "#03162D";
// The card QR is pure black in the Figma design (max contrast through a windshield).
const QR_INK = "#000000";

// Where the per-hanger pieces go, in inches from the top-left of the page
// (bleed included), measured from the Figma front frame.
const SLOTS = {
  qr: { x: 0.4593, y: 8.4259, size: 1.4564 },
  // The serial is centred under the QR, inside the white QR box.
  serial: { centerX: 0.3484 + 1.6781 / 2, y: 9.9249, sizePt: 6.14 }
};

// Hole and slit, for vendor proofs only. Must match the die-cut in Figma.
const DIE = { trimInset: 0.125, holeCx: 2.375, holeCy: 1.175, holeR: 0.7, slitDeg: 20 };

function dataUri(file, type) {
  return `data:${type};base64,${fs.readFileSync(path.join(HERE, file)).toString("base64")}`;
}

// Error correction M and no built-in margin: the white QR box around it is the
// quiet zone. Same level the admin sticker print uses.
export async function qrSvg(url) {
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: QR_INK, light: "#0000" } });
  return svg.replace("<svg ", '<svg class="qr" shape-rendering="crispEdges" ');
}

function css() {
  return `
@font-face{font-family:"Courier Prime";font-weight:700;src:url(${dataUri("fonts/courier-prime-latin-700-normal.woff2", "font/woff2")}) format("woff2");}
@page { size: 4.75in 11.25in; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #888; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media screen { .page { margin: 24px auto; box-shadow: 0 4px 24px rgba(0,0,0,.25); } }
.page { width: 4.75in; height: 11.25in; position: relative; overflow: hidden; background: #fff; page-break-after: always; break-after: page; }
.art { position: absolute; inset: 0; width: 100%; height: 100%; }
.qr { position: absolute; left: ${SLOTS.qr.x}in; top: ${SLOTS.qr.y}in; width: ${SLOTS.qr.size}in; height: ${SLOTS.qr.size}in; }
.serial { position: absolute; left: ${SLOTS.serial.centerX}in; top: ${SLOTS.serial.y}in; transform: translateX(-50%); font-family: "Courier Prime", monospace; font-weight: 700; font-size: ${SLOTS.serial.sizePt}pt; letter-spacing: .04em; color: ${NAVY}; white-space: nowrap; }
.dieline { display: none; position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.show-dieline .dieline { display: block; }
.dieline * { stroke: #E6007E; stroke-width: 1.5; fill: none; }
.sample { position: absolute; top: 3.4in; left: 0; right: 0; text-align: center; font: 800 30pt sans-serif; color: rgba(255,39,0,.22); transform: rotate(-28deg); pointer-events: none; }
`;
}

function dieline() {
  const px = (inch) => inch * 96;
  const { trimInset: t, holeCx, holeCy, holeR, slitDeg } = DIE;
  const rightEdge = t + 4.5;
  const exitY = holeCy - (rightEdge - holeCx) * Math.tan((slitDeg * Math.PI) / 180);
  return `<svg class="dieline" viewBox="0 0 ${px(4.75)} ${px(11.25)}">
    <rect x="${px(t)}" y="${px(t)}" width="${px(4.5)}" height="${px(11)}" rx="${px(0.2)}"/>
    <circle cx="${px(holeCx)}" cy="${px(holeCy)}" r="${px(holeR)}"/>
    <path d="M${px(holeCx)} ${px(holeCy)} L${px(rightEdge)} ${px(exitY)}"/>
  </svg>`;
}

function front(h, art, { sample }) {
  return `<section class="page"><img class="art" src="${art}" alt="">${h.qr}<div class="serial">${h.serial}</div>${sample ? '<div class="sample">SAMPLE · NOT A REAL TAG</div>' : ""}${dieline()}</section>`;
}

function back(art) {
  return `<section class="page"><img class="art" src="${art}" alt="">${dieline()}</section>`;
}

// hangers: [{ serial, scanUrl }]. Returns the full HTML document.
export async function renderDoorhangers(hangers, { sample = false, dieline: showDieline = false } = {}) {
  const frontArt = dataUri("art/front.png", "image/png");
  const backPage = back(dataUri("art/back.png", "image/png"));
  const pages = [];
  for (const h of hangers) {
    const qr = await qrSvg(h.scanUrl);
    pages.push(front({ ...h, qr }, frontArt, { sample }), backPage);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ParkTag door hangers</title>
<style>${css()}</style></head><body class="${showDieline ? "show-dieline" : ""}">${pages.join("\n")}</body></html>`;
}
