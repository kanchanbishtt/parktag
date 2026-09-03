// The shop half of the owner dashboard: the product sheet, the "Choose your pack"
// step, checkout, the order confirmation and its flash offer, the QR scanner,
// and the sheet gestures.
//
// This ran as an inline <script> at the bottom of welcome.html until the
// checkout audit. Keeping it there meant the page — the one that takes money —
// could only be served with 'unsafe-inline' in script-src, which is the single
// directive standing between an injected <script> and it executing. The code is
// unchanged; it is a plain (non-module) script loaded from the same position, so
// its declarations stay reachable from the onclick attributes in the markup and
// it still runs after everything above it is parsed.
//
// Those onclick attributes are why script-src-attr keeps 'unsafe-inline' on this
// page. Replacing fifty of them with listeners is a real refactor of a live
// checkout, and not one to bolt onto a CSP fix.

// ── Shop products ─────────────────────────────────────────────
const PRODUCTS = [
  {
    id: "pt-car-1",
    name: "ParkTag Car Tag (Pack of 1)",
    desc: "Allow people to contact you in case of urgency with parked vehicle.",
    features: ["Masked Calls", "WhatsApp", "Emergency Contact", "One time buy"],
    price: 299,
    orig: 499,
    discount: 40,
    variants: ["Car", "Auto"],
    // The two photo thumbnails are WebP rather than the SVGs they were exported
    // as: the Figma export embeds the full-resolution photograph as base64, so
    // the car card alone was 3.2MB. Rendered at 2x the display box (1800x1350)
    // they stay sharp on a retina phone at ~80KB. The vector thumbnails below
    // stay SVG, where they are already small and resolution-independent.
    image: "/images/shop-car.webp",
    imageDesktop: "/images/shop-car-desktop.webp",
  },
  {
    id: "pt-car-2",
    name: "ParkTag Car Tag (Pack of 2)",
    desc: "Best value: tag two cars and never miss an emergency call.",
    features: ["Masked Calls", "WhatsApp", "Emergency Contact", "One time buy"],
    price: 499,
    orig: 799,
    discount: 38,
    variants: ["Car", "Auto"],
    image: "/images/shop-car-2.svg",
    imageDesktop: "/images/shop-car-2-desktop.svg",
  },
  // Combo before Bike, so the two photographic thumbnails sit on opposite
  // corners of the two-column grid rather than stacked down one side. Order in
  // this array IS the order on screen; nothing addresses a product by position
  // (the detail sheet indexes back into this same array, and the price
  // catalogue is keyed by id), so it is safe to arrange for layout.
  {
    id: "pt-combo",
    name: "ParkTag Combo Pack",
    desc: "Car + Bike tags: the complete bundle for your entire fleet.",
    features: ["Masked Calls", "WhatsApp", "Emergency Contact", "One time buy"],
    price: 499,
    orig: 899,
    discount: 44,
    variants: ["Car", "Bike", "Scooter"],
    image: "/images/shop-combo.svg",
    imageDesktop: "/images/shop-combo-desktop.svg",
  },
  {
    id: "pt-bike-1",
    name: "ParkTag Bike Tag",
    desc: "For Bike & Helmet: weatherproof sticker with QR contact.",
    features: ["Masked Calls", "WhatsApp", "Emergency Contact", "One time buy"],
    price: 299,
    orig: 399,
    discount: 25,
    variants: ["Bike", "Scooter", "Helmet"],
    image: "/images/shop-bike.webp",
    imageDesktop: "/images/shop-bike-desktop.webp",
  },
];

// ── Skeleton helpers ──────────────────────────────────────────
function skeletonShopCards(count) {
  return Array.from({ length: count }, () => `
    <div class="pt-shop-card" style="pointer-events:none">
      <div class="pt-shop-img sk" style="border-radius:0;aspect-ratio:4/3"></div>
      <div class="pt-shop-body">
        <div class="sk" style="height:13px;border-radius:6px;margin-bottom:7px;width:88%"></div>
        <div class="sk" style="height:10px;border-radius:6px;margin-bottom:10px;width:65%"></div>
        <div class="sk" style="height:15px;border-radius:6px;width:42%"></div>
      </div>
    </div>`).join("");
}

// ── Tag placeholder SVG for shop cards ────────────────────────
function tagPlaceholder(size) {
  const s = size || 72;
  return `<svg width="${s}" height="${s}" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="72" height="72" rx="14" fill="#F3F4F6"/>
    <rect x="12" y="12" width="22" height="22" rx="4" fill="#03162D"/>
    <rect x="16" y="16" width="14" height="14" rx="2" fill="#FFFFFF"/>
    <rect x="18" y="18" width="4" height="4" fill="#03162D"/>
    <rect x="24" y="18" width="4" height="4" fill="#03162D"/>
    <rect x="18" y="24" width="4" height="4" fill="#03162D"/>
    <rect x="38" y="12" width="22" height="22" rx="4" fill="#03162D"/>
    <rect x="42" y="16" width="14" height="14" rx="2" fill="#FFFFFF"/>
    <rect x="44" y="18" width="4" height="4" fill="#03162D"/>
    <rect x="50" y="18" width="4" height="4" fill="#03162D"/>
    <rect x="44" y="24" width="10" height="4" fill="#03162D"/>
    <rect x="12" y="38" width="22" height="22" rx="4" fill="#03162D"/>
    <rect x="16" y="42" width="14" height="14" rx="2" fill="#FFFFFF"/>
    <rect x="18" y="44" width="10" height="4" fill="#03162D"/>
    <rect x="18" y="50" width="4" height="4" fill="#03162D"/>
    <rect x="24" y="50" width="4" height="4" fill="#03162D"/>
    <rect x="38" y="38" width="4" height="4" fill="#FF2700"/>
    <rect x="44" y="38" width="4" height="4" fill="#FF2700"/>
    <rect x="50" y="38" width="4" height="4" fill="#FF2700"/>
    <rect x="56" y="38" width="4" height="4" fill="#03162D"/>
    <rect x="38" y="44" width="4" height="4" fill="#FF2700"/>
    <rect x="44" y="44" width="16" height="4" fill="#03162D"/>
    <rect x="38" y="50" width="10" height="4" fill="#03162D"/>
    <rect x="50" y="50" width="4" height="4" fill="#FF2700"/>
    <rect x="56" y="50" width="4" height="4" fill="#03162D"/>
    <rect x="38" y="56" width="4" height="4" fill="#03162D"/>
    <rect x="44" y="56" width="4" height="4" fill="#FF2700"/>
    <rect x="50" y="56" width="10" height="4" fill="#03162D"/>
  </svg>`;
}

