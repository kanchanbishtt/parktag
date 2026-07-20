// ── Banners carousel ─────────────────────────────────────────────
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
let allTags      = [];
let allRequests  = [];
let _ownerMobile = null;
let _nbFilter    = null; // "active" | "premium" | "free" | "used" | null

// ── Burger menu state ─────────────────────────────────────────────
let _owner  = null;
let _userId = null;
let _selIdx = 0;


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

// ── Per-vehicle color palette ─────────────────────────────────────
const VEHICLE_COLORS = [
  { bg: "#FFE3DD", accent: "#FF2700" },  // red
  { bg: "#DBEAFE", accent: "#2563EB" },  // blue
  { bg: "#D1FAE5", accent: "#059669" },  // green
  { bg: "#EDE9FE", accent: "#7C3AED" },  // purple
  { bg: "#FEF3C7", accent: "#D97706" },  // amber
];

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
<a href="/register-owner" class="pt-vadd-lc" aria-label="Add a new vehicle">
  <div class="pt-vadd-lc-ic">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
      <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </div>
  <div>
    <p class="pt-vadd-lc-t">Add Vehicle</p>
    <p class="pt-vadd-lc-s">Register a new vehicle</p>
  </div>
</a>`;

function vehicleCard(tag, idx) {
  const colorIdx  = allTags.indexOf(tag);
  const color     = VEHICLE_COLORS[(colorIdx >= 0 ? colorIdx : idx) % VEHICLE_COLORS.length];
  const label     = tag.vehicleLabel || VEHICLE_LABELS[tag.type] || "Vehicle";
  const plate     = tag.plateNumber  || tag.number || tag.token || "—";
  const type      = tag.vehicleType  || tag.type   || "car";
  const params    = new URLSearchParams({ number: plate, type, label, id: tag.id || "", token: tag.token || "" }).toString();
  const svg       = iconFor(tag).replace(/width="\d+"/, 'width="22"').replace(/height="\d+"/, 'height="22"').replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
  const isActive  = tag.status !== "inactive";
  const pill      = tag.premium ? "★ Premium" : (!tag.freeContactUsed ? "1 Free Call" : "Call Used");
  const pillClass = tag.premium ? "vp-premium" : (!tag.freeContactUsed ? "vp-free" : "vp-used");
  const detailUrl = `/owner-vehicle-detail?${params}`;
  // Card action row (both active and inactive cards). Three states (M18):
  //  • premium            → Download E-Tag (kept for official tags only)
  //  • free, contact used → "trial expired" note + Buy Premium Tag → shop
  //  • free, unused       → nothing (the free trial is still live)
  // Buttons stopPropagation so tapping them never navigates to the detail page.
  const isOfficial = Boolean(tag.premium);
  const hasId      = Boolean(tag.id);
  const trialExpired = !isOfficial && Boolean(tag.freeContactUsed);

  let actionsInner = "";
  if (hasId && isOfficial) {
    actionsInner = `<button class="pt-vlc-act dl" onclick="event.stopPropagation();downloadETagFor('${tag.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Download E-Tag
      </button>`;
  } else if (hasId && trialExpired) {
    actionsInner = `<p class="pt-vlc-trial">Your free trial has ended, buy a premium tag to continue.</p>
      <button class="pt-vlc-act buy" onclick="event.stopPropagation();goToShopForReplace('${tag.id}')">Buy Premium Tag</button>`;
  }
  const actions = actionsInner ? `\n  <div class="pt-vlc-actions">${actionsInner}</div>` : "";

  return `
<div class="pt-vlc" style="border-left-color:${color.accent}">
  <div class="pt-vlc-main" role="link" tabindex="0"
       onclick="location.href='${detailUrl}'"
       onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.href='${detailUrl}'}"
       aria-label="${label}, ${plate}, ${isActive ? "active" : "inactive"}">
    <div class="pt-vlc-icon" style="background:${color.bg};color:${color.accent}">${svg}</div>
    <div class="pt-vlc-body">
      <p class="pt-vlc-name">${label}</p>
      <p class="pt-vlc-plate">${plate}</p>
    </div>
    <div class="pt-vlc-meta">
      <span class="pt-vlc-pill ${pillClass}">${pill}</span>
      <span class="pt-vlc-stxt${isActive ? " on" : ""}">${isActive ? "● Active" : "○ Inactive"}</span>
    </div>
    <span class="pt-vlc-arr"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>
  </div>
  ${actions}
