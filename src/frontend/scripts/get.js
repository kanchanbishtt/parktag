// The public shop window at /get.
//
// Everything on this page that is a NUMBER comes from the server. The copy,
// the images and the ordering live here; prices, and the COD surcharge, are
// fetched from /api/shop/public-catalogue, which serves the same SHOP_PRODUCTS
// the order routes charge from.
//
// That split is the whole design. Prices are already written down in three
// places in this repo and have drifted apart once already; a storefront that
// quotes a figure the checkout does not charge is the worst place for it to
// happen again, because it is the first thing a stranger reads.
//
// So no amount anybody is CHARGED appears in this file. The current price,
// launch offer and crossed-out MRP all come from the live catalogue.
import { getCaptchaToken } from "./recaptcha.js";
import { burstConfetti, clearConfetti } from "./confetti.js";
import { referralCode, clearReferralCode } from "./referral-link.js";
import { checkoutCart } from "./checkout-cart.js";
import { keepFreshToken } from "./fresh-captcha.js";
const PACKS = [
  {
    id: "pt-car-1",
    desc: "One tag for the windscreen of one car.",
    image: "/images/shop-car-thumb.webp"
  },
  {
    id: "pt-car-2",
    desc: "Best value. Tag two cars, or the front and back of one.",
    image: "/images/shop-car-2-thumb.webp",
    // The two real tags, shown in the checkout sheet beside the order.
    summaryImage: "/images/order-duo-thumb.webp"
  },
  // Out of stock, not withdrawn. A pack we still price but cannot ship is
  // shown with its price and no way to buy it, rather than dropped: a visitor
  // who came looking for the bike tag learns it exists and is coming back,
  // instead of concluding we never sold one. Clear the flag when stock lands.
  {
    id: "pt-combo",
    desc: "Car and bike together, for the whole household.",
    image: "/images/shop-combo-thumb.webp",
    soldOut: true
  },
  {
    id: "pt-bike-1",
    desc: "For a two-wheeler, front and back.",
    image: "/images/shop-bike-thumb.webp",
    soldOut: true
  }
];

// The pack the hero and the sticky bar quote. Named rather than "the cheapest"
// or "the first": which pack leads is a merchandising decision, and deriving it
// from price would silently change the headline the day a price moves.
const SUPPORT_WHATSAPP = "918791638854";
const HERO_PACK = "pt-car-2";

let _products = {};
// The website offer on each pack, off the catalogue. The server applies the
// same offers to the order on its own; these are for showing the price.
let _offers = {};
let _addOn = null;
let _checkedOutAddOn = null;
// { surchargePaise, productIds, maxQuantity } off the catalogue: which packs take Cash on
// Delivery, what it adds and the most packs it covers. Null means online only.
let _cod = null;

const byId = (id) => document.getElementById(id);