// A product's photo, or the drawn placeholder when it has none.
//
// The placeholder is kept rather than deleted: a product added without artwork
// should still render a card, not a hole. onerror falls back to it too, so a
// missing or corrupt file degrades to the old look instead of a broken image
// icon on the dashboard's main screen.
//
// Sized eagerly for the first card and lazily after — the grid is above the
// fold on a phone, so the first thumbnail should not wait on the scroller.
// The width at which the desktop artwork takes over. Written once here and
// reused in the <source media> below; the stylesheet switches the card frame to
// 16:9 at the same width, and the two must not drift — a 16:9 image in a 4:3
// frame gets its sides cropped off.
const PT_SHOP_DESKTOP_MQ = "(min-width: 1024px)";

function productImage(product, placeholderSize) {
  if (!product.image) return tagPlaceholder(placeholderSize);

  // Two crops of the same shot rather than one image scaled: the mobile artwork
  // is 4:3 (900x675) and the desktop artwork 16:9 (1440x810), each composed for
  // the shape the card actually has at that width.
  //
  // <source> comes before <img> because the browser takes the first match; the
  // <img> is both the mobile case and the fallback for anything that does not
  // understand <picture>. onerror stays on the <img>, which is where the
  // browser reports a failure of whichever source it chose.
  const desktop = product.imageDesktop
    ? `<source media="${PT_SHOP_DESKTOP_MQ}" srcset="${product.imageDesktop}" width="1440" height="810" />`
    : "";

  return `<picture class="pt-shop-pic">${desktop}<img class="pt-shop-photo"
    src="${product.image}" alt="${product.name}"
    loading="lazy" decoding="async" width="900" height="675"
    onerror="ptShopImgFallback(this, ${placeholderSize})" /></picture>`;
}

// Swaps a failed image for the drawn placeholder. A named handler rather than
// inline markup in the onerror attribute: the placeholder is a chunk of SVG
// full of double quotes, which cannot be embedded in a double-quoted attribute
// without escaping that the browser then has to undo.
function ptShopImgFallback(img, size) {
  const holder = document.createElement("span");
  holder.innerHTML = tagPlaceholder(size);
  // Replace the whole <picture>, not just the <img> inside it. A <picture>
  // renders through its <img> child, so swapping only the image would leave the
  // placeholder inside a wrapper that does not display it.
  const target = img.closest("picture") || img;
  target.replaceWith(...holder.childNodes);
}

// ── Render shop grid ──────────────────────────────────────────
function renderShop() {
  const grid = document.getElementById("shopGrid");
  grid.innerHTML = PRODUCTS.map((p, i) => `
    <div class="pt-shop-card" onclick="openProduct(${i})">
      <div class="pt-shop-img">
        <span class="pt-shop-badge">${p.discount}% OFF</span>
        ${productImage(p, 68)}
      </div>
      <div class="pt-shop-body">
        <p class="pt-shop-name">${p.name}</p>
        <p class="pt-shop-feat">${p.features.slice(0, 3).join(" · ")}</p>
        <div class="pt-shop-prow">
          <span class="pt-shop-price">₹${p.price}</span>
          <span class="pt-shop-orig">₹${p.orig}</span>
        </div>
      </div>
    </div>
  `).join("");
}

// ── Open product detail ───────────────────────────────────────
let _activeProduct = null;
let _activeVariant = 0;

