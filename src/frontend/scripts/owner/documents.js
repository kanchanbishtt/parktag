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

import { prepareDocument, MAX_DECODE_BYTES } from "./document-compress.js";

const params = new URLSearchParams(location.search);
const tagId = params.get("id") || "";

const TYPE_LABELS = {
  rc: "Registration (RC)",
  insurance: "Insurance",
  puc: "PUC / Emission",
  licence: "Driving licence",
  other: "Other"
};

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
// What THIS vehicle's tag is allowed to keep — { tier, maxDocs, premium,
// subscribed }. Always the server's answer, never derived here: the upload
// route decides the same thing from the same function, and a second copy of
// the rule in the browser is a copy free to disagree with it.
let entitlement = null;

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

function fileUrl(docId) {
  return `/api/owner/vault/documents/${encodeURIComponent(docId)}/file`;
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
const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l.9-3.6a2 2 0 0 1 .5-.9l10-10a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8l-10 10a2 2 0 0 1-.9.5L4 20Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>';

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
  // Preference order, best to worst:
  //  1. the stored thumbnail — a few KB, what new uploads always carry
  //  2. the document itself, lazily — for images with no thumbnail: ones added
  //     before thumbnails existed, or where the browser could not make one.
  //     Heavier, but showing the actual document beats a generic icon, and the
  //     per-vehicle cap bounds how much a screen can pull.
  //  3. an icon — PDFs, which have no bitmap to show without a PDF renderer.
  let preview;
  if (d.thumb) {
    preview = `<img src="${esc(d.thumb)}" alt="">`;
  } else if (d.viewable) {
    preview = `<img src="${fileUrl(d.id)}" alt="" loading="lazy" decoding="async" data-full>`;
  } else {
    preview = ICON_DOC;
  }
  return `
    <div class="dv-doc">
      <div class="dv-doc-media">
        <div class="dv-doc-thumb" data-view="${esc(d.id)}" role="button" tabindex="0" aria-label="View ${esc(d.label)}">
          <span class="dv-chip">${esc(d.docType)}</span>
          ${preview}
        </div>
        <button class="dv-edit-fab" data-edit="${esc(d.id)}" aria-label="Rename ${esc(d.label)}" title="Edit">${ICON_PENCIL}</button>
      </div>
      <div class="dv-doc-body">
        <p class="dv-doc-name" title="${esc(d.label)}">${esc(d.label)}</p>
        <p class="dv-doc-meta">${fmtSize(d.size)} &middot; ${fmtDate(d.createdAt)}</p>
        <div class="dv-doc-acts">
          <button class="dv-act" data-view="${esc(d.id)}">View</button>
          <button class="dv-act dv-danger" data-del="${esc(d.id)}">Delete</button>
        </div>
      </div>
    </div>`;
}

// Where an owner goes to buy the premium tag that would enlarge this vehicle's
// allowance. `replace` carries the tag so the shop opens on the upgrade for
// THIS vehicle rather than a bare product page — see openShopFromQuery in
// scripts/owner/welcome.js.
function upgradeUrl() {
  return `/owner-welcome?shop=1&replace=${encodeURIComponent(tagId)}`;
}

// The card that stands where the upload form goes once the vehicle is full.
//
// An E-Tag owner is shown the way up, because there is one. A premium owner is
// told the plain fact and how to make room — there is nothing to sell them
// today, and inventing a "coming soon" upsell would be worse than silence.
function fullCard(maxDocs) {
  const held = `${maxDocs} document${maxDocs === 1 ? "" : "s"}`;

  if (entitlement && !entitlement.premium) {
    return `
      <div class="dv-card">
        <h2>This vehicle is full</h2>
        <p class="dv-hint">Your E-Tag keeps ${held} for this vehicle. A premium tag keeps up to ${
          limits && limits.tiers ? limits.tiers.premium : 3
        } &mdash; or delete a document to swap it for another.</p>
        <a class="dv-primary dv-linkbtn" href="${upgradeUrl()}">Get a premium tag</a>
      </div>`;
  }
  // Full DURING the free period is the case most worth being straight about:
  // all ten are kept when it ends, but no eleventh — and no further additions
  // — until they subscribe or delete one.
  const daysLeft = trialDaysLeft();
  const premiumMax = limits && limits.tiers ? limits.tiers.premium : 3;
  const trialLine = daysLeft === null
    ? ""
    : `<p class="dv-hint">Your free period has ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. After that this vehicle keeps ${premiumMax} documents unless you subscribe. Everything saved here stays &mdash; you just won't be able to add more.</p>`;

  return `
    <div class="dv-card">
      <h2>This vehicle is full</h2>
      <p class="dv-hint">This tag keeps ${held} for this vehicle. Delete one to add another.</p>
      ${trialLine}
    </div>`;
}