// Whole rupees. Every amount on the wire is paise, matching the order routes,
// so the conversion happens once, here.
function rupees(paise) {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

// The running total, shown only above one. At quantity 1 it would just repeat
// the unit price a second time for no reason. It is qty multiplied against the
// server's own per-unit amountPaise -- never a computed discount, and never a
// number this page invented.
function offerFor(sku) {
  return _offers[sku] || null;
}

function codFor(sku, quantity = 1) {
  if (!_cod || !_cod.productIds.includes(sku)) return null;
  // Above the cap the sheet offers online only; the server refuses it anyway.
  return _cod.maxQuantity && quantity > _cod.maxQuantity ? null : _cod;
}

function pricedTotalPaise(sku, priced, qty, addOn = null) {
  const offer = offerFor(sku);
  // The server's own figure for this many packs (a percent or per-pack offer
  // does not scale like a flat one); the subtraction only for an older reply.
  const byQty = offer && Array.isArray(offer.payableByQuantity) ? offer.payableByQuantity[qty - 1] : undefined;
  const packs = typeof byQty === "number" ? byQty : (priced.amountPaise * qty) - (offer?.discountPaise || 0);
  return packs + (addOn?.amountPaise || 0);
}

function applyQtyTotal(el, priced, qty, sku) {
  if (qty > 1) {
    el.hidden = false;
    const offer = offerFor(sku);
    el.textContent = offer
      ? `${qty} packs · ${offer.code} applied = ${rupees(pricedTotalPaise(sku, priced, qty))}`
      : `${qty} × ${rupees(priced.amountPaise)} = ${rupees(priced.amountPaise * qty)}`;
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

// The share of MRP the launch offer takes off, in whole percent; 0 without one.
function offPct(offer) {
  return offer && offer.mrpPaise > offer.offerPaise
    ? Math.round(((offer.mrpPaise - offer.offerPaise) / offer.mrpPaise) * 100)
    : 0;
}

function renderChips(products) {
  const hero = products[HERO_PACK];
  const chips = document.querySelectorAll(".gt-chip-price");
  if (!chips.length || !hero) return;

  const offer = offerFor(HERO_PACK);
  const part = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  };
  // The pack's own name and what it saves, from the catalogue: the card can
  // only say what the checkout will charge.
  const name = byId("gtBuyName");
  if (name) name.textContent = hero.name;
  const pct = offPct(offer);
  for (const chip of chips) {
    chip.replaceChildren(
      part("strong", "gt-price-v", rupees(offer ? offer.offerPaise : hero.amountPaise)),
      ...(chip.dataset.for ? [part("span", "gt-price-for", chip.dataset.for)] : []),
      ...(offer ? [part("s", "gt-price-was", `MRP ${rupees(offer.mrpPaise)}`)] : []),
      ...(pct >= 1 ? [part("span", "gt-buy-off", `${pct}% OFF`)] : [])
    );
  }
  const save = byId("gtSave");
  if (save) {
    const saved = offer && offer.mrpPaise > offer.offerPaise ? `You save ${rupees(offer.mrpPaise - offer.offerPaise)} · ` : "";
    save.replaceChildren(saved, part("b", "", "Free delivery"));
    save.hidden = false;
  }

  // Same rule as the sticky bar: cash on delivery is promised only when the
  // catalogue says this pack takes it. The plain online line stands in for it
  // otherwise, so the list never has a hole.
  const cod = Boolean(codFor(HERO_PACK));
  const codLine = byId("gtChipCod");
  const onlineLine = byId("gtChipOnline");
  if (codLine) codLine.hidden = !cod;
  if (onlineLine) onlineLine.hidden = cod;
}

function renderPacks(products) {
  const list = byId("gtPacks");
  if (!list) return;

  const rows = [];
  const outRows = [];
  for (const pack of PACKS) {
    const priced = products[pack.id];
    // A pack the server no longer sells is dropped rather than shown at a
    // guessed price. Silence beats an offer that cannot be honoured.
    if (!priced) continue;

    // The server's word wins. Its flag is what create-order refuses on, so a
    // pack it reports sold out is shown that way whatever this list says.
    const soldOut = Boolean(pack.soldOut || priced.soldOut);

    const li = document.createElement("li");
    li.className = soldOut ? "gt-pack gt-pack-out" : "gt-pack";

    const img = document.createElement("img");
    img.src = pack.image;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";

    const bd = document.createElement("div");
    bd.className = "gt-pack-bd";

    const name = document.createElement("span");
    name.className = "gt-pack-n";
    name.textContent = priced.name;

    const desc = document.createElement("span");
    desc.className = "gt-pack-d";
    desc.textContent = pack.desc;

    const price = document.createElement("span");
    price.className = "gt-pack-price";

    const now = document.createElement("span");
    now.className = "gt-pack-now";
    const offer = offerFor(pack.id);
    now.textContent = rupees(offer ? offer.offerPaise : priced.amountPaise);
    price.append(now);

    // The struck-through price is shown only when it is genuinely higher than
    // what is being charged. A "was" that is not above the "now" is not a
    // saving, and printing one anyway is the kind of thing that turns a
    // discount into a misleading price claim.
    if (offer && offer.mrpPaise > offer.offerPaise) {
      const was = document.createElement("span");
      was.className = "gt-pack-was";
      was.textContent = `MRP ${rupees(offer.mrpPaise)}`;
      price.append(was);
    }

    bd.append(name, desc, price);

    // The quantity stepper. Skipped for a sold-out pack: there is nothing here
    // to set a count on.
    //
    // Built with <button>, never <a>, and kept a SIBLING of the Order anchor
    // rather than nested inside it: the delegated click handler below matches
    // on `a[data-sku]` via closest(), and a plain button outside that anchor's
    // subtree can never satisfy it. Tapping − or + must never also fire a
    // checkout.
    if (!soldOut) {
      const qty = _qty.get(pack.id) || 1;

      const stepper = document.createElement("div");
      stepper.className = "gt-pack-qty";

      const dec = document.createElement("button");
      dec.type = "button";
      dec.className = "gt-pack-qty-btn";
      dec.dataset.qtyDir = "dec";
      dec.dataset.sku = pack.id;
      dec.textContent = "−";
      dec.setAttribute("aria-label", `Fewer ${priced.name}`);

      const count = document.createElement("span");
      count.className = "gt-pack-qty-n";
      count.textContent = String(qty);

      const inc = document.createElement("button");
      inc.type = "button";
      inc.className = "gt-pack-qty-btn";
      inc.dataset.qtyDir = "inc";
      inc.dataset.sku = pack.id;
      inc.textContent = "+";
      inc.setAttribute("aria-label", `More ${priced.name}`);

      stepper.append(dec, count, inc);

      const total = document.createElement("span");
      total.className = "gt-pack-qty-total";
      applyQtyTotal(total, priced, qty, pack.id);

      bd.append(stepper, total);
    }

    // A sold-out pack gets a plain element with NO data-sku and no href, so it
    // is inert in both paths at once: the delegated click handler matches on
    // data-sku and never sees it, and with scripting off there is no link into
    // a checkout that cannot be fulfilled.
    const cta = document.createElement("a");
    if (soldOut) {
      // Still no data-sku, so neither the delegated click handler nor a
      // scripting-off click can reach a checkout we cannot fulfil. It is a
      // link now because Clarity recorded people clicking the old inert
      // "Sold out" label: a dead click that told us nothing. This turns that
      // same tap into a message we can answer, and into demand we can count.
      cta.className = "gt-pack-cta gt-pack-cta-out";
      cta.textContent = "Tell me when it's back";
      cta.href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(
        `Hi! Please let me know when the ${priced.name} is back in stock.`
      )}`;
      cta.target = "_blank";
      cta.rel = "noopener";
      cta.setAttribute("aria-label", `Ask when ${priced.name} is back in stock`);
      cta.addEventListener("click", () => {
        window.ptTrack?.("waitlist_click", { item_id: pack.id, item_name: priced.name });
      });
    } else {
      cta.className = "gt-btn gt-pack-cta";
      cta.href = `#packs`;
      cta.textContent = "Order";
      cta.dataset.sku = pack.id;
      cta.setAttribute("aria-label", `Order ${priced.name}`);
      // Only the button buys. The card itself used to (#300, after Clarity
      // recorded taps on the price and the photo), and that read as the page
      // acting on its own: people tap a card to look at it, and found the
      // delivery sheet opening on them. A tap on the card is a look, not an
      // order.
    }

    li.append(img, bd, cta);
    (soldOut ? outRows : rows).push(li);
  }

  list.replaceChildren(...rows);

  // Sold-out packs leave the buy list so the visitor faces two real choices,
  // not four with two dead ends. They stay one tap away under "Coming back
  // soon" because that tap is how the waitlist demand gets counted.
  const soon = byId("gtSoon");
  const outList = byId("gtPacksOut");
  if (soon && outList) {
    outList.replaceChildren(...outRows);
    soon.hidden = outRows.length === 0;
  }
}

function renderBar(products) {
  const hero = products[HERO_PACK];
  if (!hero) return;

  const name = byId("gtBarName");
  const sub = byId("gtBarSub");
  if (name) name.textContent = hero.name;
  // COD is named only when the catalogue says the hero pack takes it, which
  // is exactly when guest create-order accepts it. This bar once promised a
  // payment method the next tap could not offer.
  const offer = offerFor(HERO_PACK);
  const pct = offPct(offer);
  const priceLine = offer
    ? `${rupees(offer.offerPaise)}${pct >= 1 ? ` · ${pct}% off` : ""} · Free delivery`
    : `${rupees(hero.amountPaise)} · Free delivery`;
  // The bar is one line on a phone, and with the COD note on it the price was
  // cut off with an ellipsis. COD is named on the first screen instead.
  if (sub) sub.textContent = priceLine;

  // The terms under the first-screen price. Plain text, not a link:
  // begin_checkout still means a pressed Order button, never a tap elsewhere.
  const first = byId("gtFirstPrice");
  if (first) {
    const free = document.createElement("b");
    free.textContent = "Free delivery";
    const rest = [codFor(HERO_PACK) ? "Cash on delivery" : null, "1 year masked calling"].filter(Boolean);
    first.replaceChildren(free, ` · ${rest.join(" · ")}`);
    first.hidden = false;
  }
}

function renderAddOn(addOns) {
  const host = byId("gtAddon");
  const addOn = Array.isArray(addOns) ? addOns.find((item) => item.id === "dashboard-plate") : null;
  _addOn = addOn || null;
  if (!host || !addOn) {
    if (host) host.hidden = true;
    return;
  }

  byId("gtAddonImage").src = addOn.image;
  byId("gtAddonDescription").textContent = addOn.description;
  byId("gtAddonPrice").textContent = `+${rupees(addOn.amountPaise)}`;
  host.hidden = false;
  // Ticking the box, not the order that follows: this is how many people want
  // the plate at all, including the ones who never pay.
  byId("gtAddonCheck")?.addEventListener("change", (event) => {
    cartSave({ addOn: event.target.checked });
    if (event.target.checked && window.ptTrack) {
      ptTrack("add_on_selected", { item_id: addOn.id, value: addOn.amountPaise / 100, currency: "INR" });
    }
  });
}

// Duo Pack only. The box stays ticked if the buyer then orders another pack,
// so the pack decides, not the box: any other sku gets no plate and no charge.
function selectedAddOn(sku) {
  return _addOn && byId("gtAddonCheck")?.checked && (_addOn.productIds || []).includes(sku) ? _addOn : null;
}

// The hero and bar buttons carry the lead pack in their href so they work with
// no JS at all. That makes the id appear in the markup as well as here, so it
// is written back from HERO_PACK on load — otherwise changing which pack leads
// would quietly leave two buttons pointing at the old one.
function syncHeroLinks() {
  for (const id of ["gtCta", "gtCta2", "gtBarCta"]) {
    const el = byId(id);
    if (!el) continue;
    el.href = "#packs"; // in-page: an ad landing page keeps its own traffic
    el.dataset.sku = HERO_PACK;
  }
}

// ── Checkout ───────────────────────────────────────────────────────────────
//
// Pack, then delivery address, then Razorpay. No sign-in anywhere in it.
//
// The address step is NOT built here. window.ptCollectAddress is the sheet the
// dashboard, the vehicle-detail page and the Shop tab already await before
// opening Razorpay; it is loaded on this page and called with { guest: true },
// which is the same window with nothing fetched from a profile that does not
// exist and nothing saved back to one. It resolves with the address instead.
//
// Every amount is still the server's. This sends a productId and that address
// and nothing else — no price, no total — so a tampered request cannot buy a
// ₹499 pack for ₹1.

let _sku = null;
let _busy = false;
// The amount the SERVER priced this order at, kept so the purchase event can
// report revenue. Never used to charge anything -- Razorpay is opened with
// order.amount straight off the response, and the server re-derives the price
// at verify. This is for measurement only.
let _paidPaise = 0;
// The promo code the server actually applied, reported as GA4 `coupon`.
let _paidCoupon = null;
// How many of _sku the buyer actually paid for, kept the same way _paidPaise
// is: so the purchase event reports the real count instead of the "1" every
// checkout used to hardcode. Measurement only.
let _paidQty = 1;
// Whether that order was placed as Cash on Delivery. Measurement and copy only.
let _paidCod = false;

// How many of each pack the buyer wants, keyed by sku. A Map rather than a
// data attribute that has to be re-parsed off the DOM -- buy() reads it
// directly at tap time, the same way _sku is read rather than pulled back off
// an element. Floored at 1 wherever it is written: this is "how many of this
// pack", not a cart with a remove button, so there is no zero.
const _qty = new Map();
// The most packs one order may hold, from the catalogue. The fallback only
// matters if the catalogue ever omits it; the server enforces its own anyway.
let _maxQty = 20;

// ── Surviving a refresh ────────────────────────────────────────────────────
//
// A reload used to throw away everything the buyer had done: the pack counts,
// the add-on tick, the open checkout and every line of the address typed into
// it. The choices are kept here and put back on load; the address is kept by
// the address sheet itself (owner/address-step.js), which every page shares.
//
// Cleared outright once an order is paid or placed, so a finished purchase is
// never reopened by the next refresh.
const { read: cartRead, save: cartSave, clear: cartClear } = checkoutCart("pt_get_cart");

// ── Remembering an order the buyer may never see confirmed ─────────────────
//
// The gap this closes: a guest has no account, so if the tab dies between the
// payment succeeding and the confirmation screen rendering, nothing anywhere
// ties that person to their order. It is still fulfilled — Razorpay's webhook
// does that without the browser — and it still ships. They simply cannot find
// it, because the only copy of the order number was on a screen they never saw,
// and the only message that would have carried it is a WhatsApp that depends on
// Meta being configured.
//
// So the number is written to this device the moment the order exists, which is
// BEFORE Razorpay opens — the last point that is guaranteed to run no matter
// what the buyer's browser does next. Nothing sensitive is stored: an order
// number and the last four digits the buyer just typed, which is exactly the
// pair /track-order already asks for and useless without each other.
const RECALL_KEY = "pt_get_orders";
const RECALL_TTL = 60 * 864e5; // 60 days, past any delivery, and self-clearing
const RECALL_MAX = 5;          // rows kept on the device
const RECALL_CHECK = 3;        // newest rows checked on a visit

function recallRead() {
  try {
    const rows = JSON.parse(localStorage.getItem(RECALL_KEY) || "[]");
    if (!Array.isArray(rows)) return [];
    const live = rows
      .filter((r) => r && r.n && r.f && Date.now() - (r.t || 0) < RECALL_TTL)
      .slice(0, RECALL_MAX);
    // Both limits are enforced HERE, on the way in, so they hold no matter how
    // the stored value got there — an older build of this page, a hand-edited
    // value, anything. Enforcing them only on write left two holes: a device
    // where every row had expired kept them for good, because the caller
    // returned early before pruning; and an over-long list was never trimmed
    // until the next purchase. Writing only on a change keeps this from
    // creating the key on a device that has never ordered.
    if (live.length !== rows.length) recallWrite(live);
    return live;
  } catch {
    return []; // private mode, storage disabled, corrupt value, never fatal
  }
}

function recallWrite(rows) {
  try { localStorage.setItem(RECALL_KEY, JSON.stringify(rows.slice(0, RECALL_MAX))); } catch { /* ignore */ }
}

function remember(orderNumber, address) {
  const four = String((address && address.phone) || "").replace(/\D/g, "").slice(-4);
  if (!orderNumber || four.length !== 4) return;
  const rows = recallRead().filter((r) => r.n !== orderNumber);
  rows.unshift({ n: orderNumber, f: four, t: Date.now() });
  recallWrite(rows);
}

// Shown only for an order the SERVER agrees was paid. /track-order answers 404
// for an order still sitting at "created", so an abandoned checkout — where the
// buyer opened Razorpay and walked away — never produces a bar announcing an
// order that does not exist.
//
// A miss is not a reason to forget the row. A payment whose webhook has not
// landed yet also reads as 404, and dropping the record then would throw away
// the buyer's only copy of the number at the exact moment it matters. Rows age
// out on their own instead.
async function showRecall() {
  const rows = recallRead(); // prunes anything past the TTL as it reads
  if (!rows.length) return;

  for (const row of rows.slice(0, RECALL_CHECK)) {
    let data;
    try {
      const res = await fetch("/api/shop/track-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderNumber: row.n, lastFour: row.f })
      });
      if (!res.ok) continue;
      data = await res.json();
    } catch {
      return; // offline: the rows stay, and the next visit tries again
    }
    if (!data || !data.ok || !data.order) continue;

    const bar = byId("gtRecall");
    if (!bar) return;
    // The status itself lives on the track page. Naming it here too would mean
    // a second copy of its label map, and the two would drift.
    byId("gtRecallS").textContent = data.order.productName
      ? `${row.n} · ${data.order.productName}`
      : row.n;
    // Only the order number travels in the URL. The last four is the proof that
    // opens the order, and a proof does not belong in browser history.
    bar.href = `/track-order?order=${encodeURIComponent(row.n)}`;
    bar.hidden = false;
    return;
  }
}