function openProduct(idx) {
  _activeProduct = idx;
  _activeVariant = 0;
  renderSheet();

  if (window.ptTrack) {
    const _p = PRODUCTS && PRODUCTS[idx];
    ptTrack("view_item", { items: [{ item_id: (_p && _p.id) || String(idx), item_name: (_p && _p.name) || "" }] });
  }

  document.getElementById("ptBackdrop").classList.add("open");
  document.getElementById("ptSheet").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeProduct() {
  document.getElementById("ptBackdrop").classList.remove("open");
  document.getElementById("ptSheet").classList.remove("open");
  document.body.style.overflow = "";
}

function selectVariant(i) {
  _activeVariant = i;
  document.querySelectorAll(".pt-sheet-var").forEach((el, j) => {
    el.classList.toggle("active", j === i);
  });
}

function renderSheet() {
  const p = PRODUCTS[_activeProduct];
  const body = document.getElementById("ptSheetBody");
  body.innerHTML = `
    <div class="pt-sheet-img">
      ${productImage(p, 100)}
    </div>
    <p class="pt-sheet-name">${p.name}. ${p.desc}</p>
    <div class="pt-sheet-prow">
      <span class="pt-sheet-price">₹${p.price}</span>
      <span class="pt-sheet-orig">₹${p.orig}</span>
      <span class="pt-sheet-disc">${p.discount}% off</span>
    </div>
    <p class="pt-sheet-var-lbl">Select Variant</p>
    <div class="pt-sheet-vars">
      ${p.variants.map((v, i) => `
        <button class="pt-sheet-var${i === 0 ? " active" : ""}" onclick="selectVariant(${i})">${v}</button>
      `).join("")}
    </div>
    <p class="pt-sheet-offers-lbl">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="#FF2700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="7" r="1.5" fill="#FF2700"/>
      </svg>
      Available Offers
    </p>
    <ul class="pt-sheet-offers">
      ${p.features.map(f => `<li>${f}</li>`).join("")}
    </ul>
    <button class="pt-buy-btn" onclick="handleBuyNow()">BUY NOW</button>
    <p class="pt-buy-cs">Secured by Razorpay &nbsp;|&nbsp; UPI, Cards, Net Banking</p>
  `;
}

// Start buying a named SKU, from outside this file.
//
// The public storefront at /get shows prices to signed-out visitors and its
// Order buttons name a pack. That intent survives /shop, the login screen and
// however many OAuth hops sign-in takes, and lands here — so the buyer arrives
// at the pack they chose rather than at a shop tab with everything on it and
// their choice forgotten.
//
// Deliberately routed through handleBuyNow rather than reimplementing the
// steps: address first, then the pack sheet, then Razorpay. One buying flow,
// entered from two places. A second copy of it is how the shop and the
// storefront would come to disagree about what a purchase involves.
window.ptStartBuy = function ptStartBuy(sku) {
  // An unknown id opens the shop rather than failing. The value has travelled
  // through a query string and sessionStorage, so it is untrusted input, and
  // the worst it can do here is name a product that is not in the catalogue.
  const idx = PRODUCTS.findIndex((p) => p.id === sku);
  if (idx === -1) return false;

  openProduct(idx);
  handleBuyNow();
  return true;
};

async function handleBuyNow() {
  const p = PRODUCTS[_activeProduct];
  const variant = p.variants[_activeVariant];
  // Collect the delivery address FIRST (the physical tag ships home), then open
  // the "Choose your pack" step so the user configures their tags before paying.
  loadShopPricing(); // warm the price list while the address step is up
  if (typeof window.ptCollectAddress === "function") {
    const haveAddress = await window.ptCollectAddress();
    if (!haveAddress) return; // user backed out of the address step
  }
  openPackSheet(p.id, variant);
}

// Shared checkout: create the server order for `productId`, then open Razorpay.
// Used by the direct Buy Now (bike/combo) and by the pack step's Proceed to
// payment. Price is resolved server-side from the catalog (M15).
async function startPayment(productId, variant, label, btn) {
  // Delivery address is already collected before the pack step (handleBuyNow),
  // so this goes straight to creating the order and opening Razorpay.
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }

  // Remembered for the purchase event: showConfirmation() is shared by the
  // prepaid and COD paths and is handed only an order number and an amount, so
  // the SKU has to be carried across from wherever checkout actually started.
  window.__ptSku = productId;
  if (window.ptTrack) ptTrack("begin_checkout", { method: "prepaid", items: [{ item_id: productId, item_name: label, quantity: 1 }] });

  try {
    // 1. Create order on backend. Send only the productId + chosen variant —
    //    the server resolves the price from its catalog (M15), so the ₹price
    //    shown in the UI is display-only and can't be tampered with here.
    // replaceTagId (M18): set when the owner arrived from an expired free-trial
    // vehicle card. A paid order then mints a new premium tag for that vehicle
    // and soft-removes the old free tag. Null for a generic shop purchase.
    const replaceTagId = window._replaceTagId || null;
    const orderRes = await fetch("/api/shop/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId, variant, replaceTagId })
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok || !orderData.orderId) throw new Error(orderData.error || "Order creation failed.");

    // 2. Fetch key ID
    const keyRes = await fetch("/api/shop/razorpay-key");
    const { keyId } = await keyRes.json();

    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }

    // 3. Open Razorpay checkout
    const rzp = new Razorpay({
      key: keyId,
      amount: orderData.amount,
      currency: orderData.currency,
      order_id: orderData.orderId,
      // Show ONLY our logo in the checkout header. Razorpay always renders a
      // merchant name beside the image, and an empty string makes it fall back
      // to the account business name ("Edit Tree"). A zero-width space is
      // non-empty (so no fallback) yet renders nothing — leaving just the logo.
      name: "​",
      description: `${label} (${variant})`,
      // Square, navy-filled version of the logo. Razorpay frames the header
      // image in a fixed square container; a wide logo leaves white bars around
      // it. This tile fills the container edge-to-edge (navy = brand #03162D),
      // so no white box shows — just the ParkTag logo.
      image: "/images/parktag-checkout-logo.png",
      // Prefill the logged-in owner's contact so the sheet shows the CURRENT
      // user instead of Razorpay's stale cached number.
      //
      // This came off `window.__ptOwner` until the checkout audit: a global the
      // dashboard set at load with the owner's name, e-mail and mobile, and
      // left there for the whole session where every script on the page could
      // read it — Razorpay's own checkout.js included. It now rides back with
      // the order this is about to pay for, so it exists for the length of a
      // checkout instead of a session, and it is the server's copy.
      prefill: orderData.prefill || {},
      theme: { color: "#FF2700" },
      handler: async function (response) {
        // 4. Verify on backend
        const verifyRes = await fetch("/api/shop/verify-payment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          })
        });
        const verifyData = await verifyRes.json();
        closeProduct();
        closePackSheet();
        window._replaceTagId = null; // consume the replace-context either way
        if (verifyData.ok) {
          // Online = already paid → confirmation WITHOUT the flash offer.
          //
          // The figures come from verify-payment, i.e. off the order the server
          // has just marked paid. They used to come from the create-order reply
          // the browser was still holding — numbers assembled before the payment
          // and never reconciled with it afterwards. A receipt should say what
          // was recorded, not what was expected.
          showConfirmation({
            orderNumber: verifyData.orderNumber,
            amountPaise: verifyData.amountPaise,
            cod: false
          });
        } else {
          showToast("Payment verification failed. Contact support.", "error");
        }
      },
      modal: {
        ondismiss: function () {
          if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
        }
      }
    });
    rzp.open();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    showToast(err.message || "Something went wrong. Please try again.", "error");
  }
}

