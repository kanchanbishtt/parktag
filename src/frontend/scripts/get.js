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
const PACKS = [
  {
    id: "pt-car-1",
    desc: "One tag for the windscreen of one car.",
    image: "/images/shop-car.webp"
  },
  {
    id: "pt-car-2",
    desc: "Best value. Tag two cars, or the front and back of one.",
    image: "/images/shop-car-2.svg"
  },
  // Out of stock, not withdrawn. A pack we still price but cannot ship is
  // shown with its price and no way to buy it, rather than dropped: a visitor
  // who came looking for the bike tag learns it exists and is coming back,
  // instead of concluding we never sold one. Clear the flag when stock lands.
  {
    id: "pt-combo",
    desc: "Car and bike together, for the whole household.",
    image: "/images/shop-combo.svg",
    soldOut: true
  },
  {
    id: "pt-bike-1",
    desc: "For a two-wheeler, front and back.",
    image: "/images/shop-bike.webp",
    soldOut: true
  }
];

// The pack the hero and the sticky bar quote. Named rather than "the cheapest"
// or "the first": which pack leads is a merchandising decision, and deriving it
// from price would silently change the headline the day a price moves.
const SUPPORT_WHATSAPP = "918791638854";
const HERO_PACK = "pt-car-2";

let _products = {};
let _launchOffer = null;
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
  return _launchOffer && _launchOffer.productId === sku ? _launchOffer : null;
}

function codFor(sku, quantity = 1) {
  if (!_cod || !_cod.productIds.includes(sku)) return null;
  // Above the cap the sheet offers online only; the server refuses it anyway.
  return _cod.maxQuantity && quantity > _cod.maxQuantity ? null : _cod;
}

