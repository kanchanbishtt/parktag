// The Tag Reports page: what scanners flagged, open first, with the sticker
// and owner it concerns and the reporter to call back. Resolving records who,
// when and an optional note; nothing is ever deleted.
const list = document.getElementById("reports");
const chips = document.getElementById("chips");
const search = document.getElementById("q");
const pager = document.getElementById("pager");

let status = "open";
let page = 1;
let counts = { open: 0, resolved: 0, total: 0 };
let requestSeq = 0;

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
function digits(phone) { return String(phone || "").replace(/\D/g, ""); }
function fmt(n) { return Number(n || 0).toLocaleString("en-IN"); }
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// The rows on screen, kept so opening or closing a resolve form can redraw
// without another request.
let rows = [];
let lastQuery = "";
function render() {
  list.innerHTML = rows.length
    ? rows.map(reportHtml).join("")
    : `<p class="empty">${lastQuery ? "No reports match your search." : status === "open" ? "No open reports. Nothing to act on." : "No reports yet."}</p>`;
}

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" }
];

function renderChips() {
  chips.innerHTML = FILTERS.map((f) =>
    `<button class="chip" type="button" data-status="${f.key}" aria-pressed="${f.key === status}">${f.label}<span class="n">${fmt(counts[f.key === "all" ? "total" : f.key])}</span></button>`
  ).join("");
}

// One colour per reason, so two reasons never read the same at a glance.
function reasonPill(r) {
  const tone = ["abuse", "sold", "no_answer", "wrong_number"].includes(r.reason) ? ` ${r.reason}` : "";
  return `<span class="pill${tone}">${esc(r.reasonLabel)}</span>`;
}

function tagHtml(r) {
  if (!r.tag) return `<p class="meta">Sticker no longer exists</p>`;
  const t = r.tag;
  const state = t.status && t.status !== "active" ? `<span class="pill tagstate">${esc(t.status)}</span>` : "";
  const q = t.serial || t.plateNumber || "";
  return `
    <p class="main"><a href="/admin/etags?q=${encodeURIComponent(q)}">${esc(t.plateNumber || "No plate")}</a>${state}</p>
    <p class="meta">${esc(t.serial || "No serial")}${t.vehicleLabel ? ` · ${esc(t.vehicleLabel)}` : ""}${t.premium ? " · Premium" : ""}</p>`;
}

function ownerHtml(r) {
  if (!r.owner) return `<p class="meta">No owner on this sticker</p>`;
  const o = r.owner;
  return `
    <p class="main">${esc(o.name || "Unnamed owner")}</p>
    <p class="meta">${o.mobile ? `<a href="tel:+${esc(digits(o.mobile))}">${esc(o.mobile)}</a>` : esc(o.email || "No phone or email")}</p>`;
}

function reporterHtml(r) {
  return `
    <p class="main">${esc(r.reporterName || "Unnamed")}</p>
    <p class="meta">${r.reporterPhone ? `<a href="tel:+${esc(digits(r.reporterPhone))}">${esc(r.reporterPhone)}</a>` : "No number"}</p>`;
}

// Reports whose resolve form is open (tapped "Resolve"). Everything else shows
// the two contact buttons and one Resolve button, so a page of open reports
// stays a list rather than a stack of forms.
const resolving = new Set();

function actionsHtml(r) {
  const d = digits(r.reporterPhone);
  const contact = r.reporterPhone
    ? `<div class="btns">
         <a class="btn wa" href="https://wa.me/${esc(d)}" target="_blank" rel="noopener">WhatsApp</a>
         <a class="btn call" href="tel:+${esc(d)}">Call</a>
       </div>`
    : "";
  if (r.status === "resolved") {
    return `${contact}<button class="btn ghost" type="button" data-reopen="${esc(r.id)}">Reopen</button>`;
  }
  if (!resolving.has(r.id)) {
    return `${contact}<button class="btn" type="button" data-open-resolve="${esc(r.id)}">Resolve</button>`;
  }
  return `${contact}
    <textarea class="note" data-note-for="${esc(r.id)}" placeholder="What was done (optional)" maxlength="500"></textarea>
    <button class="btn" type="button" data-resolve="${esc(r.id)}">Mark resolved</button>
    <button class="btn ghost" type="button" data-cancel-resolve="${esc(r.id)}">Cancel</button>
    <div data-err-for="${esc(r.id)}"></div>`;
}