// A step run, or a harmless stand-in when the shared module has not loaded.
// Presentation only: nothing here may throw into the order path, because a
// decoration must never be able to stop somebody buying.
function stepRun(mountId, steps) {
  try {
    const mount = byId(mountId);
    if (!mount || !window.ptProgress || typeof window.ptProgress.steps !== "function") {
      return { begin() {}, advance() {}, slow() {}, done() {}, fail() {}, destroy() {} };
    }
    return window.ptProgress.steps(mount, steps);
  } catch {
    return { begin() {}, advance() {}, slow() {}, done() {}, fail() {}, destroy() {} };
  }
}

function showSheet() {
  byId("gtSheetBd").hidden = false;
  byId("gtSheet").hidden = false;
  document.body.style.overflow = "hidden";
}

// Take the sheet down, whatever is in flight.
//
// Split out from hideSheet() because the guard there is about DISMISSAL — the
// backdrop, Escape, the Done button — and not every close is a dismissal. Two
// callers legitimately need the sheet gone while _busy is still set, and both
// used to call hideSheet() and silently get nothing:
//
//   - a failed create-order, which left the buyer reading "Setting up your
//     order" forever with the real error hidden behind it;
//   - the hand-off to Razorpay, whose own window is about to cover the page.
//     Leaving this sheet underneath meant that dismissing Razorpay returned the
//     buyer to a blank sheet over a page that could no longer scroll.
function closeSheet() {
  // Ends the loop rather than leaving it drawing against a canvas nobody can
  // see: the host stays on the page after the sheet closes.
  clearConfetti(byId("gtCfti"), "gt-cfti");
  byId("gtSheet").hidden = true;
  byId("gtSheetBd").hidden = true;
  document.body.style.overflow = "";
}

