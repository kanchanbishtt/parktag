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

// The prev/next arrows are gone from the markup: they sat on top of the banner
// artwork and covered the words at both edges, and the slides exist to be read.
// The dots, a swipe, and the auto-advance below are the ways through them.
//
// These listeners were attached WITHOUT a null check, at the top level of this
// module — so removing the buttons alone would have thrown here and killed
// every line of dashboard setup that follows.
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

// ── Name on the greeting ─────────────────────────────────────────
// Sign-in only ever collects an email or a mobile, so most owners arrive with
// no name at all. Rather than taxing the sign-in flow for a greeting, the
// greeting asks for itself: "Hi there!" carries a quiet "Add your name", and an
// owner who already has one gets a pencil. Ignoring it costs nothing.
let _ownerName = "";        // the name stored on the profile, "" if none

function renderGreetingAffordance(owner) {
  if (!nameEdit) return;
  _ownerName = owner.displayName || "";
  const has = Boolean(owner.hasOwnName);
  nameEdit.dataset.mode = has ? "edit" : "add";
  nameEdit.innerHTML = has ? PENCIL_SVG : `${PENCIL_SVG}<span>Add your name</span>`;
  nameEdit.setAttribute("aria-label", has ? "Edit your name" : "Add your name");
  nameEdit.title = has ? "Edit your name" : "Add your name";
  nameEdit.hidden = false;
}

function openNameEditor() {
  if (!nameForm) return;
  nameInput.value = _ownerName;
  // Only the greeting line gives way to the field — the email/mobile beneath it
  // stays put. Hiding that too made the whole header lurch and left the owner
  // with no sign of which account they were editing.
  if (greetRow) greetRow.hidden = true;
  nameForm.hidden = false;
  setNameStatus("");
  nameInput.focus();
  nameInput.select();
}

function closeNameEditor() {
  if (!nameForm) return;
  nameForm.hidden = true;
  if (greetRow) greetRow.hidden = false;
  setNameStatus("");
}

function setNameStatus(message) {
  if (!nameStatus) return;
  nameStatus.textContent = message || "";
  nameStatus.hidden = !message;
}

async function saveOwnerName(event) {
  event?.preventDefault();
  const value = (nameInput?.value || "").trim();

  const save = document.getElementById("greet-name-save");
  if (save) save.disabled = true;
  try {
    const res = await fetch("/api/owner/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: value })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      // Only a 400 carries a message written for a person ("at least 2
      // characters"). Anything else is the framework talking — a bare "Not
      // Found" from a route that isn't deployed yet means nothing to whoever
      // is typing their name, so it does not get shown to them.
      setNameStatus(
        res.status === 400 && data.error ? data.error : "Could not save your name. Please try again."
      );
      return;
    }
    _ownerName = data.displayName || "";
    if (greetName) {
      greetName.textContent = `${UI.greetPrefix} ${data.greetingName || UI.greetFallback}!`;
    }
    renderGreetingAffordance({ displayName: _ownerName, hasOwnName: data.hasOwnName });
    // Keep the menu's owner panel in step — it reads the same name. Updated
    // directly rather than through that panel's own `set` helper, which is a
    // local inside its render function and not in scope here.
    if (_owner) {
      _owner.displayName = _ownerName;
      _owner.hasOwnName = data.hasOwnName;
      const miName = document.getElementById("mi-name");
      if (miName) miName.textContent = _ownerName || _owner.email || _owner.mobile || "—";
    }
    closeNameEditor();
  } catch {
    setNameStatus("Network error. Please try again.");
  } finally {
    if (save) save.disabled = false;
  }
}

// ── DOM refs ─────────────────────────────────────────────────────
const greetName = document.getElementById("greetName");
const greetId   = document.getElementById("greetId");
const nameEdit    = document.getElementById("greet-name-edit");
const nameForm    = document.getElementById("greet-name-form");
const nameInput   = document.getElementById("greet-name-input");
const nameCancel  = document.getElementById("greet-name-cancel");
const nameStatus  = document.getElementById("greet-name-status");
const greetRow    = document.getElementById("greet-display");

