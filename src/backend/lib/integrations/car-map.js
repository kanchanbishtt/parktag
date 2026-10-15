// The map image in the owner's WhatsApp alert: Ola's static map with a callout
// above the pin naming where the car is ("Your car · Wave Mall").
//
// Drawn as one SVG (the map embedded as an image, the callout on top) and
// rasterised by resvg. The fonts are bundled in assets/fonts because the
// production container has none; without them the text would silently vanish.

import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const FONT_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));
const FONT_FILES = [`${FONT_DIR}Inter_700Bold.ttf`, `${FONT_DIR}Inter_600SemiBold.ttf`];

// The static map is 600x300 at 2x with Ola's pin tip at the centre; the pin's
// head stands about 60px (at 2x) above the tip.
const W = 1200;
const H = 600;
const PIN_TOP = 238;

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

// Inter Bold averages about 0.6em per character; close enough to size a box.
const textWidth = (text, size) => Math.ceil(text.length * size * 0.6);

export function carMapSvg(mapPng, label) {
  const name = String(label || "").trim().slice(0, 32);
  const kicker = "YOUR CAR";
  const boxW = Math.max(textWidth(name, 30), textWidth(kicker, 18)) + 56;
  const boxH = name ? 96 : 56;
  const x = Math.round((W - boxW) / 2);
  const y = PIN_TOP - 18 - boxH;
  const mid = W / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><filter id="s" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#03162D" flood-opacity="0.22"/></filter></defs>
  <image href="data:image/png;base64,${mapPng.toString("base64")}" x="0" y="0" width="${W}" height="${H}"/>
  <g filter="url(#s)">
    <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="20" fill="#FFFFFF"/>
    <path d="M ${mid - 14} ${y + boxH - 1} L ${mid} ${y + boxH + 16} L ${mid + 14} ${y + boxH - 1} Z" fill="#FFFFFF"/>
  </g>
  <text x="${mid}" y="${y + (name ? 36 : 36)}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="18" letter-spacing="1.5" fill="#D92200">${kicker}</text>
  ${name ? `<text x="${mid}" y="${y + 74}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="30" fill="#03162D">${escapeXml(name)}</text>` : ""}
</svg>`;
}

export function composeCarMap(mapPng, label) {
  const resvg = new Resvg(carMapSvg(mapPng, label), {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Inter" },
    fitTo: { mode: "original" }
  });
  return resvg.render().asPng();
}