// Whole days left on the complimentary period, rounded UP so the last partial
// day still reads as "1 day left" rather than "0".
function trialDaysLeft() {
  if (!entitlement || !entitlement.trialEndsAt) return null;
  const endsAt = new Date(entitlement.trialEndsAt).getTime();
  if (!Number.isFinite(endsAt)) return null;
  return Math.max(0, Math.ceil((endsAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

// Shown under the upload form while there is still room. A nudge, not a wall:
// nothing here is blocked.
//
// Two audiences. An E-Tag owner is shown what the upgrade is worth. A premium
// owner inside the free period is shown that it ENDS, and what the allowance
// drops to — they can fill ten slots during the trial and be over the limit on
// day 46, so being told late would be being told too late.
function upgradeNote() {
  if (!entitlement) return "";

  const premiumMax = limits && limits.tiers ? limits.tiers.premium : 3;

  if (!entitlement.premium) {
    return `<p class="dv-quota">A premium tag keeps up to ${premiumMax} documents for this vehicle. <a href="${upgradeUrl()}">Upgrade</a></p>`;
  }

  const daysLeft = trialDaysLeft();
  if (daysLeft === null) return "";
  return `<p class="dv-quota">Free with your premium tag for another ${daysLeft} day${daysLeft === 1 ? "" : "s"}. After that this vehicle keeps ${premiumMax} documents unless you subscribe &mdash; nothing already saved is removed.</p>`;
}

function renderList(usedBytes) {
  els.lockBtn.classList.add("dv-on");

  const quotaMb = limits ? Math.round(limits.maxBytesPerOwner / (1024 * 1024)) : 40;

  // The listing always carries an entitlement when it succeeds, so null here
  // means something is wrong rather than that the vehicle has no allowance.
  // Leave the form up in that case and let the server answer: an owner who has
  // no room is told so plainly when they try, whereas a page that decides on
  // its own that the allowance is zero locks them out with no way back.
  const maxDocs = entitlement ? entitlement.maxDocs : null;
  const full = maxDocs !== null && documents.length >= maxDocs;

  const grid = documents.length
    ? `<div class="dv-grid">${documents.map(docCard).join("")}</div>`
    : `<div class="dv-empty">No documents yet.<br>Add your RC or insurance so it's with you when you need it.</div>`;

  const addCard = full
    ? fullCard(maxDocs)
    : `<div class="dv-card">
      <h2 style="text-align:left;margin-bottom:14px">Add a document</h2>
      <div class="dv-f"><label for="dv-type">Document type</label>
        <select id="dv-type">${Object.keys(TYPE_LABELS).map((k) => `<option value="${k}">${TYPE_LABELS[k]}</option>`).join("")}</select></div>
      <div class="dv-f"><label for="dv-label">Name (optional)</label>
        <input id="dv-label" type="text" maxlength="60" placeholder="e.g. RC front"></div>
      <div class="dv-f"><label for="dv-file">File (PDF, JPG, PNG or WEBP)</label>
        <input id="dv-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>
      <button class="dv-primary" id="dv-add">Add document</button>
    </div>
    ${upgradeNote()}`;

  // "6 of 1 document" is what an owner who filed six under the old flat cap
  // would otherwise be shown, which reads like a fault rather than a grandfathered
  // vehicle. Over the allowance, state the holding and the allowance separately.
  const count = documents.length;
  let tally = `${count} document${count === 1 ? "" : "s"} on this vehicle`;
  if (maxDocs !== null) {
    tally = count > maxDocs
      ? `${tally} &middot; this tag's allowance is ${maxDocs}`
      : `${count} of ${maxDocs} document${maxDocs === 1 ? "" : "s"} on this vehicle`;
  }

  els.body.innerHTML = `
    ${grid}
    ${addCard}
    <p class="dv-quota">${tally} &middot; using ${fmtSize(usedBytes)} of ${quotaMb} MB</p>`;

  // Two things open the viewer: the preview itself and the View button. Only
  // the preview needs the keyboard handler — it is a div playing the part of a
  // button, whereas a real <button> already fires click on Enter and Space, and
  // handling both there would open the viewer twice per keypress.
  els.body.querySelectorAll("[data-view]").forEach((n) => {
    const open = () => openViewer(n.getAttribute("data-view"));
    n.addEventListener("click", open);
    if (n.tagName !== "BUTTON") {
      n.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    }
  });
  // A full-size preview that will not decode (a truncated upload, a file the
  // browser cannot read) would otherwise leave a broken-image glyph on the
  // card. Swap in the icon instead — wired here rather than as an inline
  // onerror so the page carries no inline script.
  els.body.querySelectorAll("img[data-full]").forEach((img) =>
    img.addEventListener("error", () => { img.outerHTML = ICON_DOC; }, { once: true }));

  els.body.querySelectorAll("[data-edit]").forEach((n) =>
    n.addEventListener("click", () => openEditor(n.getAttribute("data-edit"))));
  els.body.querySelectorAll("[data-del]").forEach((n) =>
    n.addEventListener("click", () => removeDocument(n.getAttribute("data-del"))));
  // Absent once the vehicle is full — the upload form is replaced by fullCard()
  // rather than left on screen with a disabled button.
  const addBtn = document.getElementById("dv-add");
  if (addBtn) addBtn.addEventListener("click", addDocument);
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
  // Re-read on every load, not just at boot: an owner who buys a premium tag
  // in another tab and comes back should see the larger allowance without
  // signing out and in again.
  if (r.data.entitlement) entitlement = r.data.entitlement;
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
  const url = fileUrl(d.id);

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

// Both the stored document and its card thumbnail now come out of one pass in
// document-compress.js, off a single decode. See that module for why the
// shrinking happens here rather than on the server.

function fmtSaving(originalBytes, storedBytes) {
  const cut = Math.round((1 - storedBytes / originalBytes) * 100);
  return `${fmtSize(originalBytes)} → ${fmtSize(storedBytes)} (${cut}% smaller)`;
}

async function addDocument() {
  const typeEl = document.getElementById("dv-type");
  const labelEl = document.getElementById("dv-label");
  const fileEl = document.getElementById("dv-file");
  const btn = document.getElementById("dv-add");

  showError("");
  if (!fileEl.files || !fileEl.files.length) { showError("Choose a file to upload."); return; }

  const picked = fileEl.files[0];
  const maxFileBytes = (limits && limits.maxFileBytes) || MAX_DECODE_BYTES;

  // Deliberately NOT checked against the picked file. A 6MB photo shrinks to
  // well under the cap, and refusing it before trying would turn a file we can
  // comfortably store into an error message. The compressed size is what has to
  // fit, so that is what is measured — below, once it exists.
  if (picked.size > MAX_DECODE_BYTES) {
    showError(`That file is too large to process. Choose a photo or PDF under ${Math.floor(MAX_DECODE_BYTES / (1024 * 1024))}MB.`);
    return;
  }

  btn.disabled = true;
  btn.textContent = "Preparing…";

  const prepared = await prepareDocument(picked);
  const { file, thumb } = prepared;

  if (file.size > maxFileBytes) {
    btn.disabled = false;
    btn.textContent = "Add document";
    // A PDF, or an image that could not be compressed. Either way the number
    // the owner is shown is the size of the thing that was actually refused.
    showError(
      `This document is ${fmtSize(file.size)}. Each one must be under ${Math.floor(maxFileBytes / (1024 * 1024))}MB.`
    );
    return;
  }

  btn.textContent = "Uploading…";

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
  // The vehicle filled up under us — another tab, or an allowance that shrank.
  // Take the server's word for the tier and redraw, so the form the owner is
  // looking at stops offering something that will be refused again.
  if (r.status === 409 && r.data.code === "DOCUMENT_LIMIT_REACHED") {
    if (r.data.entitlement) entitlement = r.data.entitlement;
    // Redraw FIRST: loadDocuments() clears the banner on the way in, so an
    // error set before it would flash and disappear.
    await loadDocuments();
    showError(r.data.error || "This vehicle is full.");
    return;
  }
  if (r.status !== 200) { showError(r.data.error || "Could not save the document."); return; }
  // Say what the compression bought. It explains the wait, and it is the only
  // visible sign that the feature is working at all.
  showOk(prepared.compressed
    ? `Document added — ${fmtSaving(prepared.originalBytes, prepared.storedBytes)}.`
    : "Document added.");
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

  // tagId is sent so the allowance comes back with the status: it is per
  // vehicle, so it cannot be answered without one.
  const r = await api(`/status?tagId=${encodeURIComponent(tagId)}`);
  if (r.status === 401) { window.location.href = "/owner-login"; return; }
  if (r.status !== 200) {
    els.body.innerHTML = "";
    showError(r.data.error || "Could not open your documents.");
    return;
  }
  limits = r.data.limits || null;
  entitlement = r.data.entitlement || null;
  if (!r.data.hasPin) { renderSetPin(); return; }
  if (!r.data.unlocked) { renderUnlock(); return; }
  loadDocuments();
}

start();
