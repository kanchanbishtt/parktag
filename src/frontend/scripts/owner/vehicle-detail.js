// ── Read URL params ───────────────────────────────────────────
const params   = new URLSearchParams(location.search);
const plate    = params.get("number") || "-";
const typeKey  = params.get("type")   || "car";
const label    = params.get("label")  || "Vehicle";
const realId   = params.get("id")     || "";
const realToken = params.get("token") || "";

// Point the MORE-tab "Vehicle Documents" row at this vehicle's vault page. The
// row is a plain <a> so it keeps middle-click and "open in new tab"; only the
// vehicle id is added here. With no real tag id (the demo/preview state) the
// row is hidden rather than left linking to a page with nothing to show.
const documentsLink = document.getElementById("documents-link");
if (documentsLink) {
  if (realId) {
    documentsLink.href = `/owner-documents?id=${encodeURIComponent(realId)}`;
  } else {
    // Not `hidden`: the row carries an inline display:block (an <a> is inline
    // by default), which would out-rank the [hidden] rule and leave it visible.
    documentsLink.style.display = "none";
  }
}

// Real QR url (a cacheable SVG endpoint), populated from the API when a real tag id is present
let realQrUrl = "";
let realScanUrl   = "";
let isPremium     = false;
let isFreeUsed    = false;
let freeLeft      = 1;

// The dashboard is read ONCE and the promise shared by everything below (the
// tag details, the owner name, the SOS prefill). qr=0 leaves the inline QR
// images out; the QR is loaded from the tag's own cacheable qrUrl instead.
// Resolves to null on any failure, so callers only handle "no data".
const dashboardPromise = fetch("/api/owner/dashboard?qr=0")
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null);

// ── Skeleton → reveal once the dashboard has answered ────────
const skeleton  = document.getElementById("skeleton");
const content   = document.getElementById("vd-content");

(async () => {
  // The tag this page is showing, once the dashboard has been read. Stays null
  // for a local (unsaved) vehicle, for a tag the API does not return, and for a
  // failed fetch — all of which mean "no entitlement to report".
  let loadedCallAccess = null;
  // The dashboard's record for this vehicle, or null when the dashboard could
  // not be read. The two server-backed switches are seeded from it.
  let loadedTag = null;

  // Always yields at least once, so the rest of the module has finished
  // evaluating (initToggles and friends) before the reveal runs.
  const data = realId ? await dashboardPromise : await Promise.resolve(null);

  // If this is a real tag, take its QR and details from the dashboard API
  if (realId) {
    try {
      const tag  = data?.tags?.find(t => t.id === realId);
      if (tag) {
        realQrUrl = tag.qrUrl || "";
        realScanUrl   = tag.scanUrl   || "";
        isPremium     = Boolean(tag.premium);
        isFreeUsed    = Boolean(tag.freeContactUsed);
        freeLeft      = Number.isInteger(tag.freeContactsLeft) ? tag.freeContactsLeft : 1;
        loadedCallAccess = tag.callAccess || null;
        loadedTag = tag;
        // Stamp the unique E-Tag ID + activation status onto the print sticker (spec §9).
        const idEl = document.getElementById("print-etag-id");
        if (idEl && tag.etagId) idEl.textContent = String(tag.etagId).replace(/^PT-/, "");
        setPrintStatus(tag.status);
        // Sticker serial, printed on the sticker face itself (not the sheet).
        const serialEl = document.getElementById("print-figma-serial");
        if (serialEl) serialEl.textContent = tag.serial || "";
      }
    } catch {}
  }
  // Run unconditionally: the switch ships locked, so a path that never reached
  // the gate would leave it locked under copy that describes a working control.
  applyMaskingGate(loadedCallAccess);
  updatePremiumUI();

  skeleton.style.display = "none";
  populateContent();
  content.classList.add("visible");
  autoOpenSection();
  // After the gate above, which decides which switches are locked.
  initToggles(loadedTag);
})();