const PENCIL_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Bound here rather than beside the handlers above: these run at module load,
// and the elements they attach to are declared in this block.
nameEdit?.addEventListener("click", openNameEditor);
nameForm?.addEventListener("submit", saveOwnerName);
nameCancel?.addEventListener("click", closeNameEditor);
// Escape backs out, the same as Cancel — the field is dismissible by design.
nameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeNameEditor(); }
});
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
  bus: "Bus"
};

// ── Type-specific vehicle artwork ────────────────────────────────
// The same six drawings the activation picker uses (VEHICLE_ICON_SRC in
// scripts/scanner/app.js), so the type someone picks when activating a tag is
// the icon they meet again here. <img> rather than inline SVG because the four
// road-vehicle files are raster inside an SVG wrapper; the consequence is that
// these no longer inherit the card's text colour.
const VEHICLE_ICON_SRC = {
  car: "/images/car-tag.svg",
  bike: "/images/bike-tag.svg",
  scooter: "/images/vtype-scooter.png",
  auto_rickshaw: "/images/vtype-auto.png",
  truck: "/images/vtype-truck.png",
  bus: "/images/vtype-bus.png"
};

const VEHICLE_SVGS = Object.fromEntries(
  Object.entries(VEHICLE_ICON_SRC).map(([type, src]) => [
    type,
    `<img src="${src}" alt="" width="28" height="28" decoding="async" aria-hidden="true" style="display:block;object-fit:contain">`
  ])
);

// HTML-escape any value before interpolating it into innerHTML. vehicleLabel
// and plateNumber are owner-supplied free text (from registration/claim/add-
// vehicle) with no character allowlist on the backend, so they can contain
// `<`, `"`, etc. They're rendered here via innerHTML (not textContent), so an
// unescaped value would execute as HTML/script in this owner's own dashboard.
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

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
  // Owner-supplied free text, HTML-escaped before it's placed inside markup
  // below (the raw `label`/`plate` are still used for URLSearchParams, which
  // does its own percent-encoding — escaping there would double-encode it).
  const labelSafe = esc(label);
  const plateSafe = esc(plate);
  const params    = new URLSearchParams({ number: plate, type, label, id: tag.id || "", token: tag.token || "" }).toString();
  const svg       = iconFor(tag);
  const isActive  = tag.status !== "inactive";
  const pill      = tag.premium ? "★ Premium" : (!tag.freeContactUsed ? "1 Free Call" : "Call Used");
  const pillClass = tag.premium ? "vp-premium" : (!tag.freeContactUsed ? "vp-free" : "vp-used");
  const detailUrl = `/owner-vehicle-detail?${params}`;
  // Card action row (both active and inactive cards). Three states (M18):
  //  • premium            → Download Premium Tag (official sticker)
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
        Download Premium Tag
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
       aria-label="${labelSafe}, ${plateSafe}, ${isActive ? "active" : "inactive"}">
    <div class="pt-vlc-icon" style="background:${color.bg};color:${color.accent}">${svg}</div>
    <div class="pt-vlc-body">
      <p class="pt-vlc-name">${labelSafe}</p>
      <p class="pt-vlc-plate">${plateSafe}</p>
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

// The Tags / Active / Premium chips have been taken out of the header, so
// there is nothing left to render there. The same three counts are still on
// the page, in the Overview section (see renderNoticeboard).

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
    <p class="pt-ov-plate">${esc(plate)}</p>
    <p class="pt-ov-vtype">${esc(vtype)} · ${on ? "Active" : "Inactive"}</p>
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
      <p class="pt-act-who">${esc(masked)} contacted you</p>
      <p class="pt-act-det">${esc(plate)} · Call</p>
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
    <p class="pt-act-who">${esc(masked)} contacted you</p>
    <p class="pt-act-det">${esc(plate)} · ${isCall ? "Call" : "WhatsApp"} ${resultBadge}</p>
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