</div>`;
}

function skeletonGrid(count = 3) {
  return Array.from({ length: count }, () => `
    <div class="pt-vlc" style="pointer-events:none">
      <div class="sk" style="width:48px;height:48px;border-radius:14px;flex-shrink:0"></div>
      <div style="flex:1">
        <div class="sk" style="height:14px;width:62%;border-radius:6px;margin-bottom:7px"></div>
        <div class="sk" style="height:11px;width:42%;border-radius:5px"></div>
      </div>
    </div>`).join("") + ADD_CARD;
}

const EMPTY_STATE = `
  <div role="status" style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;padding:28px 16px 12px;text-align:center">
    <div aria-hidden="true" style="width:60px;height:60px;border-radius:50%;background:#F3F4F6;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="#9CA3AF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="7" r="1.5" fill="#9CA3AF"/>
      </svg>
    </div>
    <p style="font-size:.92rem;font-weight:800;color:#323232;margin:0 0 4px">${UI.noVehicles}</p>
    <p style="font-size:.8rem;color:#6B7280;margin:0">${UI.noVehiclesSub}</p>
  </div>`;

function getDisplayTags() {
  const q = searchInp ? searchInp.value.trim().toLowerCase() : "";
  let tags = allTags;
  if (_nbFilter) {
    tags = tags.filter(t => {
      if (_nbFilter === "active")  return t.status !== "inactive";
      if (_nbFilter === "premium") return t.premium;
      if (_nbFilter === "free")    return !t.premium && !t.freeContactUsed;
      if (_nbFilter === "used")    return !t.premium && t.freeContactUsed;
      return true;
    });
  }
  if (q) {
    tags = tags.filter(t =>
      (t.vehicleLabel || t.type || "").toLowerCase().includes(q) ||
      (t.plateNumber  || t.number || "").toLowerCase().includes(q)
    );
  }
  return tags;
}

const FILTER_EMPTY = `
  <div role="status" style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;padding:28px 16px 12px;text-align:center">
    <div aria-hidden="true" style="width:60px;height:60px;border-radius:50%;background:#FFF5F3;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="8" stroke="#FF2700" stroke-width="1.8"/>
        <path d="M21 21l-4.35-4.35" stroke="#FF2700" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </div>
    <p style="font-size:.92rem;font-weight:800;color:#323232;margin:0 0 4px">No matches</p>
    <p style="font-size:.8rem;color:#6B7280;margin:0">Try a different filter or search term</p>
  </div>`;

function renderGrid(tags, animate = false) {
  const isFiltered = _nbFilter || (searchInp && searchInp.value.trim());
  const empty = tags.length === 0 ? (isFiltered ? FILTER_EMPTY : EMPTY_STATE) : "";
  grid.innerHTML = empty + tags.map((t, i) => vehicleCard(t, i)).join("") + ADD_CARD;
  if (animate) {
    grid.classList.remove("pt-reveal-grid");
    void grid.offsetWidth;
    grid.classList.add("pt-reveal-grid");
  }
  const countEl = document.getElementById("tagsCount");
  if (countEl) {
    if (!allTags.length) {
      countEl.textContent = "";
    } else if (tags.length !== allTags.length) {
      countEl.textContent = `(${tags.length} of ${allTags.length})`;
    } else {
      countEl.textContent = `(${allTags.length})`;
    }
  }
}

function updateHeaderStats(tags) {
  const el = document.getElementById("headerStats");
  if (!el || !tags.length) { if (el) el.innerHTML = ""; return; }
  const active  = tags.filter(t => t.status !== "inactive").length;
  const premium = tags.filter(t => t.premium).length;
  el.innerHTML = [
    { n: tags.length, l: "Tags"    },
    { n: active,      l: "Active"  },
    { n: premium,     l: "Premium" },
  ].map(s => `<div class="pt-wh-sc"><span class="pt-wh-sn">${s.n}</span><span class="pt-wh-sl">${s.l}</span></div>`).join("");
}

function renderNoticeboard(tags) {
  const nb = document.getElementById("noticeboard");
  if (!nb) return;

  const total    = tags.length;
  const active   = tags.filter(t => t.status !== "inactive").length;
  const premium  = tags.filter(t => t.premium).length;
  const freeLeft = tags.filter(t => !t.premium && !t.freeContactUsed).length;
  const used     = tags.filter(t => !t.premium &&  t.freeContactUsed).length;

  const ka = (key) => _nbFilter === key ? " nb-active" : "";
  const FILTER_NAMES = { active: "Active", premium: "Premium", free: "Free Calls Left", used: "Call Used" };

  const hd = `
<div class="pt-ov-hd">
  <h2 class="pt-ov-title">Overview</h2>
  <div class="pt-ov-bar"></div>
  <p class="pt-ov-sub">${total} Vehicle${total !== 1 ? "s" : ""} registered</p>
</div>
<div class="pt-ov-kpis">
  <div class="pt-ov-kpi${ka("active")}" data-filter="active" onclick="window.applyNbFilter('active')" title="Filter: Active">
    <div class="pt-ov-ki" style="background:#DCFCE7">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#10B981" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <span class="pt-ov-kn green">${active}</span>
    <div class="pt-ov-kl">Active Tags</div>
  </div>
  <div class="pt-ov-kpi${ka("premium")}" data-filter="premium" onclick="window.applyNbFilter('premium')" title="Filter: Premium">
    <div class="pt-ov-ki" style="background:#FEF3C7">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6L12 2z" stroke="#D97706" stroke-width="1.7" stroke-linejoin="round"/></svg>
    </div>
    <span class="pt-ov-kn amber">${premium}</span>
    <div class="pt-ov-kl">Premium Tags</div>
  </div>
  <div class="pt-ov-kpi${ka("free")}" data-filter="free" onclick="window.applyNbFilter('free')" title="Filter: Free calls left">
    <div class="pt-ov-ki" style="background:#DBEAFE">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.36 2 2 0 0 1 3.59 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.73a16 16 0 0 0 6.36 6.36l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="#2563EB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <span class="pt-ov-kn">${freeLeft}</span>
    <div class="pt-ov-kl">Free Calls Left</div>
  </div>
  <div class="pt-ov-kpi${ka("used")}" data-filter="used" onclick="window.applyNbFilter('used')" title="Filter: Call used">
    <div class="pt-ov-ki" style="background:#FEE2E2">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#EF4444" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" stroke="#EF4444" stroke-width="2" stroke-linecap="round"/></svg>
    </div>
    <span class="pt-ov-kn${used ? " red" : ""}">${used}</span>
    <div class="pt-ov-kl">Calls Used</div>
  </div>