// What a dismissal gesture calls: the backdrop, Escape, the Done button. None
// of those may close the sheet out from under a live checkout.
function hideSheet() {
  if (_busy) return; // never close over a payment in flight
  closeSheet();
}

// ── A friend's link ───────────────────────────────────────────────
// What the parked code takes off, once the SERVER has said it will honour it.
// Zero until then, and zero again if it is refused.
//
// The page used to announce the discount for any well-formed code and leave
// the checkout sheet quoting the full price, so a friend saw nothing come off
// until Razorpay opened. Now the sheet shows it, which is only safe for a code
// that is real: quoting a price the payment window will not honour is the one
// thing a checkout must not do.
let _referralOff = 0;

function dropReferral() {
  clearReferralCode();
  _referralOff = 0;
  const note = byId("gtRef");
  if (note) { note.hidden = true; note.textContent = ""; }
}

async function checkReferral() {
  const code = referralCode();
  if (!code) return;
  let answer = null;
  // Bounded, because a reloaded checkout waits on this before it reopens.
  const abort = typeof AbortController === "function" ? new AbortController() : null;
  const timer = abort ? setTimeout(() => abort.abort(), 4000) : null;
  try {
    const res = await fetch("/api/shop/referral/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      ...(abort ? { signal: abort.signal } : {})
    });
    if (res.ok) answer = await res.json();
  } catch { /* offline or too slow: treated as "could not ask" below */ }
  if (timer) clearTimeout(timer);
  // Could not ask (offline, rate limited). Nothing is promised on the page;
  // the code stays parked and the server still decides at checkout.
  if (!answer) return;
  // Nobody holds this code. Forget it rather than carry it to checkout.
  if (!answer.ok || !(Number(answer.discountPaise) > 0)) { dropReferral(); return; }

  _referralOff = Number(answer.discountPaise);
  const note = byId("gtRef");
  if (note) {
    note.textContent = `🎁 Friend's link applied: an extra ${rupees(_referralOff)} off when you pay online.`;
    note.hidden = false;
  }
}

// Razorpay's own sheet reports its own failures, so this only has to speak up
// for the two steps either side of it.
function say(message) {
  const note = byId("gtNote");
  if (!note) return;
  note.hidden = false;
  note.textContent = message;
}

// Loaded on demand (see checkout-loader.js) rather than in the page's <script>
// tags: most ad traffic bounces before checkout, and Instagram's in-app browser
// can tear the WebView down mid-init, which surfaced as a spurious "Java object
// is gone" console error for visitors who never bought anything.
const loadRazorpay = () => window.ptLoadRazorpay();

// Opens a connection to a host we are about to need. Added at the moment of
// intent rather than written into the HTML: a page-load preconnect is spent on
// every visitor, and the browser drops an idle one after about ten seconds,
// long before most people reach payment.
function preconnect(origin) {
  try {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    document.head.appendChild(link);
  } catch { /* a hint, never fatal */ }
}

