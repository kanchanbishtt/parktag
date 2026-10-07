// Admin → Tags. One row per tag, four facts in a fixed order (sticker,
// vehicle, owner, status); everything else, and every action, under Details.
const rowsEl = document.getElementById("rows");
const summaryEl = document.getElementById("summary");
const qInput = document.getElementById("q");
const categorySel = document.getElementById("category");
const statusSel = document.getElementById("status");
const batchSel = document.getElementById("batch");
const batchCsv = document.getElementById("batchCsv");
const claimChips = document.getElementById("claimChips");
const confirmDialog = document.getElementById("confirm");

const CLAIMS = ["claimed", "unclaimed", "all"];
let claim = "claimed";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Only allow http(s) links in an href. esc() neutralises markup but NOT the URL
// scheme, so a `javascript:`/`data:` recordingUrl would still execute on click.
function safeUrl(u) {
  const s = String(u == null ? "" : u).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}
function fmtCount(n) {
  return Number(n || 0).toLocaleString("en-IN");
}
function fullDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
// "3d ago", "2 mo ago". Clamped so the boundaries never read "0 yrs".
function ago(s) {
  const t = new Date(s || NaN).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(days / 365);
  return `${Math.max(1, years)} yr${years > 1 ? "s" : ""} ago`;
}
// Digits-with-country-code for tel:. 10-digit → +91; strip a leading 0.
function telDigits(mobile) {
  let d = String(mobile || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d;
}
const plural = (n, word) => `${fmtCount(n)} ${word}${n === 1 ? "" : "s"}`;

// ── What a tag is right now: one word, one colour ──
function stateOf(t) {
  if (t.deletedAt) return { key: "deleted", word: "Deleted" };
  if (!t.claimed) return { key: "stock", word: "In stock" };
  if (t.status === "active") return { key: "active", word: "Active" };
  return { key: "off", word: "Inactive" };
}
function stateNote(t) {
  const s = stateOf(t);
  if (s.key === "deleted") return `Deleted ${ago(t.deletedAt)}`;
  if (s.key === "stock") return `Added ${ago(t.createdAt)}`;
  return t.activatedAt ? `Activated ${ago(t.activatedAt)}` : `Added ${ago(t.createdAt)}`;
}

// ── Rows ──
const openDetails = new Set();
const logsById = new Map(); // id → { logs } | { error: true } | "loading"
const noteById = new Map(); // id → { text, err }
let current = [];

function rowHtml(t) {
  const s = stateOf(t);
  const open = openDetails.has(t.id);
  const type = t.premium ? `<span class="tag premium">Premium</span>` : `<span class="tag">E-Tag</span>`;
  // One of the team's own stickers (internal batch, or an owner on the
  // internal list): listed like any other, left out of the overview's
  // customer counts, and said so here.
  const ours = t.internal ? `<span class="tag ours">Ours</span>` : "";
  const contacts = t.contactCount > 0 ? ` · ${plural(t.contactCount, "contact")}` : "";
  const phone = t.ownerMobile
    ? `<a href="tel:+${esc(telDigits(t.ownerMobile))}">${esc(t.ownerMobile)}</a>`
    : esc(t.ownerEmail || "No phone or email");
  return `<div class="row${t.deletedAt ? " is-deleted" : ""}${t.claimed ? "" : " is-stock"}">
      <div class="c-sticker">
        <div class="main">${esc(t.serial || t.etagId)}${type}${ours}</div>
        ${t.serial ? `<div class="sub">${esc(t.etagId)}</div>` : ""}
      </div>
      <div class="c-vehicle">
        ${t.plateNumber ? `<div class="main plate">${esc(t.plateNumber)}</div>` : `<div class="none">No vehicle yet</div>`}
        ${t.vehicleLabel || t.vehicleType ? `<div class="sub">${esc(t.vehicleLabel || t.vehicleType)}</div>` : ""}
      </div>
      <div class="c-owner">
        ${t.claimed
          ? `<div class="main">${esc(t.ownerName || "Unnamed owner")}</div><div class="sub">${phone}</div>`
          : `<div class="none">Not sold yet</div>`}
      </div>
      <div class="c-status">
        <div class="status"><span class="dot ${s.key}"></span>${esc(s.word)}</div>
        <div class="sub">${esc(stateNote(t))}${esc(contacts)}</div>
      </div>
      <div class="end">
        <button class="more-btn" type="button" data-details="${esc(t.id)}" aria-expanded="${open}" aria-controls="details-${esc(t.id)}">${open ? "Close" : "Details"}</button>
      </div>
      ${open ? detailsHtml(t) : ""}
    </div>`;
}

function logsHtml(t) {
  const entry = logsById.get(t.id);
  if (!entry || entry === "loading") return `<p class="note">Loading contact log…</p>`;
  if (entry.error) return `<p class="note err">Could not load the contact log.</p>`;
  if (!entry.logs.length) return `<p class="note">Nobody has contacted this owner through the tag yet.</p>`;
  const shown = entry.all ? entry.logs : entry.logs.slice(0, 5);
  const items = shown.map((l) => {
    const kind = l.action === "message" ? `WhatsApp${l.reason ? ` · ${l.reason}` : ""}` : "Call";
    const bits = [kind, l.status];
    if (l.callDuration != null) bits.push(`${l.callDuration}s`);
    if (l.callResult) bits.push(l.callResult);
    const rec = safeUrl(l.recordingUrl);
    return `<li>${esc(bits.filter(Boolean).join(" · "))}
        <span class="when" title="${esc(fullDate(l.createdAt))}"> · ${esc(ago(l.createdAt))}${l.ipAddress ? ` · IP ${esc(l.ipAddress)}` : ""}</span>
        ${rec ? ` · <a href="${esc(rec)}" target="_blank" rel="noopener">Recording</a>` : ""}</li>`;
  }).join("");
  const more = !entry.all && entry.logs.length > 5
    ? `<button class="link-btn" type="button" data-all-logs="${esc(t.id)}">Show all ${fmtCount(entry.logs.length)}</button>`
    : "";
  return `<ul class="logs">${items}</ul>${more}`;
}

function detailsHtml(t) {
  const s = stateOf(t);
  const item = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  const plan = t.premium
    ? "Premium"
    : `E-Tag · free contact ${t.freeContactUsed ? "used" : "not used yet"}`;
  const sticker = t.mountType === "exterior_surface" ? "Bike · back glue" : "Car · front glue";
  const ownerQuery = t.ownerEmail || t.ownerMobile || t.ownerName || "";

  const actions = [];
  if (t.claimed && ownerQuery) {
    actions.push(`<a class="btn" href="/admin/owners?q=${encodeURIComponent(ownerQuery)}">Open owner</a>`);
  }
  if (s.key === "active") actions.push(`<button class="btn danger" type="button" data-act="off" data-id="${esc(t.id)}">Deactivate</button>`);
  if (s.key === "off") actions.push(`<button class="btn primary" type="button" data-act="on" data-id="${esc(t.id)}">Activate</button>`);
  if (s.key !== "deleted") actions.push(`<button class="btn danger" type="button" data-act="delete" data-id="${esc(t.id)}">Delete tag</button>`);
  const note = noteById.get(t.id);
  const noteHtml = note
    ? `<span class="note${note.err ? " err" : ""}" role="status">${esc(note.text)}</span>`
    : s.key === "deleted" ? `<span class="note">Deleted tags stay inactive.</span>` : "";

  return `<div class="details" id="details-${esc(t.id)}">
      <dl class="facts">
        ${item("E-Tag ID", t.etagId)}
        ${item("Plan", plan)}
        ${item("Sticker type", sticker)}
        ${item("Added", fullDate(t.createdAt))}
        ${t.claimed ? item("Activated", fullDate(t.activatedAt)) : ""}
        ${t.deletedAt ? item("Deleted", fullDate(t.deletedAt)) : ""}
        ${t.ownerEmail ? item("Owner email", t.ownerEmail) : ""}
      </dl>
      ${t.claimed || t.contactCount ? `<div><p class="section-title">Contact log</p>${logsHtml(t)}</div>` : ""}
      ${actions.length || noteHtml ? `<div class="actions">${actions.join("")}${noteHtml}</div>` : ""}
    </div>`;
}

function paint() {
  rowsEl.innerHTML = current.map(rowHtml).join("");
}

// ── Loading the list ──
// 100 tags a page, numbered; the server decides what is on each page, so a
// search always looks through every tag, not just the page on screen.
const pagerEl = document.getElementById("pager");
let page = 1;

function filterParams() {
  const p = new URLSearchParams();
  const q = qInput.value.trim();
  if (q) p.set("q", q);
  if (claim !== "claimed") p.set("claim", claim);
  if (categorySel.value !== "all") p.set("category", categorySel.value);
  if (statusSel.value) p.set("status", statusSel.value);
  if (batchSel.value) p.set("batch", batchSel.value);
  return p;
}
function filtersAreSet() {
  return [...filterParams().keys()].length > 0;
}

let requestId = 0;
async function load() {
  const view = filterParams();
  if (page > 1) view.set("page", String(page));
  // The address bar keeps the view, so a refresh or a shared link shows the same list.
  history.replaceState(null, "", view.toString() ? `?${view}` : location.pathname);

  const api = new URLSearchParams();
  for (const [k, v] of view) {
    if (k === "status" && v === "deleted") api.set("includeDeleted", "1");
    else api.set(k, v);
  }

  // The CSV covers the whole batch, not just the rows shown here.
  batchCsv.hidden = !batchSel.value;
  if (batchSel.value) batchCsv.href = `/api/admin/tag-batches/${encodeURIComponent(batchSel.value)}/export.csv`;

  const mine = ++requestId;
  let data;
  try {
    const res = await fetch(`/api/admin/etags?${api}`);
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
  } catch {
    if (mine !== requestId) return;
    summaryEl.textContent = "";
    renderPager(pagerEl, { page: 1, pages: 1 });
    rowsEl.innerHTML = `<div class="empty">Could not load tags.<br><button class="btn" type="button" data-retry>Try again</button></div>`;
    return;
  }
  if (mine !== requestId) return; // a newer search is already on its way

  current = data.etags || [];
  const ids = new Set(current.map((t) => t.id));
  for (const id of openDetails) if (!ids.has(id)) openDetails.delete(id);

  // The server clamps a page past the end to the last one; follow it.
  if (Number(data.page) !== page) {
    page = Number(data.page) || 1;
    const fixed = filterParams();
    if (page > 1) fixed.set("page", String(page));
    history.replaceState(null, "", fixed.toString() ? `?${fixed}` : location.pathname);
  }
  const total = Number(data.total || 0);
  const size = Number(data.pageSize) || 100;
  const from = (page - 1) * size + 1;
  summaryEl.textContent = Number(data.pages) > 1
    ? `Showing ${fmtCount(from)}–${fmtCount(from + current.length - 1)} of ${fmtCount(total)} tags`
    : plural(total, "tag");
  renderPager(pagerEl, data, goToPage);

  if (!current.length) {
    rowsEl.innerHTML = filtersAreSet()
      ? `<div class="empty">No tags match these filters.<br><button class="btn" type="button" data-clear>Clear filters</button></div>`
      : `<div class="empty">No tags yet.</div>`;
    return;
  }
  paint();
}

function goToPage(n) {
  page = n;
  load().then(() => document.getElementById("list").scrollIntoView({ block: "start" }));
}
// Any new search or filter starts again from page 1.
function reload() {
  page = 1;
  load();
}

let timer;
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(reload, 250); }