</div>
${_nbFilter ? `
<div class="pt-ov-fbar visible">
  <span>Filtered: <strong>${FILTER_NAMES[_nbFilter] || _nbFilter}</strong></span>
  <button class="pt-ov-fbar-clear" onclick="window.clearNbFilter()">✕ Clear</button>
</div>` : ""}`;

  if (total === 0) {
    nb.innerHTML = hd + `<div class="pt-ov-empty">Add your first vehicle to see tag status here.</div>`;
    return;
  }

  const rows = tags.map(tag => {
    const plate = tag.plateNumber || tag.number || "—";
    const vtype = tag.vehicleLabel || VEHICLE_LABELS[tag.vehicleType || tag.type] || "Vehicle";
    const on    = tag.status !== "inactive";
    const badge = tag.premium ? "Unlimited" : (!tag.freeContactUsed ? "1 Free Left" : "Call Used");
    const bc    = tag.premium ? "vp-premium" : (!tag.freeContactUsed ? "vp-free" : "vp-used");
    return `
<div class="pt-ov-row">
  <span class="pt-ov-dot ${on ? "on" : "off"}"></span>
  <div class="pt-ov-body">
    <p class="pt-ov-plate">${plate}</p>
    <p class="pt-ov-vtype">${vtype} · ${on ? "Active" : "Inactive"}</p>
  </div>
  <span class="pt-ov-badge ${bc}">${badge}</span>
</div>`;
  }).join("");

  const tipIcon = freeLeft < total && !premium
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6L12 2z" stroke="#D97706" stroke-width="1.8" stroke-linejoin="round"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#10B981" stroke-width="2"/><path d="M9 12l2 2 4-4" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const tipText = freeLeft < total && !premium
    ? `Upgrade to <strong>Premium</strong> for unlimited private contact. Your number stays hidden.`
    : `Each free E-Tag includes <strong>1 free contact</strong> via masked call or WhatsApp.`;

  nb.innerHTML = hd + `
<div class="pt-ov-rows">
  <div class="pt-ov-rows-hd">Tag Status</div>
  ${rows}
</div>
<div class="pt-ov-tip">
  <span class="pt-ov-tip-ic">${tipIcon}</span>
  <span>${tipText}</span>
</div>`;
}

// ── Activity section ──────────────────────────────────────────────
function formatTimeAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function renderActivity(requests) {
  const container = document.getElementById("actCards");
  const badge     = document.getElementById("actBadge");
  if (!container) return;

  if (!requests || !requests.length) {
    container.innerHTML = `
      <div class="pt-act-empty">
        <div class="pt-act-empty-ic">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#D1D5DB" stroke-width="2" stroke-linecap="round"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#D1D5DB" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="pt-act-empty-t">No activity yet</p>
        <p class="pt-act-empty-s">Contact requests from scanners will appear here</p>
      </div>`;
    if (badge) badge.style.display = "none";
    return;
  }

  const now        = Date.now();
  const WIN_MS     = 60 * 60 * 1000;
  const TWO_DAYS   = 48 * 60 * 60 * 1000;

  // Only show entries from the last 2 days
  const recent = requests.filter(r =>
    (now - new Date(r.createdAt).getTime()) <= TWO_DAYS
  );

  // Most recent request within the 60-min callback window
  const eligible = recent.find(r =>
    r.action === "call" && (now - new Date(r.createdAt).getTime()) <= WIN_MS
  );

  // Count how many are within the window (actionable)
  const hotCount = recent.filter(r =>
    (now - new Date(r.createdAt).getTime()) <= WIN_MS
  ).length;

  if (badge) {
    badge.textContent    = hotCount;
    badge.style.display  = hotCount ? "inline-block" : "none";
  }

  // ── Callback prompt (after Overview) ──────────────────────────
  const prompt = document.getElementById("callbackPrompt");
  if (prompt) {
    if (eligible) {
      const ageMs  = Date.now() - new Date(eligible.createdAt).getTime();
      const tag    = allTags.find(t => t.token === eligible.token);
      const plate  = tag?.plateNumber || tag?.number || "your vehicle";
      const masked = eligible.phone ? `•••• ${String(eligible.phone).slice(-4)}` : "Unknown caller";
      const cta    = _ownerMobile
        ? `<button class="pt-act-cta" id="cbBtnPrompt" onclick="callBack('cbBtnPrompt')" style="flex-shrink:0">Call Back</button>`
        : `<span class="pt-act-nophone" style="flex-shrink:0">Add phone<br>to call back</span>`;
      prompt.style.display = "block";
      prompt.innerHTML = `
<div class="pt-cb-prompt">
  <div class="pt-cb-prompt-hd">
    <span class="pt-cb-pulse"></span>
    <span class="pt-cb-prompt-label">Someone wants you to call back</span>
  </div>
  <div class="pt-act-card urgent" style="margin:0;border-radius:14px">
    <div class="pt-act-ic" style="background:#FFE3DD;color:#FF2700">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.17h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.86a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="1.8"/></svg>
    </div>
    <div class="pt-act-body">
      <p class="pt-act-who">${masked} contacted you</p>
      <p class="pt-act-det">${plate} · Call</p>
      <p class="pt-act-time">${formatTimeAgo(ageMs)}</p>
    </div>
    ${cta}
  </div>
