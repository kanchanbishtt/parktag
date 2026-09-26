// Sticker designs made in /admin/sticker-designer.
//
// A design is two things the print paths need, plus the editor's own state:
//
//   artworkSvg  everything on the sticker except the QR and the serial, as one
//               SVG in the sticker's 1000 x 600 box (same box as the original
//               Figma file, so every print path keeps its aspect and size).
//   layout      where the QR and the serial go on that box. Both are overlaid
//               per tag at print time, exactly as the fixed artwork always was.
//   canvasJson  the Fabric.js document, so the design reopens with its layers.
//
// Exactly one design is "published" at a time and that is what prints. With
// none published, every print path uses the original artwork and positions
// below, which is what they printed before the designer existed.

export const STICKER_WIDTH = 1000;
export const STICKER_HEIGHT = 600;

export const DEFAULT_ARTWORK_URL = "/images/org-parktag-sticker.svg";

// The original artwork's QR slot (631.4, 68.16, 306.4 x 312.09), squared and
// centred, and the serial in the red band above it, right edge on the QR's
// right edge. These are the numbers the print CSS always hard-coded.
export const DEFAULT_LAYOUT = Object.freeze({
  qr: Object.freeze({ x: 631.4, y: 70.98, size: 306.4 }),
  serial: Object.freeze({
    x: 637.8,
    y: 18,
    width: 300,
    fontSize: 13,
    fill: "#000000",
    fontFamily: "monospace",
    align: "right",
    visible: true
  })
});

// A QR smaller than this stops scanning reliably from a windscreen: 150 units
// is 15.75mm on the 105mm sticker. The editor enforces the same floor.
export const QR_MIN_SIZE = 150;

// SVG-as-<img> cannot load web fonts, so text can only use fonts the printing
// machine has. These are the ones every desktop OS ships (or a generic family).
export const STICKER_FONTS = Object.freeze([
  "Arial",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Impact",
  "sans-serif",
  "serif",
  "monospace"
]);

export const MAX_ARTWORK_BYTES = 6 * 1024 * 1024;
export const MAX_CANVAS_JSON_BYTES = 6 * 1024 * 1024;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SERIAL_ALIGNS = new Set(["left", "center", "right"]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export class StickerDesignError extends Error {}

function fail(message) {
  throw new StickerDesignError(message);
}

export function validateLayout(raw) {
  const qr = raw?.qr;
  const serial = raw?.serial;
  if (!qr || !serial) fail("Layout needs a QR code and a serial.");

  if (![qr.x, qr.y, qr.size].every(finite)) fail("QR position must be numbers.");
  if (qr.size < QR_MIN_SIZE) fail(`The QR code must be at least ${QR_MIN_SIZE} wide (about 16mm) to scan reliably.`);
  // A little tolerance for sub-pixel drag rounding at the edges.
  if (qr.x < -1 || qr.y < -1 || qr.x + qr.size > STICKER_WIDTH + 1 || qr.y + qr.size > STICKER_HEIGHT + 1) {
    fail("The QR code must sit fully inside the sticker.");
  }

  if (![serial.x, serial.y, serial.width, serial.fontSize].every(finite)) fail("Serial position must be numbers.");
  if (serial.fontSize < 6 || serial.fontSize > 80) fail("Serial text size must be between 6 and 80.");
  if (serial.width <= 0 || serial.width > STICKER_WIDTH) fail("Serial box width is out of range.");
  if (!HEX_COLOR.test(String(serial.fill))) fail("Serial colour must be a hex colour like #000000.");
  if (!STICKER_FONTS.includes(serial.fontFamily)) fail("Serial font is not one of the print-safe fonts.");
  if (!SERIAL_ALIGNS.has(serial.align)) fail("Serial alignment must be left, center or right.");

  return {
    qr: { x: round2(qr.x), y: round2(qr.y), size: round2(qr.size) },
    serial: {
      x: round2(serial.x),
      y: round2(serial.y),
      width: round2(serial.width),
      fontSize: round2(serial.fontSize),
      fill: serial.fill.toLowerCase(),
      fontFamily: serial.fontFamily,
      align: serial.align,
      visible: serial.visible !== false
    }
  };
}

// The artwork is written by an admin's browser and later served from our
// origin, so it is checked, not trusted. Rejected rather than stripped: a
// design that silently loses a layer on save is worse than one that says why.
// Served only as <img> and under a sandbox CSP (see the route), so this is
// defence in depth, not the only line.
const FORBIDDEN_SVG = [
  [/<script\b/i, "scripts"],
  [/<foreignObject\b/i, "embedded HTML"],
  [/<(iframe|embed|object|audio|video|canvas)\b/i, "embedded content"],
  [/<!(DOCTYPE|ENTITY)\b/i, "DOCTYPE or entity declarations"],
  [/\son[a-z]+\s*=/i, "event handler attributes"],
  [/javascript:/i, "javascript: links"],
  [/@import\b/i, "stylesheet imports"]
];

export function validateArtworkSvg(svg) {
  if (typeof svg !== "string" || !svg.trim()) fail("The design has no artwork.");
  if (Buffer.byteLength(svg, "utf8") > MAX_ARTWORK_BYTES) fail("The artwork is over 6 MB. Use smaller images.");
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg)) fail("The artwork must be an SVG document.");
  for (const [pattern, what] of FORBIDDEN_SVG) {
    if (pattern.test(svg)) fail(`The artwork contains ${what}, which stickers cannot use.`);
  }
  // Every reference must be inline data or a same-document fragment. An SVG
  // shown as <img> cannot fetch anything anyway, so an outside URL would just
  // print as a hole.
  for (const match of svg.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi)) {
    const ref = match[2].trim();
    if (!ref.startsWith("#") && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(ref)) {
      fail("The artwork links to an outside file. Images must be uploaded into the design.");
    }
  }
  for (const match of svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const ref = match[2].trim();
    if (!ref.startsWith("#") && !/^data:/i.test(ref)) {
      fail("The artwork links to an outside file. Images must be uploaded into the design.");
    }
  }
  return svg;
}