// ── Choose-your-pack step ─────────────────────────────────────
// The selected tier + add-on resolve to one catalog SKU, which is all that is
// sent to create-order or place-cod — the server prices it.
//
// The prices the sheet SHOWS now come from the server too, and that is the
// change worth reading about:
//
// PACK_PRICES below is a hand-kept copy of the catalog, and it used to be the
// only thing this sheet had. It totalled those numbers, printed "No extra
// charge for COD" underneath, and place-cod then wrote the order for ₹50 MORE
// and told Delhivery to collect exactly that at the door: the buyer agreed to
// one price and was asked for a higher one after the parcel had shipped, with
// the app's own line as the assurance it would not happen. The sheet had no
// idea the surcharge existed, because the only copy of it lived on the server.
//
// GET /api/shop/pricing serves the same constants the order routes charge
// from, so what is shown and what is collected cannot drift apart. The local
// table is now just the first paint while that request is in flight, and the
// Cash on Delivery button stays disabled until the real total is known —
// better to make someone wait a moment than to quote them a price we are not
// going to honour.
let _shopPricing = null;
let _shopPricingInFlight = null;

function loadShopPricing() {
  if (_shopPricing) return Promise.resolve(_shopPricing);
  if (!_shopPricingInFlight) {
    _shopPricingInFlight = fetch("/api/shop/pricing")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { _shopPricing = d && d.ok ? d : null; return _shopPricing; })
      .catch(() => null)
      .finally(() => { _shopPricingInFlight = null; });
  }
  return _shopPricingInFlight;
}

// Rupee price for one row of the sheet: the server's figure when we have it,
// the local table only until then.
function rowRupees(sku, fallbackRupees) {
  const paise = _shopPricing && _shopPricing.products[sku] && _shopPricing.products[sku].amountPaise;
  return typeof paise === "number" ? Math.round(paise / 100) : fallbackRupees;
}

const PACK_PRICES = { "pt-car-1": 299, "pt-car-2": 499, "pt-car-4": 899, bike: 299 };
const PACK_NAMES = {
  "pt-car-1": "ParkTag Car Tag (Pack of 1)",
  "pt-car-2": "ParkTag Car Tag (Pack of 2)",
  "pt-car-4": "ParkTag Car Tag (2 Cars · Pack of 4)",
  "pt-bike-1": "ParkTag Bike Tag"
};
// Solid car/bike artwork (inline SVG — scalable, theme-coloured, no extra request).
const PACK_CAR_ICON = `<svg width="27" height="27" viewBox="0 0 512 512" aria-hidden="true"><path fill="#03162D" d="M256 92c-71.6 0-110 6.4-125.9 20.6-13.8 12.3-24.6 42.4-37.9 96.4-6.3 3.7-12.4 9.2-18.6 17C58.7 244.8 46.5 271.6 46.5 300.4v112.2c0 15.9 12.9 28.8 28.8 28.8h41c15.9 0 28.8-12.9 28.8-28.8v-25.2c41.9 3.9 90.3 5.6 111.9 5.6s70-1.7 111.9-5.6v25.2c0 15.9 12.9 28.8 28.8 28.8h41c15.9 0 28.8-12.9 28.8-28.8V300.4c0-28.8-12.2-55.6-27.1-74.4-6.2-7.8-12.3-13.3-18.6-17-13.3-54-24.1-84.1-37.9-96.4C366 98.4 327.6 92 256 92z"/><path fill="#fff" d="M256 130c-53.7 0-84.4 4.3-94.7 14.2-8.4 8-16.6 31.4-25.2 65.6-2 8 2.6 13.9 12.4 13 31.1-2.9 68.2-4.1 107.5-4.1s76.4 1.2 107.5 4.1c9.8.9 14.4-5 12.4-13-8.6-34.2-16.8-57.6-25.2-65.6C340.4 134.3 309.7 130 256 130z"/><circle fill="#fff" cx="148" cy="332" r="35"/><circle fill="#fff" cx="364" cy="332" r="35"/><rect fill="#fff" x="196" y="315" width="120" height="46" rx="23"/></svg>`;
const PACK_BIKE_ICON = `<img src="/images/bike-tag.svg" alt="Bike" width="30" height="30" style="display:block;object-fit:contain" aria-hidden="true">`;
const PACK_TAG_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" stroke="#03162D" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.4" fill="#03162D"/></svg>`;
// Car pack tiers rendered in order. `badge` is optional.
const PACK_TIERS = [
  { id: "pt-car-1", name: "1 Tag",  desc: "Front of car",              ico: PACK_TAG_ICON },
  { id: "pt-car-2", name: "1 Car",  desc: "2 tags · front &amp; back", ico: PACK_CAR_ICON, badge: "POPULAR" },
  { id: "pt-car-4", name: "2 Cars", desc: "4 tags · both cars",        ico: PACK_CAR_ICON }
];
let _packTier = null;          // a PACK_TIERS id, or null for "no car tag"
let _packBike = false;         // bike tag selected?
let _packVariant = "Car";      // carried over from the tapped product