</div>`;
    } else {
      prompt.style.display = "none";
      prompt.innerHTML = "";
    }
  }

  const callSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.17h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.86a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const waSvg  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  if (!recent.length) {
    container.innerHTML = `
      <div class="pt-act-empty">
        <div class="pt-act-empty-ic">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#D1D5DB" stroke-width="2" stroke-linecap="round"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#D1D5DB" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="pt-act-empty-t">No recent activity</p>
        <p class="pt-act-empty-s">Activity older than 2 days is hidden</p>
      </div>`;
    if (badge) badge.style.display = "none";
    return;
  }

  const cards = recent.slice(0, 20).map(r => {
    const ageMs  = now - new Date(r.createdAt).getTime();
    const within = ageMs <= WIN_MS;
    const isCall = r.action === "call";
    const isElig = r === eligible;

    // Match token → vehicle plate
    const tag    = allTags.find(t => t.token === r.token);
    const plate  = tag?.plateNumber || tag?.number || "your vehicle";
    const masked = r.phone ? `•••• ${String(r.phone).slice(-4)}` : "Unknown caller";

    let cardCls, icBg, icCol;
    if (isElig)              { cardCls = "urgent"; icBg = "#FFE3DD"; icCol = "#FF2700"; }
    else if (isCall && within) { cardCls = "call";   icBg = "#DBEAFE"; icCol = "#2563EB"; }
    else if (!isCall)        { cardCls = "wa";     icBg = "#DCFCE7"; icCol = "#16A34A"; }
    else                     { cardCls = "idle";   icBg = "#F3F4F6"; icCol = "#9CA3AF"; }

    // Call result badge
    let resultBadge = "";
    if (isCall && r.callResult) {
      const label = r.callResult === "connected" ? "Connected"
                  : r.callResult === "no-answer"  ? "No answer" : "Failed";
      const bg    = r.callResult === "connected" ? "background:#DCFCE7;color:#14532D"
                                                 : "background:#FEE2E2;color:#B91C1C";
      resultBadge = `<span class="pt-act-det-badge" style="${bg}">${label}</span>`;
      if (r.callDuration) resultBadge += `<span style="color:#9CA3AF;font-size:.67rem">${r.callDuration}s</span>`;
    }
    if (!isCall && r.status) {
      const label = r.status === "delivered" ? "Delivered" : r.status === "pending" ? "Pending" : r.status;
      resultBadge = `<span class="pt-act-det-badge" style="background:#DCFCE7;color:#14532D">${label}</span>`;
    }

    // CTA
    let cta = "";
    if (isElig) {
      if (!_ownerMobile) {
        cta = `<span class="pt-act-nophone">Add phone<br>to call back</span>`;
      } else {
        cta = `<button class="pt-act-cta" id="cbBtn" onclick="callBack()">Call Back</button>`;
      }
    }

    return `
<div class="pt-act-card ${cardCls}">
  <div class="pt-act-ic" style="background:${icBg};color:${icCol}">${isCall ? callSvg : waSvg}</div>
  <div class="pt-act-body">
    <p class="pt-act-who">${masked} contacted you</p>
    <p class="pt-act-det">${plate} · ${isCall ? "Call" : "WhatsApp"} ${resultBadge}</p>
    <p class="pt-act-time">${formatTimeAgo(ageMs)}</p>
  </div>
  ${cta}