async function buy(sku) {
  if (_busy) return;
  _sku = sku;
  // Fired here, not awaited: clicking "buy" is a real intent signal (unlike a
  // page view), so it is worth prefetching in parallel with the address step
  // below rather than paying for the round trip at the moment of payment.
  loadRazorpay();
  preconnect("https://checkout.razorpay.com");
  // The bot check, for the same reason. It used to start only at "Continue to
  // pay": fetch the site key, download Google's script, then run it, all while
  // the buyer watched. Now that happens while they type the address, and it is
  // kept fresh for as long as that takes (see fresh-captcha.js): a token lasts
  // two minutes and an address usually takes longer, so the one minted here
  // was stale by the tap and the buyer waited for another.
  const captcha = keepFreshToken(() => getCaptchaToken("guest_checkout"));
  // Read once, up front, so the value submitted below can never drift from
  // whatever the stepper happens to show by the time the request lands.
  const quantity = _qty.get(sku) || 1;
  const product = _products[sku];
  // Offered inside the checkout sheet for the packs that take it, ticked when
  // the box on the page is. What the buyer decides in the sheet comes back with
  // the address (see below), so this is only where it starts.
  const addOnOffered = _addOn && (_addOn.productIds || []).includes(sku) ? _addOn : null;
  const addOnAtOpen = selectedAddOn(sku);
  _checkedOutAddOn = addOnAtOpen;

  if (typeof window.ptCollectAddress !== "function") {
    captcha.stop();
    say("The delivery step could not load. Please refresh and try again.");
    return;
  }

  // The shared sheet. Resolves with the address, or false if dismissed —
  // backing out here is an ordinary thing to do, not an error. It is also
  // where the buyer picks online or Cash on Delivery, for a pack that takes it.
  const offer = offerFor(sku);
  const cod = codFor(sku, quantity);
  // A friend's link the server has confirmed (checkReferral). It comes off the
  // ONLINE price, because that is what the payment window is about to ask for,
  // and never off Cash on Delivery: the server does not apply it there.
  // Without the plate: the sheet adds it when it is ticked, so the same number
  // is never added twice.
  const totalPaise = product ? pricedTotalPaise(sku, product, quantity, null) : 0;
  const refOff = referralCode() ? _referralOff : 0;
  // The server's own floor: no discount takes the goods below one rupee.
  const onlinePaise = refOff ? Math.max(totalPaise - refOff, 100) : totalPaise;
  // Marked open before the sheet shows, so a reload from here brings it back.
  cartSave({ checkout: sku });
  const picked = await window.ptCollectAddress({
    guest: true,
    // The COD phone check in the sheet sends a code, so it is bot-scored too.
    captchaToken: () => getCaptchaToken("guest_checkout"),
    orderSummary: product
      ? {
          name: `${quantity > 1 ? `${quantity} × ` : ""}${product.name}`,
          amountPaise: onlinePaise,
          image: PACKS.find((p) => p.id === sku)?.summaryImage || PACKS.find((p) => p.id === sku)?.image,
          mrpPaise: offer || refOff ? product.amountPaise * quantity : null,
          offerLabel: offer ? `${offer.code} auto-applied` : null,
          referralLabel: refOff ? `Friend's link: ${rupees(totalPaise - onlinePaise)} off` : null,
          cod: cod
            ? { amountPaise: pricedTotalPaise(sku, product, quantity, null) + cod.surchargePaise, feePaise: cod.surchargePaise }
            : null,
          addOn: addOnOffered
            ? {
                id: addOnOffered.id,
                name: addOnOffered.name,
                description: addOnOffered.description,
                amountPaise: addOnOffered.amountPaise,
                image: addOnOffered.image,
                checked: Boolean(addOnAtOpen),
                // The same tick the page has: its own handler saves the choice
                // and counts it, so the two can never disagree.
                onChange: (on) => {
                  const box = byId("gtAddonCheck");
                  if (!box) return;
                  box.checked = on;
                  box.dispatchEvent(new Event("change"));
                }
              }
            : undefined
        }
      : null
  });
  if (!picked) {
    captcha.stop();
    cartSave({ checkout: null }); // backed out on purpose: do not reopen it
    return;
  }
  const { paymentMethod = "online", codToken, marketingOptIn = false, marketingOptInSource, addOn: addOnPicked, ...address } = picked;
  const payCod = paymentMethod === "cod";
  // The sheet's answer, not the page's box, decides: the buyer may have ticked
  // or unticked the plate there.
  const addOn = addOnOffered && addOnPicked ? addOnOffered : null;
  _checkedOutAddOn = addOn;

  if (window.ptTrack && product) {
    ptTrack("add_shipping_info", {
      value: pricedTotalPaise(sku, product, quantity, addOn) / 100,
      currency: "INR",
      ...(offer ? { coupon: offer.code } : {}),
      items: [{ item_id: sku, quantity }, ...(addOn ? [{ item_id: addOn.id, quantity: 1 }] : [])]
    });
  }

  _busy = true;

  // The sheet opens NOW, in a working state, rather than only after payment.
  // Creating the order takes a few seconds (address validation, an order
  // number, then Razorpay's own API) and until this the buyer stared at an
  // unchanged product grid with no sign their tap had registered.
  { const el = byId("gtWorking"); if (el) el.hidden = false; }
  { const el = byId("gtDone"); if (el) el.hidden = true; }
  const orderSteps = stepRun("gtSteps", [
    { label: "Checking your address", weight: 1 },
    { label: "Reserving your pack", weight: 1 },
    { label: payCod ? "Placing your order" : "Opening secure payment", weight: 2 }
  ]);
  orderSteps.begin();
  showSheet();

  // Each names real work inside create-order: validateAddress, then the order
  // number and the shopOrder write, then createRazorpayOrder. One request from
  // here, so the run walks the stages on a schedule and can only be FINISHED by
  // the response arriving.
  const orderPacing = [700, 1500].map((delay) => setTimeout(() => orderSteps.advance(), delay));
  const stopOrderPacing = () => orderPacing.forEach(clearTimeout);

  let order;
  try {
    // Invisible bot score for the server to check. Resolves to "" when
    // reCAPTCHA is unconfigured or the script cannot load, which the server
    // treats as "feature off" rather than "fail" — a checkout must not become
    // unreachable because Google is having a bad day.
    //
    // Razorpay's payment window loads from api.razorpay.com the moment this
    // order comes back, so that connection is opened now, in parallel.
    preconnect("https://api.razorpay.com");
    const recaptchaToken = await captcha.take();

    const res = await fetch("/api/shop/guest/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `ref` is a HINT, never a price. The server resolves it, refuses a
      // self-referral and decides the discount; an absent or junk code just
      // means no discount, never a failed checkout.
      body: JSON.stringify({
        productId: sku,
        address,
        recaptchaToken,
        ref: referralCode(),
        quantity,
        // No promo: the server applies the website offer itself, the same one
        // this page shows, so the page can never forget to ask for it.
        addOnId: addOn?.id,
        paymentMethod,
        // Ticked at checkout. The server records WHEN, never a bare boolean.
        marketingOptIn,
        marketingOptInSource,
        // Proof the delivery mobile passed its code; Cash on Delivery only.
        codToken
      })
    });
    order = await res.json();
    // The server's message names the field that is wrong rather than saying
    // "invalid", so it is worth surfacing verbatim.
    if (!res.ok || !order.ok) throw new Error(order && order.error);
    // The sheet quoted the friend's price. If the server did not apply it (a
    // buyer using their own link is the case that reaches here), stop before
    // the payment window opens at a price this page did not show. The code is
    // dropped, so the next attempt quotes and charges the same figure.
    if (!payCod && refOff > 0 && !(Number(order.referralDiscountPaise) > 0)) {
      dropReferral();
      const why = order.referralRefused === "self"
        ? "A friend's link cannot be used with your own number"
        : "That friend's link could not be applied";
      throw new Error(`${why}, so this order is ${rupees(order.amount)}. Tap the button again to continue at that price.`);
    }
    // Before the payment window opens, not after it closes. Everything from
    // here on depends on the buyer's browser still being alive; this is the
    // last line that does not.
    remember(order.orderNumber, address);
    _paidPaise = order.amount || 0;
    _paidCoupon = order.promoCode || null;
    _paidQty = quantity;
    _paidCod = order.paymentMethod === "cod";
  } catch (err) {
    stopOrderPacing();
    orderSteps.fail("");
    orderSteps.destroy();
    _busy = false; // the flow is over; let the buyer try again
    closeSheet();
    cartSave({ checkout: null });
    say((err && err.message) || "Could not start the payment. Please try again.");
    return;
  }

  // The server's amount, not the page's: this is what Razorpay is about to ask
  // for, or what the courier will collect.
  if (window.ptTrack) {
    ptTrack("add_payment_info", {
      value: order.amount / 100,
      currency: "INR",
      ...(order.promoCode ? { coupon: order.promoCode } : {}),
      ...(_paidCod ? { cod: true, method: "cod" } : {}),
      items: [{ item_id: sku, quantity }, ...(addOn ? [{ item_id: addOn.id, quantity: 1 }] : [])]
    });
  }

  // Cash on Delivery: the order is already placed and booked. No Razorpay,
  // straight to the confirmation with the breakdown.
  if (_paidCod) {
    stopOrderPacing();
    orderSteps.done();
    orderSteps.destroy();
    showDone(order);
    return;
  }

  if (!(await loadRazorpay())) {
    stopOrderPacing();
    orderSteps.fail("");
    orderSteps.destroy();
    _busy = false; // the flow is over; let the buyer try again
    closeSheet();
    cartSave({ checkout: null });
    say("The payment window could not load. Check your connection and try again.");
    return;
  }

  const rzp = new Razorpay({
    key: order.keyId,
    order_id: order.orderId,
    amount: order.amount,
    currency: order.currency,
    name: "ParkTag",
    description: order.description || order.orderNumber,
    image: "/images/parktag-checkout-logo.png",
    prefill: order.prefill || {},
    theme: { color: "#03162D" },
    // UPI first. On a phone it hands straight to the buyer's UPI app instead
    // of a method list; cards, net banking and wallets stay listed below it.
    config: {
      display: {
        blocks: { upi: { name: "Pay using UPI", instruments: [{ method: "upi" }] } },
        sequence: ["block.upi"],
        preferences: { show_default_blocks: true }
      }
    },
    // Dismissing is not a failure. The order stays "created" and is handed
    // back on the next attempt rather than minting a second one.
    modal: { ondismiss: () => { _busy = false; cartSave({ checkout: null }); } },
    handler: async (response) => {
      // Paid. Forget the cart now rather than after verify: a reload in between
      // must not reopen a checkout for an order that is already paid.
      cartClear();
      try {
        const res = await fetch("/api/shop/guest/verify-payment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          })
        });
        const done = await res.json();
        if (!res.ok || !done.ok) throw new Error(done && done.error);
        showDone(done);
      } catch {
        // The money is taken by this point, so this must not read as a failed
        // purchase. The webhook fulfils the order regardless of this tab.
        showDone({ orderNumber: order.orderNumber, pending: true });
      }
    }
  });

  // Razorpay's own sheet is about to cover everything, so the run is finished
  // and cleared first: leaving a half-filled bar underneath it would still be
  // there if the buyer dismissed the payment window.
  stopOrderPacing();
  orderSteps.done();
  orderSteps.destroy();
  { const el = byId("gtWorking"); if (el) el.hidden = true; }
  closeSheet();

  rzp.open();
}