function setClaim(value) {
  claim = CLAIMS.includes(value) ? value : "claimed";
  for (const chip of claimChips.querySelectorAll("[data-claim]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.claim === claim));
  }
}

// ── Details and actions ──
async function loadLogs(id) {
  if (logsById.has(id) && logsById.get(id) !== "loading") return;
  logsById.set(id, "loading");
  try {
    const res = await fetch(`/api/admin/etags/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error();
    logsById.set(id, { logs: data.logs || [] });
  } catch {
    logsById.set(id, { error: true });
  }
  if (openDetails.has(id)) paint();
}

// Resolves true only when the admin presses the confirm button.
function confirmAction({ title, text, ok }) {
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmText").textContent = text;
  const okBtn = document.getElementById("confirmOk");
  okBtn.textContent = ok;
  okBtn.className = "btn danger-solid";
  confirmDialog.returnValue = "";
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "ok"), { once: true });
  });
}

function describe(t) {
  const who = t.ownerName || "the owner";
  const what = t.plateNumber ? `${t.serial || t.etagId} (${t.plateNumber})` : t.serial || t.etagId;
  return { who, what };
}

async function runAction(btn) {
  const t = current.find((x) => x.id === btn.dataset.id);
  if (!t) return;
  const { who, what } = describe(t);
  const act = btn.dataset.act;

  let request;
  if (act === "off") {
    const ok = await confirmAction({
      title: "Deactivate this tag?",
      text: `Scans of ${what} will stop reaching ${who} until it's activated again.`,
      ok: "Deactivate"
    });
    if (!ok) return;
    request = fetch(`/api/admin/etags/${encodeURIComponent(t.id)}/status`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "inactive" })
    });
  } else if (act === "on") {
    request = fetch(`/api/admin/etags/${encodeURIComponent(t.id)}/status`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "active" })
    });
  } else if (act === "delete") {
    const ok = await confirmAction({
      title: "Delete this tag?",
      text: t.claimed
        ? `${what} will be deactivated and hidden from ${who}, and any documents stored for this vehicle will be permanently erased. This can't be undone.`
        : `${what} will be removed from stock. This can't be undone.`,
      ok: "Delete tag"
    });
    if (!ok) return;
    request = fetch(`/api/admin/etags/${encodeURIComponent(t.id)}`, { method: "DELETE" });
  } else {
    return;
  }

  btn.disabled = true;
  noteById.delete(t.id);
  try {
    const res = await request;
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    noteById.set(t.id, { text: act === "delete" ? "Deleted." : act === "off" ? "Deactivated." : "Activated." });
    await load();
    // A deleted tag drops out of the default view, so say so where the row was counted.
    if (!current.some((x) => x.id === t.id)) summaryEl.textContent += ` · Deleted ${what}.`;
  } catch (error) {
    noteById.set(t.id, { text: error.message || "Something went wrong.", err: true });
    paint();
  }
}

