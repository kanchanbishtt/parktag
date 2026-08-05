/*
 * Private document vault — the owner's soft copies of RC, insurance, PUC and
 * licence for ONE vehicle.
 *
 * Exposes window.ptOpenVault(tagId). Opened from the "Vehicle documents" row in
 * the MORE tab of the vehicle detail page, matching where a driver expects to
 * find their paperwork: with the vehicle, not in an account-wide settings list.
 *
 * Three states, driven entirely by the server's answer to /vault/status so the
 * client never has to guess:
 *   • no PIN yet  -> create one (entered twice)
 *   • PIN, locked -> enter it
 *   • unlocked    -> the document list, with add and delete
 *
 * The PIN is a second factor over the login session: it exists for the case of
 * an unlocked phone that is already signed in. Everything here is owner-only —
 * nothing in this sheet is reachable from a tag scan.
 *
 * Plain global script, like address-step.js, so the ES-module page script and
 * any inline handler can both call it.
 */
(function () {
  "use strict";
  if (window.ptOpenVault) return; // guard against double-inclusion

  var els = null;      // built lazily on first open
  var tagId = null;    // vehicle this sheet is currently showing
  var limits = null;   // server-declared caps, shown in the UI

  var TYPE_LABELS = {
    rc: "Registration (RC)",
    insurance: "Insurance",
    puc: "PUC / Emission",
    licence: "Driving licence",
    other: "Other"
  };

  var IC = {
    lock: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="1.7"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M18 7l-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  // Labels and filenames are owner-supplied free text and go in via innerHTML,
  // so they must be escaped here — the backend stores them as typed.
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtSize(bytes) {
    var kb = bytes / 1024;
    if (kb < 1024) return Math.max(1, Math.round(kb)) + " KB";
    return (kb / 1024).toFixed(1) + " MB";
  }

  function injectStyles() {
    if (document.getElementById("pt-vault-styles")) return;
    var css = [
      "#pt-vault-ov{position:fixed;inset:0;background:rgba(3,22,45,.55);z-index:1200;display:none;align-items:flex-end;justify-content:center;}",
      "#pt-vault-ov.pt-open{display:flex;}",
      "#pt-vault-sheet{background:#fff;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;border-radius:22px 22px 0 0;padding:20px 18px 26px;box-sizing:border-box;animation:ptVaultIn .22s ease;}",
      "@media(min-width:560px){#pt-vault-ov{align-items:center;}#pt-vault-sheet{border-radius:22px;}}",
      "@keyframes ptVaultIn{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}",
      "#pt-vault-hd{display:flex;align-items:center;gap:10px;margin-bottom:4px;}",
      "#pt-vault-hd h3{margin:0;font-size:1.05rem;font-weight:900;color:#03162D;flex:1;}",
      "#pt-vault-x{border:none;background:#f3f4f6;border-radius:10px;width:32px;height:32px;cursor:pointer;color:#6B7280;padding:7px;}",
      "#pt-vault-x svg{width:100%;height:100%;}",
      "#pt-vault-sub{margin:0 0 16px;font-size:.82rem;color:#6B7280;line-height:1.5;}",
      "#pt-vault-err{display:none;background:#fdecec;color:#c0271b;font-size:.8rem;font-weight:600;padding:10px 13px;border-radius:11px;margin-bottom:13px;}",
      "#pt-vault-err.pt-show{display:block;}",
      ".pt-vault-f{margin-bottom:13px;}",
      ".pt-vault-f label{display:block;font-size:.72rem;font-weight:700;color:#374151;margin-bottom:5px;}",
      ".pt-vault-f input,.pt-vault-f select{width:100%;box-sizing:border-box;padding:12px 13px;border:1.5px solid #e6e6ec;border-radius:13px;font-size:.94rem;color:#03162D;background:#fff;outline:none;font-family:inherit;}",
      ".pt-vault-f input:focus,.pt-vault-f select:focus{border-color:#FF2700;box-shadow:0 0 0 3.5px #FFE3DD;}",
      ".pt-vault-pin{letter-spacing:.42em;font-weight:800;text-align:center;}",
      ".pt-vault-primary{width:100%;padding:15px;border:none;border-radius:15px;background:#FF2700;color:#fff;font-size:.97rem;font-weight:800;cursor:pointer;font-family:inherit;}",
      ".pt-vault-primary:disabled{opacity:.6;cursor:default;}",
      ".pt-vault-secondary{width:100%;padding:12px;margin-top:9px;border:1.5px solid #e6e6ec;border-radius:14px;background:#fff;color:#374151;font-size:.88rem;font-weight:700;cursor:pointer;font-family:inherit;}",
      ".pt-vault-row{display:flex;align-items:center;gap:11px;padding:11px 0;border-bottom:1px solid #f0f0f3;}",
      ".pt-vault-row:last-child{border-bottom:none;}",
      ".pt-vault-ic{width:36px;height:36px;flex:0 0 36px;border-radius:10px;background:#FFE3DD;color:#FF2700;padding:8px;box-sizing:border-box;}",
      ".pt-vault-ic svg{width:100%;height:100%;}",
      ".pt-vault-meta{flex:1;min-width:0;}",
      ".pt-vault-meta a{display:block;font-size:.9rem;font-weight:700;color:#03162D;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".pt-vault-meta a:hover{color:#FF2700;}",
      ".pt-vault-meta span{font-size:.74rem;color:#9CA3AF;}",
      ".pt-vault-del{border:none;background:none;color:#c0271b;cursor:pointer;padding:7px;width:32px;height:32px;flex:0 0 32px;}",
      ".pt-vault-del svg{width:100%;height:100%;}",
      "#pt-vault-empty{text-align:center;color:#9CA3AF;font-size:.85rem;padding:24px 8px;}",
      "#pt-vault-quota{font-size:.72rem;color:#a3a8b3;text-align:center;margin:14px 0 0;}",
      "@media(prefers-reduced-motion:reduce){#pt-vault-sheet{animation:none;}}"
    ].join("");
    var s = document.createElement("style");
    s.id = "pt-vault-styles";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    injectStyles();
    var ov = document.createElement("div");
    ov.id = "pt-vault-ov";
    ov.innerHTML =
      '<div id="pt-vault-sheet" role="dialog" aria-modal="true" aria-label="Vehicle documents">' +
        '<div id="pt-vault-hd">' +
          '<h3 id="pt-vault-title">Vehicle documents</h3>' +
          '<button id="pt-vault-x" aria-label="Close">' + IC.close + "</button>" +
        "</div>" +
        '<p id="pt-vault-sub"></p>' +
        '<div id="pt-vault-err" role="alert"></div>' +
        '<div id="pt-vault-body"></div>' +
      "</div>";
    document.body.appendChild(ov);

    els = {
      ov: ov,
      title: ov.querySelector("#pt-vault-title"),
      sub: ov.querySelector("#pt-vault-sub"),
      err: ov.querySelector("#pt-vault-err"),
      body: ov.querySelector("#pt-vault-body")
    };

    ov.querySelector("#pt-vault-x").addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("pt-open")) close();
    });
  }

  function showError(message) {
    els.err.textContent = message || "";
    els.err.classList.toggle("pt-show", Boolean(message));
  }

  function close() {
    els.ov.classList.remove("pt-open");
    document.body.style.overflow = "";
    // Re-lock on close. The grant would expire on its own, but leaving it open
    // means the next person to pick up the phone gets straight back in.
    fetch("/api/owner/vault/lock", { method: "POST" }).catch(function () {});
  }

  async function api(path, options) {
    var res = await fetch("/api/owner/vault" + path, options || {});
    var data = null;
    try { data = await res.json(); } catch (_) { data = {}; }
    return { status: res.status, data: data };
  }

  // ── States ───────────────────────────────────────────────────────────────

  function renderSetPin() {
    els.title.textContent = "Protect your documents";
    els.sub.textContent =
      "Create a PIN for your document vault. You'll enter it each time you open your papers, so they stay private even if your phone is unlocked.";
    els.body.innerHTML =
      '<div class="pt-vault-f"><label for="pt-vault-pin1">New PIN (4-8 digits)</label>' +
        '<input class="pt-vault-pin" id="pt-vault-pin1" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></div>' +
      '<div class="pt-vault-f"><label for="pt-vault-pin2">Confirm PIN</label>' +
        '<input class="pt-vault-pin" id="pt-vault-pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></div>' +
      '<button class="pt-vault-primary" id="pt-vault-save-pin">Create PIN</button>';

    var pin1 = document.getElementById("pt-vault-pin1");
    var pin2 = document.getElementById("pt-vault-pin2");
    var btn = document.getElementById("pt-vault-save-pin");
    digitsOnly(pin1); digitsOnly(pin2);
    pin1.focus();

    btn.addEventListener("click", async function () {
      showError("");
      if (!/^\d{4,8}$/.test(pin1.value)) { showError("PIN must be 4 to 8 digits."); return; }
      if (pin1.value !== pin2.value) { showError("Both PINs must match."); return; }
      btn.disabled = true;
      var r = await api("/pin", {
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
    els.title.textContent = "Enter your vault PIN";
    els.sub.textContent = "Your documents are locked. Enter your PIN to view them.";
    els.body.innerHTML =
      '<div class="pt-vault-f"><label for="pt-vault-pin">PIN</label>' +
        '<input class="pt-vault-pin" id="pt-vault-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></div>' +
      '<button class="pt-vault-primary" id="pt-vault-unlock">Unlock</button>';

    var pin = document.getElementById("pt-vault-pin");
    var btn = document.getElementById("pt-vault-unlock");
    digitsOnly(pin);
    pin.focus();
    pin.addEventListener("keydown", function (e) { if (e.key === "Enter") btn.click(); });

    btn.addEventListener("click", async function () {
      showError("");
      btn.disabled = true;
      var r = await api("/unlock", {
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

  function renderList(documents, usedBytes) {
    els.title.textContent = "Vehicle documents";
    els.sub.textContent = "RC, insurance, PUC and licence for this vehicle. Only you can see these.";

    var rows = documents.length
      ? documents.map(function (d) {
          var url = "/api/owner/vault/documents/" + encodeURIComponent(d.id) + "/file";
          return '<div class="pt-vault-row">' +
            '<div class="pt-vault-ic">' + IC.doc + "</div>" +
            '<div class="pt-vault-meta">' +
              '<a href="' + url + '" target="_blank" rel="noopener">' + esc(d.label) + "</a>" +
              "<span>" + esc(TYPE_LABELS[d.docType] || d.docType) + " &middot; " + fmtSize(d.size) + "</span>" +
            "</div>" +
            '<button class="pt-vault-del" data-del="' + esc(d.id) + '" aria-label="Delete document">' + IC.trash + "</button>" +
          "</div>";
        }).join("")
      : '<div id="pt-vault-empty">No documents yet. Add your RC or insurance so it is with you when you need it.</div>';

    var quotaMb = limits ? Math.round(limits.maxBytesPerOwner / (1024 * 1024)) : 40;
    els.body.innerHTML =
      "<div>" + rows + "</div>" +
      '<div style="margin-top:16px">' +
        '<div class="pt-vault-f"><label for="pt-vault-type">Document type</label><select id="pt-vault-type">' +
          Object.keys(TYPE_LABELS).map(function (k) {
            return '<option value="' + k + '">' + TYPE_LABELS[k] + "</option>";
          }).join("") +
        "</select></div>" +
        '<div class="pt-vault-f"><label for="pt-vault-label">Name (optional)</label>' +
          '<input id="pt-vault-label" type="text" maxlength="60" placeholder="e.g. RC front"></div>' +
        '<div class="pt-vault-f"><label for="pt-vault-file">File (PDF, JPG, PNG or WEBP)</label>' +
          '<input id="pt-vault-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>' +
        '<button class="pt-vault-primary" id="pt-vault-add">Add document</button>' +
        '<button class="pt-vault-secondary" id="pt-vault-lock">Lock vault</button>' +
      "</div>" +
      '<p id="pt-vault-quota">Using ' + fmtSize(usedBytes) + " of " + quotaMb + " MB</p>";

    els.body.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () { removeDocument(btn.getAttribute("data-del")); });
    });
    document.getElementById("pt-vault-add").addEventListener("click", addDocument);
    document.getElementById("pt-vault-lock").addEventListener("click", async function () {
      await api("/lock", { method: "POST" });
      showError("");
      renderUnlock();
    });
  }

  function digitsOnly(input) {
    input.addEventListener("input", function () {
      this.value = this.value.replace(/[^0-9]/g, "");
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function loadDocuments() {
    showError("");
    els.body.innerHTML = '<div id="pt-vault-empty">Loading…</div>';
    var r = await api("/documents?tagId=" + encodeURIComponent(tagId));
    // 423 means the grant lapsed between screens — drop back to the PIN prompt
    // rather than showing an error the owner can do nothing about.
    if (r.status === 423) { renderUnlock(); return; }
    if (r.status !== 200) {
      els.body.innerHTML = "";
      showError(r.data.error || "Could not load your documents.");
      return;
    }
    renderList(r.data.documents || [], r.data.usedBytes || 0);
  }

  async function addDocument() {
    var typeEl = document.getElementById("pt-vault-type");
    var labelEl = document.getElementById("pt-vault-label");
    var fileEl = document.getElementById("pt-vault-file");
    var btn = document.getElementById("pt-vault-add");

    showError("");
    if (!fileEl.files || !fileEl.files.length) { showError("Choose a file to upload."); return; }

    var file = fileEl.files[0];
    if (limits && file.size > limits.maxFileBytes) {
      showError("Each document must be under " + Math.floor(limits.maxFileBytes / (1024 * 1024)) + "MB.");
      return;
    }

    // Order matters: the server reads these text fields off the multipart stream
    // as they arrive, so they must be appended BEFORE the file part.
    var form = new FormData();
    form.append("tagId", tagId);
    form.append("docType", typeEl.value);
    form.append("label", labelEl.value);
    form.append("file", file);

    btn.disabled = true;
    btn.textContent = "Uploading…";
    var r = await api("/documents", { method: "POST", body: form });
    btn.disabled = false;
    btn.textContent = "Add document";

    if (r.status === 423) { renderUnlock(); return; }
    if (r.status !== 200) { showError(r.data.error || "Could not save the document."); return; }
    loadDocuments();
  }

  async function removeDocument(docId) {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    var r = await api("/documents/" + encodeURIComponent(docId), { method: "DELETE" });
    if (r.status === 423) { renderUnlock(); return; }
    if (r.status !== 200) { showError(r.data.error || "Could not delete the document."); return; }
    loadDocuments();
  }

  // ── Entry point ──────────────────────────────────────────────────────────

  window.ptOpenVault = async function (vehicleTagId) {
    if (!els) build();
    if (!vehicleTagId) return;
    tagId = String(vehicleTagId);

    showError("");
    els.ov.classList.add("pt-open");
    document.body.style.overflow = "hidden";
    els.title.textContent = "Vehicle documents";
    els.sub.textContent = "";
    els.body.innerHTML = '<div id="pt-vault-empty">Loading…</div>';

    var r = await api("/status");
    if (r.status === 401) {
      els.body.innerHTML = "";
      showError("Please sign in again to open your documents.");
      return;
    }
    if (r.status !== 200) {
      els.body.innerHTML = "";
      showError(r.data.error || "Could not open your documents.");
      return;
    }

    limits = r.data.limits || null;
    if (!r.data.hasPin) { renderSetPin(); return; }
    if (!r.data.unlocked) { renderUnlock(); return; }
    loadDocuments();
  };

  // Wire the MORE-tab row. Capture phase + stopPropagation so the page's
  // accordion handler never sees the click: this row opens a sheet instead of
  // expanding a sub-panel, and letting both fire would toggle an empty panel
  // open behind the sheet.
  function wireRow() {
    var row = document.querySelector('.vd-menu-item[data-item="documents"] .vd-menu-row');
    if (!row) return;
    row.addEventListener("click", function (e) {
      e.stopPropagation();
      var id = new URLSearchParams(location.search).get("id");
      if (id) window.ptOpenVault(id);
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireRow, { once: true });
  } else {
    wireRow();
  }
})();