// Both car tags and the bike tag are optional here; the tapped card just sets a
// sensible starting selection. The user can change any of it before paying.
function openPackSheet(preselectId, variant) {
  if (preselectId === "pt-bike-1") { _packTier = null; _packBike = true; }
  else if (preselectId === "pt-combo") { _packTier = "pt-car-2"; _packBike = true; }
  else if (PACK_PRICES[preselectId]) { _packTier = preselectId; _packBike = false; }
  else { _packTier = "pt-car-2"; _packBike = false; }
  _packVariant = variant || "Car";
  renderPackSheet();
  // Repaint once the server's prices land, so the Cash on Delivery total is
  // the real one before anyone can tap it.
  loadShopPricing().then(() => {
    if (document.getElementById("ptPackSheet").classList.contains("open")) renderPackSheet();
  });
  closeProduct(); // leave the product sheet; show the pack step
  document.getElementById("ptPackBackdrop").classList.add("open");
  document.getElementById("ptPackSheet").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closePackSheet() {
  document.getElementById("ptPackBackdrop").classList.remove("open");
  document.getElementById("ptPackSheet").classList.remove("open");
  document.body.style.overflow = "";
}

// Car tier acts like a deselectable radio: tapping the selected one clears it.
function selectPackTier(id) { _packTier = _packTier === id ? null : id; renderPackSheet(); }
function togglePackBike() { _packBike = !_packBike; renderPackSheet(); }

// Map the current selection → the single catalog SKU the backend prices.
// car+bike → combined SKU, car only → car SKU, bike only → pt-bike-1, none → null.
function resolvePackSku() {
  if (_packTier && _packBike) return _packTier + "-bike";
  if (_packTier) return _packTier;
  if (_packBike) return "pt-bike-1";
  return null;
}

function packProceed() {
  const sku = resolvePackSku();
  if (!sku) return; // nothing selected — proceed button is disabled anyway
  let label;
  if (_packTier && _packBike) label = PACK_NAMES[_packTier] + " + Bike Tag";
  else if (_packTier) label = PACK_NAMES[_packTier];
  else label = PACK_NAMES["pt-bike-1"];
  startPayment(sku, _packVariant, label, document.querySelector(".pt-pack-proceed"));
}

function renderPackSheet() {
  const sku = resolvePackSku();
  const empty = !sku;
  // The server prices the whole SKU, so the combined packs are priced as one
  // item rather than by re-adding the parts here.
  const localTotal = (_packTier ? PACK_PRICES[_packTier] : 0) + (_packBike ? PACK_PRICES.bike : 0);
  const total = empty ? 0 : rowRupees(sku, localTotal);

  // What Cash on Delivery actually costs: catalog + the server's handling
  // surcharge, which is what the courier is told to collect. Null until the
  // price list has loaded — and while it is null the COD button stays
  // disabled, because the alternative is quoting a total we will not honour.
  const codSurcharge = _shopPricing ? Math.round(_shopPricing.codSurchargePaise / 100) : null;
  const codTotal = !empty && codSurcharge !== null ? total + codSurcharge : null;
  const tiers = PACK_TIERS.map((t) => `
    <button type="button" class="pt-pack-opt${_packTier === t.id ? " active" : ""}" onclick="selectPackTier('${t.id}')">
      <span class="pt-pack-radio"></span>
      <span class="pt-pack-ico">${t.ico}</span>
      <span class="pt-pack-txt"><span class="pt-pack-name">${t.name}${t.badge ? ` <span class="pt-pack-badge">${t.badge}</span>` : ""}</span><span class="pt-pack-desc">${t.desc}</span></span>
      <span class="pt-pack-price">₹${rowRupees(t.id, PACK_PRICES[t.id])}</span>
    </button>`).join("");
  document.getElementById("ptPackSheetBody").innerHTML = `
    <h3 class="pt-pack-title">Choose your pack</h3>
    <p class="pt-pack-sub">Pick the tags you need — car, bike, or both — then proceed to payment.</p>

    <p class="pt-pack-sec">Car tags 🚗 <em>(optional)</em></p>
    ${tiers}

    <p class="pt-pack-sec">Bike tag 🏍 <em>(optional)</em></p>
    <button type="button" class="pt-pack-addon${_packBike ? " active" : ""}" onclick="togglePackBike()">
      <span class="pt-pack-check"></span>
      <span class="pt-pack-ico">${PACK_BIKE_ICON}</span>
      <span class="pt-pack-txt"><span class="pt-pack-name">Bike tag</span><span class="pt-pack-desc">Front &amp; back · two-wheeler</span></span>
      <span class="pt-pack-price">₹${rowRupees("pt-bike-1", PACK_PRICES.bike)}</span>
    </button>

    <div class="pt-pack-total">
      <span class="pt-pack-total-lbl">Order total</span>
      <span class="pt-pack-total-amt">₹${total}</span>
    </div>
    <div class="pt-pack-actions">
      <button type="button" class="pt-pack-proceed" onclick="packProceed()"${empty ? " disabled" : ""}>Pay online now</button>
      <button type="button" class="pt-pack-cod" onclick="packPlaceCod()"${empty || codTotal === null ? " disabled" : ""}>${codTotal === null ? "Cash on Delivery" : `Cash on Delivery · ₹${codTotal}`}</button>
    </div>
    <p class="pt-pack-foot">${packFootNote(empty, total, codSurcharge, codTotal)}</p>
  `;
}

// The line under the buttons. It used to read "No extra charge for COD"
// unconditionally, which was simply not true — so it is now derived from the
// surcharge the server actually applies. If that is ever set back to zero the
// old sentence returns on its own, and it is right again, rather than being a
// claim nobody rechecks.
function packFootNote(empty, total, codSurcharge, codTotal) {
  if (empty) return "Select at least one tag to continue.";
  if (codTotal === null) return "Free delivery on all orders. Checking the Cash on Delivery price…";
  if (codSurcharge > 0) {
    return `Free delivery on all orders. Pay online and it is ₹${total}; Cash on Delivery adds a ₹${codSurcharge} handling fee, so the courier collects ₹${codTotal}.`;
  }
  return "Free delivery on all orders. No extra charge for COD.";
}

// ── Order confirmation + COD flash offer ──────────────────────
let _confState = null;   // { orderNumber, amountPaise }
let _flashTimer = null;
const FLASH_DISCOUNT_PAISE = 5000; // ₹50 (display only; backend enforces it)

function rupees(paise) { return "₹" + Math.round(paise / 100); }

// Place a Cash-on-Delivery order (no payment now), then show the confirmation
// with the flash offer.
// COD placement gates on delivery-phone verification. The first attempt sends no
// OTP; if the server needs one (the delivery phone isn't the owner's verified
// account mobile) it replies { needsOtp:true }, we run the OTP step, then retry
// place-cod with the code. The phone itself lives server-side (saved address).
let _codSku = null;

async function placeCodRequest(sku, otp) {
  const res = await fetch("/api/shop/place-cod", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productId: sku,
      // Recorded on the order now, same as the online path — the server
      // validates it against its own list and drops anything else.
      variant: _packVariant,
      replaceTagId: window._replaceTagId || null,
      otp: otp || undefined
    })
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function finishCod(data) {
  window._replaceTagId = null;
  closeCodOtp();
  closePackSheet();
  showConfirmation({
    orderNumber: data.orderNumber,
    amountPaise: data.amount,
    cod: true,
    flashSeconds: data.flashOfferSeconds
  });
}

async function packPlaceCod() {
  const sku = resolvePackSku();
  if (!sku) return;
  window.__ptSku = sku;
  if (window.ptTrack) ptTrack("begin_checkout", { method: "cod", items: [{ item_id: sku, quantity: 1 }] });
  const btn = document.querySelector(".pt-pack-cod");
  // Restore the button's own label afterwards — it now carries the COD total,
  // so a hard-coded "Cash on Delivery" here would quietly drop the price.
  const codLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Placing order…"; }
  try {
    const { res, data } = await placeCodRequest(sku, null);
    if (data && data.needsOtp) { openCodOtp(sku); return; }
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not place order.");
    finishCod(data);
  } catch (err) {
    showToast(err.message || "Could not place order. Please try again.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = codLabel; }
  }
}

// COD phone-verification overlay: opens, sends the OTP to the saved delivery
// phone (server picks the number), then verifies + places the order on submit.
function openCodOtp(sku) {
  _codSku = sku;
  document.getElementById("ptCodOtpInput").value = "";
  document.getElementById("ptCodOtpErr").textContent = "";
  document.getElementById("ptCodOtpOv").classList.add("open");
  document.body.style.overflow = "hidden";
  window.scrollTo(0, 0);
  sendCodOtp();
}

function closeCodOtp() {
  document.getElementById("ptCodOtpOv").classList.remove("open");
}

async function sendCodOtp() {
  const hint = document.getElementById("ptCodOtpHint");
  hint.textContent = "Sending a code to your delivery number…";
  try {
    const res = await fetch("/api/shop/cod-otp/send", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not send the code.");
    hint.textContent = "Enter the 6-digit code sent to " + (data.phoneHint || "your phone") + " on WhatsApp";
  } catch (err) {
    hint.textContent = err.message || "Could not send the code. Tap resend.";
  }
}

async function submitCodOtp() {
  const code = (document.getElementById("ptCodOtpInput").value || "").trim();
  const err = document.getElementById("ptCodOtpErr");
  if (!/^\d{6}$/.test(code)) { err.textContent = "Enter the 6-digit code."; return; }
  err.textContent = "";
  const b = document.getElementById("ptCodOtpSubmit");
  b.disabled = true; b.textContent = "Verifying…";
  try {
    const { res, data } = await placeCodRequest(_codSku, code);
    if (data && data.needsOtp) { err.textContent = "Please enter the code we sent."; return; }
    if (!res.ok || !data.ok) { err.textContent = data.error || "Invalid code. Try again."; return; }
    finishCod(data);
  } catch (e) {
    err.textContent = e.message || "Something went wrong. Try again.";
  } finally {
    b.disabled = false; b.textContent = "Verify & place order";
  }
}

// Show the confirmation screen. COD orders get the flash offer and its
// countdown — for however long the server says the offer is good for, which is
// the same deadline cod-prepay-order enforces. Already-paid online orders get
// neither.
function showConfirmation({ orderNumber, amountPaise, cod, flashSeconds }) {
  _confState = { orderNumber, amountPaise };

  // The one place a completed order is confirmed, whether it was paid online or
  // placed as COD — so it is the one place the purchase event belongs. Firing it
  // in the two callers instead would double-count the COD-to-prepaid upgrade,
  // which passes back through here a second time.
  //
  // COD is reported as a purchase because that is the moment the customer
  // commits, but it is tagged `cod` so the share that never get accepted at the
  // door can be separated out in GA4 and excluded from Meta's optimisation
  // later. Prepaid revenue is the honest number.
  if (window.ptTrack) {
    ptTrack("purchase", {
      transaction_id: orderNumber,
      value: (amountPaise || 0) / 100,
      currency: "INR",
      cod: !!cod,
      method: cod ? "cod" : "prepaid",
      items: [{ item_id: window.__ptSku || "unknown", quantity: 1, price: (amountPaise || 0) / 100 }]
    });
  }

  document.getElementById("ptConfOrdNo").textContent = "Order #" + orderNumber;
  document.getElementById("ptConfShip").textContent = "Ships in ~24 hours · #" + orderNumber;
  const flash = document.getElementById("ptFlash");
  if (cod) {
    // Same reason the pack sheet stopped trusting its own copy of the catalog:
    // this figure is quoted on a button the buyer is about to press, and the
    // charge behind it is computed server-side by cod-prepay-order. Prefer the
    // server's discount so the two cannot say different things.
    const discountPaise =
      _shopPricing && typeof _shopPricing.flashDiscountPaise === "number"
        ? _shopPricing.flashDiscountPaise
        : FLASH_DISCOUNT_PAISE;
    const online = Math.max(amountPaise - discountPaise, 100);
    document.getElementById("ptFlashCod").textContent = rupees(amountPaise);
    document.getElementById("ptFlashOnline").textContent = rupees(online);
    const fbtn = document.getElementById("ptFlashBtn");
    fbtn.textContent = "Pay " + rupees(online) + " online now";
    fbtn.disabled = false;
    flash.style.display = "";
    document.getElementById("ptCodRemindAmt").textContent = rupees(amountPaise) + " in cash";
    document.getElementById("ptCodRemind").style.display = "";
    // The server decides how long the offer lasts and says so in seconds;
    // this used to be a hard-coded 60 that nothing on the server agreed to.
    startFlashTimer(flashSeconds > 0 ? flashSeconds : 60);
  } else {
    flash.style.display = "none";
    document.getElementById("ptCodRemind").style.display = "none";
  }
  document.getElementById("ptConfOv").classList.add("open");
  document.body.style.overflow = "hidden";
  window.scrollTo(0, 0);
}

function startFlashTimer(seconds) {
  clearInterval(_flashTimer);
  let remaining = seconds;
  const el = document.getElementById("ptFlashTimer");
  const paint = () => {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    el.textContent = m + ":" + String(s).padStart(2, "0");
  };
  paint();
  _flashTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(_flashTimer);
      _flashTimer = null;
      // Window closed — hide the offer; the order stays COD at full price.
      document.getElementById("ptFlash").style.display = "none";
      return;
    }
    paint();
  }, 1000);
}

