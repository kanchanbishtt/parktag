// The public shop at /shop.
//
// Everything on this page that is a NUMBER comes from the server. The copy,
// the images and the ordering live here; prices, and the COD surcharge, are
// fetched from /api/shop/public-catalogue, which serves the same SHOP_PRODUCTS
// the order routes charge from. A storefront that quotes a figure the checkout
// does not charge is the worst place for a price to drift, because it is the
// first thing a stranger reads. So no amount anybody is CHARGED appears here;
// even the crossed-out MRP comes from the live public catalogue.

// Display-only. The lead pack comes first: which one leads is a merchandising
// decision, so it is written down rather than derived from price.
import { referralCode, clearReferralCode } from "./referral-link.js";
import { getCaptchaToken } from "./recaptcha.js";
import { keepFreshToken } from "./fresh-captcha.js";
import { checkoutCart } from "./checkout-cart.js";

const PACKS = [
  {
    id: "pt-car-2",
    desc: "Two tags: two cars, or the front and back of one.",
    image: "/images/shop-car-2-v2-900.webp",
    badge: "Best seller"
  },
  {
    id: "pt-car-1",
    desc: "One tag for the windscreen of one car.",
    image: "/images/shop-car-900.webp"
  },
  // Out of stock, not withdrawn. A pack we still price but cannot ship is shown
  // with its price and no way to buy it, rather than dropped: somebody who came
  // for the bike tag learns it exists and is coming back, instead of concluding
  // we never sold one. Clear the flag when stock lands. Kept in step with the
  // same two packs on /get.
  {
    id: "pt-combo",
    desc: "Car and bike together, for the whole household.",
    image: "/images/shop-combo-900.webp",
    soldOut: true
  },
  {
    id: "pt-bike-1",
    desc: "For a two-wheeler, front and back.",
    image: "/images/shop-bike-v2-900.webp",
    soldOut: true
  }
];

const byId = (id) => document.getElementById(id);

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8L12 2.5Z" fill="currentColor"/></svg>';

