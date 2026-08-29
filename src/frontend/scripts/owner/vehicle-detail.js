// ── Read URL params ───────────────────────────────────────────
const params   = new URLSearchParams(location.search);
const plate    = params.get("number") || "—";
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

// Real QR data url — populated from API when a real tag id is present
let realQrDataUrl = "";
let realScanUrl   = "";
let isPremium     = false;
let isFreeUsed    = false;

// ── Skeleton → reveal after 500ms ────────────────────────────
const skeleton  = document.getElementById("skeleton");
const content   = document.getElementById("vd-content");

setTimeout(async () => {
  // If this is a real tag, fetch its QR from the dashboard API
  if (realId) {
    try {
      const res  = await fetch("/api/owner/dashboard");
      const data = res.ok ? await res.json() : null;
      const tag  = data?.tags?.find(t => t.id === realId);
      if (tag) {
        realQrDataUrl = tag.qrDataUrl || "";
        realScanUrl   = tag.scanUrl   || "";
        isPremium     = Boolean(tag.premium);
        isFreeUsed    = Boolean(tag.freeContactUsed);
        // Stamp the unique E-Tag ID + activation status onto the print sticker (spec §9).
        const idEl = document.getElementById("print-etag-id");
        if (idEl && tag.etagId) idEl.textContent = String(tag.etagId).replace(/^PT-/, "");
        const stEl = document.getElementById("print-status");
        if (stEl) stEl.textContent = tag.status === "inactive" ? "Inactive" : "Active";
        // Sticker serial, printed on the sticker face itself (not the sheet).
        const serialEl = document.getElementById("print-figma-serial");
        if (serialEl) serialEl.textContent = tag.serial || "";
      }
    } catch {}
  }
  updatePremiumUI();

  skeleton.style.transition = "opacity .25s ease";
  skeleton.style.opacity = "0";
  setTimeout(() => {
    skeleton.style.display = "none";
    populateContent();
    content.classList.add("visible");
    autoOpenSection();
  }, 250);
}, 500);

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

  // Owner name from session
  fetch("/api/owner/dashboard")
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data?.owner) {
        const name = data.owner.displayName || data.owner.email || "—";
        document.getElementById("info-name").textContent = name;
      }
    })
    .catch(() => {});

  // Contact page link — real token if available, else demo
  const scanLink = realScanUrl || "/vehicle/DEMOPARKTAG1";
  document.getElementById("contact-page-link").href = scanLink;

  // Inject real QR into print template if available
  const printQr = document.getElementById("print-qr-img");
  if (printQr && realQrDataUrl) {
    printQr.src = realQrDataUrl;
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

function initToggles() {
  const state = loadToggles();
  document.querySelectorAll(".vd-switch input[type=checkbox]").forEach(cb => {
    const id = cb.id;
    if (id in state) cb.checked = state[id];
    cb.addEventListener("change", () => {
      const s = loadToggles();
      s[id] = cb.checked;
      saveToggles(s);
    });
  });
}

setTimeout(initToggles, 600);

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
      alert("Network error — the emergency contact was not saved.");
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
    "the Emergency button on the contact page — that places a real masked call."
  );
});

setTimeout(async () => {
  const inp = document.getElementById("sos-number");
  if (!inp) return;

  if (realId) {
    try {
      const res = await fetch("/api/owner/dashboard");
      const data = res.ok ? await res.json() : null;
      const tag = data?.tags?.find(t => t.id === realId);
      if (tag?.emergencyContact) { inp.value = tag.emergencyContact; return; }
    } catch {}
  }

  // Deliberately no localStorage fallback. Filling this from whatever this
  // browser happened to remember put a number into a field the owner had never
  // saved for the vehicle, so one with no SOS at all looked as though it had
  // one. Empty is the honest starting state; the owner nominates someone.
}, 600);

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
  setTimeout(() => window.print(), 80);
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
    // Free trial spent → send them to the shop to buy a premium tag.
    if (copy) copy.textContent = "Your free trial has ended — buy a premium tag to continue.";
    if (buyBtn) { buyBtn.style.display = ""; buyBtn.disabled = !realId; }
  } else {
    // Free trial still live → informational only, no purchase yet.
    if (copy) copy.textContent = "This E-Tag includes 1 free contact. After it's used, buy a premium tag to keep Call & WhatsApp active.";
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
    if (freebox) freebox.innerHTML = "This free E-Tag includes <b>1 free contact</b>. A finder can reach you once via masked call or WhatsApp (your number stays private). For unlimited contact, upgrade to the official physical ParkTag sticker.";
  }

  // Put the real tag QR on both sticker variants (the generated one was left on a
  // placeholder before).
  if (realQrDataUrl) {
    const figmaQr = document.getElementById("print-figma-qr-img");
    const genQr   = document.getElementById("print-qr-img");
    if (figmaQr) figmaQr.src = realQrDataUrl;
    if (genQr)   genQr.src   = realQrDataUrl;
  }
}

// Buy Premium Tag → open the dashboard shop with this tag as the replace-context
// (M18). A paid shop order mints a new premium tag and removes this free tag.
document.getElementById("buy-premium-btn")?.addEventListener("click", () => {
  if (!realId) { alert("Open this vehicle from your dashboard to purchase."); return; }
  window.location.href = "/owner-welcome?shop=1&replace=" + encodeURIComponent(realId);
});
