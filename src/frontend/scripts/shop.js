// The public shop at /shop.
//
// Everything on this page that is a NUMBER comes from the server. The copy,
// the images and the ordering live here; prices, and the COD surcharge, are
// fetched from /api/shop/public-catalogue, which serves the same SHOP_PRODUCTS
// the order routes charge from. A storefront that quotes a figure the checkout
// does not charge is the worst place for a price to drift, because it is the
// first thing a stranger reads. So no amount anybody is CHARGED appears here.
// The one exception is `orig` below, the struck-through "was" price, which is
// a marketing claim rather than anything billed, and is only rendered when it
// is genuinely above the price being charged.

// Display-only. The lead pack comes first: which one leads is a merchandising
// decision, so it is written down rather than derived from price.
const PACKS = [
  {
    id: "pt-car-2",
    desc: "Two tags: two cars, or the front and back of one.",
    image: "/images/shop-car-2.svg",
    orig: 799,
    badge: "Best seller"
  },
  {
    id: "pt-car-1",
    desc: "One tag for the windscreen of one car.",
    image: "/images/shop-car.webp",
    orig: 499
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
    orig: 799
  }
];

const byId = (id) => document.getElementById(id);

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8L12 2.5Z" fill="currentColor"/></svg>';

// PLACEHOLDER. The Amazon listing (B0HHG5KKJS) carried no rating on
// 4 September 2026 and there is no reviews system of our own, so this figure is
// not sourced from anywhere. Replace `value` with a real rating, and add
// `count`, before this ships. Set to null to hide the row on every card.
const RATING = { value: 4.8, count: null };