// Confirmation → the "How to activate" screen (next flow).
function goToHowto() {
  clearInterval(_flashTimer);
  _flashTimer = null;
  document.getElementById("ptConfOv").classList.remove("open");
  document.getElementById("ptHowtoOv").classList.add("open");
  document.body.style.overflow = "hidden";
  window.scrollTo(0, 0);
}

// Finish the whole post-purchase flow and return to the dashboard.
function closeHowto() {
  document.getElementById("ptHowtoOv").classList.remove("open");
  document.body.style.overflow = "";
  _confState = null;
  if (typeof window._reloadDashboard === "function") window._reloadDashboard();
}

// ── Camera QR scanner (tag activation) ────────────────────────
let _scanStream = null;
let _scanTimer = null;
let _barcodeDetector = null;

async function openScanner() {
  const ov = document.getElementById("ptScanOv");
  const video = document.getElementById("ptScanVideo");
  const status = document.getElementById("ptScanStatus");
  ov.classList.add("open");
  status.textContent = "Starting camera…";
  const supported = ("BarcodeDetector" in window) && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  if (!supported) {
    status.textContent = "Live scanning isn't supported on this browser. Open your phone's camera and point it at the tag's QR to activate.";
    return;
  }
  try {
    _barcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
    _scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
    video.srcObject = _scanStream;
    await video.play();
    status.textContent = "Point the camera at your tag's QR";
    _scanTimer = setInterval(async () => {
      if (!_barcodeDetector || !_scanStream) return;
      try {
        const codes = await _barcodeDetector.detect(video);
        if (codes && codes.length) {
          const url = resolveTagUrl(codes[0].rawValue || "");
          if (url) { stopScanStream(); window.location.href = url; }
          else { status.textContent = "That QR isn't a ParkTag — try another."; }
        }
      } catch (_) { /* frame not ready yet */ }
    }, 350);
  } catch (err) {
    status.textContent = "Couldn't access the camera. Allow camera access, or scan the tag's QR with your phone camera.";
  }
}