// ── Populate fields ───────────────────────────────────────────
function populateContent() {
  const displayTagId = realToken || ("DEMO-" + plate.replace(/\s/g, "").toUpperCase().slice(0, 8));

  // No "#" prefix any more: this is drawn as the number plate itself, and a
  // real plate carries no such mark. textContent is safe against the plate
  // graphic — the IND band and tricolour strip are pseudo-elements, so they
  // survive the write.
  document.getElementById("vd-plate").textContent  = plate;
  document.getElementById("vd-tagid").textContent  = "Tag id: " + displayTagId;
  document.getElementById("info-plate").textContent = plate;
  document.getElementById("info-type").textContent  = label;
  document.getElementById("info-tagid").textContent = displayTagId;

  // Owner name, number and backup number from the dashboard payload
  dashboardPromise
    .then(data => {
      if (data?.owner) {
        const name = data.owner.displayName || data.owner.email || "-";
        document.getElementById("info-name").textContent = name;
        const mobileEl = document.getElementById("info-mobile");
        if (mobileEl) mobileEl.textContent = data.owner.mobile || "Not set";
        ownerBackup = data.owner.backupMobile || null;
        backupDeclined = data.owner.backupDeclined || null;
      }
      renderBackupRow();
    })
    .catch(() => renderBackupRow());

  // Contact page link — real token if available, else demo
  const scanLink = realScanUrl || "/vehicle/DEMOPARKTAG1";
  document.getElementById("contact-page-link").href = scanLink;

  // Inject real QR into print template if available
  const printQr = document.getElementById("print-qr-img");
  if (printQr && realQrUrl) {
    printQr.src = realQrUrl;
  }

  // Hide demo banner if this is a real tag
  const demoBanner = document.querySelector(".vd-demo-banner");
  if (demoBanner && realId) demoBanner.style.display = "none";
}

// ── Auto-open section from ?open= URL param ───────────────────
function autoOpenSection() {
  const openKey = params.get("open");
  if (!openKey) return;
  const map = {
    etag:        { tab: "manage", item: "download-etag" },
    premium:     { tab: "manage", item: "premium" },
    replacement: { tab: "more",   item: "replacement" }
  };
  const target = map[openKey];
  if (!target) return;

  // Switch tab if needed
  if (target.tab === "more") {
    const moreTab = document.querySelector('.vd-tab[data-tab="more"]');
    if (moreTab) moreTab.click();
  }

  setTimeout(() => {
    const item = document.querySelector(`.vd-menu-item[data-item="${target.item}"]`);
    if (!item) return;
    document.querySelectorAll(".vd-menu-item.open").forEach(o => o.classList.remove("open"));
    item.classList.add("open");
    item.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 80);
}

// ── Tab switching ─────────────────────────────────────────────
document.querySelectorAll(".vd-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".vd-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".vd-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
  });
});

// ── Accordion items ───────────────────────────────────────────
document.querySelectorAll(".vd-menu-item").forEach(item => {
  const row = item.querySelector(".vd-menu-row");
  if (!row) return;
  row.addEventListener("click", () => {
    const isOpen = item.classList.contains("open");
    document.querySelectorAll(".vd-menu-item.open").forEach(o => o.classList.remove("open"));
    if (!isOpen) item.classList.add("open");
  });
});

// ── Persist toggle state in localStorage ─────────────────────
const STORAGE_KEY = "pt_vd_toggles_" + plate;

function loadToggles() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

