const tabQueue = document.getElementById("tab-queue");
const tabRecent = document.getElementById("tab-recent");
const panelQueue = document.getElementById("panel-queue");
const panelRecent = document.getElementById("panel-recent");
const queueRows = document.getElementById("queueRows");
const queueCount = document.getElementById("queueCount");
const queueChips = document.getElementById("queueChips");
const queueQ = document.getElementById("queueQ");
const queueSort = document.getElementById("queueSort");
const recentRows = document.getElementById("recentRows");
const recentCount = document.getElementById("recentCount");
const recentMore = document.getElementById("recentMore");
const recentQ = document.getElementById("recentQ");
const recentType = document.getElementById("recentType");
const batchChip = document.getElementById("batchChip");

// ?batch=<key> (from the Issuance page's Batches card) narrows the activations
// list to one batch and opens that tab. Only the digits a batch key can be are
// sent on.
const BATCH = (() => {
  const b = new URLSearchParams(location.search).get("batch") || "";
  return /^\d{2,9}$/.test(b) ? b : "";
})();

let QUEUE = [];
let queueFilter = null; // chosen once the queue has loaded

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtCount(n) {
  return Number(n || 0).toLocaleString("en-IN");
}
// "3d ago", "2 mo ago". Clamped so the boundaries never read "0 yrs".
function ago(s) {
  if (!s) return "";
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.min(11, Math.max(1, Math.round(days / 30.44)))} mo ago`;
  const years = Math.max(1, Math.round(days / 365.25));
  return `${years} yr${years === 1 ? "" : "s"} ago`;
}
// Digits-with-country-code for tel:/wa.me. 10-digit → +91; strip a leading 0.
function waDigits(mobile) {
  let d = String(mobile || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d;
}
function phoneLink(mobile) {
  if (!mobile) return `<div class="sub">No phone</div>`;
  return `<div class="sub"><a href="tel:+${esc(waDigits(mobile))}">${esc(mobile)}</a></div>`;
}

// The reminder, addressed by first name when there is one. Written for any
// sticker, premium or E-Tag.
function reminderText(name) {
  const first = String(name || "").trim().split(/\s+/)[0];
  return `Hi${first ? ` ${first}` : ""}! Your ParkTag sticker is ready to activate. ` +
    "Scan the QR on it, or open your ParkTag dashboard, to activate it so people can reach you about your vehicle without seeing your number. " +
    "Reply here if you need help.";
}

// ── Tabs ──────────────────────────────────────────────────────────────
function showTab(which) {
  const recent = which === "recent";
  tabQueue.setAttribute("aria-selected", String(!recent));
  tabRecent.setAttribute("aria-selected", String(recent));
  panelQueue.hidden = recent;
  panelRecent.hidden = !recent;
  // Remembered in the address, so Back and a shared link land on the same tab.
  const hash = recent ? "#recent" : "";
  if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
}
tabQueue.addEventListener("click", () => showTab("queue"));
tabRecent.addEventListener("click", () => showTab("recent"));

// ── Awaiting activation ───────────────────────────────────────────────
// Which pile an order is in, from where its parcel is. Only someone who has
// the sticker in hand can activate it, so "delivered" is who to remind now.
const RETURNED = /rto|return|undeliver|lost|cancel/i;
function groupOf(order) {
  const d = order.delivery || {};
  if (d.state === "delivered" || d.state === "handed_over") return "ready";
  if (d.state === "shipment_failed") return "problem";
  if (d.state === "shipped") return RETURNED.test(d.courierStatus || "") ? "problem" : "transit";
  return "pending";
}

const GROUPS = [
  { key: "ready", label: "Remind now", empty: "Nobody to remind right now." },
  { key: "transit", label: "On the way", empty: "Nothing on the way." },
  { key: "pending", label: "Not shipped", empty: "Everything has shipped." },
  { key: "problem", label: "Problem", empty: "No shipping problems." },
  { key: "all", label: "All", empty: "Nobody is waiting to activate." }
];

function statusHtml(order) {
  const d = order.delivery || {};
  let text;
  if (d.state === "delivered") text = `Delivered ${ago(d.at)}`;
  else if (d.state === "handed_over") text = "Handed over";
  else if (d.state === "shipment_failed") text = "Shipment failed";
  else if (d.state === "shipped") text = d.courierStatus || "Shipped";
  else text = "Not shipped yet";
  return `<div class="status"><span class="dot ${groupOf(order)}"></span>${esc(text)}</div>
    <div class="sub">Ordered ${esc(ago(order.placedAt))}</div>`;
}

function channelName(channel) {
  return channel === "call" ? "a call" : "WhatsApp";
}

function remindedHtml(order) {
  const r = order.lastReminder;
  if (!r) return `<span class="reminded none">Not reminded yet</span>`;
  const total = order.reminderCount > 1 ? ` · ${fmtCount(order.reminderCount)} reminders total` : "";
  return `<span class="reminded">Last reminded ${esc(ago(r.at))} on ${esc(channelName(r.channel))}${esc(total)}</span>`;
}

// Everything the row leaves out, one click away.
const openDetails = new Set();
function detailsHtml(o) {
  const d = o.delivery || {};
  let shipping;
  if (d.state === "handed_over") shipping = "Handed over in person";
  else if (d.state === "delivered") shipping = `Delivered ${ago(d.at)}${o.waybill ? ` · AWB ${o.waybill}` : ""}`;
  else if (d.state === "shipped") shipping = `AWB ${o.waybill || "—"} · courier says “${d.courierStatus || "no update yet"}”${d.at ? `, checked ${ago(d.at)}` : ""}`;
  else if (d.state === "shipment_failed") shipping = `Delhivery booking failed: ${d.error || "no reason recorded"}`;
  else shipping = "No shipment booked yet (no AWB on the order)";

  const history = (o.reminders || []).slice().reverse();
  const reminders = history.length
    ? `<ul class="history">${history.map((r) => `<li>${esc(ago(r.at))} · ${esc(channelName(r.channel))} · by ${esc(r.by || "unknown admin")}</li>`).join("")}</ul>`
    : "None yet";

  const item = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  return `<dl class="details">
      ${item("Payment", o.paymentMethod === "cod" ? "Cash on delivery" : "Prepaid online")}
      ${item("Price", esc(o.priceBreakdown || "—"))}
      ${item("Shipping", esc(shipping))}
      ${item("Ordered", esc(o.placedAt ? new Date(o.placedAt).toLocaleString() : "—"))}
      ${o.ownerEmail ? item("Email", esc(o.ownerEmail)) : ""}
      ${item("Reminders", reminders)}
    </dl>`;
}

function queueRowHtml(o) {
  const product = String(o.productName || "Order").replace(/^ParkTag\s+/i, "");
  const pack = o.stickers > 1 ? ` · ${fmtCount(o.activatedStickers)} of ${fmtCount(o.stickers)} activated` : "";
  const open = openDetails.has(o.id);
  const d = waDigits(o.ownerMobile);
  const buttons = o.ownerMobile
    ? `<div class="btns">
         <a class="btn wa" data-remind="whatsapp" data-id="${esc(o.id)}" href="https://wa.me/${esc(d)}?text=${encodeURIComponent(reminderText(o.ownerName))}" target="_blank" rel="noopener">WhatsApp</a>
         <a class="btn call" data-remind="call" data-id="${esc(o.id)}" href="tel:+${esc(d)}">Call</a>
       </div>`
    : `<span class="reminded none">No phone number</span>`;
  return `
    <div class="row">
      <div>
        <div class="main">${esc(o.ownerName || "Unnamed buyer")}</div>
        ${phoneLink(o.ownerMobile)}
      </div>
      <div>
        <div class="mid">${esc(o.orderNumber || "—")}${o.paymentMethod === "cod" ? `<span class="tag cod">COD</span>` : ""}</div>
        <div class="sub">${esc(product)}${esc(pack)}</div>
        <button class="more-btn" type="button" data-details="${esc(o.id)}" aria-expanded="${open}">${open ? "Hide details" : "Details"}</button>
      </div>
      <div>${statusHtml(o)}</div>
      <div class="actions">
        ${buttons}
        <div data-reminder-for="${esc(o.id)}">${remindedHtml(o)}</div>
      </div>
      ${open ? detailsHtml(o) : ""}
    </div>`;
}

function renderQueue() {
  const counts = Object.fromEntries(GROUPS.map((g) => [g.key, 0]));
  for (const o of QUEUE) counts[groupOf(o)] += 1;
  counts.all = QUEUE.length;
  if (!queueFilter) queueFilter = counts.ready ? "ready" : "all";

  // Only the piles that have someone in them, plus All.
  queueChips.innerHTML = GROUPS
    .filter((g) => g.key === "all" || counts[g.key] || g.key === queueFilter)
    .map((g) => `<button class="chip" data-group="${g.key}" aria-pressed="${g.key === queueFilter}">${esc(g.label)}<span class="n">${fmtCount(counts[g.key])}</span></button>`)
    .join("");

  const q = queueQ.value.trim().toLowerCase();
  const list = QUEUE
    .filter((o) => queueFilter === "all" || groupOf(o) === queueFilter)
    .filter((o) => !q || [o.orderNumber, o.ownerName, o.ownerEmail, o.ownerMobile, o.productName, o.waybill]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  // The server sends waiting-longest first; "newest" is the same list reversed.
  if (queueSort.value === "newest") list.reverse();

  if (!list.length) {
    const group = GROUPS.find((g) => g.key === queueFilter);
    queueRows.innerHTML = `<div class="empty">${esc(q ? "No buyers match your search." : group.empty)}</div>`;
    return;
  }
  queueRows.innerHTML = list.map(queueRowHtml).join("");
}

queueChips.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-group]");
  if (!chip) return;
  queueFilter = chip.dataset.group;
  renderQueue();
});

// WhatsApp or Call records the reminder. The link itself still opens as
// normal; recording is best-effort and says so in the row if it fails.
queueRows.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-details]");
  if (toggle) {
    const id = toggle.dataset.details;
    if (openDetails.has(id)) openDetails.delete(id); else openDetails.add(id);
    renderQueue();
    return;
  }
  const link = event.target.closest("a[data-remind]");
  if (!link) return;
  const id = link.dataset.id;
  const order = QUEUE.find((o) => o.id === id);
  if (!order) return;
  const slot = () => queueRows.querySelector(`[data-reminder-for="${CSS.escape(id)}"]`);

  fetch(`/api/admin/activations/${encodeURIComponent(id)}/reminder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel: link.dataset.remind }),
    keepalive: true
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.lastReminder) throw new Error(data.error || "Failed");
      order.lastReminder = data.lastReminder;
      order.reminderCount = (order.reminderCount || 0) + 1;
      order.reminders = [...(order.reminders || []), data.lastReminder].slice(-20);
      renderQueue();
    })
    .catch(() => {
      if (slot()) slot().innerHTML = `<span class="reminded note-err">Reminder not recorded</span>`;
    });
});