</div>`;
  }).join("");

  container.innerHTML = cards;
}

async function callBack(btnId = "cbBtn") {
  const btn = document.getElementById(btnId);
  if (btn) { btn.disabled = true; btn.textContent = "Calling…"; }
  try {
    const res  = await fetch("/api/owner/callback/register-call", { method: "POST" });
    const data = await res.json();
    if (data.ok && data.virtualNumber) {
      if (btn) { btn.textContent = "Opening dialer…"; btn.classList.add("ok"); }
      setTimeout(() => { window.location.href = `tel:${data.virtualNumber}`; }, 120);
    } else if (data.code === "NO_PHONE") {
      _toast("Add your mobile number to your profile to enable callback.", "err");
      if (btn) { btn.disabled = false; btn.textContent = "Call Back"; }
    } else if (data.code === "CALLBACK_WINDOW_EXPIRED") {
      _toast("The 60-minute callback window has passed.", "err");
      renderActivity(allRequests); // re-render to remove the button
    } else {
      _toast(data.error || "Couldn't initiate callback. Try again.", "err");
      if (btn) { btn.disabled = false; btn.textContent = "Call Back"; }
    }
  } catch {
    _toast("Network error. Please try again.", "err");
    if (btn) { btn.disabled = false; btn.textContent = "Call Back"; }
  }
}
window.callBack = callBack;

async function saveMobile() {
  const input  = document.getElementById("mi-mobile-input");
  const status = document.getElementById("mi-mobile-status");
  const raw    = (input?.value || "").trim().replace(/\D/g, "");

  if (!raw || raw.length < 10) {
    if (status) { status.textContent = "Enter a valid 10-digit number."; status.style.color = "#DC2626"; status.style.display = "block"; }
    return;
  }

  const mobile = raw.length === 10 ? `+91${raw}` : `+${raw}`;

  try {
    const res  = await fetch("/api/owner/mobile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile })
    });
    const data = await res.json();
    if (data.ok) {
      _ownerMobile = mobile;
      const mobileEl = document.getElementById("mi-mobile");
      if (mobileEl) { mobileEl.textContent = mobile; mobileEl.style.color = "#03162D"; }
      const mobileEdit = document.getElementById("mi-mobile-edit");
      if (mobileEdit) mobileEdit.style.display = "none";
      const mobileAlert = document.getElementById("mobile-missing-alert");
      if (mobileAlert) mobileAlert.style.display = "none";
      if (status) { status.textContent = "Phone number saved."; status.style.color = "#16A34A"; status.style.display = "block"; }
      _toast("Phone number saved. Call Back is now enabled.", "ok");
      renderActivity(allRequests);
    } else {
      if (status) { status.textContent = data.error || "Failed to save."; status.style.color = "#DC2626"; status.style.display = "block"; }
    }
  } catch {
    if (status) { status.textContent = "Network error. Try again."; status.style.color = "#DC2626"; status.style.display = "block"; }
  }
}
window.saveMobile = saveMobile;

// ── Notice board KPI filter ───────────────────────────────────────
function applyNbFilter(key) {
  if (_nbFilter === key) { clearNbFilter(); return; }
  _nbFilter = key;
  renderGrid(getDisplayTags());
  renderNoticeboard(allTags);
  const bar = document.getElementById("mainFilterBar");
  const lbl = document.getElementById("mainFilterLabel");
  if (bar && lbl) {
    const names = { active: "Active", premium: "Premium", free: "Free Calls Left", used: "Call Used" };
    lbl.textContent = names[key] || key;
    bar.classList.add("visible");
  }
}

function clearNbFilter() {
  _nbFilter = null;
  renderGrid(getDisplayTags());
  renderNoticeboard(allTags);
  const bar = document.getElementById("mainFilterBar");
  if (bar) bar.classList.remove("visible");
}

window.applyNbFilter = applyNbFilter;
window.clearNbFilter = clearNbFilter;

// ── Search filter ─────────────────────────────────────────────────
searchInp.addEventListener("input", () => {
  renderGrid(getDisplayTags());
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

// ── Auto-sync localStorage-only vehicles to the DB ───────────────
// Fires silently after the grid renders. For each vehicle that exists only in
// localStorage (e.g. API save failed during registration, or DB was reseeded),
// it retries POST /api/owner/local-vehicle. On success the vehicle gets a real
// token + QR; the localStorage entry is removed and the grid re-renders with
// the real tag data.
async function syncLocalVehicles(localVehicles, userId) {
  let synced = false;
  for (const v of localVehicles) {
    const number = (v.number || v.plateNumber || "").trim().toUpperCase();
    const type   = v.type || v.vehicleType || null;
    if (!number) continue;
    try {
      const res = await fetch("/api/owner/local-vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, number })
      });
      if (res.ok || res.status === 409) {
        try {
          const key = userKey(userId);
          const arr = JSON.parse(localStorage.getItem(key) || "[]");
          localStorage.setItem(key, JSON.stringify(arr.filter(s => (s.number || "").toUpperCase() !== number)));
        } catch {}
        try {
          const arr = JSON.parse(localStorage.getItem("pt_pending_vehicles") || "[]");
          localStorage.setItem("pt_pending_vehicles", JSON.stringify(arr.filter(s => (s.number || "").toUpperCase() !== number)));
        } catch {}
        synced = true;
      }
    } catch {}
  }
  if (!synced) return;
  try {
    const res = await fetch("/api/owner/dashboard");
    if (!res.ok) return;
    const data = await res.json();
    const seen = new Set();
    allTags = (data.tags || []).filter(t => {
      const p = (t.plateNumber || "").toUpperCase();
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    renderGrid(getDisplayTags(), true);
    updateHeaderStats(allTags);
    renderNoticeboard(allTags);
  } catch {}
}

// ── Load data ─────────────────────────────────────────────────────
async function load() {
  grid.innerHTML = skeletonGrid(3);
  try {
    const res = await fetch("/api/owner/dashboard");
    if (res.status === 401 || res.status === 403) {
      window.location.href = "/owner-login";
      return;
    }
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

      // Populate burger menu owner header
      _owner       = data.owner;
      _ownerMobile = data.owner.mobile || null;
      _userId = id || String(data.owner._id || "");
      const mName = document.getElementById("menuName");
      const mId   = document.getElementById("menuId");
      const mAv   = document.getElementById("menuAvatar");
      if (mName) mName.textContent = firstName;
      if (mId)   mId.textContent   = id;
      if (mAv)   mAv.textContent   = firstName.charAt(0).toUpperCase();
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

    allTags     = [...localOnly, ...dedupedApi];
    allRequests = data.requests || [];
    renderGrid(getDisplayTags(), true);
    updateHeaderStats(allTags);
    renderNoticeboard(allTags);
    renderActivity(allRequests);
    if (localOnly.length > 0) syncLocalVehicles(localOnly, userId);
  } catch {
    grid.innerHTML = `
      <div role="alert" style="grid-column:1/-1;text-align:center;padding:28px 16px 12px">
        <p style="font-size:.9rem;font-weight:700;color:#374151;margin:0 0 10px">${UI.loadError}</p>
        <button onclick="load()"
          style="background:#FF2700;color:#fff;border:none;border-radius:10px;
                 padding:9px 22px;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit">
          ${UI.retry}
        </button>
      </div>` + ADD_CARD;
  }
}

// Show skeleton immediately so layout is stable before API responds
if (grid) grid.innerHTML = skeletonGrid(3);
load();
window._reloadDashboard = load;

// Deep-link from the vehicle-detail page: /owner-welcome?shop=1&replace=<tagId>
// opens the shop with the trial tag remembered as the replace-context (M18).
(function openShopFromQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get("shop") === "1") {
    window._replaceTagId = q.get("replace") || null;
    // Defer until the shop tab wiring is ready.
    setTimeout(() => { if (typeof switchTab === "function") switchTab("shop"); }, 0);
  }
})();

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

// ── Burger menu ────────────────────────────────────────────────────

function _vKey(tag) {
  // Same key format as vehicle-detail.js so toggle state is shared between pages
  return "pt_vd_toggles_" + (tag.plateNumber || tag.number || "demo");
}

function _sosKey(tag) {
  // Same key format as vehicle-detail.js
  return "pt_sos_" + (tag.plateNumber || tag.number || "");
}

function _loadSw(tag) {
  const def = { tagActive: true, callsActive: true, callMasking: true,
                pushNotif: true, emailAlerts: true, whatsapp: false, location: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(_vKey(tag)) || "{}") }; }
  catch { return def; }
}

function saveSw(el, key) {
  const tag = allTags[_selIdx];
  if (!tag) return;
  const s = _loadSw(tag);
  s[key] = el.checked;
  localStorage.setItem(_vKey(tag), JSON.stringify(s));

  // Tag Active is backed by a real API endpoint
  if (key === "tagActive") {
    const tagId = tag.id || String(tag._id || "");
    if (!tagId) return;
    const swEl = el;
    fetch(`/api/owner/tags/${tagId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: el.checked ? "active" : "inactive" })
    }).catch(() => {
      // Revert toggle on failure
      s[key] = !el.checked;
      localStorage.setItem(_vKey(tag), JSON.stringify(s));
      swEl.checked = !swEl.checked;
      _toast("Couldn't update tag status. Try again.", "err");
    });
  }
}
window.saveSw = saveSw;

