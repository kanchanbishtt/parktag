// ── Vehicle document vault page ────────────────────────────────────────────
//
// A DigiLocker-style page for one vehicle's paperwork: a grid of cards the
// owner can open, rename, re-file and delete, plus the upload form.
//
// A full page rather than a sheet because this is somewhere people come to look
// things up — it wants a back button, a URL you can return to, and room to show
// a document large enough to read at a police stop.
//
// Owner-only. The page itself needs an owner session (see /owner-documents in
// app.js) and every document call needs the vault PIN on top of that. Nothing
// here is reachable from a tag scan.

const params = new URLSearchParams(location.search);
const tagId = params.get("id") || "";

const TYPE_LABELS = {
  rc: "Registration (RC)",
  insurance: "Insurance",
  puc: "PUC / Emission",
  licence: "Driving licence",
  other: "Other"
};

// Thumbnails are generated here, in the browser, and uploaded alongside the
// file. Painting a grid from the documents themselves would mean downloading up
// to 30MB of photos to draw one screen; a canvas-scaled JPEG is a few KB.
const THUMB_MAX_EDGE = 320;
const THUMB_QUALITY = 0.7;

const els = {
  body: document.getElementById("dv-body"),
  err: document.getElementById("dv-err"),
  ok: document.getElementById("dv-ok"),
  vehicle: document.getElementById("dv-vehicle"),
  lockBtn: document.getElementById("dv-lock"),
  ov: document.getElementById("dv-ov"),
  ovTitle: document.getElementById("dv-ov-title"),
  ovBody: document.getElementById("dv-ov-body")
};

let limits = null;
let documents = [];

// Labels are owner-supplied free text and go in via innerHTML.
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtSize(bytes) {
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function showError(message) {
  els.err.textContent = message || "";
  els.err.classList.toggle("dv-show", Boolean(message));
  if (message) els.ok.classList.remove("dv-show");
}

function showOk(message) {
  els.ok.textContent = message || "";
  els.ok.classList.toggle("dv-show", Boolean(message));
  if (message) {
    els.err.classList.remove("dv-show");
    setTimeout(() => els.ok.classList.remove("dv-show"), 3000);
  }
}

async function api(path, options) {
  const res = await fetch(`/api/owner/vault${path}`, options || {});
  let data = {};
  try { data = await res.json(); } catch (_) { data = {}; }
  return { status: res.status, data };
}

const ICON_DOC = '<svg class="dv-fallback" viewBox="0 0 24 24" fill="none"><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="1.7"/></svg>';

// ── PIN states ─────────────────────────────────────────────────────────────

function digitsOnly(input) {
  input.addEventListener("input", function () {
    this.value = this.value.replace(/[^0-9]/g, "");
  });
}

function renderSetPin() {
  els.lockBtn.classList.remove("dv-on");
  els.body.innerHTML = `
    <div class="dv-card">
      <div class="dv-lock-ic">${ICON_LOCK}</div>
      <h2>Protect your documents</h2>
      <p class="dv-hint">Create a PIN for this vault. You'll enter it each time you open your papers, so they stay private even if your phone is unlocked.</p>
      <div class="dv-f"><label for="dv-pin1">New PIN (4-8 digits)</label>
        <input class="dv-pin" id="dv-pin1" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></div>
      <div class="dv-f"><label for="dv-pin2">Confirm PIN</label>
        <input class="dv-pin" id="dv-pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></div>
      <button class="dv-primary" id="dv-save-pin">Create PIN</button>
    </div>`;

  const pin1 = document.getElementById("dv-pin1");
  const pin2 = document.getElementById("dv-pin2");
  const btn = document.getElementById("dv-save-pin");
  digitsOnly(pin1); digitsOnly(pin2);
  pin1.focus();

  btn.addEventListener("click", async () => {
    showError("");
    if (!/^\d{4,8}$/.test(pin1.value)) { showError("PIN must be 4 to 8 digits."); return; }
    if (pin1.value !== pin2.value) { showError("Both PINs must match."); return; }
    btn.disabled = true;
    const r = await api("/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: pin1.value })
    });
    btn.disabled = false;
    if (r.status !== 200) { showError(r.data.error || "Could not save your PIN."); return; }
    loadDocuments();
  });
}

function renderUnlock() {
  els.lockBtn.classList.remove("dv-on");
  els.body.innerHTML = `
    <div class="dv-card">
      <div class="dv-lock-ic">${ICON_LOCK}</div>
      <h2>Enter your vault PIN</h2>
      <p class="dv-hint">Your documents are locked.</p>
      <div class="dv-f"><label for="dv-pin">PIN</label>
        <input class="dv-pin" id="dv-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></div>
      <button class="dv-primary" id="dv-unlock">Unlock</button>
    </div>`;

  const pin = document.getElementById("dv-pin");
  const btn = document.getElementById("dv-unlock");
  digitsOnly(pin);
  pin.focus();
  pin.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });

  btn.addEventListener("click", async () => {
    showError("");
    btn.disabled = true;
    const r = await api("/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: pin.value })
    });
    btn.disabled = false;
    if (r.status === 200) { loadDocuments(); return; }
    pin.value = "";
    showError(r.data.error || "Incorrect PIN.");
  });
}

