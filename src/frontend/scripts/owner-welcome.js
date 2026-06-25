// ── Carousel ─────────────────────────────────────────────────────
const track    = document.getElementById("carTrack");
const viewport = document.getElementById("carVp");
const dots     = document.querySelectorAll(".pt-dot-btn");
const TOTAL    = 3;
let cur = 0, autoTimer;

function goTo(idx) {
  cur = ((idx % TOTAL) + TOTAL) % TOTAL;
  track.style.transform = `translateX(-${cur * 100}%)`;
  dots.forEach((d, i) => d.setAttribute("aria-selected", String(i === cur)));
}

document.getElementById("carPrev").addEventListener("click", () => goTo(cur - 1));
document.getElementById("carNext").addEventListener("click", () => goTo(cur + 1));
dots.forEach(d => d.addEventListener("click", () => goTo(Number(d.dataset.idx))));

function startAuto() { autoTimer = setInterval(() => goTo(cur + 1), 3000); }
function stopAuto()  { clearInterval(autoTimer); }
viewport.addEventListener("mouseenter", stopAuto);
viewport.addEventListener("mouseleave", startAuto);

let swipeX = 0;
track.addEventListener("touchstart", e => { swipeX = e.touches[0].clientX; }, { passive: true });
track.addEventListener("touchend",   e => {
  const dx = swipeX - e.changedTouches[0].clientX;
  if (Math.abs(dx) > 40) goTo(dx > 0 ? cur + 1 : cur - 1);
});
startAuto();

// ── Determine new/returning user ─────────────────────────────────
const urlParams = new URLSearchParams(location.search);
const newParam  = urlParams.get("new");
const isNewUser = newParam !== null
  ? newParam === "1"
  : sessionStorage.getItem("pt_is_new_user") === "1";
sessionStorage.removeItem("pt_is_new_user");

// ── DOM refs ─────────────────────────────────────────────────────
const greetName = document.getElementById("greetName");
const greetId   = document.getElementById("greetId");
const grid      = document.getElementById("vehicleGrid");
const searchInp = document.getElementById("vehicleSearch");
let allTags     = [];


// ── UI strings (externalised for i18n) ───────────────────────────
const UI = {
  greetPrefix:    "Hi,",
  greetFallback:  "there",
  noVehicles:     "No vehicles yet",
  noVehiclesSub:  "Add your first vehicle below",
  loadError:      "Couldn't load your vehicles.",
  retry:          "Retry",
  refreshing:     "Refreshing…",
};

// ── Type labels ───────────────────────────────────────────────────
const VEHICLE_LABELS = {
  car: "Car", bike: "Bike", scooter: "Scooter",
  auto_rickshaw: "Auto Rickshaw", truck: "Truck",
  bus: "Bus", bicycle: "Bicycle", e_scooter: "E-Scooter"
};