function pricedTotalPaise(sku, priced, qty, addOn = null) {
  const offer = offerFor(sku);
  return (priced.amountPaise * qty) - (offer?.discountPaise || 0) + (addOn?.amountPaise || 0);
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

function renderChips(products) {
  const hero = products[HERO_PACK];
  const chip = document.querySelector(".gt-chip-price");
  if (!chip || !hero) return;

  // "Pack of 2 · ₹499" — the name already says which pack, so the chip does
  // not repeat the word ParkTag a third time on one screen.
  const offer = offerFor(HERO_PACK);
  chip.textContent = offer
    ? `${hero.name.replace(/^ParkTag\s*/, "")} · ${rupees(offer.offerPaise)} launch offer · MRP ${rupees(offer.mrpPaise)}`
    : `${hero.name.replace(/^ParkTag\s*/, "")} · ${rupees(hero.amountPaise)}`;
}

function renderPacks(products) {
  const list = byId("gtPacks");
  if (!list) return;

  const rows = [];
  for (const pack of PACKS) {
    const priced = products[pack.id];
    // A pack the server no longer sells is dropped rather than shown at a
    // guessed price. Silence beats an offer that cannot be honoured.
    if (!priced) continue;

    const li = document.createElement("li");
    li.className = pack.soldOut ? "gt-pack gt-pack-out" : "gt-pack";

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
    if (!pack.soldOut) {
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
    if (pack.soldOut) {
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
      // The whole card buys, not only its button: Clarity recorded dead taps
      // on the price and the photo. See the Order listener below.
      li.dataset.sku = pack.id;
    }

    li.append(img, bd, cta);
    rows.push(li);
  }

  list.replaceChildren(...rows);
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
  const codNote = codFor(HERO_PACK) ? " · COD available" : "";
  if (sub) sub.textContent = offer
    ? `${rupees(offer.offerPaise)} launch offer · MRP ${rupees(offer.mrpPaise)} · Free delivery${codNote}`
    : `${rupees(hero.amountPaise)} · Free delivery${codNote}`;
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
    if (event.target.checked && window.ptTrack) {
      ptTrack("add_on_selected", { item_id: addOn.id, value: addOn.amountPaise / 100, currency: "INR" });
    }
  });
  // The product image sits outside the <label>, for the CSS grid layout, so it
  // doesn't toggle the checkbox natively. Buyers tap the photo expecting it to.
  byId("gtAddonImage")?.addEventListener("click", () => {
    const check = byId("gtAddonCheck");
    if (!check) return;
    check.checked = !check.checked;
    check.dispatchEvent(new Event("change"));
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
  for (const id of ["gtCta", "gtBarCta"]) {
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

// Razorpay's own sheet reports its own failures, so this only has to speak up
// for the two steps either side of it.
function say(message) {
  const note = byId("gtNote");
  if (!note) return;
  note.hidden = false;
  note.textContent = message;
}

// Loaded on demand rather than eagerly in the page's <script> tags: most ad
// traffic bounces before ever reaching checkout, and Instagram's in-app
// browser can tear the WebView down mid-init, which was surfacing as a
// spurious "Error invoking postMessage: Java object is gone" console error
// for visitors who never bought anything.
let _rzpLoad = null;
function loadRazorpay() {
  if (typeof Razorpay === "function") return Promise.resolve(true);
  if (_rzpLoad) return _rzpLoad;
  _rzpLoad = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(typeof Razorpay === "function");
    script.onerror = () => { _rzpLoad = null; resolve(false); };
    document.head.appendChild(script);
  });
  return _rzpLoad;
}

async function buy(sku) {
  if (_busy) return;
  _sku = sku;
  // Fired here, not awaited: clicking "buy" is a real intent signal (unlike a
  // page view), so it is worth prefetching in parallel with the address step
  // below rather than paying for the round trip at the moment of payment.
  loadRazorpay();
  // Read once, up front, so the value submitted below can never drift from
  // whatever the stepper happens to show by the time the request lands.
  const quantity = _qty.get(sku) || 1;
  const product = _products[sku];
  const addOn = selectedAddOn(sku);
  _checkedOutAddOn = addOn;

  if (typeof window.ptCollectAddress !== "function") {
    say("The delivery step could not load. Please refresh and try again.");
    return;
  }

  // The shared sheet. Resolves with the address, or false if dismissed —
  // backing out here is an ordinary thing to do, not an error. It is also
  // where the buyer picks online or Cash on Delivery, for a pack that takes it.
  const offer = offerFor(sku);
  const cod = codFor(sku, quantity);
  const picked = await window.ptCollectAddress({
    guest: true,
    // The COD phone check in the sheet sends a code, so it is bot-scored too.
    captchaToken: () => getCaptchaToken("guest_checkout"),
    orderSummary: product
      ? {
          name: `${quantity > 1 ? `${quantity} × ` : ""}${product.name}${addOn ? ` + ${addOn.name}` : ""}`,
          amountPaise: pricedTotalPaise(sku, product, quantity, addOn),
          mrpPaise: offer ? (product.amountPaise * quantity) + (addOn?.amountPaise || 0) : null,
          offerLabel: offer ? `${offer.code} auto-applied` : null,
          cod: cod
            ? { amountPaise: pricedTotalPaise(sku, product, quantity, addOn) + cod.surchargePaise, feePaise: cod.surchargePaise }
            : null
        }
      : null
  });
  if (!picked) return;
  const { paymentMethod = "online", codToken, marketingOptIn = false, marketingOptInSource, ...address } = picked;
  const payCod = paymentMethod === "cod";

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
    const recaptchaToken = await getCaptchaToken("guest_checkout");

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
        promo: offer?.code,
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
    // Before the payment window opens, not after it closes. Everything from
    // here on depends on the buyer's browser still being alive; this is the
    // last line that does not.
    remember(order.orderNumber, address);
    _paidPaise = order.amount || 0;
    _paidCoupon = order.promoCode || null;
    _paidQty = quantity;
    _paidCod = order.paymentMethod === "cod";
    // Spent. A second purchase this session should not silently reuse it.
    clearReferralCode();
  } catch (err) {
    stopOrderPacing();
    orderSteps.fail("");
    orderSteps.destroy();
    _busy = false; // the flow is over; let the buyer try again
    closeSheet();
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
    // Dismissing is not a failure. The order stays "created" and is handed
    // back on the next attempt rather than minting a second one.
    modal: { ondismiss: () => { _busy = false; } },
    handler: async (response) => {
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

// ── Gallery dots ───────────────────────────────────────────────────────────
//
// The scrolling is the browser's. This is only the two things it does not give
// us: a dot that jumps to a slide, and a dot that knows which slide is showing.
// Everything degrades to a plain scrollable strip if this never runs, which is
// why the slides live in the HTML and are not built from a list in here.
function wireGallery() {
  const track = byId("gtGal");
  const dots = byId("gtGalDots");
  if (!track || !dots) return;

  const slides = Array.from(track.children);
  const buttons = Array.from(dots.children);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const behavior = reduceMotion.matches ? "auto" : "smooth";

  dots.addEventListener("click", (event) => {
    const dot = event.target.closest("button[data-slide]");
    if (!dot) return;
    const slide = slides[Number(dot.dataset.slide)];
    // block: "nearest" so jumping between images never drags the PAGE
    // vertically, which is what scrollIntoView does by default.
    if (slide) slide.scrollIntoView({ behavior, inline: "center", block: "nearest" });
  });

  // Every slide is exactly one track wide, so the index is the ratio. Read on
  // scroll rather than only on click, so a swipe moves the dots too.
  const sync = () => {
    const index = Math.round(track.scrollLeft / track.clientWidth);
    buttons.forEach((button, i) => {
      button.setAttribute("aria-current", i === index ? "true" : "false");
    });
  };

  track.addEventListener("scroll", sync, { passive: true });
  sync();

  // ── Autoplay ──────────────────────────────────────────────────────────────
  //
  // The track is a scroll-snap strip, so advancing it is just a scroll; the
  // dots keep themselves in step through the sync() listener above and need no
  // separate bookkeeping.
  //
  // The index is held here rather than read back from scrollLeft on each tick.
  // Reading the live position only works while no scroll is in flight, which
  // ties the interval to however long a smooth scroll happens to take — at a
  // short interval the read rounds to whichever slide sits under the midpoint
  // and the show stutters between two frames instead of moving on. Counting
  // instead of measuring keeps the cadence independent of the animation.
  const SLIDE_MS = 2500;

  let index = 0;
  let timer = null;
  let onScreen = true;
  let surrendered = false; // the visitor took the wheel; we do not take it back

  const advance = () => {
    // Wrapping from the last slide to the first is a jump across the whole
    // strip. Smoothed, that reads as a fast rewind through every image; taken
    // instantly it reads as the loop starting again, which is what it is.
    const wrapping = index === slides.length - 1;
    index = (index + 1) % slides.length;
    track.scrollTo({
      left: index * track.clientWidth,
      behavior: wrapping ? "auto" : behavior
    });
  };

  const pause = () => { if (timer) { clearInterval(timer); timer = null; } };

  const play = () => {
    if (timer || surrendered || !onScreen) return;
    // A single slide has nowhere to go, and a visitor who has asked for less
    // motion should not be handed a carousel that advances on its own at all.
    if (slides.length < 2 || reduceMotion.matches) return;
    timer = setInterval(advance, SLIDE_MS);
  };

  // Any deliberate input — a swipe, a dot, an arrow key — ends the autoplay for
  // good. Pausing while a finger is down and resuming after would fight someone
  // trying to look at one image, which is the whole reason they touched it.
  const surrender = () => { surrendered = true; pause(); };
  for (const type of ["pointerdown", "keydown", "wheel"]) {
    track.addEventListener(type, surrender, { passive: true });
  }
  dots.addEventListener("pointerdown", surrender, { passive: true });

  // Cursor over the images is not a surrender, only a reason to hold still
  // while someone reads the caption.
  track.addEventListener("mouseenter", pause);
  track.addEventListener("mouseleave", play);

  // Nothing should animate in a background tab: it burns battery to redraw a
  // strip nobody is looking at, and the catch-up on return is ugly.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause(); else play();
  });

  // Same argument once the hero has been scrolled past.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        onScreen = entry.isIntersecting;
        if (onScreen) play(); else pause();
      }
    }, { threshold: 0.5 });
    io.observe(track);
  } else {
    play();
  }

  // A visitor can turn the setting on without reloading.
  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) pause(); else play();
  });
}