// ── Document grid ──────────────────────────────────────────────────────────

function docCard(d) {
  const preview = d.thumb
    ? `<img src="${esc(d.thumb)}" alt="">`
    : ICON_DOC;
  return `
    <div class="dv-doc">
      <div class="dv-doc-thumb" data-view="${esc(d.id)}" role="button" tabindex="0" aria-label="View ${esc(d.label)}">
        <span class="dv-chip">${esc(d.docType)}</span>
        ${preview}
      </div>
      <div class="dv-doc-body">
        <p class="dv-doc-name" title="${esc(d.label)}">${esc(d.label)}</p>
        <p class="dv-doc-meta">${fmtSize(d.size)} &middot; ${fmtDate(d.createdAt)}</p>
        <div class="dv-doc-acts">
          <button class="dv-act" data-edit="${esc(d.id)}">Edit</button>
          <button class="dv-act dv-danger" data-del="${esc(d.id)}">Delete</button>
        </div>
      </div>
    </div>`;
}

function renderList(usedBytes) {
  els.lockBtn.classList.add("dv-on");

  const quotaMb = limits ? Math.round(limits.maxBytesPerOwner / (1024 * 1024)) : 40;
  const grid = documents.length
    ? `<div class="dv-grid">${documents.map(docCard).join("")}</div>`
    : `<div class="dv-empty">No documents yet.<br>Add your RC or insurance so it's with you when you need it.</div>`;

  els.body.innerHTML = `
    ${grid}
    <div class="dv-card">
      <h2 style="text-align:left;margin-bottom:14px">Add a document</h2>
      <div class="dv-f"><label for="dv-type">Document type</label>
        <select id="dv-type">${Object.keys(TYPE_LABELS).map((k) => `<option value="${k}">${TYPE_LABELS[k]}</option>`).join("")}</select></div>
      <div class="dv-f"><label for="dv-label">Name (optional)</label>
        <input id="dv-label" type="text" maxlength="60" placeholder="e.g. RC front"></div>
      <div class="dv-f"><label for="dv-file">File (PDF, JPG, PNG or WEBP)</label>
        <input id="dv-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>
      <button class="dv-primary" id="dv-add">Add document</button>
    </div>
    <p class="dv-quota">Using ${fmtSize(usedBytes)} of ${quotaMb} MB &middot; up to ${limits ? limits.maxDocsPerVehicle : 6} documents per vehicle</p>`;

  els.body.querySelectorAll("[data-view]").forEach((n) => {
    const open = () => openViewer(n.getAttribute("data-view"));
    n.addEventListener("click", open);
    n.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  els.body.querySelectorAll("[data-edit]").forEach((n) =>
    n.addEventListener("click", () => openEditor(n.getAttribute("data-edit"))));
  els.body.querySelectorAll("[data-del]").forEach((n) =>
    n.addEventListener("click", () => removeDocument(n.getAttribute("data-del"))));
  document.getElementById("dv-add").addEventListener("click", addDocument);
}

async function loadDocuments() {
  showError("");
  els.body.innerHTML = `<div class="dv-empty">Loading…</div>`;
  const r = await api(`/documents?tagId=${encodeURIComponent(tagId)}`);
  // 423 means the grant lapsed between screens — go back to the PIN prompt
  // rather than showing an error the owner can do nothing about.
  if (r.status === 423) { renderUnlock(); return; }
  if (r.status !== 200) {
    els.body.innerHTML = "";
    showError(r.data.error || "Could not load your documents.");
    return;
  }
  documents = r.data.documents || [];
  renderList(r.data.usedBytes || 0);
}

// ── Viewer ─────────────────────────────────────────────────────────────────

function closeOverlay() {
  els.ov.classList.remove("dv-open");
  document.body.style.overflow = "";
}

function openOverlay(title, html) {
  els.ovTitle.textContent = title;
  els.ovBody.innerHTML = html;
  els.ov.classList.add("dv-open");
  document.body.style.overflow = "hidden";
}

function openViewer(docId) {
  const d = documents.find((x) => x.id === docId);
  if (!d) return;
  const url = `/api/owner/vault/documents/${encodeURIComponent(d.id)}/file`;

  // Images render here at full size. PDFs deliberately do not: the app's CSP
  // has no `frame-src 'self'`, so a browser would refuse to paint one in an
  // iframe — the link downloads it and hands it to the device's PDF viewer.
  openOverlay(d.label, d.viewable
    ? `<img id="dv-view-img" src="${url}" alt="${esc(d.label)}">`
    : `<div class="dv-pdf-note">This is a PDF. Open it to view in your device's document viewer.</div>
       <a class="dv-primary" style="display:block;text-align:center;text-decoration:none" href="${url}" target="_blank" rel="noopener">Open PDF</a>`);
}

// ── Edit ───────────────────────────────────────────────────────────────────

function openEditor(docId) {
  const d = documents.find((x) => x.id === docId);
  if (!d) return;

  openOverlay(`Edit ${d.label}`, `
    <div class="dv-f"><label for="dv-edit-type">Document type</label>
      <select id="dv-edit-type">${Object.keys(TYPE_LABELS)
        .map((k) => `<option value="${k}"${k === d.docType ? " selected" : ""}>${TYPE_LABELS[k]}</option>`)
        .join("")}</select></div>
    <div class="dv-f"><label for="dv-edit-label">Name</label>
      <input id="dv-edit-label" type="text" maxlength="60" value="${esc(d.label)}"></div>
    <button class="dv-primary" id="dv-edit-save">Save changes</button>
    <button class="dv-secondary" id="dv-edit-cancel">Cancel</button>
    <p class="dv-quota" style="margin-top:14px">To replace the file itself, delete this document and add it again.</p>`);

  document.getElementById("dv-edit-cancel").addEventListener("click", closeOverlay);
  document.getElementById("dv-edit-save").addEventListener("click", async () => {
    const btn = document.getElementById("dv-edit-save");
    btn.disabled = true;
    const r = await api(`/documents/${encodeURIComponent(docId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        docType: document.getElementById("dv-edit-type").value,
        label: document.getElementById("dv-edit-label").value
      })
    });
    btn.disabled = false;
    if (r.status === 423) { closeOverlay(); renderUnlock(); return; }
    if (r.status !== 200) { showError(r.data.error || "Could not save your changes."); closeOverlay(); return; }
    closeOverlay();
    showOk("Document updated.");
    loadDocuments();
  });
}

// ── Upload ─────────────────────────────────────────────────────────────────

// Draw the picked image into a canvas at thumbnail size and read it back as a
// small JPEG. Resolves to null for PDFs, and for anything the browser cannot
// decode — the card then falls back to a type icon, which is only cosmetic.
function makeThumbnail(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { resolve(null); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", THUMB_QUALITY));
      } catch (_) {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function addDocument() {
  const typeEl = document.getElementById("dv-type");
  const labelEl = document.getElementById("dv-label");
  const fileEl = document.getElementById("dv-file");
  const btn = document.getElementById("dv-add");

  showError("");
  if (!fileEl.files || !fileEl.files.length) { showError("Choose a file to upload."); return; }

  const file = fileEl.files[0];
  if (limits && file.size > limits.maxFileBytes) {
    showError(`Each document must be under ${Math.floor(limits.maxFileBytes / (1024 * 1024))}MB.`);
    return;
  }

  btn.disabled = true;
  btn.textContent = "Uploading…";

  const thumb = await makeThumbnail(file);

  // Order matters: the server reads these text fields off the multipart stream
  // as they arrive, so they must all be appended BEFORE the file part.
  const form = new FormData();
  form.append("tagId", tagId);
  form.append("docType", typeEl.value);
  form.append("label", labelEl.value);
  if (thumb) form.append("thumb", thumb);
  form.append("file", file);

  const r = await api("/documents", { method: "POST", body: form });
  btn.disabled = false;
  btn.textContent = "Add document";

  if (r.status === 423) { renderUnlock(); return; }
  if (r.status !== 200) { showError(r.data.error || "Could not save the document."); return; }
  showOk("Document added.");
  loadDocuments();
}

async function removeDocument(docId) {
  const d = documents.find((x) => x.id === docId);
  if (!window.confirm(`Delete "${d ? d.label : "this document"}"? This cannot be undone.`)) return;
  const r = await api(`/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
  if (r.status === 423) { renderUnlock(); return; }
  if (r.status !== 200) { showError(r.data.error || "Could not delete the document."); return; }
  showOk("Document deleted.");
  loadDocuments();
}

// ── Boot ───────────────────────────────────────────────────────────────────

els.ov.addEventListener("click", (e) => { if (e.target === els.ov) closeOverlay(); });
document.getElementById("dv-ov-x").addEventListener("click", closeOverlay);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.ov.classList.contains("dv-open")) closeOverlay();
});

els.lockBtn.addEventListener("click", async () => {
  await api("/lock", { method: "POST" });
  showOk("");
  showError("");
  renderUnlock();
});

// Name the vehicle from the dashboard rather than the query string, so the
// heading always matches what the account actually holds.
async function showVehicleName() {
  try {
    const res = await fetch("/api/owner/dashboard");
    if (!res.ok) return;
    const data = await res.json();
    const tag = (data.tags || []).find((t) => String(t.id) === tagId);
    if (!tag) return;
    els.vehicle.textContent = tag.plateNumber || tag.vehicleLabel || "Vehicle";
    els.vehicle.hidden = false;
  } catch (_) {
    // Cosmetic only — the documents load regardless.
  }
}

async function start() {
  if (!tagId) {
    showError("No vehicle selected. Open your documents from the vehicle's page.");
    return;
  }
  showVehicleName();

  const r = await api("/status");
  if (r.status === 401) { window.location.href = "/owner-login"; return; }
  if (r.status !== 200) {
    els.body.innerHTML = "";
    showError(r.data.error || "Could not open your documents.");
    return;
  }
  limits = r.data.limits || null;
  if (!r.data.hasPin) { renderSetPin(); return; }
  if (!r.data.unlocked) { renderUnlock(); return; }
  loadDocuments();
}

start();