// ── Type-specific SVG icons (28×28) ──────────────────────────────
const VEHICLE_SVGS = {
  car: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="8" width="20" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 8l2-4h10l2 4" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="7" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="17" cy="18" r="1.5" fill="currentColor"/>
  </svg>`,
  bike: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <circle cx="6" cy="16" r="3" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.8"/>
    <path d="M6 16l4-6h4l2 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 10V7m0 3l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  scooter: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="2.5" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="19" cy="17" r="2.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 17h2l2-5h6l1 3h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 12V9l3-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  auto_rickshaw: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="7" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M17 11h3l1 4h-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="7" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="17" cy="18" r="1.5" fill="currentColor"/>
    <path d="M3 11h14" stroke="currentColor" stroke-width="1.5"/>
  </svg>`,
  truck: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <rect x="1" y="6" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M15 9h4l3 3v4h-7V9z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="5.5" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="18.5" cy="18" r="1.5" fill="currentColor"/>
  </svg>`,
  bus: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M3 10h18" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="8" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="16" cy="18" r="1.5" fill="currentColor"/>
    <path d="M7 4v6M17 4v6" stroke="currentColor" stroke-width="1.5"/>
  </svg>`,
  bicycle: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="3" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="19" cy="17" r="3" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 17l4-6h4l1 3M13 11l2 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M9 11H7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="9" cy="7" r="1.5" stroke="currentColor" stroke-width="1.5"/>
  </svg>`,
  e_scooter: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="2.5" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="19" cy="17" r="2.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 17h2l2-5h6l1 3h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 12V9l3-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M17 3l-1.5 2.5H17L15.5 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

function iconFor(tag) {
  // tag.vehicleType from API, or tag.type from localStorage pending vehicles
  const t = tag.vehicleType || tag.type || "car";
  return VEHICLE_SVGS[t] || VEHICLE_SVGS.car;
}

const ADD_CARD = `
<a href="/register-owner" class="pt-vadd">
  <div class="pt-vadd-icon">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
      <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </div>
  <p class="pt-vadd-title">Add</p>
  <p class="pt-vadd-sub">Vehicle<br/>Tap to add</p>
</a>`;

function vehicleCard(tag, idx) {
  const label = tag.vehicleLabel || VEHICLE_LABELS[tag.type] || "Vehicle";
  const plate  = tag.plateNumber  || tag.number || tag.token || "—";
  const type   = tag.vehicleType  || tag.type   || "car";
  const params = new URLSearchParams({ number: plate, type, label, id: tag.id || "", token: tag.token || "" }).toString();
  const svg    = iconFor(tag).replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
  return `
<a href="/owner-vehicle-detail?${params}" class="pt-vc"
   style="text-decoration:none;color:inherit"
   aria-label="${label}, plate ${plate}">
  <div class="pt-vc-icon">
    ${svg}
    <span class="pt-vc-badge" aria-hidden="true">${idx + 1}</span>
  </div>
  <p class="pt-vc-name" aria-hidden="true">${label}</p>
  <p class="pt-vc-plate" aria-hidden="true">${plate}</p>
</a>`;
}

function skeletonGrid(count = 3) {
  const cards = Array.from({ length: count }, () => `
    <div class="pt-vc" style="pointer-events:none;gap:8px">
      <div class="sk" style="width:60px;height:60px;border-radius:50%"></div>
      <div class="sk" style="width:65%;height:13px;margin-top:2px"></div>
      <div class="sk" style="width:45%;height:10px"></div>
    </div>`).join("");
  return cards + ADD_CARD;
}

const EMPTY_STATE = `
  <div role="status" style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;padding:28px 16px 12px;text-align:center">
    <div aria-hidden="true" style="width:60px;height:60px;border-radius:50%;background:#F3F4F6;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="#9CA3AF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="7" r="1.5" fill="#9CA3AF"/>
      </svg>
    </div>
    <p style="font-size:.92rem;font-weight:800;color:#1F2937;margin:0 0 4px">${UI.noVehicles}</p>
    <p style="font-size:.8rem;color:#6B7280;margin:0">${UI.noVehiclesSub}</p>
  </div>`;

function renderGrid(tags, animate = false) {
  const empty = tags.length === 0 ? EMPTY_STATE : "";
  grid.innerHTML = empty + tags.map((t, i) => vehicleCard(t, i)).join("") + ADD_CARD;
  if (animate) {
    grid.classList.remove("pt-reveal-grid");
    void grid.offsetWidth;
    grid.classList.add("pt-reveal-grid");
  }
}

// ── Search filter ─────────────────────────────────────────────────
searchInp.addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q
    ? allTags.filter(t =>
        (t.vehicleLabel || t.type || "").toLowerCase().includes(q) ||
        (t.plateNumber  || t.number || "").toLowerCase().includes(q)
      )
    : allTags;
  renderGrid(filtered);
});

// ── User-scoped localStorage helpers ─────────────────────────────
function userKey(userId) {
  return "pt_vehicles_" + (userId || "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

function readSavedVehicles(userId) {
  try {
    const raw = localStorage.getItem(userKey(userId));
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function mergePendingVehicles(userId) {
  try {
    const pending = JSON.parse(localStorage.getItem("pt_pending_vehicles") || "[]");
    if (!pending.length) return;
    const saved = readSavedVehicles(userId);
    const savedNums = new Set(saved.map(v => (v.number || "").toUpperCase()));
    const merged = [...saved, ...pending.filter(v => !savedNums.has((v.number || "").toUpperCase()))];
    localStorage.setItem(userKey(userId), JSON.stringify(merged));
    localStorage.removeItem("pt_pending_vehicles");
  } catch {}
}

// ── Load data ─────────────────────────────────────────────────────
async function load() {
  grid.innerHTML = skeletonGrid(3);
  try {
    const res = await fetch("/api/owner/dashboard");
    if (!res.ok) {
      grid.innerHTML = ADD_CARD;
      return;
    }

    const data = await res.json();

    // Derive a stable user identifier from the session
    const userId = data.owner
      ? (data.owner.email || data.owner.mobile || String(data.owner._id || ""))
      : null;

    if (data.owner) {
      const rawName = data.owner.displayName || "";
      const isEmail = rawName.includes("@");
      let firstName;
      if (!isEmail && rawName) {
        firstName = rawName.split(" ")[0];
      } else {
        // Derive a friendly name from the email address
        const email = data.owner.email || "";
        if (email.includes("@")) {
          const local = email.split("@")[0].replace(/[0-9]/g, "");
          const parts = local.split(/[._\-+]/).filter(Boolean);
          const part = parts[0] || local;
          firstName = part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : UI.greetFallback;
        } else {
          firstName = UI.greetFallback;
        }
      }
      const id = data.owner.email || data.owner.mobile || "";
      greetName.textContent = `${UI.greetPrefix} ${firstName}!`;
      greetName.classList.remove("pt-reveal");
      void greetName.offsetWidth; // force reflow to re-trigger animation
      greetName.classList.add("pt-reveal");
      if (id) {
        greetId.textContent = id;
        greetId.classList.remove("pt-reveal");
        void greetId.offsetWidth;
        greetId.classList.add("pt-reveal");
      }
    }

    // One-time migration: move the old unscoped key into pending so it gets claimed below
    try {
      const legacy = localStorage.getItem("pt_saved_vehicles");
      if (legacy) {
        const cur = JSON.parse(localStorage.getItem("pt_pending_vehicles") || "[]");
        const legacyArr = JSON.parse(legacy);
        const curNums = new Set(cur.map(v => (v.number || "").toUpperCase()));
        const merged = [...cur, ...legacyArr.filter(v => !curNums.has((v.number || "").toUpperCase()))];
        localStorage.setItem("pt_pending_vehicles", JSON.stringify(merged));
        localStorage.removeItem("pt_saved_vehicles");
      }
    } catch {}

    // Persist userId so register-owner.js can write directly to the right key
    if (userId) sessionStorage.setItem("pt_uid", userId);

    // Absorb any vehicles added during register flow into THIS user's store
    if (userId) mergePendingVehicles(userId);

    // Read only THIS user's saved vehicles
    const saved   = userId ? readSavedVehicles(userId) : [];
    const apiTags = data.tags || [];
    // Dedup by _id first, fall back to plate number
    const apiIds  = new Set(apiTags.map(t => String(t._id || "")).filter(Boolean));
    const apiNums = new Set(apiTags.map(t => (t.plateNumber || "").toUpperCase()).filter(Boolean));
    const localOnly = saved.filter(v =>
      !(v._id && apiIds.has(String(v._id))) &&
      !apiNums.has((v.number || "").toUpperCase())
    );

    // Dedup apiTags themselves by plate number (handles stale DB duplicates)
    const seenPlates = new Set();
    const dedupedApi = apiTags.filter(t => {
      const plate = (t.plateNumber || t.number || "").toUpperCase();
      if (!plate || seenPlates.has(plate)) return false;
      seenPlates.add(plate);
      return true;
    });

    allTags = [...localOnly, ...dedupedApi];
    renderGrid(allTags, true);
  } catch {
    grid.innerHTML = `
      <div role="alert" style="grid-column:1/-1;text-align:center;padding:28px 16px 12px">
        <p style="font-size:.9rem;font-weight:700;color:#374151;margin:0 0 10px">${UI.loadError}</p>
        <button onclick="load()"
          style="background:#1A9D20;color:#fff;border:none;border-radius:10px;
                 padding:9px 22px;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit">
          ${UI.retry}
        </button>
      </div>` + ADD_CARD;
  }
}

// Show skeleton immediately so layout is stable before API responds
if (grid) grid.innerHTML = skeletonGrid(3);
load();

// ── Pull-to-refresh ───────────────────────────────────────────────
const PTR_THRESHOLD = 72;
let ptrStartY = 0;
let ptrTriggered = false;
const ptrEl = document.getElementById("ptrIndicator");

document.addEventListener("touchstart", e => {
  ptrStartY = e.touches[0].clientY;
  ptrTriggered = false;
}, { passive: true });

document.addEventListener("touchmove", e => {
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
  if (scrollTop > 0 || !ptrEl) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy > 10) {
    ptrEl.classList.add("visible");
    if (dy >= PTR_THRESHOLD) ptrTriggered = true;
  }
}, { passive: true });

document.addEventListener("touchend", () => {
  if (!ptrEl) return;
  ptrEl.classList.remove("visible");
  if (ptrTriggered) { ptrTriggered = false; load(); }
  ptrStartY = 0;
});
