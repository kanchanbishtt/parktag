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

function startAuto() { autoTimer = setInterval(() => goTo(cur + 1), 4500); }
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

// ── SVG icons ────────────────────────────────────────────────────
const CAR_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none">
  <rect x="2" y="8" width="20" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/>
  <path d="M5 8l2-4h10l2 4" stroke="currentColor" stroke-width="1.8"/>
  <circle cx="7" cy="18" r="1.5" fill="currentColor"/>
  <circle cx="17" cy="18" r="1.5" fill="currentColor"/>
</svg>`;

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
  return `
<div class="pt-vc">
  <div class="pt-vc-icon">
    ${CAR_SVG}
    <span class="pt-vc-badge">${idx + 1}</span>
  </div>
  <p class="pt-vc-name">${tag.vehicleLabel || "Vehicle"}</p>
  <p class="pt-vc-plate">${tag.plateNumber || tag.token}</p>
</div>`;
}

function renderGrid(tags) {
  grid.innerHTML = tags.map((t, i) => vehicleCard(t, i)).join("") + ADD_CARD;
}

// ── Search filter ─────────────────────────────────────────────────
searchInp.addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q
    ? allTags.filter(t =>
        (t.vehicleLabel || "").toLowerCase().includes(q) ||
        (t.plateNumber  || "").toLowerCase().includes(q)
      )
    : allTags;
  renderGrid(filtered);
});

// ── Load data ─────────────────────────────────────────────────────
async function load() {
  if (isNewUser) {
    grid.innerHTML = ADD_CARD;
    return;
  }

  try {
    const res = await fetch("/api/owner/dashboard");
    if (!res.ok) { grid.innerHTML = ADD_CARD; return; }

    const data = await res.json();

    if (data.owner) {
      const name = data.owner.displayName || data.owner.email || "";
      const id   = data.owner.email || data.owner.mobile || "";
      greetName.textContent = `Hi, ${name.split(" ")[0] || "there"}!`;
      if (id) greetId.textContent = id;
    }

    allTags = data.tags || [];
    renderGrid(allTags);
  } catch {
    grid.innerHTML = ADD_CARD;
  }
}

load();
