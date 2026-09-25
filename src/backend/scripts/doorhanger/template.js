// Door hanger print template: 4.5in x 11in, hung on a parked car's door handle.
//
// Every hanger carries a REAL unclaimed tag, not a demo. The owner scans the QR,
// activates it with their own plate and phone (the normal /tag/<token> wizard),
// then tears off the bottom card and keeps it on the dashboard. From then on the
// card works like any E-Tag, with the doorhanger batch's two free contacts, and
// the back of the hanger sells the weatherproof sticker for when they run out.
//
// The output is one self-contained HTML file (fonts inlined, QR as inline SVG)
// with one CSS page per hanger side: front with its unique QR, then the shared
// back. Open it in Chrome and "Save as PDF" (the admin print queue works the
// same way), or render it headless. Page size includes a 0.125in bleed on every
// edge, which is what print vendors ask for.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Brand tokens, from landing/public/brand-guideline/tokens/colors.css.
const RED = "#FF2700";
const RED_TINT = "#FFE3DD";
const NAVY = "#03162D";
const SLATE = "#495B7B";
const PAGE = "#F1F1F0";

// Poppins and DM Sans stand in for Metropolis and Google Sans, exactly as the
// brand guideline's fonts.css does. The rupee sign lives in Poppins'
// devanagari subset, hence the extra face limited to U+20B9.
const FONT_FACES = [
  ["Poppins", 600, "poppins-latin-600-normal.woff2"],
  ["Poppins", 700, "poppins-latin-700-normal.woff2"],
  ["Poppins", 800, "poppins-latin-800-normal.woff2"],
  ["Poppins", 700, "poppins-devanagari-700-normal.woff2", "U+20B9"],
  ["Poppins", 800, "poppins-devanagari-700-normal.woff2", "U+20B9"],
  ["DM Sans", 400, "dm-sans-latin-400-normal.woff2"],
  ["DM Sans", 500, "dm-sans-latin-500-normal.woff2"],
  ["DM Sans", 700, "dm-sans-latin-700-normal.woff2"],
  ["DM Sans", 500, "poppins-devanagari-700-normal.woff2", "U+20B9"],
  ["DM Sans", 700, "poppins-devanagari-700-normal.woff2", "U+20B9"]
];

