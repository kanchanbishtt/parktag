const rows = document.getElementById("rows");
const summary = document.getElementById("summary");
const qInput = document.getElementById("q");
const statusSel = document.getElementById("status");
const inclDel = document.getElementById("includeDeleted");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

let timer;
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 250); }

async function load() {
  const params = new URLSearchParams();
  if (qInput.value.trim()) params.set("q", qInput.value.trim());
  if (statusSel.value) params.set("status", statusSel.value);
  if (inclDel.checked) params.set("includeDeleted", "1");

  rows.innerHTML = `<tr><td colspan="8" class="empty">Loading…</td></tr>`;
  let data;
  try {
    const res = await fetch(`/api/admin/etags?${params.toString()}`);
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
  } catch (e) {
    rows.innerHTML = `<tr><td colspan="8" class="err">Could not load E-Tags.</td></tr>`;
    summary.textContent = "";
    return;
  }

  const list = data.etags || [];
  summary.textContent = `Showing ${list.length} of ${data.total} E-Tag(s)`;
  if (!list.length) {
    rows.innerHTML = `<tr><td colspan="8" class="empty">No E-Tags found.</td></tr>`;
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
    return `<tr>
      <td><b>${esc(t.etagId)}</b></td>
      <td><span class="plate">${esc(t.plateNumber || "—")}</span><br><span class="muted">${esc(t.vehicleLabel || t.vehicleType || "")}</span></td>
      <td>${esc(t.ownerName || "—")}<br><span class="muted">${esc(t.ownerEmail || t.ownerMobile || "")}</span></td>
      <td>${statusPill}</td>
      <td>${planPill}</td>
      <td>${t.contactCount}</td>
      <td class="muted">${fmtDate(t.createdAt)}</td>
      <td><div class="act">${actions}</div></td>
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
    return `<div class="log">
      <b>${kind}</b> — ${esc(l.status)}${dur}${result}<br>
      <span class="muted">${fmtDate(l.createdAt)}${l.ipAddress ? " · IP " + esc(l.ipAddress) : ""}</span>
      ${l.recordingUrl ? `<br><a href="${esc(l.recordingUrl)}" target="_blank" rel="noopener">Recording</a>` : ""}
    </div>`;
  }).join("");
}

qInput.addEventListener("input", debouncedLoad);
statusSel.addEventListener("change", load);
inclDel.addEventListener("change", load);
load();