// The callback mobile is the number the masked-call feature dials, so it can't
// be saved on trust — the owner must prove control of it with an OTP. Step 1
// (saveMobile) sends the code; step 2 (verifyMobileOtp) verifies it and saves.
function _miMobileFromInput() {
  const raw = (document.getElementById("mi-mobile-input")?.value || "").trim().replace(/\D/g, "");
  if (!raw || raw.length < 10) return null;
  return raw.length === 10 ? `+91${raw}` : `+${raw}`;
}
function _miStatus(msg, color) {
  const status = document.getElementById("mi-mobile-status");
  if (status) { status.textContent = msg; status.style.color = color; status.style.display = "block"; }
}

// Number being verified — set when the code is sent, so the verify step uses
// the exact same number the OTP was sent to.
let _miPendingMobile = null;

async function saveMobile() {
  const mobile = _miMobileFromInput();
  if (!mobile) { _miStatus("Enter a valid 10-digit number.", "#DC2626"); return; }

  const btn = document.getElementById("mi-mobile-send");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  try {
    const res  = await fetch("/api/owner/mobile/send-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile })
    });
    const data = await res.json();
    if (data.ok) {
      _miPendingMobile = mobile;
      const otpRow = document.getElementById("mi-mobile-otp-row");
      if (otpRow) otpRow.style.display = "flex";
      document.getElementById("mi-mobile-otp-input")?.focus();
      _miStatus(`Code sent to ${mobile}. Enter it below to confirm.`, "#16A34A");
    } else {
      _miStatus(data.error || "Could not send the code.", "#DC2626");
    }
  } catch {
    _miStatus("Network error. Try again.", "#DC2626");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send code"; }
  }
}
window.saveMobile = saveMobile;