// Once per visit, ask the server to re-read the courier status of parcels in
// transit, then redraw only if something moved (usually: now delivered, so the
// buyer joins "Remind now"). Best-effort: a failure leaves the list as it was.
const syncNote = document.getElementById("syncNote");
let trackingRefreshed = false;
async function refreshTracking() {
  if (trackingRefreshed) return;
  trackingRefreshed = true;
  if (!QUEUE.some((o) => o.delivery?.state === "shipped")) return;

  syncNote.hidden = false;
  try {
    const res = await fetch("/api/admin/activations/refresh-tracking", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.changed > 0) await loadQueue();
  } catch {
    /* the list already on screen stays */
  } finally {
    syncNote.hidden = true;
  }
}

async function loadQueue() {
  try {
    const res = await fetch("/api/admin/activations");
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    QUEUE = data.unactivated || [];
    queueCount.textContent = fmtCount(QUEUE.length);
    renderQueue();
    refreshTracking();
  } catch {
    queueRows.innerHTML = `<div class="empty">Could not load buyers awaiting activation.</div>`;
    queueCount.textContent = "—";
  }
}

// ── Recently activated (server-side search, latest 100) ───────────────
function recentRowHtml(t) {
  const type = t.type === "premium" ? `<span class="tag premium">Premium</span>` : `<span class="tag">E-Tag</span>`;
  const inactive = t.status !== "active" ? `<span class="tag warn">${esc(t.status || "inactive")}</span>` : "";
  return `
    <div class="row">
      <div>
        <div class="main">${esc(t.plateNumber || "No plate")}</div>
        <div class="sub">${esc(t.vehicleLabel || "Vehicle")}</div>
      </div>
      <div>
        <div class="mid">${esc(t.ownerName || "Unnamed owner")}</div>
        ${phoneLink(t.ownerMobile)}
      </div>
      <div>
        <div class="mid">${esc(t.serial || t.etagId)}${type}${inactive}</div>
        ${t.batchLabel ? `<div class="sub">${esc(t.batchLabel)}</div>` : ""}
      </div>
      <div>
        <div class="mid">${esc(ago(t.activatedAt) || "—")}</div>
        <div class="sub">Activated</div>
      </div>
    </div>`;
}