function reportHtml(r) {
  const resolved = r.status === "resolved";
  return `
    <div class="report${resolved ? " is-resolved" : ""}" data-id="${esc(r.id)}">
      <div>
        <div class="label">Report</div>
        <p>${reasonPill(r)}${resolved ? `<span class="pill resolved">Resolved</span>` : ""}</p>
        <p class="meta" title="${esc(fmtDate(r.createdAt))}">${esc(ago(r.createdAt))} · ${esc(fmtDate(r.createdAt))}</p>
        ${r.reportsOnTag > 1 ? `<p class="repeat">${esc(ordinal(r.reportsOnTag))} report on this sticker</p>` : ""}
        ${r.details ? `<div class="details">${esc(r.details)}</div>` : ""}
        ${resolved ? `<p class="resolution">Resolved ${esc(ago(r.resolvedAt))}${r.resolvedBy ? ` by ${esc(r.resolvedBy)}` : ""}${r.note ? ` · ${esc(r.note)}` : ""}</p>` : (r.note ? `<p class="resolution">Note: ${esc(r.note)}</p>` : "")}
      </div>
      <div>
        <div class="label">Reported sticker</div>
        ${tagHtml(r)}
        <div class="label" style="margin-top:8px">Owner</div>
        ${ownerHtml(r)}
      </div>
      <div>
        <div class="label">Reported by</div>
        ${reporterHtml(r)}
      </div>
      <div class="actions">${actionsHtml(r)}</div>
    </div>`;
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
  const params = new URLSearchParams({ status });
  if (page > 1) params.set("page", String(page));
  const q = search.value.trim();
  if (q) params.set("q", q);
  try {
    const res = await fetch(`/api/admin/tag-reports?${params}`, { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    const data = await res.json();
    if (seq !== requestSeq) return;
    if (!res.ok) throw new Error(data.error || "Failed");
    counts = data.counts || counts;
    page = Number(data.page) || 1;
    renderChips();
    renderPager(data);
    rows = data.reports || [];
    lastQuery = q;
    resolving.clear();
    render();
  } catch {
    if (seq !== requestSeq) return;
    list.innerHTML = `<p class="err">Could not load reports.</p>`;
  }
}

async function setStatus(id, next, note) {
  const res = await fetch(`/api/admin/tag-reports/${encodeURIComponent(id)}/status`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note ? { status: next, note } : { status: next })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "Could not update the report.");
}

chips.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-status]");
  if (!chip) return;
  status = chip.dataset.status;
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

list.addEventListener("click", async (event) => {
  const open = event.target.closest("button[data-open-resolve]");
  if (open) {
    resolving.add(open.dataset.openResolve);
    render();
    list.querySelector(`[data-note-for="${CSS.escape(open.dataset.openResolve)}"]`)?.focus();
    return;
  }
  const cancel = event.target.closest("button[data-cancel-resolve]");
  if (cancel) {
    resolving.delete(cancel.dataset.cancelResolve);
    render();
    return;
  }
  const resolve = event.target.closest("button[data-resolve]");
  const reopen = event.target.closest("button[data-reopen]");
  const button = resolve || reopen;
  if (!button) return;
  const id = resolve ? resolve.dataset.resolve : reopen.dataset.reopen;
  const note = resolve ? (list.querySelector(`[data-note-for="${CSS.escape(id)}"]`)?.value || "").trim() : "";
  const errSlot = list.querySelector(`[data-err-for="${CSS.escape(id)}"]`);
  button.disabled = true;
  button.textContent = resolve ? "Saving…" : "Reopening…";
  try {
    await setStatus(id, resolve ? "resolved" : "open", note);
    await load();
  } catch (err) {
    button.disabled = false;
    button.textContent = resolve ? "Mark resolved" : "Reopen";
    if (errSlot) errSlot.innerHTML = `<span class="note-err">${esc(err.message)}</span>`;
  }
});

renderChips();
load();