// Whole rupees. Every amount on the wire is paise, matching the order routes,
// so the conversion happens once, here.
function rupees(paise) {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

// The pack named in the URL, if it is a real one. Arrives from a public link,
// so it is only ever used to pick a card to highlight, never echoed anywhere.
function requestedSku(products) {
  const raw = new URLSearchParams(location.search).get("sku");
  return raw && Object.prototype.hasOwnProperty.call(products, raw) ? raw : null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Five stars, filled to the exact value by clipping a coloured copy over a grey
// one, so 4.8 reads as 4.8 and not as five.
function ratingRow(rating) {
  const value = Math.max(0, Math.min(5, Number(rating.value) || 0));
  const row = el("div", "sh-rating");
  row.setAttribute("aria-label", `Rated ${value.toFixed(1)} out of 5`);

  const stars = el("span", "sh-stars");
  stars.setAttribute("aria-hidden", "true");
  const grey = el("span", "sh-stars-bg");
  grey.innerHTML = STAR.repeat(5);
  const fill = el("span", "sh-stars-fg");
  fill.innerHTML = STAR.repeat(5);
  fill.style.width = `${(value / 5) * 100}%`;
  stars.append(grey, fill);

  row.append(stars, el("span", "sh-rating-v", value.toFixed(1)));
  if (rating.count) row.append(el("span", "sh-rating-c", `(${Number(rating.count).toLocaleString("en-IN")})`));
  return row;
}

function renderGrid(products) {
  const list = byId("shGrid");
  if (!list) return;

  const want = requestedSku(products);
  const cards = [];

  for (const pack of PACKS) {
    const priced = products[pack.id];
    // A pack the server no longer sells is dropped rather than shown at a
    // guessed price. Silence beats an offer that cannot be honoured.
    if (!priced) continue;

    const li = el("li", "sh-card");
    li.dataset.card = pack.id;
    if (want === pack.id) li.classList.add("sh-card-hi");

    if (pack.badge) {
      const badge = el("span", "sh-badge");
      badge.innerHTML = STAR; // static markup, never user input
      badge.append(pack.badge);
      li.append(badge);
    }

    const media = el("div", "sh-card-media");
    const img = el("img", "sh-card-img");
    img.src = pack.image;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 900;
    img.height = 675;
    media.append(img);

    const bd = el("div", "sh-card-bd");
    bd.append(el("h2", "sh-card-n", priced.name));
    if (RATING) bd.append(ratingRow(RATING));
    bd.append(el("p", "sh-card-d", pack.desc));

    const ft = el("div", "sh-card-ft");
    const price = el("div", "sh-price");
    price.append(el("span", "sh-price-now", rupees(priced.amountPaise)));
    // Shown only when genuinely higher than what is charged. A "was" that is
    // not above the "now" is not a saving, and printing one anyway is the kind
    // of thing that turns a discount into a misleading price claim.
    if (pack.orig && pack.orig * 100 > priced.amountPaise) {
      price.append(el("span", "sh-price-was", `₹${pack.orig.toLocaleString("en-IN")}`));
    }

    // A real href, so the card still points somewhere with no JS. The click
    // handler below intercepts it and runs the guest checkout instead.
    const cta = el("a", "sh-btn sh-btn-primary sh-card-cta", "Order →");
    cta.href = `/shop?sku=${encodeURIComponent(pack.id)}`;
    cta.dataset.sku = pack.id;
    cta.setAttribute("aria-label", `Order ${priced.name}`);

    ft.append(price, cta);
    li.append(media, bd, ft);
    cards.push(li);
  }

  list.replaceChildren(...cards);

  if (want) {
    const hi = list.querySelector(`[data-card="${want}"]`);
    if (hi) hi.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function renderCod(codPaise) {
  const node = byId("shCod");
  if (!node) return;
  node.textContent = codPaise > 0 ? `(+${rupees(codPaise)})` : "";
}

// ── Remembering an order the buyer may never see confirmed ─────────────────
//
// A guest has no account, so if the tab dies between the payment succeeding and
// the confirmation rendering, nothing anywhere ties that person to their order.
// It is still fulfilled, Razorpay's webhook does that without the browser, 
// and it still ships. They simply cannot find it. So the number is written to
// this device the moment the order exists, which is BEFORE Razorpay opens.
// Nothing sensitive is stored: an order number and the last four digits of the
// phone, which is exactly the pair /track-order asks for.
const RECALL_KEY = "pt_get_orders"; // same key the previous storefront wrote, so its orders still surface
const RECALL_TTL = 60 * 864e5;
const RECALL_MAX = 5;
const RECALL_CHECK = 3;

function recallRead() {
  try {
    const rows = JSON.parse(localStorage.getItem(RECALL_KEY) || "[]");
    if (!Array.isArray(rows)) return [];
    const live = rows
      .filter((r) => r && r.n && r.f && Date.now() - (r.t || 0) < RECALL_TTL)
      .slice(0, RECALL_MAX);
    if (live.length !== rows.length) recallWrite(live);
    return live;
  } catch {
    return [];
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

// Shown only for an order the SERVER agrees was paid, so an abandoned checkout
// never produces a bar announcing an order that does not exist. A miss is not a
// reason to forget the row: a webhook that has not landed yet also reads as 404.
async function showRecall() {
  const rows = recallRead();
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
      return;
    }
    if (!data || !data.ok || !data.order) continue;

    const bar = byId("shRecall");
    if (!bar) return;
    byId("shRecallS").textContent = data.order.productName ? `${row.n} · ${data.order.productName}` : row.n;
    // Only the order number travels in the URL. The last four is the proof that
    // opens the order, and a proof does not belong in browser history.
    bar.href = `/track-order?order=${encodeURIComponent(row.n)}`;
    bar.hidden = false;
    return;
  }
}

// ── Checkout ───────────────────────────────────────────────────────────────
//
// Pack, then delivery address, then Razorpay. No sign-in anywhere in it.
// window.ptCollectAddress is the sheet the dashboard already uses, called with
// { guest: true }. This sends a productId and that address and nothing else, 
// no price, no total, so a tampered request cannot buy a ₹499 pack for ₹1.

let _sku = null;
let _busy = false;

function showSheet() {
  byId("shSheetBd").hidden = false;
  byId("shSheet").hidden = false;
  document.body.style.overflow = "hidden";
}

function hideSheet() {
  if (_busy) return; // never close over a payment in flight
  byId("shSheet").hidden = true;
  byId("shSheetBd").hidden = true;
  document.body.style.overflow = "";
}

function say(message) {
  const note = byId("shNote");
  if (!note) return;
  note.hidden = false;
  note.textContent = message;
  // The sheet that just closed may have left the page scrolled past this.
  note.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function buy(sku) {
  if (_busy) return;
  _sku = sku;

  if (typeof window.ptCollectAddress !== "function") {
    say("The delivery step could not load. Please refresh and try again.");
    return;
  }

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
    if (!res.ok || !order.ok) throw new Error(order && order.error);
    // Before the payment window opens, not after it closes.
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
  byId("shDoneSub").textContent = done.pending
    ? `Payment received. Order ${done.orderNumber} is being confirmed. You will get a WhatsApp update shortly.`
    : `Order ${done.orderNumber} is on its way. We have sent the details to your mobile.`;
  showSheet();

  if (window.ptTrack) {
    ptTrack("purchase", { transaction_id: done.orderNumber, items: [{ item_id: _sku, quantity: 1 }] });
  }
}

function wireCheckout() {
  byId("shDoneX").addEventListener("click", hideSheet);
  byId("shSheetBd").addEventListener("click", hideSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !byId("shSheet").hidden) hideSheet();
  });

  // One listener for every Order control, including the cards rendered after
  // this runs. Matched on data-sku, not on the href: the header logo also links
  // to /shop and must stay a plain link.
  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[data-sku]");
    if (!link) return;

    event.preventDefault();
    const sku = link.dataset.sku;

    if (window.ptTrack) {
      ptTrack("begin_checkout", { method: "guest", items: [{ item_id: sku, quantity: 1 }] });
    }
    buy(sku);
  });
}

// A failure must not leave shimmer running forever, a page that looks like it
// is still loading is worse than one that says it could not load.
function failQuietly() {
  const list = byId("shGrid");
  if (list) list.replaceChildren();
  say("Prices could not be loaded just now. Please refresh, or sign in to order from your dashboard.");
}

async function load() {
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

  renderGrid(payload.products);
  renderCod(payload.codSurchargePaise || 0);
  wireCheckout();
  byId("shYear").textContent = String(new Date().getFullYear());

  // After the page is usable, never in front of it.
  showRecall();

  // Fired once prices are on screen, not on DOMContentLoaded, so "viewed the
  // item" means a price was seen. The ratio of landing-site sessions to this
  // event is the size of the drop the login wall was causing.
  if (window.ptTrack) {
    const lead = payload.products[PACKS[0].id];
    ptTrack("view_item", {
      items: Object.entries(payload.products).map(([id, p]) => ({ item_id: id, item_name: p.name })),
      ...(lead ? { value: lead.amountPaise / 100, currency: "INR" } : {})
    });
  }
}

load();