function saveToggles(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// The masking switch is live exactly when masking is actually available: an
// E-Tag whose one free contact is unspent, a premium tag inside its free year, or
// a premium tag on a subscription. `masking` is the server's answer and the
// same field the scanner gate reads; the page does not re-derive the window.
//
// The switch ships locked in the markup and is only opened here, and
// initToggles runs after this in the same reveal step, so the order they land
// in cannot leave an unentitled owner with a working control.
function applyMaskingGate(callAccess) {
  const cb = document.getElementById("toggle-masking");
  if (!cb) return;

  const allowed = Boolean(callAccess && callAccess.masking);
  cb.disabled = !allowed;
  // On by default where it is available — an E-Tag's free masked contact is
  // theirs to use, so it starts hidden rather than exposed.
  cb.checked = allowed ? loadToggles()[cb.id] !== false : false;

  const row = cb.closest(".vd-toggle-row");
  if (row) row.classList.toggle("vd-toggle-locked", !allowed);

  // The reason names the next rung: a spent E-Tag needs a premium tag, a
  // lapsed premium tag needs a subscription. No price on either — nothing
  // sells the subscription yet.
  const note = document.getElementById("vd-masking-note");
  if (note) {
    if (allowed) {
      note.textContent = "Call masking hides your real number from callers. Disabling it will reveal your actual phone number.";
    } else if (!callAccess) {
      // No entitlement to report — a local vehicle, or the dashboard did not
      // load. Not a spent E-Tag, so it must not be told it is one.
      note.textContent = "Call masking starts once this vehicle's tag is active.";
    } else if (callAccess.tier === "premium-lapsed") {
      note.textContent = "Call masking has ended for this tag. It continues on a subscription. We'll let you know when that's available.";
    } else {
      note.textContent = "This E-Tag's one free masked contact has been used. Get the official ParkTag sticker to keep your number hidden.";
    }
  }
}

// The two switches that are real: each is a field on the tag, written through
// its own owner endpoint and read by the scanner routes. On a saved vehicle
// they are seeded from the server and never from localStorage — an unsaved
// (local) vehicle has nothing on the server to switch and keeps the remembered
// value like the other switches.
//
//   Tag Active   → status active/inactive. Off takes every channel down: no
//                  masked call, no WhatsApp alert, no Emergency call, and the
//                  scanner page says the tag is inactive.
//   Calls Active → callsPaused. Off retires the masked owner call only; the
//                  alert and the Emergency call carry on.
//
// Same endpoints and the same revert-on-failure as the dashboard's own
// switches (saveSw in welcome.js). While a request is in flight the switch is
// held so a second tap cannot race the first.
const SERVER_SWITCHES = {
  "toggle-tag": {
    path: "status",
    body: (on) => ({ status: on ? "active" : "inactive" }),
    seeded: (tag) => tag.status !== "inactive",
    failed: "Couldn't update tag status. Try again.",
    applied: (data) => setPrintStatus(data.tag && data.tag.status)
  },
  "toggle-calls": {
    path: "calls",
    body: (on) => ({ active: on }),
    seeded: (tag) => !tag.callsPaused,
    failed: "Couldn't update call settings. Try again.",
    applied: () => {}
  }
};

function initToggles(tag) {
  const state = loadToggles();
  document.querySelectorAll(".vd-switch input[type=checkbox]").forEach(cb => {
    const id = cb.id;
    if (id in SERVER_SWITCHES && realId) return;
    // A locked switch is locked because the owner has not paid for it, so a
    // remembered value from this browser must not put it back on.
    if (id in state && !cb.disabled) cb.checked = state[id];
    cb.addEventListener("change", () => {
      if (cb.disabled) return;
      const s = loadToggles();
      s[id] = cb.checked;
      saveToggles(s);
    });
  });
  if (realId) {
    for (const id of Object.keys(SERVER_SWITCHES)) initServerSwitch(id, tag);
  }
}

// `tag` is the dashboard's record for this vehicle, or null when the dashboard
// could not be read. Unknown reads as on, which is what the markup already
// assumes; the switch still posts, so a tap sets the real value either way.
function initServerSwitch(id, tag) {
  const cb = document.getElementById(id);
  const spec = SERVER_SWITCHES[id];
  if (!cb || !spec) return;

  cb.checked = tag ? spec.seeded(tag) : true;

  cb.addEventListener("change", async () => {
    const wanted = cb.checked;
    cb.disabled = true;
    try {
      const res = await fetch(`/api/owner/tags/${encodeURIComponent(realId)}/${spec.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(spec.body(wanted))
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `${spec.path} update failed`);
      spec.applied(data);
    } catch {
      cb.checked = !wanted;
      alert(spec.failed);
    } finally {
      cb.disabled = false;
    }
  });
}

// The activation status stamped on the print sticker (spec §9); kept in step
// with the switch so a sheet printed right after a change reads correctly.
function setPrintStatus(status) {
  const stEl = document.getElementById("print-status");
  if (stEl) stEl.textContent = status === "inactive" ? "Inactive" : "Active";
}

// ── Backup number ─────────────────────────────────────────────
// One per owner, not per vehicle (owner's rule, 5 Oct 2026): the same field
// the dashboard menu edits, shown here too because this page's User Info is
// where an owner looks for their own details. Saved without a code; the
// server checks for a real Indian mobile and refuses the owner's own number.
// Rung after the owner's own when a masked call goes unanswered.
//
// Three states, switched by renderBackupRow(): unset (Not set, a Recommended
// tag, the input in place), set (the number with Change and Remove), editing
// (the input prefilled, with Cancel).
let ownerBackup = null;
let backupEditing = false;
// Save asks before it saves: the 10 digits waiting on "Is this number right?",
// null when the question is not showing.
let backupPending = null;
// A number that took itself off with the link in its WhatsApp notice. Shown
// under the row until the owner saves a different one.
let backupDeclined = null;

// Shown exactly as the Phone Number row above it shows the owner's own number
// (E.164, same face, no grouping), so the two read as a pair.
function formatBackup(e164) {
  return e164 || "";
}

// Grouped for reading back in the confirm step, where the point is to catch a
// wrong digit: "+91 98765 43210".
function groupedMobile(digits) {
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function backupStatus(msg, isErr) {
  const el = document.getElementById("bk-status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? "#B91C1C" : "#047857";
  el.hidden = !msg;
}

function renderBackupRow() {
  if (!document.getElementById("bk-row")) return;
  const set = Boolean(ownerBackup);
  const confirming = Boolean(backupPending);
  // The row stays as the owner left it behind the pop-up, typed number and all.
  const editing = backupEditing || !set;

  const value = document.getElementById("bk-value");
  if (value) {
    value.textContent = set ? formatBackup(ownerBackup) : "Not set";
    value.style.color = set ? "" : "#6B7280";
  }
  const tag = document.getElementById("bk-tag");
  if (tag) tag.hidden = set;
  const edit = document.getElementById("bk-edit");
  if (edit) edit.hidden = !editing;
  const input = document.getElementById("bk-input");
  if (input && editing && !confirming) input.value = backupEditing && set ? String(ownerBackup).replace(/^\+91/, "") : "";
  const cancel = document.getElementById("bk-cancel");
  if (cancel) cancel.hidden = !(backupEditing && set);
  const acts = document.getElementById("bk-acts");
  if (acts) acts.hidden = editing;
  const confirm = document.getElementById("bk-confirm");
  if (confirm) confirm.hidden = !confirming;
  const num = document.getElementById("bk-confirm-num");
  if (num && confirming) num.textContent = groupedMobile(backupPending);
  if (!backupEditing) backupStatus("");
  if (!set && !confirming && backupDeclined) {
    backupStatus(`${backupDeclined} asked not to be your backup. Please add a different number.`, true);
  }
}

// Save: check the shape, then read the number back and ask.
function saveBackupMobile() {
  const input = document.getElementById("bk-input");
  const digits = String(input?.value || "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(digits)) {
    backupStatus("Enter a 10-digit Indian mobile number.", true);
    input?.focus();
    return;
  }
  // An error from an earlier try must not sit under the row while the
  // question is open.
  backupStatus("");
  backupPending = digits;
  renderBackupRow();
  document.getElementById("bk-confirm-yes")?.focus();
}

// "Edit number": back to the input with what was typed still in it.
function backToBackupEdit(error) {
  const digits = backupPending;
  backupPending = null;
  renderBackupRow();
  const input = document.getElementById("bk-input");
  if (input && digits) input.value = digits;
  if (error) backupStatus(error, true);
  input?.focus();
}

async function confirmBackupMobile() {
  const digits = backupPending;
  if (!digits) return;
  const btn = document.getElementById("bk-confirm-yes");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const res = await fetch("/api/owner/backup-mobile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile: `+91${digits}` })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      backToBackupEdit(data.error || "Couldn't save the backup number. Try again.");
      return;
    }
    ownerBackup = data.backupMobile;
    backupDeclined = null;
    backupPending = null;
    backupEditing = false;
    renderBackupRow();
  } catch {
    backToBackupEdit("Network error. The backup number was not saved.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Yes, save"; }
  }
}

async function removeBackupMobile() {
  try {
    const res = await fetch("/api/owner/backup-mobile", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { backupStatus("Couldn't remove the backup number. Try again.", true); return; }
    ownerBackup = null;
    backupEditing = false;
    renderBackupRow();
  } catch {
    backupStatus("Network error. The backup number was not removed.", true);
  }
}

document.getElementById("bk-edit")?.addEventListener("submit", (e) => { e.preventDefault(); saveBackupMobile(); });
document.getElementById("bk-input")?.addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10); });
document.getElementById("bk-change")?.addEventListener("click", () => { backupEditing = true; renderBackupRow(); document.getElementById("bk-input")?.focus(); });
document.getElementById("bk-cancel")?.addEventListener("click", () => { backupEditing = false; backupPending = null; renderBackupRow(); });
document.getElementById("bk-confirm-yes")?.addEventListener("click", confirmBackupMobile);
document.getElementById("bk-confirm-edit")?.addEventListener("click", () => backToBackupEdit());
// Tapping outside the pop-up, or Escape, answers it the same way: back to the
// number, nothing saved.
document.getElementById("bk-confirm-bg")?.addEventListener("click", () => backToBackupEdit());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && backupPending) backToBackupEdit();
});
document.getElementById("bk-remove")?.addEventListener("click", removeBackupMobile);

// ── SOS save ─────────────────────────────────────────────────
// This number used to live only in localStorage, which meant it existed on
// exactly one browser and the server could never dial it. It now persists on
// the tag, which is what lets the scanner-side Emergency button connect a
// caller to this contact. localStorage is kept only as a prefill for local
// (unsaved) vehicles, which have no tag id to save against.
document.getElementById("sos-save-btn")?.addEventListener("click", async () => {
  const num = (document.getElementById("sos-number")?.value || "").trim();
  if (!num) { alert("Please enter an emergency contact number."); return; }

  const btn = document.getElementById("sos-save-btn");
  const restore = () => setTimeout(() => {
    btn.textContent = "Save Emergency Contact";
    btn.style.background = "";
    btn.style.color = "";
  }, 2000);

  btn.disabled = true;
  btn.textContent = "Saving…";

  if (realId) {
    try {
      const res = await fetch(`/api/owner/tags/${realId}/emergency-contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emergencyContact: num })
      });
      const data = await res.json().catch(() => ({}));
      btn.disabled = false;
      if (!res.ok) {
        btn.textContent = "Save Emergency Contact";
        alert(data.error || "Could not save the emergency contact.");
        return;
      }
      // Mirror the normalised value the server stored.
      const inp = document.getElementById("sos-number");
      if (inp && data.emergencyContact) inp.value = data.emergencyContact;
    } catch {
      btn.disabled = false;
      btn.textContent = "Save Emergency Contact";
      alert("Network error. The emergency contact was not saved.");
      return;
    }
  } else {
    // Local-only vehicle: nothing on the server to attach it to yet.
    try { localStorage.setItem("pt_sos_" + plate, num); } catch {}
    btn.disabled = false;
  }

  btn.textContent = "Saved!";
  btn.style.background = "#FFE3DD";
  btn.style.color = "#B31C00";
  restore();
});

