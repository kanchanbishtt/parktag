const rows = document.getElementById("rows");
const summary = document.getElementById("summary");
const qInput = document.getElementById("q");
const statusSel = document.getElementById("status");
const categorySel = document.getElementById("category");
const inclDel = document.getElementById("includeDeleted");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// Only allow http(s) links in an href. esc() neutralises markup but NOT the URL
// scheme, so a `javascript:`/`data:` recordingUrl would still execute on click.
function safeUrl(u) {
  const s = String(u == null ? "" : u).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}
function fmtDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}
// Date and time on separate lines. As one nowrap string the Created column ran
// to 164px — with nine columns that was enough to push the table past its card
// and clip the Delete button off the right edge.
function fmtStamp(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return `${esc(d.toLocaleDateString())}<br><span class="muted">${esc(d.toLocaleTimeString())}</span>`;
  } catch { return esc(s); }
}

let timer;
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 250); }

async function load() {
  const params = new URLSearchParams();
  if (qInput.value.trim()) params.set("q", qInput.value.trim());
  if (statusSel.value) params.set("status", statusSel.value);
  // "all" is the default, so it is left off the query entirely rather than
  // sent as a value the server would have to recognise and ignore.
  if (categorySel.value && categorySel.value !== "all") params.set("category", categorySel.value);
  if (inclDel.checked) params.set("includeDeleted", "1");

  rows.innerHTML = `<tr><td colspan="9" class="empty">Loading…</td></tr>`;
  let data;
  try {
    const res = await fetch(`/api/admin/etags?${params.toString()}`);
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
  } catch (e) {
    rows.innerHTML = `<tr><td colspan="9" class="err">Could not load tags.</td></tr>`;
    summary.textContent = "";
    return;
  }

  const list = data.etags || [];
  summary.textContent = `Showing ${list.length} of ${data.total} tag(s)`;
  if (!list.length) {
    rows.innerHTML = `<tr><td colspan="9" class="empty">No tags found.</td></tr>`;
    return;
  }

  rows.innerHTML = list.map((t) => {
    const statusPill = t.deletedAt
      ? `<span class="pill del">deleted</span>`
      : `<span class="pill ${t.status === "active" ? "active" : "inactive"}">${esc(t.status)}</span>`;
    const planPill = t.premium
      ? `<span class="pill premium">Premium</span>`
      : `<span class="pill free">Free${t.freeContactUsed ? " · used" : ""}</span>`;
    const toggleLabel = t.status === "active" ? "Deactivate" : "Activate";
    const toggleTo = t.status === "active" ? "inactive" : "active";
    const actions = t.deletedAt
      ? `<button class="go" data-act="status" data-id="${t.id}" data-to="active">Restore</button>`
      : `<button data-act="logs" data-id="${t.id}">Logs</button>
         <button data-act="status" data-id="${t.id}" data-to="${toggleTo}">${toggleLabel}</button>
         <button class="danger" data-act="delete" data-id="${t.id}">Delete</button>`;
    // data-label feeds the `td::before` labels the narrow-screen card layout
    // renders once the header row is hidden (see the @media block in etags.html).
    return `<tr>
      <td data-label="E-Tag ID"><b>${esc(t.etagId)}</b></td>
      <td data-label="Sticker serial">${t.serial ? `<b>${esc(t.serial)}</b>` : `<span class="muted">—</span>`}</td>
      <td data-label="Vehicle"><span class="plate">${esc(t.plateNumber || "—")}</span><br><span class="muted">${esc(t.vehicleLabel || t.vehicleType || "")}</span></td>
      <td data-label="Owner">${esc(t.ownerName || "—")}<br><span class="muted">${esc(t.ownerEmail || t.ownerMobile || "")}</span></td>
      <td data-label="Status">${statusPill}</td>
      <td data-label="Plan">${planPill}</td>
      <td data-label="Contacts">${t.contactCount}</td>
      <td data-label="Created" class="muted stamp">${fmtStamp(t.createdAt)}</td>
      <td data-label="Actions"><div class="act">${actions}</div></td>
    </tr>`;
  }).join("");
}

rows.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;

  if (act === "logs") return openLogs(id);

  if (act === "status") {
    btn.disabled = true;
    await fetch(`/api/admin/etags/${id}/status`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: btn.dataset.to })
    });
    load();
    return;
  }

  if (act === "delete") {
    if (!confirm("Soft-delete this E-Tag? It will be hidden from the owner and deactivated.")) return;
    btn.disabled = true;
    await fetch(`/api/admin/etags/${id}`, { method: "DELETE" });
    load();
  }
});

// ── Logs modal ──
const overlay = document.getElementById("overlay");
document.getElementById("closeModal").addEventListener("click", () => overlay.classList.remove("open"));
overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });

async function openLogs(id) {
  const mLogs = document.getElementById("mLogs");
  mLogs.innerHTML = "Loading…";
  overlay.classList.add("open");
  let data;
  try {
    const res = await fetch(`/api/admin/etags/${id}`);
    data = await res.json();
    if (!res.ok) throw new Error();
  } catch { mLogs.innerHTML = "Could not load logs."; return; }

  const t = data.etag;
  document.getElementById("mTitle").textContent = `${t.etagId} · ${t.plateNumber || ""}`;
  document.getElementById("mSub").textContent =
    `${t.premium ? "Premium" : "Free"} · ${t.status} · ${t.contactAttempts} contact attempt(s) · owner ${t.owner?.email || t.owner?.mobile || "—"}`;

  if (!data.logs.length) { mLogs.innerHTML = `<p class="muted">No contact logs yet.</p>`; return; }
  mLogs.innerHTML = data.logs.map((l) => {
    const kind = l.action === "message" ? `WhatsApp${l.reason ? " · " + esc(l.reason) : ""}` : "Call";
    const dur = l.callDuration != null ? ` · ${l.callDuration}s` : "";
    const result = l.callResult ? ` · ${esc(l.callResult)}` : "";
    const rec = safeUrl(l.recordingUrl);
    return `<div class="log">
      <b>${kind}</b> · ${esc(l.status)}${dur}${result}<br>
      <span class="muted">${fmtDate(l.createdAt)}${l.ipAddress ? " · IP " + esc(l.ipAddress) : ""}</span>
      ${rec ? `<br><a href="${esc(rec)}" target="_blank" rel="noopener">Recording</a>` : ""}
    </div>`;
  }).join("");
}

qInput.addEventListener("input", debouncedLoad);
statusSel.addEventListener("change", load);
categorySel.addEventListener("change", load);
inclDel.addEventListener("change", load);
load();
