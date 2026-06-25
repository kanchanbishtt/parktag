// ── Read URL params ───────────────────────────────────────────
const params   = new URLSearchParams(location.search);
const plate    = params.get("number") || "—";
const typeKey  = params.get("type")   || "car";
const label    = params.get("label")  || "Vehicle";
const realId   = params.get("id")     || "";
const realToken = params.get("token") || "";

// Real QR data url — populated from API when a real tag id is present
let realQrDataUrl = "";
let realScanUrl   = "";

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
      }
    } catch {}
  }

  skeleton.style.transition = "opacity .25s ease";
  skeleton.style.opacity = "0";
  setTimeout(() => {
    skeleton.style.display = "none";
    populateContent();
    content.classList.add("visible");
  }, 250);
}, 500);

// ── Populate fields ───────────────────────────────────────────
function populateContent() {
  const displayTagId = realToken || ("DEMO-" + plate.replace(/\s/g, "").toUpperCase().slice(0, 8));

  document.getElementById("vd-plate").textContent  = "#" + plate;
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
document.getElementById("sos-save-btn")?.addEventListener("click", () => {
  const num = (document.getElementById("sos-number")?.value || "").trim();
  if (!num) { alert("Please enter an emergency contact number."); return; }
  try { localStorage.setItem("pt_sos_" + plate, num); } catch {}
  const btn = document.getElementById("sos-save-btn");
  btn.textContent = "Saved!";
  btn.style.background = "#D1FAE5";
  btn.style.color = "#065F46";
  setTimeout(() => { btn.textContent = "Save Emergency Contact"; btn.style.background = ""; btn.style.color = ""; }, 2000);
});

document.getElementById("sos-test-btn")?.addEventListener("click", () => {
  alert("SOS test alert sent! (Demo mode)");
});

setTimeout(() => {
  const saved = localStorage.getItem("pt_sos_" + plate);
  if (saved) {
    const inp = document.getElementById("sos-number");
    if (inp) inp.value = saved;
  }
}, 600);

// ── Download E-Tag ────────────────────────────────────────────
document.getElementById("download-etag-btn")?.addEventListener("click", () => {
  const el = document.getElementById("print-vehicle-num");
  if (el) el.textContent = plate;
  setTimeout(() => window.print(), 80);
});