export function validateCanvasJson(json) {
  if (typeof json !== "string" || !json) fail("The design has no layers.");
  if (Buffer.byteLength(json, "utf8") > MAX_CANVAS_JSON_BYTES) fail("The design is over 6 MB. Use smaller images.");
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("The design's layers could not be read.");
  }
  if (!parsed || !Array.isArray(parsed.objects)) fail("The design's layers could not be read.");
  return json;
}

export function validateName(name) {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) fail("Give the design a name.");
  if (clean.length > 80) fail("Keep the name under 80 characters.");
  return clean;
}

// What a print path needs: where the artwork is and where the QR and serial go.
export function printSpecFor(design) {
  if (!design) {
    return { designId: null, name: "Original artwork", artworkUrl: DEFAULT_ARTWORK_URL, layout: DEFAULT_LAYOUT };
  }
  const version = encodeURIComponent(String(design.updatedAt || ""));
  return {
    designId: String(design._id),
    name: design.name,
    artworkUrl: `/admin/sticker-art/${design._id}.svg?v=${version}`,
    layout: design.layout
  };
}

export async function getPublishedStickerDesign(collections) {
  if (!collections?.stickerDesigns) return null;
  return collections.stickerDesigns.findOne({ status: "published" }, { projection: { canvasJson: 0, artworkSvg: 0 } });
}

function pct(value, total) {
  return `${round2((value / total) * 100)}%`;
}

// Inline CSS for the three overlays, in percent of the sticker box (and cqw for
// the serial's size) so they scale with the sticker at any print size.
// Only numbers and validated enums reach here, so there is nothing to escape,
// and quotes inside are single so the result can sit in a style="..." attribute.
export function overlayStyles(layout) {
  const { qr, serial } = layout;
  const serialFont = serial.fontFamily === "monospace"
    ? "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    : `'${serial.fontFamily}', sans-serif`;
  return {
    qr: `position:absolute;left:${pct(qr.x, STICKER_WIDTH)};top:${pct(qr.y, STICKER_HEIGHT)};width:${pct(qr.size, STICKER_WIDTH)};aspect-ratio:1;display:block;`,
    serial: [
      "position:absolute",
      `left:${pct(serial.x, STICKER_WIDTH)}`,
      `top:${pct(serial.y, STICKER_HEIGHT)}`,
      `width:${pct(serial.width, STICKER_WIDTH)}`,
      `font-size:${round2(serial.fontSize / 10)}cqw`,
      `text-align:${serial.align}`,
      `color:${serial.fill}`,
      `font-family:${serialFont}`,
      "letter-spacing:0.06em",
      "white-space:nowrap",
      serial.visible ? "" : "display:none"
    ].filter(Boolean).join(";") + ";"
  };
}