async function verifyMobileOtp() {
  const otp = (document.getElementById("mi-mobile-otp-input")?.value || "").trim();
  const mobile = _miPendingMobile || _miMobileFromInput();
  if (!mobile) { _miStatus("Enter a valid 10-digit number.", "#DC2626"); return; }
  if (!/^\d{6}$/.test(otp)) { _miStatus("Enter the 6-digit code.", "#DC2626"); return; }

  try {
    const res  = await fetch("/api/owner/mobile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile, otp })
    });
    const data = await res.json();
    if (data.ok) {
      const saved = data.mobile || mobile;
      _ownerMobile = saved;
      _miPendingMobile = null;
      const mobileEl = document.getElementById("mi-mobile");
      if (mobileEl) { mobileEl.textContent = saved; mobileEl.style.color = "#03162D"; }
      const mobileEdit = document.getElementById("mi-mobile-edit");
      if (mobileEdit) mobileEdit.style.display = "none";
      const otpRow = document.getElementById("mi-mobile-otp-row");
      if (otpRow) otpRow.style.display = "none";
      const mobileAlert = document.getElementById("mobile-missing-alert");
      if (mobileAlert) mobileAlert.style.display = "none";
      _miStatus("Phone number verified and saved.", "#16A34A");
      _toast("Phone number verified. Call Back is now enabled.", "ok");
      renderActivity(allRequests);
    } else {
      _miStatus(data.error || "Invalid code. Try again.", "#DC2626");
    }
  } catch {
    _miStatus("Network error. Try again.", "#DC2626");
  }
}
window.verifyMobileOtp = verifyMobileOtp;

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

    // Derive a stable user identifier from the session.
    //
    // Email or mobile only. This used to fall back to the owner's ObjectId, but
    // the server no longer sends it — it is the id every owner route keys off,
    // and no page needs it. The fallback could not fire in any case: an account
    // with neither an email nor a mobile has no way to sign in, so it cannot be
    // the one reading this.
    const userId = data.owner ? (data.owner.email || data.owner.mobile || "") : null;

    if (data.owner) {
      // The server decides the name now: what the owner set, then the recipient
      // name off their delivery address, then a cautious read of the email. The
      // guessing that used to live here turned "info@" into "Hi Info" — a wrong
      // answer stated confidently. A null greetingName means we genuinely do not
      // know, and "Hi there" plus the inline field is the honest response.
      const firstName = data.owner.greetingName || UI.greetFallback;
      const id = data.owner.email || data.owner.mobile || "";
      renderGreetingAffordance(data.owner);
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
      _userId = id;
      // Expose the logged-in owner's contact for the shop checkout (inline script
      // in welcome.html runs in a separate scope and can only read via window).
      // Razorpay prefills from this so the sheet shows the CURRENT user, not a
      // stale cached number.
      window.__ptOwner = {
        // The owner's full name, or empty. Never the greeting's first name and
        // never "there": Razorpay prefills a real checkout field from this, and
        // a placeholder greeting is not a name to bill.
        name: data.owner.displayName || "",
        email: data.owner.email || "",
        contact: data.owner.mobile || ""
      };
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
    renderNoticeboard(allTags);
    renderActivity(allRequests);
    if (localOnly.length > 0) syncLocalVehicles(localOnly, userId);
  } catch (error) {
    // This used to be a bare `catch {}`. Every failure in the whole block —
    // a network fault, a bad payload, a typo in a render helper — surfaced as
    // the same "Couldn't load your vehicles." with no way to tell which, so a
    // rendering bug was indistinguishable from the API being down.
    console.error("[owner dashboard] load failed:", error);
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
//
// The same opener finishes the public buying route. Someone who clicked "Order
// your tag" on the marketing site went /shop → /owner-login?next=shop, which
// parked the intent in sessionStorage; whichever way they then signed in, they
// land here with no query string to speak of, so the parked intent is what
// carries them the last step into the shop. Read once and deleted, so a later
// visit to the dashboard opens on the vehicles tab as usual.
(function openShopFromQuery() {
  const q = new URLSearchParams(location.search);
  const afterLogin = sessionStorage.getItem("pt_after_login");
  sessionStorage.removeItem("pt_after_login");
  if (q.get("shop") === "1" || afterLogin === "shop") {
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

async function saveSos() {
  const tag = allTags[_selIdx];
  const num = (document.getElementById("sos-inp")?.value || "").trim();
  if (!num) { _toast("Please enter an emergency contact number.", "err"); return; }
  if (!tag) { _toast("Select a vehicle first.", "err"); return; }

  // Persist on the tag so the scanner-side Emergency button can actually dial
  // it. localStorage alone only ever reached this one browser.
  if (tag.id) {
    try {
      const res = await fetch(`/api/owner/tags/${tag.id}/emergency-contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emergencyContact: num })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { _toast(data.error || "Could not save the emergency contact.", "err"); return; }
      tag.emergencyContact = data.emergencyContact || null;
      const el = document.getElementById("sos-inp");
      if (el && data.emergencyContact) el.value = data.emergencyContact;
      // The warning has to clear on the same save that fixes it, or the vehicle
      // keeps reading as missing until the drawer is reopened.
      setSosMissing(!data.emergencyContact);
    } catch {
      _toast("Network error — emergency contact not saved.", "err");
      return;
    }
  } else {
    // Local-only vehicle with no server tag to attach to yet.
    localStorage.setItem(_sosKey(tag), num);
  }

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
        return `<button class="pt-mchip${i === _selIdx ? " active" : ""}" style="${activeStyle}" onclick="selectV(${i})">${esc(p)}</button>`;
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

  // Download menu label reflects the tag type: premium tags download the
  // official premium sticker, free tags the generated E-Tag.
  const dlLbl = document.getElementById("mi-download-lb");
  if (dlLbl) dlLbl.textContent = tag.premium ? "Download Premium Tag" : "Download E-Tag";

  // SOS number — server value wins; the localStorage key (same one
  // vehicle-detail.js uses) is only a fallback for local, unsaved vehicles.
  // Only the number the SERVER holds. The old localStorage fallback put a value
  // from this browser into a field the owner had never saved, which read as
  // "already set" for a vehicle that had no SOS at all — and it is the owner's
  // job to nominate someone else, not for us to pre-answer with whatever this
  // device happened to remember. Empty is the correct starting state.
  const sosEl = document.getElementById("sos-inp");
  if (sosEl) sosEl.value = tag.emergencyContact || "";
  // Only a number the SERVER holds counts as set. A value sitting in
  // localStorage exists on one device and cannot be dialled by the scanner
  // flow, so treating it as "done" would hide exactly the gap being flagged.
  setSosMissing(!tag.emergencyContact);
}

// Marks a vehicle with no emergency contact, both inside the panel and on the
// collapsed row, so the gap is visible without opening anything.
function setSosMissing(missing) {
  const note = document.getElementById("sos-missing");
  if (note) note.hidden = !missing;
  const row = document.querySelector('.pt-mi[data-key="sos"], .pt-mi[data-key="emergency"]');
  if (row) row.dataset.sosMissing = missing ? "1" : "0";
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
  // Sticker serial, printed on the sticker face itself (not the sheet).
  const serEl = document.getElementById("wl-print-serial");

  if (numEl) numEl.textContent = plate;
  if (idEl)  idEl.textContent  = etagId;
  if (stEl)  stEl.textContent  = status;
  if (qrEl)  qrEl.src          = qr;
  if (serEl) serEl.textContent = tag.serial || "";

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
  // Sticker serial, printed on the sticker face itself (not the sheet).
  const serEl = document.getElementById("wl-print-serial");

  if (numEl) numEl.textContent = plate;
  if (idEl)  idEl.textContent  = etagId;
  if (stEl)  stEl.textContent  = status;
  if (qrEl)  qrEl.src          = qr;
  if (serEl) serEl.textContent = tag.serial || "";

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
  // replace(), not href: assigning pushes a new entry and leaves the dashboard
  // sitting directly behind it, so one press of Back returned to the page the
  // person had just signed out of. Replacing swaps the dashboard's own entry
  // for the sign-in page, so Back skips past it entirely.
  window.location.replace("/owner-login");
}
window.signOut = signOut;

// Deleting is irreversible, so the session cookie alone does not authorise it.
// The server wants either the account password, or — when the account has none,
// which is every OTP sign-up — a fresh code sent to the address already on the
// account. Which one applies is the server's call, and asking for the code is
// what reveals it: an account with a password is told to use it instead. That
// keeps the old behaviour of prompting for a password the owner may never have
// set out of the flow entirely.
async function deleteAccount() {
  if (!confirm("Permanently delete your account? This removes your account, all vehicles, tags, and history. This cannot be undone.")) return;

  try {
    const sent = await fetch("/api/owner/account/send-delete-code", { method: "POST" });
    const sentData = await sent.json().catch(() => ({}));

    let proof;

    if (sent.ok && sentData.ok) {
      const where = sentData.hint ? ` sent to ${sentData.hint}` : "";
      const otp = prompt(`Enter the 6-digit code${where} to confirm deleting your account:`);
      if (otp === null) return; // cancelled
      proof = { otp: String(otp).trim() };
    } else if (sentData.code === "PASSWORD_REQUIRED") {
      const password = prompt("Enter your password to confirm account deletion:");
      if (password === null) return; // cancelled
      proof = { password };
    } else {
      _toast(sentData.error || "Couldn't start account deletion. Try again.", "err");
      return;
    }

    const res = await fetch("/api/owner/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proof)
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      sessionStorage.clear();
      // replace(), not href: the account is gone, so leaving the dashboard one
      // Back press away restores a page built from a deleted account's data.
      window.location.replace("/owner-login");
      return;
    }
    _toast(data.error || "Couldn't delete account. Try again.", "err");
  } catch {
    _toast("Couldn't delete account. Try again.", "err");
  }
}
window.deleteAccount = deleteAccount;

var _ordersLoaded = false;
var ORDER_STATUS_LABELS = {
  processing: "Preparing to ship",
  cod_confirmed: "Confirmed · Cash on delivery",
  booking_failed: "Couldn't book courier yet — we'll retry",
  booked: "Booked with courier"
};

function humanizeOrderStatus(status) {
  if (ORDER_STATUS_LABELS[status]) return ORDER_STATUS_LABELS[status];
  // Anything else is a raw Delhivery status string (e.g. "Manifested",
  // "In Transit", "Delivered") — show it as-is, lightly formatted.
  return String(status || "Processing").replace(/_/g, " ");
}

async function loadOrdersOnce() {
  if (_ordersLoaded) return;
  _ordersLoaded = true;
  var el = document.getElementById("ordersList");
  if (!el) return;
  try {
    var res = await fetch("/api/owner/orders");
    if (!res.ok) throw new Error();
    var data = await res.json();
    var orders = (data && data.orders) || [];
    if (!orders.length) {
      el.innerHTML = '<p class="pt-snote">No orders yet.</p>';
      return;
    }
    el.innerHTML = orders.map(function (o) {
      var amount = typeof o.amount === "number" ? "₹" + (o.amount / 100).toFixed(0) : "";
      if (amount && o.paymentMethod === "cod") amount += " · COD";
      var date = o.orderedAt ? new Date(o.orderedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
      return '<div class="pt-irow" style="flex-direction:column;align-items:flex-start;gap:2px;padding:10px 0">' +
        '<div style="display:flex;justify-content:space-between;width:100%">' +
        '<span style="font-weight:700;color:#0e1220">' + esc(o.productName || "ParkTag order") + '</span>' +
        '<span style="color:#6b7280;font-size:.78rem">' + esc(amount) + '</span>' +
        '</div>' +
        '<span style="font-size:.78rem;color:#374151">' + esc(humanizeOrderStatus(o.shippingStatus)) + '</span>' +
        (o.orderNumber ? '<span style="font-size:.72rem;color:#9ca3af">Order ' + esc(o.orderNumber) + '</span>' : '') +
        // esc() is an HTML escaper and is NOT safe inside a JS string literal:
        // it turns ' into &#39;, which the HTML parser decodes back to a real
        // quote before the JS is parsed — so an apostrophe would break straight
        // out of the argument. `o.id` is a server-generated ObjectId so this
        // isn't reachable today, but rather than rely on that, require the value
        // to actually look like one before embedding it.
        (o.trackable && /^[a-f0-9]{24}$/i.test(String(o.id || ""))
          ? '<button type="button" onclick="openTracking(\'' + o.id + '\')" style="font-size:.74rem;color:#FF2700;font-weight:700;background:none;border:none;padding:0;cursor:pointer;font-family:inherit">Track order →</button>'
          : (o.waybill ? '<span style="font-size:.72rem;color:#9ca3af">Waybill: ' + esc(o.waybill) + '</span>' : '')) +
        (date ? '<span style="font-size:.7rem;color:#9ca3af">Ordered ' + esc(date) + '</span>' : '') +
        '</div>';
    }).join("");
  } catch {
    _ordersLoaded = false; // allow retry on next open
    el.innerHTML = '<p class="pt-snote">Couldn\'t load orders. Try again later.</p>';
  }
}
window.loadOrdersOnce = loadOrdersOnce;

// ── In-app Delhivery tracking timeline ───────────────────────────────
function _trackFmt(dt) {
  if (!dt) return "";
  var d = new Date(dt);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

function openTracking(orderId) {
  var bd = document.getElementById("ptTrackBackdrop");
  var sh = document.getElementById("ptTrackSheet");
  var body = document.getElementById("ptTrackBody");
  if (!bd || !sh || !body) return;
  body.innerHTML = '<p class="pt-snote" style="padding:24px 0;text-align:center">Loading tracking…</p>';
  bd.classList.add("open");
  sh.classList.add("open");
  document.body.style.overflow = "hidden";

  fetch("/api/owner/orders/" + encodeURIComponent(orderId) + "/track")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok) { body.innerHTML = '<p class="pt-snote" style="padding:24px 0;text-align:center">Couldn\'t load tracking. Try again later.</p>'; return; }
      body.innerHTML = renderTrackTimeline(d);
    })
    .catch(function () {
      body.innerHTML = '<p class="pt-snote" style="padding:24px 0;text-align:center">Couldn\'t load tracking. Try again later.</p>';
    });
}
window.openTracking = openTracking;

function closeTracking() {
  var bd = document.getElementById("ptTrackBackdrop");
  var sh = document.getElementById("ptTrackSheet");
  if (bd) bd.classList.remove("open");
  if (sh) sh.classList.remove("open");
  document.body.style.overflow = "";
}
window.closeTracking = closeTracking;

function renderTrackTimeline(d) {
  var head =
    '<div style="margin-bottom:14px">' +
      '<h3 style="margin:0 0 3px;font-size:1.05rem;font-weight:800;color:#03162D">Track order</h3>' +
      (d.orderNumber ? '<p style="margin:0;font-size:.8rem;color:#6b7280">' + esc(d.orderNumber) + (d.productName ? ' · ' + esc(d.productName) : '') + '</p>' : '') +
    '</div>';

  var current =
    '<div style="background:#F9FAFB;border:1px solid #EEF0F3;border-radius:12px;padding:12px 14px;margin-bottom:16px">' +
      '<div style="font-size:.68rem;color:#9ca3af;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Current status</div>' +
      '<div style="font-size:.95rem;font-weight:800;color:#03162D;margin-top:2px">' + esc(humanizeOrderStatus(d.status)) + '</div>' +
      (d.statusDateTime ? '<div style="font-size:.74rem;color:#6b7280;margin-top:1px">' + esc(_trackFmt(d.statusDateTime)) + '</div>' : '') +
    '</div>';

  var scans = Array.isArray(d.scans) ? d.scans : [];
  var timeline;
  if (!scans.length) {
    timeline = '<p class="pt-snote" style="text-align:center;padding:8px 0">No tracking updates yet. We\'ll show each step here once the courier scans your parcel.</p>';
  } else {
    timeline = '<div style="position:relative;padding-left:22px">' +
      '<div style="position:absolute;left:5px;top:6px;bottom:10px;width:2px;background:#E5E7EB"></div>' +
      scans.map(function (s, i) {
        var isLatest = i === 0;
        var dot = isLatest ? "#FF2700" : "#C9CDD3";
        return '<div style="position:relative;padding:0 0 16px 0">' +
          '<span style="position:absolute;left:-22px;top:2px;width:11px;height:11px;border-radius:50%;background:' + dot + ';box-shadow:0 0 0 3px #fff"></span>' +
          '<div style="font-size:.86rem;font-weight:' + (isLatest ? "800" : "600") + ';color:#03162D">' + esc(humanizeOrderStatus(s.status)) + '</div>' +
          (s.location ? '<div style="font-size:.76rem;color:#6b7280">' + esc(s.location) + '</div>' : '') +
          (s.dateTime ? '<div style="font-size:.72rem;color:#9ca3af">' + esc(_trackFmt(s.dateTime)) + '</div>' : '') +
        '</div>';
      }).join("") +
      '</div>';
  }

  var footer = d.trackingUrl
    ? '<a href="' + esc(d.trackingUrl) + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:.76rem;color:#6b7280;text-decoration:underline">Open on Delhivery ↗</a>'
    : '';

  return head + current + timeline + footer;
}

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