rowsEl.addEventListener("click", (e) => {
  const details = e.target.closest("[data-details]");
  if (details) {
    const id = details.dataset.details;
    if (openDetails.has(id)) {
      openDetails.delete(id);
      noteById.delete(id);
    } else {
      openDetails.add(id);
      const t = current.find((x) => x.id === id);
      if (t && (t.claimed || t.contactCount)) loadLogs(id);
    }
    paint();
    return;
  }
  const all = e.target.closest("[data-all-logs]");
  if (all) {
    const entry = logsById.get(all.dataset.allLogs);
    if (entry && entry.logs) { entry.all = true; paint(); }
    return;
  }
  const act = e.target.closest("button[data-act]");
  if (act) { runAction(act); return; }
  if (e.target.closest("[data-retry]")) { load(); return; }
  if (e.target.closest("[data-clear]")) {
    qInput.value = "";
    setClaim("claimed");
    categorySel.value = "all";
    statusSel.value = "";
    batchSel.value = "";
    reload();
  }
});

claimChips.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-claim]");
  if (!chip || chip.dataset.claim === claim) return;
  setClaim(chip.dataset.claim);
  reload();
});
qInput.addEventListener("input", debouncedLoad);
for (const sel of [categorySel, statusSel, batchSel]) sel.addEventListener("change", reload);