// Turn a scanned QR value into the tag's activation URL, or null if not ours.
function resolveTagUrl(raw) {
  const v = String(raw || "").trim();
  if (/\/(tag|vehicle)\/[A-Za-z0-9]{12,64}\b/.test(v)) {
    if (/^https?:\/\//i.test(v)) return v;    // full URL → open as-is
    return v.startsWith("/") ? v : "/" + v;   // path → make absolute
  }
  if (/^[A-Za-z0-9]{12,64}$/.test(v)) return "/tag/" + v; // bare token
  return null;
}

function stopScanStream() {
  if (_scanTimer) { clearInterval(_scanTimer); _scanTimer = null; }
  if (_scanStream) { _scanStream.getTracks().forEach((t) => t.stop()); _scanStream = null; }
  const video = document.getElementById("ptScanVideo");
  if (video) video.srcObject = null;
}

function closeScanner() {
  stopScanStream();
  document.getElementById("ptScanOv").classList.remove("open");
}

// Flash offer: convert this COD order to prepaid (−₹50) via Razorpay.
async function codPrepay() {
  if (!_confState) return;
  const btn = document.getElementById("ptFlashBtn");
  const orderNumber = _confState.orderNumber;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch("/api/shop/cod-prepay-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderNumber })
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.orderId) throw new Error(data.error || "Could not start payment.");

    // The offer window is enforced on the server, and it can have closed between
    // the countdown running out and this request landing. Stop here rather than
    // opening a payment sheet for the full amount under a button that promised a
    // discount — the order simply stays Cash on Delivery, which is what they
    // already agreed to.
    if (!data.discountPaise) {
      clearInterval(_flashTimer);
      _flashTimer = null;
      document.getElementById("ptFlash").style.display = "none";
      showToast("That offer has expired — your order stays Cash on Delivery.", "error");
      if (btn) btn.disabled = false;
      return;
    }

    const rzp = new Razorpay({
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      order_id: data.orderId,
      name: "​",
      description: "ParkTag order " + orderNumber + " (prepaid)",
      image: "/images/parktag-checkout-logo.png",
      prefill: data.prefill || {},
      theme: { color: "#FF2700" },
      handler: async function (response) {
        const vr = await fetch("/api/shop/cod-prepay-verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderNumber,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          })
        });
        const vd = await vr.json();
        if (vd.ok) {
          clearInterval(_flashTimer); _flashTimer = null;
          // What the server recorded as saved, not a hard-coded ₹50 that would
          // keep congratulating the buyer whatever the discount turned out to be.
          showToast("Paid online — you saved " + rupees(vd.savedPaise) + "! 🎉", "success");
          // Paid online now → skip the flash offer AND the confirmation window,
          // take the user straight to the "How to activate" guide.
          goToHowto();
        } else {
          showToast("Payment verification failed. Contact support.", "error");
          if (btn) btn.disabled = false;
        }
      },
      modal: { ondismiss: function () { if (btn) btn.disabled = false; } }
    });
    rzp.open();
  } catch (err) {
    showToast(err.message || "Could not start payment.", "error");
    if (btn) btn.disabled = false;
  }
}