function saveSos() {
  const tag = allTags[_selIdx];
  const num = (document.getElementById("sos-inp")?.value || "").trim();
  if (!num) { _toast("Please enter an emergency contact number.", "err"); return; }
  if (tag) localStorage.setItem(_sosKey(tag), num);
  _toast("Emergency contact saved.", "ok");
}
window.saveSos = saveSos;

function _fillMenu() {
  const removeBtn = document.getElementById("menuRemoveBtn");
  const tag = allTags[_selIdx];

  if (!tag) {
    const vsm = document.getElementById("menuVSummary");
    if (vsm) vsm.style.display = "none";
    if (removeBtn) removeBtn.style.display = "none";
    return;
  }

  const vsm = document.getElementById("menuVSummary");
  if (vsm) vsm.style.display = "flex";
  if (removeBtn) removeBtn.style.display = "";

  const plate = tag.plateNumber || tag.number || "—";
  const type  = tag.vehicleType || tag.type || "car";
  const label = tag.vehicleLabel || VEHICLE_LABELS[type] || "Vehicle";

  // Vehicle color for this selection
  const color = VEHICLE_COLORS[_selIdx % VEHICLE_COLORS.length];

  // ── Sticky label (Option 3) ──
  const stickyEl  = document.getElementById("stickyVehicle");
  const stickyDot = document.getElementById("stickyDot");
  const stickyPl  = document.getElementById("stickyPlate");
  const stickyTy  = document.getElementById("stickyType");
  if (stickyEl)  { stickyEl.style.borderLeftColor = color.accent; stickyEl.style.background = color.bg + "CC"; }
  if (stickyDot) stickyDot.style.background = color.accent;
  if (stickyPl)  stickyPl.textContent = plate;
  if (stickyTy)  stickyTy.textContent = label;

  // ── Profile header accent (Option 4) ──
  const ph = document.querySelector(".pt-menu-ph");
  if (ph) ph.style.borderBottom = `3px solid ${color.accent}`;

  const vpEl = document.getElementById("menuVPlate");
  const vtEl = document.getElementById("menuVType");
  const viEl = document.getElementById("menuVIcon");
  if (vpEl) vpEl.textContent = plate;
  if (vtEl) vtEl.textContent = label;
  if (viEl) {
    viEl.innerHTML = (VEHICLE_SVGS[type] || VEHICLE_SVGS.car)
      .replace(/width="28"/, 'width="22"').replace(/height="28"/, 'height="22"');
    viEl.style.background = color.bg;
    viEl.style.color      = color.accent;
  }
  if (vsm) vsm.style.borderColor = color.accent + "55";

  // Vehicle chips — each chip uses its own vehicle's color when active (Option 4)
  const chips = document.getElementById("menuChips");
  if (chips) {
    if (allTags.length > 1) {
      chips.style.display = "flex";
      chips.innerHTML = allTags.map((t, i) => {
        const c = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
        const p = t.plateNumber || t.number || "?";
        const activeStyle = i === _selIdx
          ? `background:${c.accent};border-color:${c.accent};color:#fff`
          : "";
        return `<button class="pt-mchip${i === _selIdx ? " active" : ""}" style="${activeStyle}" onclick="selectV(${i})">${p}</button>`;
      }).join("");
    } else {
      chips.style.display = "none";
    }
  }

  // Contact page link
  const link = document.getElementById("menuContactLink");
  if (link) {
    link.href = tag.scanUrl || "#";
    if (!tag.scanUrl) {
      link.onclick = e => { e.preventDefault(); _toast("Contact page not yet available for this tag.", "err"); };
    } else {
      link.onclick = null;
    }
  }

  // User info panel
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("mi-plate",  plate);
  set("mi-type",   label);
  set("mi-name",   _owner ? (_owner.displayName || _owner.email || _owner.mobile || "—") : "—");
  set("mi-tagid",  tag.token || tag.id || "DEMO");
  const mobileEl = document.getElementById("mi-mobile");
  if (mobileEl) {
    mobileEl.textContent = _ownerMobile || "Not set";
    mobileEl.style.color = _ownerMobile ? "#03162D" : "#6B7280";
  }
  const mobileInput = document.getElementById("mi-mobile-input");
  if (mobileInput && _ownerMobile) {
    mobileInput.value = _ownerMobile.replace(/^\+91/, "");
  }
  // Phone-login users already have their number on file, so show it as detected
  // and hide the input. Only users without a mobile (Google/email login) are
  // asked to enter one.
  const mobileEdit = document.getElementById("mi-mobile-edit");
  if (mobileEdit) mobileEdit.style.display = _ownerMobile ? "none" : "flex";
  const mobileAlert = document.getElementById("mobile-missing-alert");
  if (mobileAlert) mobileAlert.style.display = _ownerMobile ? "none" : "flex";

  // Toggles — Tag Active uses real DB status; rest use localStorage
  const s = _loadSw(tag);
  const sw = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
  sw("sw-tag",      tag.status ? tag.status === "active" : s.tagActive);
  sw("sw-calls",    s.callsActive);
  sw("sw-masking",  s.callMasking);
  sw("sw-push",     s.pushNotif);
  sw("sw-email",    s.emailAlerts);
  sw("sw-whatsapp", s.whatsapp);
  sw("sw-location", s.location);

  // Premium badge
  const premBadge = document.getElementById("menuPremiumBadge");
  if (premBadge) premBadge.style.display = tag.premium ? "inline-block" : "none";

  // SOS number — same key as vehicle-detail.js (plain string, not JSON)
  const sosVal = localStorage.getItem(_sosKey(tag)) || "";
  const sosEl = document.getElementById("sos-inp");
  if (sosEl) sosEl.value = sosVal;
}