// The paid breakdown, row for row as verify-payment read it off the stored
// order. Rendered, never summed: this page does no arithmetic on it.
function renderBreakdown(rows) {
  const host = byId("gtDoneBreakdown");
  if (!host) return;
  host.replaceChildren(...(Array.isArray(rows) ? rows : []).flatMap((row) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = row.label;
    dd.textContent = row.text;
    if (row.total) dt.className = dd.className = "gt-done-b-total";
    return [dt, dd];
  }));
  host.hidden = !host.childElementCount;
}

function showDone(done) {
  // Swap the working state back out. Without this the sheet would show the
  // spent progress bar above the confirmation.
  { const w = byId("gtWorking"); if (w) w.hidden = true; }
  { const d = byId("gtDone"); if (d) d.hidden = false; }
  _busy = false;
  cartClear(); // the order exists; nothing left to bring back
  // And the friend's link is spent. Cleared HERE, not when the order was
  // created: that is what it used to do, so a buyer who closed the payment
  // window and tried again was sent back without the code and charged the
  // full price. A second purchase this session still does not reuse it.
  clearReferralCode();
  byId("gtDoneSub").textContent = done.paymentMethod === "cod"
    ? `Order ${done.orderNumber} is placed. Pay ${rupees(done.amount)} in cash when it arrives. We have sent the details to your mobile.`
    : done.pending
      ? `Payment received. Order ${done.orderNumber} is being confirmed, you will get a WhatsApp update shortly.`
      : `Order ${done.orderNumber} is on its way. We have sent the details to your mobile.`;
  renderBreakdown(done.breakdown);
  showSheet();
  // After the sheet is up, so the paper lands over a card that is already
  // arriving. confetti.js declines outright under prefers-reduced-motion.
  burstConfetti(byId("gtCfti"), "gt-cfti");

  if (window.ptTrack) {
    // value and currency are not decoration. Without them Meta and GA4 record
    // the conversion at zero, so nothing downstream can bid on or report
    // revenue. Meta also gets this from the server (meta-capi.js), but the two
    // de-duplicate on a shared event_id and whichever lands first wins -- so a
    // valueless browser event can beat the server's and erase the amount.
    ptTrack("purchase", {
      transaction_id: done.orderNumber,
      value: _paidPaise / 100,
      currency: "INR",
      ...(_paidCoupon ? { coupon: _paidCoupon } : {}),
      // Tagged so COD never accepted at the door can be told apart, as the
      // signed-in shop does.
      ...(_paidCod ? { cod: true, method: "cod" } : {}),
      items: [
        { item_id: _sku, quantity: _paidQty },
        ...(_checkedOutAddOn ? [{ item_id: _checkedOutAddOn.id, quantity: 1 }] : [])
      ]
    });
  }
}

