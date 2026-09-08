// The direct-sale checkout.
//
// ── What this page is for ──────────────────────────────────────────────────
//
// Somebody has already been quoted a price over WhatsApp or standing in a car
// park. Before this existed, that sale went around the shop entirely: UPI to
// edittree@axl, sticker handed over, nothing written down. Four real customers
// were invisible to reporting and no sticker could be traced to a reason for
// leaving.
//
// This puts the same sale through the ordinary checkout, so it lands in the one
// ledger with an order number, a payment reference and a phone. The phone is
// the part that matters most: it is what links the sticker to this order once
// the buyer activates it, which is why nobody has to read a serial off a
// sticker they have already stuck on a windscreen.
//
// ── The rule this page obeys ───────────────────────────────────────────────
//
// IT SENDS A CODE. IT NEVER SENDS A PRICE.
//
// The totals below are display only. Every amount is recomputed by the server
// on create-order and again on verify-payment, so a page with its numbers
// edited buys nobody a discount. See lib/core/promo-codes.js.

const byId = (id) => document.getElementById(id);
const rupees = (paise) => `Rs ${(Number(paise || 0) / 100).toFixed(2)}`;

let products = {};
let sku = null;
// What the last check said, for display only. create-order resolves the code
// again and that resolution is the one that decides the price.
let quote = null;
let busy = false;

function fail(message) {
  const el = byId("drError");
  el.textContent = message;
  el.hidden = !message;
}

function renderPacks(list) {
  const wrap = byId("drPacks");
  wrap.innerHTML = "";

  for (const [id, product] of Object.entries(list)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dr-pack";
    button.dataset.sku = id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    button.innerHTML =
      `<span class="dr-pack-name"></span><span class="dr-pack-price"></span>`;
    button.querySelector(".dr-pack-name").textContent = product.name;
    button.querySelector(".dr-pack-price").textContent = rupees(product.amountPaise);
    button.addEventListener("click", () => choose(id));
    wrap.append(button);
  }
}

function choose(id) {
  sku = id;
  for (const button of document.querySelectorAll(".dr-pack")) {
    const on = button.dataset.sku === id;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-checked", on ? "true" : "false");
  }
  showTotal();
  void checkCode();
}

function showTotal() {
  if (!sku || !products[sku]) return;

  const catalog = products[sku].amountPaise;
  const discount = quote && quote.ok ? quote.discountPaise : 0;
  const payable = quote && quote.ok ? quote.payablePaise : catalog;

  byId("drCatalog").textContent = rupees(catalog);
  byId("drPay").textContent = rupees(payable);
  byId("drOff").textContent = `- ${rupees(discount)}`;
  byId("drOffRow").hidden = !discount;
  byId("drTotal").hidden = false;
}

// Why an address appears or does not.
//
// A handover code means the sticker is being put into somebody's hand, so
// there is no parcel and no address to collect. Anything else is posted.
// Defaulting to SHOWING the address is deliberate: being wrong that way costs
// a form nobody needed, and being wrong the other way loses a delivery.
function syncShipping() {
  const handover = Boolean(quote && quote.ok && quote.fulfilment === "handover");
  byId("drShip").hidden = handover;
}

// The reasons a code can be refused, said in words a buyer can act on. Anything
// unrecognised falls through to a plain "not valid", because a reason nobody
// understands is worse than none.
const CODE_REFUSALS = {
  malformed: "That code does not look right. Check it and try again.",
  unknown: "We do not recognise that code.",
  revoked: "That code is no longer active.",
  expired: "That code has expired.",
  exhausted: "That code has already been used.",
  "not-yours": "That code was issued for a different mobile number."
};

async function checkCode() {
  const code = byId("drCode").value.trim().toUpperCase();
  const note = byId("drCodeNote");

  if (!code || !sku) {
    quote = null;
    note.textContent = "";
    note.className = "dr-hint";
    showTotal();
    syncShipping();
    return;
  }

  try {
    const res = await fetch("/api/shop/promo/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, productId: sku, phone: byId("drPhone").value.trim() })
    });
    quote = await res.json();
  } catch {
    // A code that cannot be checked is not a code that is wrong. Say nothing,
    // show the full price, and let create-order be the judge.
    quote = null;
    note.textContent = "";
    showTotal();
    syncShipping();
    return;
  }

  if (quote && quote.ok) {
    note.textContent = `Code applied. You save ${rupees(quote.discountPaise)}.`;
    note.className = "dr-hint dr-hint-good";
  } else {
    note.textContent = CODE_REFUSALS[quote && quote.reason] || "That code is not valid.";
    note.className = "dr-hint dr-hint-bad";
  }

  showTotal();
  syncShipping();
}