// Links arrive as ?batch=<key>&claim=all (Issuance), ?q=<serial> (Owners) and
// ?claim=unclaimed&category=premium (Overview). Only values the controls offer
// apply; anything else falls back to the default.
async function init() {
  const url = new URLSearchParams(location.search);
  setClaim(url.get("claim") || "claimed");
  const pick = (sel, value) => {
    if ([...sel.options].some((o) => o.value === value)) sel.value = value;
  };
  pick(categorySel, url.get("category") || "all");
  pick(statusSel, url.get("status") || "");
  if (url.get("includeDeleted") === "1" && !statusSel.value) statusSel.value = "deleted";
  qInput.value = (url.get("q") || "").trim().slice(0, 100);
  const wantedPage = Number.parseInt(url.get("page") || "1", 10);
  page = Number.isFinite(wantedPage) && wantedPage >= 1 ? wantedPage : 1;

  try {
    const res = await fetch("/api/admin/tag-batches");
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    const data = await res.json();
    for (const b of (res.ok && data.batches) || []) {
      const opt = document.createElement("option");
      opt.value = b.key;
      opt.textContent = `Batch ${b.key}${b.labels.length ? ` · ${b.labels.join(", ")}` : ""} (${b.activated}/${b.total} activated)`;
      batchSel.append(opt);
    }
  } catch { /* the filter stays at "All batches"; the list still loads */ }

  pick(batchSel, url.get("batch") || "");
  load();
}
init();