// ── Photos ────────────────────────────────────────────────────────────────
//
// Every photo on the page opens larger on a tap.
// Panels that are not links but look like they might be (the how-it-works
// cards, the price, the paper note) take the tap somewhere useful instead of
// ignoring it. A tap on a photo is left to the zoom, and a real link or button
// inside is left alone.
function wireGoto() {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  document.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, label, img")) return;
    const panel = event.target.closest("[data-goto]");
    const target = panel && document.querySelector(panel.dataset.goto);
    if (!target) return;
    window.ptTrack?.("tile_tap", { target: panel.dataset.goto });
    target.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
  });
}

function wireZoom() {
  const dialog = byId("gtZoom");
  const big = byId("gtZoomImg");
  if (!dialog || !big || typeof dialog.showModal !== "function") return;

  document.addEventListener("click", (event) => {
    // Every photo on the page opens larger on a tap. Clarity showed people
    // tapping them to see more and nothing happening.
    const shot = event.target.closest(
      "img.gt-heard-shot, img.gt-proof-media, .gt-show img, .gt-buy-pic img, .gt-diff-a img, .gt-diff-b img, .gt-how-media img, #gtAddonImage, .gt-pack img"
    );
    if (!shot) return;
    big.src = shot.currentSrc || shot.src;
    big.alt = shot.alt;
    dialog.showModal();
  });
  dialog.addEventListener("click", () => dialog.close());
  // Emptied on close, or the next photo opens showing this one until it loads.
  dialog.addEventListener("close", () => big.removeAttribute("src"));
}

function wireHeroFilm() {
  const video = byId("gtHeroFilm");
  if (!video) return;
  // Under reduced motion it never plays: it shows the closing frame (the tag on
  // the glass, "No number. Just scan.") instead of the opening one.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const toEnd = () => { video.currentTime = video.duration; };
    if (video.readyState >= 1) toEnd(); else video.addEventListener("loadedmetadata", toEnd, { once: true });
    return;
  }
  // Muted and inline, so play() needs no gesture. A refusal (data saver) leaves
  // the poster. No loop attribute: it ends on "No number. Just scan.", holds
  // that frame for a second, then starts again from the empty windscreen.
  // Some in-app browsers (Instagram and Facebook on Android) refuse even muted
  // autoplay until the visitor touches the page. Then the film shows a play
  // mark and starts on the first touch anywhere, or a tap on the film itself.
  const box = video.parentElement;
  const play = () => video.play().then(() => box.classList.remove("gt-film-wait"), () => box.classList.add("gt-film-wait"));
  const kick = () => { if (video.paused && !video.ended) play(); };
  document.addEventListener("touchstart", kick, { once: true, passive: true });
  document.addEventListener("pointerdown", kick, { once: true, passive: true });
  video.addEventListener("click", kick);
  video.addEventListener("playing", () => box.classList.remove("gt-film-wait"));
  video.addEventListener("ended", () => setTimeout(() => { video.currentTime = 0; play(); }, 1000));
  play();
}

function wireProofVideo() {
  const video = byId("gtProofVideo");
  if (!video) return;
  // Muted and inline, so play() is allowed without a gesture; a browser that
  // refuses anyway (data saver) leaves the poster, which is fine.
  const play = () => video.play().catch(() => {});

  if (!("IntersectionObserver" in window)) {
    play();
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) play(); else video.pause();
    }
  }, { rootMargin: "200px 0px" });
  io.observe(video);
}

