// The Orders page: each order as stored, newest first, with the amount and how
// it was paid, the full delivery address, where the parcel is, and the
// stickers it has become. Read-only.
const list = document.getElementById("orders");
const chips = document.getElementById("chips");
const search = document.getElementById("q");
const pager = document.getElementById("pager");

let view = "sales";
let page = 1;
let counts = { sales: 0, abandoned: 0, ours: 0, all: 0 };
let rows = [];
let lastQuery = "";
let requestSeq = 0;
const openDetails = new Set();

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(s) {
  if (!s) return "";
  try { return new Date(s).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return s; }
}
function ago(s) {
  const t = Date.parse(s || "");
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function rupees(paise) {
  const n = Math.round(Number(paise) || 0) / 100;
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmt(n) { return Number(n || 0).toLocaleString("en-IN"); }
function digits(phone) { return String(phone || "").replace(/\D/g, ""); }

const VIEWS = [
  { key: "sales", label: "Sales", empty: "No sales yet." },
  { key: "abandoned", label: "Abandoned", empty: "No abandoned checkouts." },
  { key: "ours", label: "Ours", empty: "No test orders of ours." },
  { key: "all", label: "All", empty: "No orders yet." }
];

const PAY = { online: "Paid online", cod: "Cash on delivery", cod_prepaid: "COD, paid online later" };

function renderChips() {
  chips.innerHTML = VIEWS.map((v) =>
    `<button class="chip" type="button" data-view="${v.key}" aria-pressed="${v.key === view}">${v.label}<span class="n">${fmt(counts[v.key])}</span></button>`
  ).join("");
}

function paymentHtml(o) {
  if (o.status === "created") return `<span class="pill abandoned">Not paid</span>`;
  // A hand sale says how it was really paid (UPI, cash), not "online".
  if (o.paymentMode === "manual") return `<span class="pill manual">Paid by ${esc(String(o.paymentMethod || "hand").toUpperCase())}</span>`;
  return `<span class="pill ${esc(o.paymentMode)}">${esc(PAY[o.paymentMode] || o.paymentMode)}</span>`;
}

function deliveryHtml(o) {
  const d = o.delivery || {};
  let text;
  if (d.state === "delivered") text = `Delivered ${ago(d.at)}`;
  else if (d.state === "handed_over") text = "Handed over in person";
  else if (d.state === "shipment_failed") text = "Shipment failed";
  else if (d.state === "shipped") text = d.courierStatus || "Shipped";
  else if (o.status === "created") text = "No order placed";
  else text = "Not shipped yet";
  const awb = o.waybill
    ? `<p class="meta">AWB ${o.trackingUrl ? `<a href="${esc(o.trackingUrl)}" target="_blank" rel="noopener">${esc(o.waybill)}</a>` : esc(o.waybill)}</p>`
    : "";
  return `<p class="main"><span class="dot ${esc(d.state || "")}"></span>${esc(text)}</p>${awb}`;
}

function addressHtml(a) {
  if (!a || !(a.line1 || a.city || a.pincode)) return `<p class="meta">No address on this order</p>`;
  const lines = [a.line1, [a.line2, a.landmark].filter(Boolean).join(", "), [a.city, a.state].filter(Boolean).join(", "), a.pincode].filter(Boolean);
  return `<div class="addr">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
}

function stickersHtml(o) {
  const s = o.stickers || {};
  if (o.status === "created") return "";
  if (s.mintedTagId) return `<p class="meta">Premium tag minted online</p>`;
  const done = s.linked >= s.capacity;
  return `<p class="meta">${esc(fmt(s.linked))} of ${esc(fmt(s.capacity))} sticker${s.capacity === 1 ? "" : "s"} activated${done ? " ✓" : ""}</p>`;
}

function detailsHtml(o) {
  const item = (label, value) => value ? `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>` : "";
  const a = o.address || {};
  return `<dl class="details">
    ${item("Price breakdown", esc(o.priceBreakdown || "—"))}
    ${item("Payment id", esc(o.paymentId || o.paymentRef || "—"))}
    ${item("Paid at", esc(o.paidAt ? fmtDate(o.paidAt) : "—"))}
    ${item("Order id", esc(o.orderId || "—"))}
    ${item("Promo", o.promoCode ? `${esc(o.promoCode)} · −${esc(rupees(o.promoDiscountPaise))}` : "")}
    ${item("Referral discount", o.referralDiscountPaise ? `−${esc(rupees(o.referralDiscountPaise))}` : "")}
    ${item("Add-ons", (o.product.addOns || []).length ? esc(o.product.addOns.join(", ")) : "")}
    ${item("Email", esc(a.email || (o.owner && o.owner.email) || ""))}
    ${item("Account", o.owner ? `<a href="/admin/owners?q=${encodeURIComponent(o.owner.mobile || o.owner.email || o.owner.name || "")}">${esc(o.owner.name || "Owner")}</a>${o.owner.mobile ? ` · ${esc(o.owner.mobile)}` : ""}` : (o.guest ? "Guest checkout" : ""))}
    ${item("Campaign", o.attribution && (o.attribution.source || o.attribution.campaign) ? esc([o.attribution.source, o.attribution.medium, o.attribution.campaign].filter(Boolean).join(" / ")) : "")}
    ${item("Note", esc(o.note || ""))}
  </dl>`;
}

function orderHtml(o) {
  const open = openDetails.has(o.id);
  const a = o.address || {};
  const abandoned = o.status === "created";
  return `
    <div class="order${abandoned ? " is-abandoned" : ""}${o.internal ? " is-ours" : ""}" data-id="${esc(o.id)}">
      <div class="c-order">
        <div class="label">Order</div>
        <p class="main">${esc(o.orderNumber || o.orderId || "—")}${o.internal ? `<span class="pill ours">Ours</span>` : ""}${o.channel && o.channel !== "shop" ? `<span class="pill channel">${esc(o.channel)}</span>` : ""}</p>
        <p class="meta" title="${esc(fmtDate(o.createdAt))}">${esc(ago(o.createdAt))} · ${esc(fmtDate(o.createdAt))}</p>
        <div class="label block">Product</div>
        <p>${esc(o.product.name || "—")}${o.product.quantity > 1 ? ` × ${esc(fmt(o.product.quantity))}` : ""}</p>
        ${stickersHtml(o)}
      </div>
      <div class="c-to">
        <div class="label">Deliver to</div>
        <p class="main">${esc(a.fullName || "Unnamed buyer")}</p>
        <p class="meta">${a.phone ? `<a href="tel:+${esc(digits(a.phone))}">${esc(a.phone)}</a>` : "No phone"}</p>
        ${addressHtml(a)}
      </div>
      <div class="c-amount">
        <div class="label">Amount</div>
        <p class="amount">${esc(rupees(o.amountPaise))}</p>
        <p>${paymentHtml(o)}</p>
        ${o.paymentMode === "cod" && o.codSurchargePaise ? `<p class="meta">includes ${esc(rupees(o.codSurchargePaise))} COD fee</p>` : ""}
        ${o.paymentMode === "cod_prepaid" && o.listedPaise !== o.amountPaise ? `<p class="meta">was ${esc(rupees(o.listedPaise))} as COD</p>` : ""}
      </div>
      <div class="c-delivery">
        <div class="label">Delivery</div>
        ${deliveryHtml(o)}
      </div>
      <div class="foot">
        <button class="more-btn" type="button" data-details="${esc(o.id)}" aria-expanded="${open}">${open ? "Hide details" : "Details"}</button>
      </div>
      ${open ? detailsHtml(o) : ""}
    </div>`;
}

function render() {
  const v = VIEWS.find((x) => x.key === view) || VIEWS[0];
  list.innerHTML = rows.length
    ? rows.map(orderHtml).join("")
    : `<p class="empty">${lastQuery ? "No orders match your search." : v.empty}</p>`;
}

function renderPager(data) {
  if (!data || data.pages <= 1) { pager.innerHTML = ""; return; }
  const btn = (n, label) => `<button class="chip" type="button" data-page="${n}" aria-pressed="${n === data.page}">${label}</button>`;
  const parts = [];
  if (data.page > 1) parts.push(btn(data.page - 1, "Previous"));
  for (let n = 1; n <= data.pages; n++) parts.push(btn(n, String(n)));
  if (data.page < data.pages) parts.push(btn(data.page + 1, "Next"));
  pager.innerHTML = parts.join("");
}

async function load() {
  const seq = ++requestSeq;
  const params = new URLSearchParams({ view });
  if (page > 1) params.set("page", String(page));
  const q = search.value.trim();
  if (q) params.set("q", q);
  try {
    const res = await fetch(`/api/admin/orders?${params}`, { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    const data = await res.json();
    if (seq !== requestSeq) return;
    if (!res.ok) throw new Error(data.error || "Failed");
    counts = data.counts || counts;
    page = Number(data.page) || 1;
    rows = data.orders || [];
    lastQuery = q;
    renderChips();
    renderPager(data);
    render();
  } catch {
    if (seq !== requestSeq) return;
    list.innerHTML = `<p class="err">Could not load orders.</p>`;
  }
}

chips.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-view]");
  if (!chip) return;
  view = chip.dataset.view;
  page = 1;
  load();
});

pager.addEventListener("click", (event) => {
  const b = event.target.closest("[data-page]");
  if (!b) return;
  page = Number(b.dataset.page) || 1;
  load().then(() => list.scrollIntoView({ block: "start" }));
});

let searchTimer = null;
search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page = 1; load(); }, 300);
});

list.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-details]");
  if (!toggle) return;
  const id = toggle.dataset.details;
  if (openDetails.has(id)) openDetails.delete(id); else openDetails.add(id);
  render();
});

// A search in the URL (from another page's link) applies on arrival.
const initial = new URLSearchParams(location.search).get("q");
if (initial) search.value = initial;
renderChips();
load();