function openMenu() {
  _fillMenu();
  document.getElementById("menuBackdrop").classList.add("open");
  document.getElementById("menuDrawer").classList.add("open");
  document.body.style.overflow = "hidden";
}
window.openMenu = openMenu;

function closeMenu() {
  document.getElementById("menuBackdrop").classList.remove("open");
  document.getElementById("menuDrawer").classList.remove("open");
  document.body.style.overflow = "";
}
window.closeMenu = closeMenu;

function toggleMI(item) {
  const wasOpen = item.classList.contains("open");
  document.querySelectorAll("#menuDrawer .pt-mi.open").forEach(el => el.classList.remove("open"));
  if (!wasOpen) item.classList.add("open");
}
window.toggleMI = toggleMI;

function toggleActInfo(e) {
  e.stopPropagation();
  const tip = document.getElementById("actInfoTooltip");
  const btn = document.getElementById("actInfoBtn");
  if (!tip) return;
  const visible = tip.style.display !== "none";
  tip.style.display = visible ? "none" : "block";
  if (btn) btn.style.color = visible ? "#9CA3AF" : "#FF2700";
}
window.toggleActInfo = toggleActInfo;

function togglePhoneInfo(e) {
  e.stopPropagation();
  const tip = document.getElementById("phoneInfoTooltip");
  const btn = document.getElementById("phoneInfoBtn");
  if (!tip) return;
  const visible = tip.style.display !== "none";
  tip.style.display = visible ? "none" : "block";
  if (btn) btn.style.color = visible ? "#D97706" : "#92400E";
}
window.togglePhoneInfo = togglePhoneInfo;

document.addEventListener("click", () => {
  [
    { tip: "actInfoTooltip",   btn: "actInfoBtn",   defaultColor: "#9CA3AF" },
    { tip: "phoneInfoTooltip", btn: "phoneInfoBtn",  defaultColor: "#D97706" },
  ].forEach(({ tip: tipId, btn: btnId, defaultColor }) => {
    const tip = document.getElementById(tipId);
    const btn = document.getElementById(btnId);
    if (tip && tip.style.display !== "none") {
      tip.style.display = "none";
      if (btn) btn.style.color = defaultColor;
    }
  });
});

function goToPhoneSetup() {
  // Open the User Info accordion and focus the phone number input
  document.querySelectorAll("#menuDrawer .pt-mi.open").forEach(el => el.classList.remove("open"));
  const userInfoItem = document.querySelector("#menuDrawer .pt-mi[data-key='user-info']");
  if (userInfoItem) userInfoItem.classList.add("open");
  setTimeout(() => {
    const phoneInput = document.getElementById("mi-mobile-input");
    if (phoneInput) {
      phoneInput.scrollIntoView({ behavior: "smooth", block: "center" });
      phoneInput.focus();
    }
  }, 300);
}
window.goToPhoneSetup = goToPhoneSetup;