function showToast(message, tone) {
  const existing = document.getElementById("pt-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "pt-toast";
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed", bottom: "90px", left: "50%", transform: "translateX(-50%)",
    background: tone === "success" ? "#FF2700" : "#EF4444",
    color: "#fff", padding: "12px 22px", borderRadius: "12px",
    fontWeight: "700", fontSize: "0.88rem", zIndex: "999",
    boxShadow: "0 4px 16px rgba(0,0,0,0.18)", maxWidth: "88vw", textAlign: "center"
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Tab switching ─────────────────────────────────────────────
// One table, three views. Written as a list rather than as a chain of booleans
// because the two-view version was already `isShop ? ... : ...` in four places,
// and a third would have meant getting the same ternary right four more times.
// A fourth view is one row here.
const TABS = [
  { key: "tags",    view: "view-tags",    nav: "navTags" },
  { key: "shop",    view: "view-shop",    nav: "navShop" },
  { key: "profile", view: "view-profile", nav: "navProfile" }
];

function switchTab(tab) {
  // Unknown input falls back to Tags rather than hiding every view and leaving
  // a blank page with three unlit pills.
  const target = TABS.some((t) => t.key === tab) ? tab : "tags";

  // Changing view closes the drawer with it. The drawer's own controls can
  // switch tab — "Buy Premium Tag" on a vehicle card calls goToShopForReplace —
  // and leaving it open over the view it just navigated to hides that view
  // behind a sheet the owner has to dismiss before they can see what their tap
  // did.
  const drawer = document.getElementById("menuDrawer");
  if (drawer && drawer.classList.contains("open") && typeof closeMenu === "function") {
    closeMenu();
  }

  for (const t of TABS) {
    const view = document.getElementById(t.view);
    const nav = document.getElementById(t.nav);
    const on = t.key === target;
    if (view) {
      // "block", not "". An empty inline value removes the declaration and lets
      // the cascade answer — and the cascade now says `#view-shop { display:
      // none }`, because the stylesheet owns the pre-script state. Setting ""
      // here would leave Shop and Profile permanently hidden.
      view.style.display = on ? "block" : "none";
      if (on) {
        // Removing and re-adding is not enough on its own — the browser
        // collapses both into one frame and the animation never restarts.
        // Reading offsetWidth in between forces the reflow that makes it.
        view.classList.remove("pt-view-in");
        void view.offsetWidth;
        view.classList.add("pt-view-in");
      }
    }
    if (nav) {
      nav.classList.toggle("active", on);
      // Kept in step with the pill. It used to be stamped on Tags in the markup
      // and never moved, so a screen reader announced Tags as the current page
      // from the Shop view.
      if (on) nav.setAttribute("aria-current", "page");
      else nav.removeAttribute("aria-current");
    }
  }

  if (target === "shop") {
    const grid = document.getElementById("shopGrid");
    grid.innerHTML = skeletonShopCards(4);
    requestAnimationFrame(() => setTimeout(renderShop, 280));
  }

  if (target === "profile" && typeof renderProfileView === "function") {
    renderProfileView();
  }

  // Remember where they are, so a refresh does not dump them back on Tags.
  //
  // The URL rather than storage: it survives a reload, it makes the view
  // linkable, and it is visible when something goes wrong. replaceState rather
  // than assigning location.hash, because assigning pushes a history entry —
  // tap through three tabs and Back would need three presses to leave the page
  // instead of one. It also does not fire hashchange, so the listener below
  // cannot loop.
  // Keep the attribute tab-boot.js wrote in step with where we actually are, so
  // the CSS above can never contradict the inline styles set just now — and so a
  // bfcache restore finds the two agreeing.
  try {
    if (target === "tags") document.documentElement.removeAttribute("data-tab");
    else document.documentElement.setAttribute("data-tab", target);
  } catch { /* nothing to do; the inline styles above already decided the view */ }

  try {
    const want = target === "tags" ? " " : "#" + target;
    // " " clears the fragment without leaving a bare "#" in the bar.
    if ((location.hash || "").slice(1) !== (target === "tags" ? "" : target)) {
      history.replaceState(null, "", location.pathname + location.search + want.trim());
    }
  } catch { /* history is unavailable in some embedded webviews; the tab still switches */ }

  // Landing at the bottom of wherever you just were is disorienting when the
  // views are different lengths, which these are.
  //
  // The two-argument form rather than a behavior option: `"instant" in window`
  // was testing for a window property of that name, which has never existed, so
  // it always fell through to "auto" — and "auto" honours scroll-behavior from
  // the stylesheet, which is exactly the smooth scroll a view change should not
  // have. This form is always instant.
  window.scrollTo(0, 0);
}

// Close sheet on backdrop click
document.getElementById("ptBackdrop").addEventListener("click", closeProduct);

// Swipe-down to close sheet
let _sheetTouchY = 0;
const sheet = document.getElementById("ptSheet");
sheet.addEventListener("touchstart", e => { _sheetTouchY = e.touches[0].clientY; }, { passive: true });
sheet.addEventListener("touchend", e => {
  if (e.changedTouches[0].clientY - _sheetTouchY > 60) closeProduct();
});

// ── Restore the view on load ─────────────────────────────────────
//
// This script is a classic <script> and runs while the parser is still on the
// page, BEFORE the deferred module that owns _owner and renderProfileView. That
// is fine: switchTab guards its call into that module with a typeof check, and
// load() re-renders the identity card once the dashboard payload lands.
//
// Only known tab keys are honoured. Any other fragment — a real anchor, junk
// somebody pasted — is left alone rather than being treated as a view.
function _restoreTabFromHash() {
  const key = (location.hash || "").slice(1);
  if (!TABS.some((t) => t.key === key)) return;
  switchTab(key);
}

_restoreTabFromHash();

// Someone editing the fragment by hand, or a back/forward that crosses a
// fragment set by something other than switchTab.
window.addEventListener("hashchange", _restoreTabFromHash);