// What create-order receives. The postal fields are sent empty on a handover
// sale; the server decides which validator to run, and it decides that from the
// code rather than from anything this page claims.
function collect() {
  return {
    fullName: byId("drName").value.trim(),
    phone: byId("drPhone").value.trim(),
    line1: byId("drLine1").value.trim(),
    line2: byId("drLine2").value.trim(),
    landmark: "",
    city: byId("drCity").value.trim(),
    state: byId("drState").value.trim(),
    pincode: byId("drPin").value.trim()
  };
}

async function pay(event) {
  event.preventDefault();
  if (busy) return;

  fail("");
  if (!sku) { fail("Please choose which tag you are buying."); return; }

  const address = collect();
  if (address.fullName.length < 2) { fail("Please enter your name."); return; }
  if (!/^[6-9][0-9]{9}$/.test(address.phone)) { fail("Enter a valid 10-digit mobile number."); return; }

  busy = true;
  const cta = byId("drCta");
  cta.disabled = true;
  cta.textContent = "Opening secure payment...";

  try {
    const res = await fetch("/api/shop/guest/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The code is a HINT. The server resolves it, applies the discount it
      // decides on, and refuses one that is expired, revoked or somebody
      // else's. A junk code just means no discount, never a failed checkout.
      body: JSON.stringify({
        productId: sku,
        address,
        promo: byId("drCode").value.trim().toUpperCase()
      })
    });
    const order = await res.json();

    if (!res.ok || !order.ok) {
      fail(order.error || "We could not start that order. Please try again.");
      return;
    }

    await openRazorpay(order, address);
  } catch {
    fail("Something went wrong reaching us. Please check your connection and try again.");
  } finally {
    busy = false;
    cta.disabled = false;
    cta.textContent = "Pay securely";
  }
}

function openRazorpay(order, address) {
  return new Promise((resolve) => {
    if (typeof window.Razorpay !== "function") {
      fail("The payment window could not load. Please refresh and try again.");
      resolve();
      return;
    }

    const checkout = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: "ParkTag",
      description: products[sku] ? products[sku].name : "ParkTag",
      prefill: { name: address.fullName, contact: address.phone },
      theme: { color: "#0b2545" },
      handler: async (response) => {
        await confirm(response, order);
        resolve();
      },
      // Dismissing is an ordinary thing to do, not an error. The order stays
      // unpaid and the same checkout is reused if they tap Pay again.
      modal: { ondismiss: () => resolve() }
    });

    checkout.open();
  });
}

async function confirm(response, order) {
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

    if (!res.ok || !done.ok) {
      // The money has left. Never say the payment failed, because it did not,
      // and never leave them without the number to quote.
      fail(
        `Payment went through, but we could not confirm it here. ` +
          `Please send us order ${order.orderNumber} and we will sort it out.`
      );
      return;
    }

    byId("drForm").hidden = true;
    byId("drDoneNo").textContent = done.orderNumber || order.orderNumber;
    byId("drDone").hidden = false;
  } catch {
    fail(
      `Payment went through, but we could not confirm it here. ` +
        `Please send us order ${order.orderNumber} and we will sort it out.`
    );
  }
}

async function load() {
  try {
    const res = await fetch("/api/shop/public-catalogue", { headers: { accept: "application/json" } });
    const data = await res.json();
    products = (data && data.products) || {};
  } catch {
    fail("We could not load the packs. Please refresh.");
    return;
  }

  renderPacks(products);

  // Preselect when there is a ?sku= on the link, so a code and a pack can be
  // sent together in one message.
  const wanted = new URLSearchParams(location.search).get("sku");
  if (wanted && products[wanted]) choose(wanted);

  // Same for the code, so the whole thing is one tap from WhatsApp.
  const code = new URLSearchParams(location.search).get("code");
  if (code) byId("drCode").value = code.toUpperCase();

  byId("drCode").addEventListener("change", checkCode);
  byId("drCode").addEventListener("blur", checkCode);
  // The phone is part of what makes a bound code valid, so re-check when it
  // changes rather than telling somebody their own code is not theirs.
  byId("drPhone").addEventListener("blur", checkCode);
  byId("drForm").addEventListener("submit", pay);

  if (code && sku) void checkCode();
}

void load();