function selectV(idx) {
  _selIdx = idx;
  document.querySelectorAll("#menuDrawer .pt-mi.open").forEach(el => el.classList.remove("open"));
  _fillMenu();
}
window.selectV = selectV;

function goToVehicleDetail(section) {
  const tag = allTags[_selIdx];
  if (!tag) return;
  const plate = tag.plateNumber || tag.number || "";
  const type  = tag.vehicleType || tag.type || "car";
  const label = tag.vehicleLabel || VEHICLE_LABELS[type] || "Vehicle";
  const params = new URLSearchParams({
    number: plate, type, label,
    id: tag.id || String(tag._id || ""),
    token: tag.token || "",
    open: section
  }).toString();
  window.location.href = `/owner-vehicle-detail?${params}`;
}
window.goToVehicleDetail = goToVehicleDetail;

function downloadETag() {
  const tag = allTags[_selIdx];
  if (!tag) { _toast("No vehicle selected.", "err"); return; }
  const plate = tag.plateNumber || tag.number || "—";
  const etagId = tag.etagId ? String(tag.etagId).replace(/^PT-/, "") : "—";
  const status = tag.status === "inactive" ? "Inactive" : "Active";
  const qr = tag.qrDataUrl || "";

  const numEl = document.getElementById("wl-print-vehicle-num");
  const idEl  = document.getElementById("wl-print-etag-id");
  const stEl  = document.getElementById("wl-print-status");
  const qrEl  = document.getElementById("wl-print-qr-img");

  if (numEl) numEl.textContent = plate;
  if (idEl)  idEl.textContent  = etagId;
  if (stEl)  stEl.textContent  = status;
  if (qrEl)  qrEl.src          = qr;

  setTimeout(() => window.print(), 80);
}
window.downloadETag = downloadETag;

// Download the official E-Tag sticker for a specific tag (by id), independent of
// the burger-menu selection. Reuses the shared hidden print template.
function downloadETagFor(tagId) {
  const tag = allTags.find(t => String(t.id) === String(tagId));
  if (!tag) { _toast("Vehicle not found.", "err"); return; }
  const plate  = tag.plateNumber || tag.number || "—";
  const etagId = tag.etagId ? String(tag.etagId).replace(/^PT-/, "") : "—";
  const status = tag.status === "inactive" ? "Inactive" : "Active";
  const qr     = tag.qrDataUrl || "";

  const numEl = document.getElementById("wl-print-vehicle-num");
  const idEl  = document.getElementById("wl-print-etag-id");
  const stEl  = document.getElementById("wl-print-status");
  const qrEl  = document.getElementById("wl-print-qr-img");

  if (numEl) numEl.textContent = plate;
  if (idEl)  idEl.textContent  = etagId;
  if (stEl)  stEl.textContent  = status;
  if (qrEl)  qrEl.src          = qr;

  setTimeout(() => window.print(), 80);
}
window.downloadETagFor = downloadETagFor;

// Send the owner to the shop to buy a premium tag that REPLACES a spent
// free-trial tag (M18). The old tag id is remembered so the shop's create-order
// can pass it as replaceTagId; on a paid order the backend mints a new premium
// tag and soft-removes this old free tag, then the dashboard reloads.
function goToShopForReplace(tagId) {
  window._replaceTagId = tagId || null;
  if (typeof switchTab === "function") switchTab("shop");
}
window.goToShopForReplace = goToShopForReplace;

function goToShop() {
  closeMenu();
  window._replaceTagId = null; // generic shop visit — not a trial replacement
  if (typeof switchTab === "function") switchTab("shop");
}
window.goToShop = goToShop;

async function removeVehicle() {
  const tag = allTags[_selIdx];
  if (!tag) return;
  const plate = tag.plateNumber || tag.number || "this vehicle";
  if (!confirm(`Remove ${plate}? This cannot be undone.`)) return;
  const tagId = tag.id || String(tag._id || "");
  if (!tagId) {
    try {
      const key = userKey(_userId || "");
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify(
        arr.filter(v => (v.number || "").toUpperCase() !== (tag.number || "").toUpperCase())
      ));
    } catch {}
    _selIdx = 0;
    closeMenu();
    load();
    return;
  }
  try {
    const res = await fetch(`/api/owner/tags/${tagId}`, { method: "DELETE" });
    if (res.ok) {
      _selIdx = 0;
      closeMenu();
      _toast(`${plate} removed.`, "ok");
      load();
    } else {
      _toast("Couldn't remove vehicle. Try again.", "err");
    }
  } catch {
    _toast("Couldn't remove vehicle. Try again.", "err");
  }
}
window.removeVehicle = removeVehicle;

async function signOut() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
  sessionStorage.clear();
  window.location.href = "/owner-login";
}
window.signOut = signOut;

function _toast(msg, tone) {
  const existing = document.getElementById("pt-toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.id = "pt-toast";
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed", bottom: "90px", left: "50%", transform: "translateX(-50%)",
    background: tone === "ok" ? "#FF2700" : "#EF4444",
    color: "#fff", padding: "11px 20px", borderRadius: "11px",
    fontWeight: "700", fontSize: ".85rem", zIndex: "9999",
    boxShadow: "0 4px 16px rgba(0,0,0,.18)", maxWidth: "88vw",
    textAlign: "center", whiteSpace: "nowrap"
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