// The sticking demo in "Real tags, real cars". It used to carry `autoplay`,
// which makes a browser download the whole 1.8 MB file at page load, competing
// with the prices and the hero image for the first seconds of a phone's
// connection. Now it loads and plays as it nears the screen and pauses once
// scrolled away. Without IntersectionObserver it simply plays, as before.
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
    // Floored at 1, never a max: there is no "remove from cart" step here, and
    // an upper bound was a deliberate product decision NOT to add.
    const next = btn.dataset.qtyDir === "inc" ? current + 1 : Math.max(1, current - 1);
    _qty.set(sku, next);

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
    // A tap anywhere on an in-stock card opens checkout like its Order button,
    // except on the card's own controls (the − / + stepper), which do their own
    // thing. Only the button counts as begin_checkout: Clarity showed most card
    // taps are people looking, and counting them inflated checkouts past real
    // intent. A card tap is select_item, GA4-only, so Meta never bids on it.
    const button = event.target.closest("a[data-sku]");
    const link = button ||
      (!event.target.closest("button, a, input, label") && event.target.closest(".gt-pack[data-sku]"));
    if (!link) return;

    event.preventDefault();
    const sku = link.dataset.sku || HERO_PACK;
    const fromButton = Boolean(button);

    if (window.ptTrack) {
      const priced = products && products[sku];
      const quantity = _qty.get(sku) || 1;
      const addOn = selectedAddOn(sku);
      ptTrack(fromButton ? "begin_checkout" : "select_item", {
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
  const chip = document.querySelector(".gt-chip-price");
  if (chip) chip.remove();

  const list = byId("gtPacks");
  if (list) list.replaceChildren();

  const note = byId("gtNote");
  if (note) {
    note.hidden = false;
    note.textContent = "Prices could not be loaded just now. Tap Order now and they will be shown at checkout.";
  }
}

async function load() {
  // Before the fetch: the buttons must point at the right pack even if the
  // price never arrives, and the gallery is static markup that must not stop
  // working because the price list is down.
  syncHeroLinks();
  wireGallery();
  wireProofVideo();

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
  _launchOffer = payload.launchOffer || null;
  _cod = typeof payload.codSurchargePaise === "number" && Array.isArray(payload.codProductIds)
    ? {
        surchargePaise: payload.codSurchargePaise,
        productIds: payload.codProductIds,
        maxQuantity: Number.isInteger(payload.codMaxQuantity) ? payload.codMaxQuantity : null
      }
    : null;
  renderChips(payload.products);
  // A friend's link: the discount is applied by the server at payment, so say
  // so here, or the page quotes a price the buyer will not actually pay.
  const refNote = byId("gtRef");
  if (refNote && referralCode() && Number(payload.referralDiscountPaise) > 0) {
    refNote.textContent = `🎁 Friend's link applied: an extra ${rupees(payload.referralDiscountPaise)} off when you pay online, taken off at payment.`;
    refNote.hidden = false;
  }
  renderPacks(payload.products);
  renderBar(payload.products);
  renderAddOn(payload.addOns);
  wireCheckout(payload.products);

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