// `products` is the catalogue already on screen, passed in only so the
// begin_checkout event can carry a value. A missing entry costs the value on
// one event and nothing else -- it must never stop the click reaching buy().
function wireCheckout(products) {
  byId("gtDoneX").addEventListener("click", hideSheet);
  byId("gtSheetBd").addEventListener("click", hideSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !byId("gtSheet").hidden) hideSheet();
  });

  // The stepper's own delegated listener, separate from the Order handler
  // below. It matches on `button[data-qty-dir]`, which an `a[data-sku]` click
  // can never satisfy and vice versa, so a tap on − or + can never also open
  // checkout.
  document.addEventListener("click", (event) => {
    const btn = event.target.closest && event.target.closest("button[data-qty-dir]");
    if (!btn) return;

    const sku = btn.dataset.sku;
    const priced = products && products[sku];
    if (!sku || !priced) return;

    const current = _qty.get(sku) || 1;
    // Floored at 1: there is no "remove from cart" step here. Capped at the
    // server's ceiling, which every order route refuses above, so the stepper
    // cannot offer a count the checkout will then turn down.
    const next = btn.dataset.qtyDir === "inc" ? Math.min(_maxQty, current + 1) : Math.max(1, current - 1);
    _qty.set(sku, next);
    cartSave({ qty: Object.fromEntries(_qty) });

    const card = btn.closest(".gt-pack");
    if (!card) return;
    const n = card.querySelector(".gt-pack-qty-n");
    if (n) n.textContent = String(next);
    const total = card.querySelector(".gt-pack-qty-total");
    if (total) applyQtyTotal(total, priced, next, sku);
  });

  // One listener for every Order control, including the pack buttons rendered
  // after this runs.
  //
  // Matched on data-sku, NOT on the href. It used to key on `a[href^='/shop']`,
  // which stopped working the moment those hrefs became in-page anchors so this
  // page would keep its own ad traffic — every Order button would have fallen
  // through to the anchor and jumped down the page instead of opening checkout.
  // data-sku is the thing that actually means "this control buys a pack", and
  // it is also what a sold-out control deliberately lacks.
  document.addEventListener("click", (event) => {
    if (!event.target.closest) return;
    // The Order controls only: the pack buttons and the bar. A tap elsewhere
    // on a card does nothing (see renderPacks), so begin_checkout means a
    // person pressed Order, which is what Meta's optimiser is told it means.
    const link = event.target.closest("a[data-sku]");
    if (!link) return;

    event.preventDefault();
    const sku = link.dataset.sku || HERO_PACK;

    if (window.ptTrack) {
      const priced = products && products[sku];
      const quantity = _qty.get(sku) || 1;
      const addOn = selectedAddOn(sku);
      ptTrack("begin_checkout", {
        method: "guest",
        items: [
          { item_id: sku, quantity },
          ...(addOn ? [{ item_id: addOn.id, quantity: 1 }] : [])
        ],
        ...(priced ? { value: pricedTotalPaise(sku, priced, quantity, addOn) / 100, currency: "INR" } : {})
      });
    }
    buy(sku);
  });
}

// A failure here must not leave shimmer running forever — a page that looks
// like it is still loading is worse than one that says it could not load.
// The CTAs are plain links to /shop and keep working regardless, so the offer
// is still reachable even when the price is not.
function failQuietly() {
  document.querySelectorAll(".gt-chip-price").forEach((chip) => chip.remove());

  const list = byId("gtPacks");
  if (list) list.replaceChildren();

  const note = byId("gtNote");
  if (note) {
    note.hidden = false;
    note.textContent = "Prices could not be loaded just now. Tap Order now and they will be shown at checkout.";
  }
}

// "Questions? Ask us on WhatsApp", under the Order button. Counted apart from
// the waitlist taps so a buyer with a question can be told from one waiting
// for stock.
function wireAsk() {
  byId("gtAsk")?.addEventListener("click", () => window.ptTrack?.("ask_whatsapp_click"));
}

async function load() {
  // Before the fetch: the buttons must point at the right pack even if the
  // price never arrives.
  syncHeroLinks();
  wireHeroFilm();
  wireProofVideo();
  wireZoom();
  wireGoto();
  wireAsk();

  let payload;
  try {
    // No custom headers: this has to match the <link rel="preload"> in
    // get.html exactly, or the browser ignores the preloaded response and asks
    // again. The endpoint only ever answers JSON.
    const res = await fetch("/api/shop/public-catalogue");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch {
    failQuietly();
    return;
  }

  if (!payload || !payload.ok || !payload.products) {
    failQuietly();
    return;
  }

  _products = payload.products;
  _offers = payload.offers || (payload.launchOffer ? { [payload.launchOffer.productId]: payload.launchOffer } : {});
  if (Number.isInteger(payload.maxQuantity) && payload.maxQuantity >= 1) _maxQty = payload.maxQuantity;
  _cod = typeof payload.codSurchargePaise === "number" && Array.isArray(payload.codProductIds)
    ? {
        surchargePaise: payload.codSurchargePaise,
        productIds: payload.codProductIds,
        maxQuantity: Number.isInteger(payload.codMaxQuantity) ? payload.codMaxQuantity : null
      }
    : null;
  renderChips(payload.products);
  // A friend's link: ask the server whether it is one it will honour, then say
  // so here and in the checkout sheet. Not awaited; the packs do not wait on it.
  const referralChecked = checkReferral();
  // What this tab had chosen before a reload. Counts only for packs still in
  // the catalogue, and only whole numbers of at least one.
  const saved = cartRead();
  const savedQty = saved.qty && typeof saved.qty === "object" ? saved.qty : {};
  for (const [sku, n] of Object.entries(savedQty)) {
    if (_products[sku] && Number.isInteger(n) && n >= 1) _qty.set(sku, Math.min(_maxQty, n));
  }
  renderPacks(payload.products);
  renderBar(payload.products);
  renderAddOn(payload.addOns);
  // Set directly, not through a change event: that would re-fire the
  // add_on_selected event for a tick the buyer made before the reload.
  if (_addOn && typeof saved.addOn === "boolean") {
    const box = byId("gtAddonCheck");
    if (box) box.checked = saved.addOn;
  }
  wireCheckout(payload.products);

  // Reloaded mid-checkout: reopen it on the same pack. buy() refills the
  // address from the draft. A pack that has since sold out is not reopened.
  const resume = PACKS.find((pack) => pack.id === saved.checkout);
  // After the friend's-link check, so the reopened sheet quotes the same price
  // the first one did. It never rejects and gives up after four seconds.
  if (resume && !resume.soldOut && _products[resume.id] && !_products[resume.id].soldOut) {
    referralChecked.then(() => buy(resume.id));
  }

  // After the page is usable, never in front of it. A returning buyer's order
  // matters, but not more than the shop rendering.
  showRecall();

  // Fired once the prices are actually on screen, not on DOMContentLoaded, so
  // "viewed the item" means a price was seen rather than that the page began
  // loading. This is the event the whole exercise is measured on: the ratio of
  // landing-site sessions to view_item is the size of the drop the login wall
  // was causing, and until this page existed there was nothing to count.
  if (window.ptTrack) {
    const hero = payload.products[HERO_PACK];
    ptTrack("view_item", {
      items: Object.entries(payload.products).map(([id, p]) => ({ item_id: id, item_name: p.name })),
      ...(hero ? { value: pricedTotalPaise(HERO_PACK, hero, 1) / 100, currency: "INR" } : {}),
      // The launch offer on screen, so offer views can be told from plain ones.
      ...(offerFor(HERO_PACK) ? { coupon: offerFor(HERO_PACK).code } : {})
    });
  }
}

load();

// The proof clip loops; for anyone who asked for less motion it waits for a tap.
if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
  for (const video of document.querySelectorAll(".gt-proof video")) {
    video.removeAttribute("autoplay");
    video.pause();
    video.controls = true;
  }
}