// Only the newest request may paint, so a slow earlier search never
// overwrites a later one.
// 100 a page, numbered; search runs on the server across every activation.
let recentRequest = 0;
let recentTotalShown = false;
let recentPage = 1;
const recentPager = document.getElementById("recentPager");
async function loadRecent() {
  const params = new URLSearchParams();
  if (recentPage > 1) params.set("page", String(recentPage));
  if (recentType.value !== "all") params.set("type", recentType.value);
  const q = recentQ.value.trim();
  if (q) params.set("q", q);
  if (BATCH) params.set("batch", BATCH);
  const id = ++recentRequest;
  try {
    const res = await fetch(`/api/admin/activations/recent${params.toString() ? `?${params}` : ""}`);
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    const data = await res.json();
    if (id !== recentRequest) return;
    if (!res.ok) throw new Error(data.error || "Failed");

    // The tab keeps the unfiltered total; searching only changes the list.
    if (!recentTotalShown && !q && recentType.value === "all") {
      recentCount.textContent = fmtCount(data.total);
      recentTotalShown = true;
    }
    const list = data.activations || [];
    recentPage = Number(data.page) || 1; // the server clamps a page past the end
    const from = (recentPage - 1) * (Number(data.pageSize) || 100) + 1;
    recentMore.hidden = !(Number(data.pages) > 1);
    recentMore.textContent = `Showing ${fmtCount(from)}–${fmtCount(from + list.length - 1)} of ${fmtCount(data.total)}`;
    renderPager(recentPager, data, (n) => {
      recentPage = n;
      loadRecent().then(() => recentRows.scrollIntoView({ block: "start" }));
    });
    const filtered = q || recentType.value !== "all" || BATCH;
    recentRows.innerHTML = list.length
      ? list.map(recentRowHtml).join("")
      : `<div class="empty">${filtered ? "No activations match." : "No activations yet."}</div>`;
  } catch {
    if (id !== recentRequest) return;
    recentRows.innerHTML = `<div class="empty">Could not load activations.</div>`;
    recentMore.hidden = true;
    renderPager(recentPager, { page: 1, pages: 1 });
    if (!recentTotalShown) recentCount.textContent = "—";
  }
}

if (BATCH) {
  batchChip.hidden = false;
  batchChip.innerHTML = `Batch ${esc(BATCH)} · <a href="/admin/activations#recent">show all</a>`;
}

queueQ.addEventListener("input", renderQueue);
queueSort.addEventListener("change", renderQueue);
let recentTimer = null;
recentQ.addEventListener("input", () => {
  clearTimeout(recentTimer);
  recentTimer = setTimeout(() => { recentPage = 1; loadRecent(); }, 300);
});
recentType.addEventListener("change", () => { recentPage = 1; loadRecent(); });

showTab(BATCH || location.hash === "#recent" ? "recent" : "queue");
loadQueue();
loadRecent();