// No rating is shown until it can be backed by a real source and review count.
// An unsourced score damages trust more than an honest absence of social proof.
const RATING = null;

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
    if (pack.soldOut) li.classList.add("sh-card-out");

    const offer = offerFor(pack.id);

    if (pack.soldOut) {
      li.append(el("span", "sh-badge sh-badge-out", "Sold out"));
    } else if (offer) {
      li.append(el("span", "sh-badge", `Offer · ${rupees(offer.discountPaise)} off`));
    } else if (pack.badge) {
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
    price.append(el("span", "sh-price-now", rupees(offer ? offer.offerPaise : priced.amountPaise)));
    // Shown only when genuinely higher than what is charged. A "was" that is
    // not above the "now" is not a saving, and printing one anyway is the kind
    // of thing that turns a discount into a misleading price claim.
    if (offer && offer.mrpPaise > offer.offerPaise) {
      price.append(el("span", "sh-price-was", `MRP ${rupees(offer.mrpPaise)}`));
    }

    // A real href, so the card still points somewhere with no JS. The click
    // handler below intercepts it and runs the guest checkout instead.
    // A sold-out pack gets a plain element with NO data-sku and no href, so it
    // is inert in both paths at once: the delegated click handler matches on
    // data-sku and never sees it, and with scripting off there is no link into
    // a checkout that cannot be fulfilled.
    const cta = pack.soldOut
      ? el("span", "sh-card-cta sh-card-cta-out", "Sold out")
      : el("a", "sh-btn sh-btn-primary sh-card-cta", "Order →");
    if (!pack.soldOut) {
      cta.href = `/shop?sku=${encodeURIComponent(pack.id)}`;
      cta.dataset.sku = pack.id;
      cta.setAttribute("aria-label", `Order ${priced.name}`);
    }

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

// ── Surviving a refresh ────────────────────────────────────────────────────
//
// A reload used to close the delivery step and untick the add-on. The add-on
// tick and the pack whose checkout is open are kept here and put back on load;
// the address is kept by the address sheet itself. Cleared once an order is
// paid or placed, so a finished purchase is never reopened by the next refresh.
const cart = checkoutCart("pt_shop_cart");

// The amount the SERVER priced this order at, kept so the purchase event can
// report revenue. Measurement only -- nothing is ever charged from it.
let _paidPaise = 0;
// The promo code the server actually applied, reported as GA4 `coupon`.
let _paidCoupon = null;
// The website offer on each pack, off the catalogue. The server applies the
// same offers to the order on its own; these are for showing the price.
let _offers = {};
function offerFor(sku) {
  return _offers[sku] || null;
}
let _addOn = null;
let _checkedOutAddOn = null;
// { surchargePaise, productIds } off the catalogue: which packs take Cash on
// Delivery and what it adds. Null means online only.
let _cod = null;
// Whether the last order was placed as Cash on Delivery. Measurement and copy.
let _paidCod = false;

function renderAddOns(addOns) {
  const host = byId("shAddon");
  const addOn = Array.isArray(addOns) ? addOns.find((item) => item.id === "dashboard-plate") : null;
  _addOn = addOn || null;
  if (!host || !addOn) {
    if (host) host.hidden = true;
    return;
  }
  byId("shAddonImage").src = addOn.image;
  byId("shAddonDescription").textContent = addOn.description;
  byId("shAddonPrice").textContent = `+${rupees(addOn.amountPaise)}`;
  host.hidden = false;
  // Ticking the box, not the order that follows: this is how many people want
  // the plate at all, including the ones who never pay.
  byId("shAddonCheck")?.addEventListener("change", (event) => {
    cart.save({ addOn: event.target.checked });
    if (event.target.checked && window.ptTrack) {
      ptTrack("add_on_selected", { item_id: addOn.id, value: addOn.amountPaise / 100, currency: "INR" });
    }
  });
}

// Duo Pack only. The box stays ticked if the buyer then orders another pack,
// so the pack decides, not the box: any other sku gets no plate and no charge.
function selectedAddOn(sku) {
  return _addOn && byId("shAddonCheck")?.checked && (_addOn.productIds || []).includes(sku) ? _addOn : null;
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
  byId("shSheetBd").hidden = false;
  byId("shSheet").hidden = false;
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
  byId("shSheet").hidden = true;
  byId("shSheetBd").hidden = true;
  document.body.style.overflow = "";
}

// What a dismissal gesture calls: the backdrop, Escape, the Done button. None
// of those may close the sheet out from under a live checkout.
function hideSheet() {
  if (_busy) return; // never close over a payment in flight
  closeSheet();
}

function say(message) {
  const note = byId("shNote");
  if (!note) return;
  note.hidden = false;
  note.textContent = message;
  // The sheet that just closed may have left the page scrolled past this.
  note.scrollIntoView({ block: "center", behavior: "smooth" });
}

// Opens a connection to a host we are about to need. Added at the moment of
// intent, not written into the HTML: a page-load preconnect is spent on every
// visitor, and the browser drops an idle one after about ten seconds.
function preconnect(origin) {
  try {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    document.head.appendChild(link);
  } catch { /* a hint, never fatal */ }
}

async function buy(sku, product) {
  // Fetched in parallel with the address step; only opened after the order.
  window.ptLoadRazorpay();
  preconnect("https://checkout.razorpay.com");
  if (_busy) return;
  _sku = sku;

  if (typeof window.ptCollectAddress !== "function") {
    say("The delivery step could not load. Please refresh and try again.");
    return;
  }

  const addOn = selectedAddOn(sku);
  _checkedOutAddOn = addOn;
  const offerPrice = offerFor(sku) ? offerFor(sku).offerPaise : product?.amountPaise;
  // The sheet is also where the buyer picks online or Cash on Delivery, for a
  // pack the catalogue says takes it.
  const cod = _cod && _cod.productIds.includes(sku) ? _cod : null;
  // The bot check, started now rather than at the tap, and kept fresh while the
  // buyer types (see fresh-captcha.js), as /get does. Only a Cash on Delivery
  // order sends a token from this page, so it is only started for a pack that
  // takes COD; an online order here is not made to load Google's script.
  const captcha = cod ? keepFreshToken(() => getCaptchaToken("guest_checkout")) : null;
  // Marked open before the sheet shows, so a reload from here brings it back.
  cart.save({ checkout: sku });
  const picked = await window.ptCollectAddress({
    guest: true,
    // The COD phone check in the sheet sends a code, and the server wants a
    // bot score for it. Only called on the COD path.
    captchaToken: () => getCaptchaToken("guest_checkout"),
    orderSummary: product
      ? {
          name: addOn ? `${product.name} + ${addOn.name}` : product.name,
          amountPaise: offerPrice + (addOn?.amountPaise || 0),
          mrpPaise: offerFor(sku) ? offerFor(sku).mrpPaise : null,
          offerLabel: offerFor(sku) ? `${offerFor(sku).code} auto-applied` : null,
          cod: cod
            ? { amountPaise: offerPrice + (addOn?.amountPaise || 0) + cod.surchargePaise, feePaise: cod.surchargePaise }
            : null
        }
      : null
  });
  if (!picked) {
    if (captcha) captcha.stop();
    cart.save({ checkout: null }); // backed out on purpose: do not reopen it
    return;
  }
  const { paymentMethod = "online", codToken, ...address } = picked;

  if (window.ptTrack && product) {
    ptTrack("add_shipping_info", {
      value: (offerPrice + (addOn?.amountPaise || 0)) / 100,
      currency: "INR",
      ...(offerFor(sku) ? { coupon: offerFor(sku).code } : {}),
      items: [{ item_id: sku, quantity: 1 }, ...(addOn ? [{ item_id: addOn.id, quantity: 1 }] : [])]
    });
  }

  _busy = true;

  // The sheet opens NOW, in a working state, rather than only after payment.
  // Creating the order takes a few seconds (address validation, an order
  // number, then Razorpay's own API) and until this the buyer stared at an
  // unchanged product grid with no sign their tap had registered.
  { const el = byId("shWorking"); if (el) el.hidden = false; }
  { const el = byId("shDone"); if (el) el.hidden = true; }
  const orderSteps = stepRun("shSteps", [
    { label: "Checking your address", weight: 1 },
    { label: "Reserving your pack", weight: 1 },
    { label: paymentMethod === "cod" ? "Placing your order" : "Opening secure payment", weight: 2 }
  ]);
  orderSteps.begin();
  showSheet();

  // Each names real work inside create-order: validateAddress, then the order
  // number and the shopOrder write, then createRazorpayOrder (or, for Cash on
  // Delivery, the write itself: the courier booking and the confirmation run
  // on the server after it has answered). One request from here, so the run
  // walks the stages on a schedule and can only be FINISHED by the response
  // arriving.
  const orderPacing = [700, 1500].map((delay) => setTimeout(() => orderSteps.advance(), delay));
  const stopOrderPacing = () => orderPacing.forEach(clearTimeout);

  let order;
  try {
    // Razorpay's payment window loads from api.razorpay.com the moment this
    // order comes back, so that connection is opened now, in parallel.
    if (paymentMethod !== "cod") preconnect("https://api.razorpay.com");
    // COD only: the server refuses an unscored COD order. Online checkout here
    // stays as it was, with no token. The token is the one kept fresh since
    // the sheet opened, so the tap does not wait on Google.
    if (captcha && paymentMethod !== "cod") captcha.stop();
    const recaptchaToken = paymentMethod === "cod"
      ? await (captcha ? captcha.take() : getCaptchaToken("guest_checkout"))
      : undefined;
    const res = await fetch("/api/shop/guest/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // A HINT, never a price. The server resolves the code, refuses a
      // self-referral and decides the discount.
      body: JSON.stringify({
        productId: sku,
        address,
        ref: referralCode(),
        // No promo: the server applies the website offer itself, the same one
        // the card shows, so a page can never forget to ask for it.
        recaptchaToken,
        addOnId: addOn?.id,
        paymentMethod,
        // Proof the delivery mobile passed its code; Cash on Delivery only.
        codToken
      })
    });
    order = await res.json();
    if (!res.ok || !order.ok) throw new Error(order && order.error);
    // Before the payment window opens, not after it closes.
    remember(order.orderNumber, address);
    _paidPaise = order.amount || 0;
    _paidCoupon = order.promoCode || null;
    _paidCod = order.paymentMethod === "cod";
  } catch (err) {
    stopOrderPacing();
    orderSteps.fail("");
    orderSteps.destroy();
    _busy = false; // the flow is over; let the buyer try again
    closeSheet();
    cart.save({ checkout: null });
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
      items: [{ item_id: sku, quantity: 1 }, ...(addOn ? [{ item_id: addOn.id, quantity: 1 }] : [])]
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

  if (!(await window.ptLoadRazorpay())) {
    stopOrderPacing();
    orderSteps.fail("");
    orderSteps.destroy();
    _busy = false; // the flow is over; let the buyer try again
    closeSheet();
    cart.save({ checkout: null });
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
    modal: { ondismiss: () => { _busy = false; cart.save({ checkout: null }); } },
    handler: async (response) => {
      // Paid. Forget the cart now rather than after verify: a reload in between
      // must not reopen a checkout for an order that is already paid.
      cart.clear();
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
  { const el = byId("shWorking"); if (el) el.hidden = true; }
  closeSheet();

  rzp.open();
}

// The paid breakdown, row for row as verify-payment read it off the stored
// order. Rendered, never summed: this page does no arithmetic on it.
function renderBreakdown(rows) {
  const host = byId("shDoneBreakdown");
  if (!host) return;
  host.replaceChildren(...(Array.isArray(rows) ? rows : []).flatMap((row) => {
    const dt = el("dt", row.total ? "sh-done-b-total" : "", row.label);
    const dd = el("dd", row.total ? "sh-done-b-total" : "", row.text);
    return [dt, dd];
  }));
  host.hidden = !host.childElementCount;
}

function showDone(done) {
  // Swap the working state back out. Without this the sheet would show the
  // spent progress bar above the confirmation.
  { const w = byId("shWorking"); if (w) w.hidden = true; }
  { const d = byId("shDone"); if (d) d.hidden = false; }
  _busy = false;
  cart.clear(); // the order exists; nothing left to bring back
  // The order exists, so a friend's link is spent. Cleared HERE, not when the
  // order was created: a buyer who closed the payment window and tried again
  // was sent back without the code and charged the full price.
  clearReferralCode();
  byId("shDoneSub").textContent = done.paymentMethod === "cod"
    ? `Order ${done.orderNumber} is placed. Pay ${rupees(done.amount)} in cash when it arrives. We have sent the details to your mobile.`
    : done.pending
      ? `Payment received. Order ${done.orderNumber} is being confirmed. You will get a WhatsApp update shortly.`
      : `Order ${done.orderNumber} is on its way. We have sent the details to your mobile.`;
  renderBreakdown(done.breakdown);
  showSheet();

  if (window.ptTrack) {
    // Without value/currency both Meta and GA4 book the conversion at zero,
    // and the valueless browser event can win the event_id de-duplication
    // against the server's CAPI Purchase and erase the amount there too.
    ptTrack("purchase", {
      transaction_id: done.orderNumber,
      value: _paidPaise / 100,
      currency: "INR",
      ...(_paidCoupon ? { coupon: _paidCoupon } : {}),
      // Tagged so COD never accepted at the door can be told apart, as the
      // signed-in shop does.
      ...(_paidCod ? { cod: true, method: "cod" } : {}),
      items: [
        { item_id: _sku, quantity: 1 },
        ...(_checkedOutAddOn ? [{ item_id: _checkedOutAddOn.id, quantity: 1 }] : [])
      ]
    });
  }
}

// `products` is the catalogue already on screen, passed in only so
// begin_checkout can carry a value. A missing entry costs the value on one
// event and nothing else -- it must never stop the click reaching buy().
function wireCheckout(products) {
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
      const priced = products && products[sku];
      const offer = offerFor(sku);
      const addOn = selectedAddOn(sku);
      const valuePaise = priced
        ? (offer ? offer.offerPaise : priced.amountPaise) + (addOn?.amountPaise || 0)
        : null;
      ptTrack("begin_checkout", {
        method: "guest",
        items: [
          { item_id: sku, quantity: 1 },
          ...(addOn ? [{ item_id: addOn.id, quantity: 1 }] : [])
        ],
        ...(valuePaise !== null ? { value: valuePaise / 100, currency: "INR" } : {})
      });
    }
    buy(sku, products && products[sku]);
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

  _offers = payload.offers || (payload.launchOffer ? { [payload.launchOffer.productId]: payload.launchOffer } : {});
  _cod = typeof payload.codSurchargePaise === "number" && Array.isArray(payload.codProductIds)
    ? { surchargePaise: payload.codSurchargePaise, productIds: payload.codProductIds }
    : null;
  renderGrid(payload.products);
  renderAddOns(payload.addOns);
  // What this tab had chosen before a reload. Set directly, not through a
  // change event: that would re-fire add_on_selected for a tick the buyer made
  // before the reload.
  const saved = cart.read();
  if (_addOn && typeof saved.addOn === "boolean") {
    const box = byId("shAddonCheck");
    if (box) box.checked = saved.addOn;
  }
  wireCheckout(payload.products);
  byId("shYear").textContent = String(new Date().getFullYear());

  // Reloaded mid-checkout: reopen it on the same pack. The address sheet
  // refills itself from its own draft. A pack that has since sold out, or left
  // the catalogue, is not reopened.
  const resume = PACKS.find((pack) => pack.id === saved.checkout);
  if (resume && !resume.soldOut && payload.products[resume.id] && !payload.products[resume.id].soldOut) {
    buy(resume.id, payload.products[resume.id]);
  }

  // After the page is usable, never in front of it.
  showRecall();

  // Fired once prices are on screen, not on DOMContentLoaded, so "viewed the
  // item" means a price was seen. The ratio of landing-site sessions to this
  // event is the size of the drop the login wall was causing.
  if (window.ptTrack) {
    const lead = payload.products[PACKS[0].id];
    // The offer price when there is one on screen, not the MRP.
    const leadOffer = offerFor(PACKS[0].id);
    ptTrack("view_item", {
      items: Object.entries(payload.products).map(([id, p]) => ({ item_id: id, item_name: p.name })),
      ...(lead ? { value: (leadOffer ? leadOffer.offerPaise : lead.amountPaise) / 100, currency: "INR" } : {}),
      ...(leadOffer ? { coupon: leadOffer.code } : {})
    });
  }
}

load();
