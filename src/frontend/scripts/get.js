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
// So no amount anybody is CHARGED appears in this file. The one exception is
// `orig` below — the struck-through "was" price, which is a marketing claim
// rather than anything billed, and which is only rendered when it is genuinely
// above the price being charged.

// Display-only. `orig` is the struck-through "was" price, which is marketing
// copy rather than anything charged, so it belongs on this side.
const PACKS = [
  {
    id: "pt-car-1",
    desc: "One tag for the windscreen of one car.",
    image: "/images/shop-car.webp",
    orig: 499
  },
  {
    id: "pt-car-2",
    desc: "Best value — tag two cars, or the front and back of one.",
    image: "/images/shop-car-2.svg",
    orig: 799
  },
  {
    id: "pt-combo",
    desc: "Car and bike together, for the whole household.",
    image: "/images/shop-combo.svg",
    orig: 899
  },
  {
    id: "pt-bike-1",
    desc: "For a two-wheeler, front and back.",
    image: "/images/shop-bike.webp",
    orig: 499
  }
];

// The pack the hero and the sticky bar quote. Named rather than "the cheapest"
// or "the first": which pack leads is a merchandising decision, and deriving it
// from price would silently change the headline the day a price moves.
const HERO_PACK = "pt-car-2";

const byId = (id) => document.getElementById(id);

// Whole rupees. Every amount on the wire is paise, matching the order routes,
// so the conversion happens once, here.
function rupees(paise) {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

function renderChips(products) {
  const hero = products[HERO_PACK];
  const chip = document.querySelector(".gt-chip-price");
  if (!chip || !hero) return;

  // "Pack of 2 · ₹499" — the name already says which pack, so the chip does
  // not repeat the word ParkTag a third time on one screen.
  chip.textContent = `${hero.name.replace(/^ParkTag\s*/, "")} · ${rupees(hero.amountPaise)}`;
}

function renderCod(codPaise) {
  const el = byId("gtCod");
  if (!el) return;
  el.textContent = codPaise > 0 ? `${rupees(codPaise)}` : "nothing extra";
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
    li.className = "gt-pack";

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
    now.textContent = rupees(priced.amountPaise);
    price.append(now);

    // The struck-through price is shown only when it is genuinely higher than
    // what is being charged. A "was" that is not above the "now" is not a
    // saving, and printing one anyway is the kind of thing that turns a
    // discount into a misleading price claim.
    if (pack.orig && pack.orig * 100 > priced.amountPaise) {
      const was = document.createElement("span");
      was.className = "gt-pack-was";
      was.textContent = `₹${pack.orig.toLocaleString("en-IN")}`;
      price.append(was);
    }

    bd.append(name, desc, price);

    const cta = document.createElement("a");
    cta.className = "gt-btn gt-pack-cta";
    cta.href = `/shop?sku=${encodeURIComponent(pack.id)}`;
    cta.textContent = "Order";
    cta.dataset.sku = pack.id;
    cta.setAttribute("aria-label", `Order ${priced.name}`);

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
  if (sub) sub.textContent = `${rupees(hero.amountPaise)} · Free delivery · COD available`;
}

// The hero and bar buttons carry the lead pack in their href so they work with
// no JS at all. That makes the id appear in the markup as well as here, so it
// is written back from HERO_PACK on load — otherwise changing which pack leads
// would quietly leave two buttons pointing at the old one.
function syncHeroLinks() {
  for (const id of ["gtCta", "gtBarCta"]) {
    const el = byId(id);
    if (!el) continue;
    el.href = `/shop?sku=${encodeURIComponent(HERO_PACK)}`;
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
const RECALL_TTL = 60 * 864e5; // 60 days — past any delivery, and self-clearing
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
    return []; // private mode, storage disabled, corrupt value — never fatal
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

function showSheet() {
  byId("gtSheetBd").hidden = false;
  byId("gtSheet").hidden = false;
  document.body.style.overflow = "hidden";
}

function hideSheet() {
  if (_busy) return; // never close over a payment in flight
  byId("gtSheet").hidden = true;
  byId("gtSheetBd").hidden = true;
  document.body.style.overflow = "";
}

// Razorpay's own sheet reports its own failures, so this only has to speak up
// for the two steps either side of it.
function say(message) {
  const note = byId("gtNote");
  if (!note) return;
  note.hidden = false;
  note.textContent = message;
}

async function buy(sku) {
  if (_busy) return;
  _sku = sku;

  if (typeof window.ptCollectAddress !== "function") {
    say("The delivery step could not load. Please refresh and try again.");
    return;
  }

  // The shared sheet. Resolves with the address, or false if dismissed —
  // backing out here is an ordinary thing to do, not an error.
  const address = await window.ptCollectAddress({ guest: true });
  if (!address) return;

  _busy = true;

  let order;
  try {
    const res = await fetch("/api/shop/guest/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: sku, address })
    });
    order = await res.json();
    // The server's message names the field that is wrong rather than saying
    // "invalid", so it is worth surfacing verbatim.
    if (!res.ok || !order.ok) throw new Error(order && order.error);
    // Before the payment window opens, not after it closes. Everything from
    // here on depends on the buyer's browser still being alive; this is the
    // last line that does not.
    remember(order.orderNumber, address);
  } catch (err) {
    _busy = false;
    say((err && err.message) || "Could not start the payment. Please try again.");
    return;
  }

  if (typeof Razorpay !== "function") {
    _busy = false;
    say("The payment window could not load. Check your connection and try again.");
    return;
  }

  const rzp = new Razorpay({
    key: order.keyId,
    order_id: order.orderId,
    amount: order.amount,
    currency: order.currency,
    name: "ParkTag",
    description: order.orderNumber,
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

  rzp.open();
}

function showDone(done) {
  _busy = false;
  byId("gtDoneSub").textContent = done.pending
    ? `Payment received. Order ${done.orderNumber} is being confirmed — you will get a WhatsApp update shortly.`
    : `Order ${done.orderNumber} is on its way. We have sent the details to your mobile.`;
  showSheet();

  if (window.ptTrack) {
    ptTrack("purchase", { transaction_id: done.orderNumber, items: [{ item_id: _sku, quantity: 1 }] });
  }
}

function wireCheckout() {
  byId("gtDoneX").addEventListener("click", hideSheet);
  byId("gtSheetBd").addEventListener("click", hideSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !byId("gtSheet").hidden) hideSheet();
  });

  // One listener for every Order control, including the pack buttons rendered
  // after this runs. The hrefs stay real so the page still works with no JS.
  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href^='/shop']");
    if (!link) return;

    event.preventDefault();
    const sku = link.dataset.sku || HERO_PACK;

    if (window.ptTrack) {
      ptTrack("begin_checkout", { method: "guest", items: [{ item_id: sku, quantity: 1 }] });
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

  const cod = byId("gtCod");
  if (cod) cod.textContent = "a small handling fee";

  const note = byId("gtNote");
  if (note) {
    note.hidden = false;
    note.textContent = "Prices could not be loaded just now. Tap Order now and they will be shown at checkout.";
  }
}

async function load() {
  // Before the fetch: the buttons must point at the right pack even if the
  // price never arrives.
  syncHeroLinks();

  let payload;
  try {
    const res = await fetch("/api/shop/public-catalogue", { headers: { accept: "application/json" } });
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

  renderChips(payload.products);
  renderCod(payload.codSurchargePaise || 0);
  renderPacks(payload.products);
  renderBar(payload.products);
  wireCheckout();

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
      ...(hero ? { value: hero.amountPaise / 100, currency: "INR" } : {})
    });
  }
}

load();