function fontCss() {
  return FONT_FACES.map(([family, weight, file, range]) => {
    const data = fs.readFileSync(path.join(HERE, "fonts", file)).toString("base64");
    return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;` +
      `src:url(data:font/woff2;base64,${data}) format("woff2");` +
      (range ? `unicode-range:${range};` : "") + "}";
  }).join("\n");
}

// onDark: navy band, "park" turns white. onRed: the red card, where the red
// "Tag" would vanish, so the whole mark goes white.
function wordmark(onDark, onRed = false) {
  let svg = fs.readFileSync(path.join(HERE, "parktag-wordmark.svg"), "utf8");
  if (onDark || onRed) svg = svg.replaceAll("#03162D", "#FFFFFF");
  if (onRed) svg = svg.replaceAll("#FF2700", "#FFFFFF");
  return svg.replace("<svg ", '<svg class="wordmark" ');
}

// Error correction M and no built-in margin: the white card around the code is
// the quiet zone. Same level the admin sticker print uses.
export async function qrSvg(url) {
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: NAVY, light: "#0000" } });
  return svg.replace("<svg ", '<svg class="qr" shape-rendering="crispEdges" ');
}

// Small line icons for the back, drawn at 24x24 in the brand navy.
const ICONS = {
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
  phone: '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>'
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

const CSS = `
@page { size: 4.75in 11.25in; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #888; }
body { font-family: "DM Sans", sans-serif; color: ${NAVY}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media screen { .page { margin: 24px auto; box-shadow: 0 4px 24px rgba(0,0,0,.25); } }

/* One side of one hanger, bleed included. .trim is the finished 4.5x11 area. */
.page { width: 4.75in; height: 11.25in; position: relative; overflow: hidden; background: #fff; page-break-after: always; break-after: page; }
.trim { position: absolute; left: .125in; top: .125in; width: 4.5in; height: 11in; }

/* Die-cut hole + slit for the handle. Printed art stays clear of it; the vendor
   cuts from the dieline, which only shows in --dieline proofs. */
.hole-zone { position: absolute; left: 0; right: 0; top: 0; height: 2.35in; }
.dieline { display: none; }
.show-dieline .dieline { display: block; position: absolute; inset: 0; pointer-events: none; }
.show-dieline .dieline * { stroke: #E6007E; stroke-width: 1.5; fill: none; }

/* Top band: navy on both sides so the hanger reads the same from either face. */
.band { position: absolute; left: -.125in; right: -.125in; top: -.125in; height: 4.55in; background: ${NAVY}; color: #fff; }
.band .inner { position: absolute; left: .125in; right: .125in; top: 2.4in; padding: 0 .35in; }
.wordmark { display: block; width: 1.55in; height: auto; position: absolute; left: .35in; top: 1.72in; }
.band .brand { position: absolute; left: .125in; right: .125in; top: .125in; height: 2.35in; }
.eyebrow { font-family: "Poppins"; font-weight: 700; font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; color: ${RED}; }
h1 { font-family: "Poppins"; font-weight: 800; font-size: 25pt; line-height: 1.08; letter-spacing: -.01em; margin-top: .08in; }
.band p { font-size: 10.5pt; line-height: 1.4; color: rgba(255,255,255,.78); margin-top: .1in; }

/* Front, middle: the offer and the three steps. */
.offer { position: absolute; left: .35in; right: .35in; top: 4.72in; }
h2 { font-family: "Poppins"; font-weight: 800; font-size: 17pt; line-height: 1.12; }
.offer p.lead { font-size: 10pt; line-height: 1.42; color: ${SLATE}; margin-top: .07in; }
.chip { display: inline-block; margin-top: .12in; padding: .05in .13in; border-radius: 99px; background: ${RED}; color: #fff; font-family: "Poppins"; font-weight: 700; font-size: 9pt; }
.steps { list-style: none; margin-top: .16in; }
.steps li { display: flex; gap: .12in; align-items: flex-start; font-size: 9.5pt; line-height: 1.35; margin-top: .09in; }
.steps li b { font-family: "Poppins"; font-weight: 700; }
.num { flex: 0 0 .26in; height: .26in; border-radius: 50%; background: ${NAVY}; color: #fff; font-family: "Poppins"; font-weight: 700; font-size: 9pt; display: flex; align-items: center; justify-content: center; }

/* Perforation between the hanger and the dashboard card. */
.perf { position: absolute; left: -.125in; right: -.125in; top: 7.8in; border-top: 1.5px dashed ${SLATE}; }
.perf span { position: absolute; left: 50%; top: -.09in; transform: translateX(-50%); background: #fff; padding: 0 .1in; white-space: nowrap; font-size: 7.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: ${SLATE}; }

/* Tear-off dashboard card: this is the tag people will scan from outside. */
.card { position: absolute; left: -.125in; right: -.125in; top: 7.8in; bottom: -.125in; background: ${RED}; color: #fff; }
.card .inner { position: absolute; left: .125in; right: .125in; top: .22in; bottom: .125in; padding: 0 .3in; display: flex; gap: .2in; align-items: center; }
.qrbox { flex: 0 0 2.05in; background: #fff; border-radius: .12in; padding: .14in .14in .08in; text-align: center; }
.qr { display: block; width: 100%; height: auto; }
.serial { font-family: "Courier New", monospace; font-weight: 700; font-size: 7.5pt; color: ${NAVY}; margin-top: .05in; letter-spacing: .04em; }
.card .copy h3 { font-family: "Poppins"; font-weight: 800; font-size: 15pt; line-height: 1.1; }
.card .copy p { font-size: 9pt; line-height: 1.35; margin-top: .08in; color: rgba(255,255,255,.92); }
.card .copy .small { font-size: 7.5pt; margin-top: .12in; opacity: .85; }
.card .wordmark-sm { width: 1.05in; height: auto; margin-top: .14in; display: block; }

/* Back. */
.how { position: absolute; left: .35in; right: .35in; top: 4.78in; }
.how .row { display: flex; gap: .14in; align-items: flex-start; margin-top: .16in; }
.how .row:first-child { margin-top: 0; }
.icon { flex: 0 0 .38in; width: .38in; height: .38in; padding: .07in; border-radius: 50%; background: ${RED_TINT}; color: ${RED}; }
.how .row b { display: block; font-family: "Poppins"; font-weight: 700; font-size: 11pt; line-height: 1.2; }
.how .row span { display: block; font-size: 9pt; line-height: 1.35; color: ${SLATE}; margin-top: .02in; }
.try { position: absolute; left: .35in; right: .35in; top: 7.05in; background: ${RED_TINT}; border-radius: .14in; padding: .16in .2in; }
.try b { font-family: "Poppins"; font-weight: 800; font-size: 12.5pt; color: ${NAVY}; }
.try p { font-size: 9pt; line-height: 1.38; color: ${NAVY}; margin-top: .04in; }
.buy { position: absolute; left: -.125in; right: -.125in; bottom: -.125in; height: 2.55in; background: ${PAGE}; }
.buy .inner { position: absolute; left: .125in; right: .125in; top: .26in; padding: 0 .35in; }
.buy h2 { font-size: 15pt; }
.buy p { font-size: 9pt; line-height: 1.38; color: ${SLATE}; margin-top: .05in; }
.price { display: flex; align-items: baseline; gap: .1in; margin-top: .1in; }
.price strong { font-family: "Poppins"; font-weight: 800; font-size: 20pt; color: ${RED}; }
.price s { font-size: 10pt; color: ${SLATE}; }
.price em { font-style: normal; font-size: 9pt; font-weight: 500; color: ${NAVY}; }
.url { font-family: "Poppins"; font-weight: 700; font-size: 12pt; margin-top: .08in; }
.foot { font-size: 7.5pt; color: ${SLATE}; margin-top: .06in; }

.sample { position: absolute; top: 3.2in; left: 0; right: 0; text-align: center; font-family: "Poppins"; font-weight: 800; font-size: 34pt; color: rgba(255,39,0,.18); transform: rotate(-28deg); pointer-events: none; }
`;

function dieline() {
  // Trim box, a 1.5in hole and a slit from the hole to the left edge. Drawn in
  // bleed-inclusive page coordinates (inches * 96), only for proofs.
  const px = (inch) => inch * 96;
  const cx = px(.125 + 2.25), cy = px(.125 + 1.15), r = px(.75);
  return `<svg class="dieline" viewBox="0 0 ${px(4.75)} ${px(11.25)}">
    <rect x="${px(.125)}" y="${px(.125)}" width="${px(4.5)}" height="${px(11)}" rx="${px(.2)}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}"/>
    <path d="M${cx - r} ${cy} L${px(.9)} ${px(.35)}"/>
  </svg>`;
}

function holeMask() {
  // The hole punches through the navy band; paint it as page grey on screen
  // proofs so the artwork can be judged around it.
  return `<svg class="hole-zone" viewBox="0 0 432 226"><circle cx="216" cy="110" r="72" fill="#fff" opacity=".08"/></svg>`;
}

function front(h, { sample }) {
  return `<section class="page"><div class="trim">
  <div class="band"><div class="brand">${holeMask()}${wordmark(true)}</div>
    <div class="inner">
      <div class="eyebrow">For the owner of this car</div>
      <h1>Could anyone reach you right now?</h1>
      <p>Lights left on. A window open. A car blocked in. Today they would have to wait, honk or leave a note.</p>
    </div>
  </div>
  <div class="offer">
    <h2>This hanger is your free ParkTag.</h2>
    <p class="lead">Activate the card below and anyone can reach you with a masked call. Your number is never shared.</p>
    <div class="chip">Free to activate · First 2 contacts free</div>
    <ol class="steps">
      <li><span class="num">1</span><span><b>Scan the code</b> with your phone camera.</span></li>
      <li><span class="num">2</span><span><b>Add your plate and mobile.</b> Confirm with a WhatsApp OTP.</span></li>
      <li><span class="num">3</span><span><b>Tear off the card</b> and keep it on your dashboard, facing out.</span></li>
    </ol>
  </div>
  <div class="card"><div class="inner">
    <div class="qrbox">${h.qr}<div class="serial">${h.serial}</div></div>
    <div class="copy">
      <h3>Need to reach this car's owner?</h3>
      <p>Scan the code. You get a masked call or WhatsApp. No numbers shared.</p>
      ${wordmark(true, true).replace('class="wordmark"', 'class="wordmark-sm"')}
    </div>
  </div></div>
  <div class="perf"><span>Tear here · keep on your dashboard</span></div>
  ${sample ? '<div class="sample">SAMPLE · NOT A REAL TAG</div>' : ""}
  </div>${dieline()}</section>`;
}

function back() {
  return `<section class="page"><div class="trim">
  <div class="band"><div class="brand">${holeMask()}${wordmark(true)}</div>
    <div class="inner">
      <div class="eyebrow">How ParkTag works</div>
      <h1>Be reachable. Stay private.</h1>
      <p>One QR card lets anyone reach you about your car, without seeing your number.</p>
    </div>
  </div>
  <div class="how">
    <div class="row">${icon("scan")}<div><b>Someone scans your card.</b><span>No app needed. Any phone camera works.</span></div></div>
    <div class="row">${icon("phone")}<div><b>Your phone rings.</b><span>A masked call from a ParkTag number. They never see yours.</span></div></div>
    <div class="row">${icon("check")}<div><b>Sorted in a minute.</b><span>Move the car, switch off the lights, get back to your day.</span></div></div>
  </div>
  <div class="try">
    <b>Try it today.</b>
    <p>After you activate, ask a friend to scan your card and call you. Your first 2 contacts are free, so you can see it work before you decide.</p>
  </div>
  <div class="buy"><div class="inner">
    <h2>Keep it for good.</h2>
    <p>The windshield sticker is weatherproof, scans through glass and includes a year of masked calls.</p>
    <div class="price"><strong>₹399</strong><s>₹499</s><em>Duo Pack · 2 stickers</em></div>
    <div class="url">parktag.me</div>
    <div class="foot">Free delivery · 7-day replacement · support@parktag.me</div>
  </div></div>
  </div>${dieline()}</section>`;
}

// hangers: [{ serial, scanUrl }]. Returns the full HTML document.
export async function renderDoorhangers(hangers, { sample = false, dieline: showDieline = false } = {}) {
  const pages = [];
  const backPage = back();
  for (const h of hangers) {
    const qr = await qrSvg(h.scanUrl);
    pages.push(front({ ...h, qr }, { sample }), backPage);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ParkTag door hangers</title>
<style>${fontCss()}\n${CSS}</style></head><body class="${showDieline ? "show-dieline" : ""}">${pages.join("\n")}</body></html>`;
}