document.getElementById("sos-test-btn")?.addEventListener("click", () => {
  const num = (document.getElementById("sos-number")?.value || "").trim();
  if (!num) { alert("Save an emergency contact first."); return; }
  alert(
    "Emergency contact is set to " + num + ".\n\n" +
    "To test the live call, scan this vehicle's QR, verify the plate, then use " +
    "the Emergency button on the contact page, which places a real masked call."
  );
});

(async () => {
  const inp = document.getElementById("sos-number");
  if (!inp) return;

  if (realId) {
    try {
      const data = await dashboardPromise;
      const tag = data?.tags?.find(t => t.id === realId);
      if (tag?.emergencyContact) { inp.value = tag.emergencyContact; return; }
    } catch {}
  }

  // Deliberately no localStorage fallback. Filling this from whatever this
  // browser happened to remember put a number into a field the owner had never
  // saved for the vehicle, so one with no SOS at all looked as though it had
  // one. Empty is the honest starting state; the owner nominates someone.
})();

// ── Remove Vehicle ────────────────────────────────────────────
document.getElementById("remove-vehicle-btn")?.addEventListener("click", async () => {
  if (!confirm(`Remove ${plate} from your account? This cannot be undone.`)) return;
  const btn = document.getElementById("remove-vehicle-btn");
  btn.disabled = true;
  btn.textContent = "Removing…";

  if (realId) {
    try {
      const res = await fetch(`/api/owner/tags/${realId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Could not remove vehicle."); btn.disabled = false; btn.textContent = "Remove Vehicle"; return; }
    } catch { alert("Network error. Please try again."); btn.disabled = false; btn.textContent = "Remove Vehicle"; return; }
  } else {
    // localStorage-only vehicle — remove from both storage keys
    try {
      const uid = sessionStorage.getItem("pt_uid");
      if (uid) {
        const key = "pt_vehicles_" + uid.replace(/[^a-z0-9]/gi, "_").toLowerCase();
        const arr = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(key, JSON.stringify(arr.filter(v => (v.number || "").toUpperCase() !== plate.toUpperCase())));
      }
      const pend = JSON.parse(localStorage.getItem("pt_pending_vehicles") || "[]");
      localStorage.setItem("pt_pending_vehicles", JSON.stringify(pend.filter(v => (v.number || "").toUpperCase() !== plate.toUpperCase())));
    } catch {}
  }

  window.location.href = "/owner-welcome";
});

// ── Download E-Tag ────────────────────────────────────────────
document.getElementById("download-etag-btn")?.addEventListener("click", () => {
  const el = document.getElementById("print-vehicle-num");
  if (el) el.textContent = plate;
  (window.ptLoadPrintImages?.() ?? Promise.resolve()).then(() => window.print());
});

// ── Premium / buy-premium-tag (M18) ───────────────────────────
// Three states, matching the dashboard cards:
//  • premium            → PREMIUM badge, active note, Download E-Tag available
//  • free, unused       → free-trial info, no buy button, no download
//  • free, contact used → "trial ended" copy + Buy Premium Tag → shop
function updatePremiumUI() {
  const badge = document.getElementById("vd-premium-badge");
  const buyBtn = document.getElementById("buy-premium-btn");
  const activeNote = document.getElementById("premium-active-note");
  const copy = document.getElementById("premium-copy");
  const downloadItem = document.querySelector('[data-item="download-etag"]');

  if (isPremium) {
    if (badge) badge.style.display = "inline-block";
    if (buyBtn) buyBtn.style.display = "none";
    if (activeNote) activeNote.style.display = "block";
    if (copy) copy.textContent = "This E-Tag is premium. Call & WhatsApp are always available.";
    if (downloadItem) downloadItem.style.display = ""; // Download only for premium
    return;
  }

  // Non-premium: never show Download / E-Tag info.
  if (badge) badge.style.display = "none";
  if (activeNote) activeNote.style.display = "none";
  if (downloadItem) downloadItem.style.display = "none";

  if (isFreeUsed) {
    // Free trial spent → send them to the shop to buy a premium tag. WhatsApp
    // is not part of this trial (see call-access.js) and stays reachable
    // either way, so the copy asks for the call back rather than overclaiming
    // that upgrading is the only way to hear from a finder at all.
    if (copy) copy.textContent = "Your free masked-call trial has been used. Buy a premium tag to keep Call working — WhatsApp still reaches you.";
    if (buyBtn) { buyBtn.style.display = ""; buyBtn.disabled = !realId; }
  } else {
    // Free trial still live → informational only, no purchase yet.
    const left = freeLeft === 1 ? "1 free call" : `${freeLeft} free calls`;
    if (copy) copy.textContent = `This E-Tag has ${left} left. After that, buy a premium tag to keep Call working — WhatsApp stays available either way.`;
    if (buyBtn) buyBtn.style.display = "none";
  }
  applyEtagDownloadMode();
}

// Premium tags download the OFFICIAL sticker (real Figma artwork) and the button
// is renamed to "Download Premium Tag". Free tags keep the generated E-Tag and
// the original label. Toggled purely on the tag's premium state.
function applyEtagDownloadMode() {
  const print     = document.getElementById("etag-print");
  const menuLabel = document.getElementById("etag-menu-label");
  const btnLabel  = document.getElementById("etag-btn-label");
  const intro     = document.getElementById("etag-intro");
  const instrH    = document.getElementById("etag-instr-h");
  const freebox   = document.getElementById("etag-freebox");

  if (isPremium) {
    if (print) print.classList.add("is-premium");
    if (menuLabel) menuLabel.textContent = "Download Premium Tag";
    if (btnLabel)  btnLabel.textContent  = "Download Premium Tag PDF";
    if (intro)  intro.textContent  = "Thank you for purchasing your official ParkTag premium sticker.";
    if (instrH) instrH.textContent = "How to fix your sticker to the windscreen";
    if (freebox) freebox.innerHTML = "This official ParkTag sticker unlocks <b>unlimited private contact</b>. Finders can always reach you via masked call or WhatsApp, and your number stays private.";
  } else {
    if (print) print.classList.remove("is-premium");
    if (menuLabel) menuLabel.textContent = "Download E-Tag";
    if (btnLabel)  btnLabel.textContent  = "Download E-Tag PDF";
    if (intro)  intro.textContent  = "Thank you for generating your free ParkTag E-Tag.";
    if (instrH) instrH.textContent = "How to fix the E-Tag to your windscreen";
    if (freebox) freebox.innerHTML = "This free E-Tag includes <b>1 free masked call</b> and unlimited WhatsApp alerts (your number stays private either way). For unlimited masked calls too, upgrade to the official physical ParkTag sticker.";
  }

  // Put the real tag QR on both sticker variants (the generated one was left on a
  // placeholder before).
  if (realQrUrl) {
    const figmaQr = document.getElementById("print-figma-qr-img");
    const genQr   = document.getElementById("print-qr-img");
    if (figmaQr) figmaQr.src = realQrUrl;
    if (genQr)   genQr.src   = realQrUrl;
  }
}

// Buy Premium Tag → open the dashboard shop with this tag as the replace-context
// (M18). A paid shop order mints a new premium tag and removes this free tag.
document.getElementById("buy-premium-btn")?.addEventListener("click", () => {
  if (!realId) { alert("Open this vehicle from your dashboard to purchase."); return; }
  window.location.href = "/owner-welcome?shop=1&replace=" + encodeURIComponent(realId);
});
