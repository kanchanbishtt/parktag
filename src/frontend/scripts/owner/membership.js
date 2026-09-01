// ── Membership screen ──────────────────────────────────────────────────────
//
// Renders the plans, the tag-type selector and the feature grid from
// /api/owner/membership. Nothing on this page is authored here: prices,
// savings, the trial length and the feature labels all arrive from the server,
// because a number typed into the browser is a number that drifts from the
// constant the backend actually enforces.
//
// Wired with addEventListener only. /owner-membership is in STRICT_SCRIPT_PAGES
// (app.js), so its CSP drops 'unsafe-inline' from script-src AND script-src-attr
// — an onclick here would not error, it would silently never fire.

const byId = (id) => document.getElementById(id);

// One SVG per feature icon key the server can send. Kept as a lookup rather
// than built from the label, so an unknown key degrades to a neutral dot
// instead of throwing and taking the whole grid with it.
const ICONS = {
  mask: '<path d="M2 12c0-3 2-5 5-5h10c3 0 5 2 5 5s-2 5-5 5c-2 0-3-1-5-1s-3 1-5 1c-3 0-5-2-5-5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 11.5h1.5M14.5 11.5H16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1A19.5 19.5 0 0 1 4.7 12 19.8 19.8 0 0 1 1.6 3.4 2 2 0 0 1 3.6 1.2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.9 8.9a16 16 0 0 0 6 6l.9-.9a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  callback: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1A19.5 19.5 0 0 1 4.7 12 19.8 19.8 0 0 1 1.6 3.4 2 2 0 0 1 3.6 1.2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.9 8.9a16 16 0 0 0 6 6l.9-.9a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 3h6v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 3l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.6" stroke="currentColor" stroke-width="1.8"/>',
  whatsapp: '<path d="M3 21l1.6-4.6A8.4 8.4 0 1 1 8 20.2L3 21z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5.7 0 1-.6.6-1.1l-.9-1-1.3.6-2.4-2.4.6-1.3-1-.9c-.5-.4-1.1-.1-1.1.6z" fill="currentColor"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="1.8"/>',
  alert: '<path d="M12 3l9.5 16.5H2.5L12 3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4M12 17.2v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  car: '<path d="M4 16v2.5M20 16v2.5M3 15.5v-3l1.8-4.6A2 2 0 0 1 6.7 6.5h10.6a2 2 0 0 1 1.9 1.4L21 12.5v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7.5" cy="13" r="1.1" fill="currentColor"/><circle cx="16.5" cy="13" r="1.1" fill="currentColor"/>',
  gift: '<rect x="3" y="9" width="18" height="11.5" rx="1.8" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 9h19M12 9v11.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 9S9.5 3.5 7 5.2 12 9 12 9zM12 9s2.5-5.5 5-3.8S12 9 12 9z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>'
};

const SCOPE_ICONS = {
  parking: '<path d="M7 20V4h5.5a4.5 4.5 0 0 1 0 9H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  etag: '<rect x="3.5" y="6" width="17" height="12" rx="2.2" stroke="currentColor" stroke-width="1.8"/><path d="M7 10h5M7 13.5h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  all: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.8"/>'
};

const svg = (paths, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths}</svg>`;

let data = null;
let selectedPlan = null;
let selectedScope = null;
// Whether the skeleton is still on screen. The fade-up plays once, on the
// first fill — re-rendering after a tap is a state change the owner caused and
// asked to see immediately, and animating it makes the page feel laggy.
let loading = true;

// Empty a host and mark it no longer busy. aria-busy is on the containers in
// the markup so a screen reader is not read a wall of empty placeholder nodes
// while the fetch is in flight; clearing it is what says the region settled.
function fill(host, revealClass) {
  host.textContent = "";
  host.removeAttribute("aria-busy");
  if (loading && revealClass) {
    host.classList.add("mb-in", revealClass);
  }
}

// textContent everywhere, never innerHTML, for anything that carries a server
// string. The icons below are the only markup built by concatenation and they
// are drawn from the ICONS table above by key — no server text is ever
// interpolated into HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── Plans ──────────────────────────────────────────────────────────────────

function renderPlans() {
  const host = byId("mbPlans");
  fill(host, "mb-in-1");

  for (const plan of data.plans) {
    const card = el("button", "mb-plan");
    card.type = "button";
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", plan.id === selectedPlan ? "true" : "false");

    if (plan.popular) card.appendChild(el("span", "mb-plan-pop", "POPULAR"));
    card.appendChild(el("span", "mb-plan-term", plan.label));
    card.appendChild(el("span", "mb-plan-price", `₹${plan.priceInr}`));

    // What it works out to per month. Without it, ₹249 sits beside ₹49 reading
    // as five times the price, and the annual plan — the best value on the row
    // — looks like the most expensive thing on the screen.
    //
    // The approximate sign is not decoration: ₹149 over six months is ₹24.83,
    // and a flat "₹25/mo" would be a price we do not charge. The server says
    // which plans divide evenly; this only renders what it is told.
    card.appendChild(
      el(
        "span",
        "mb-plan-rate",
        plan.perMonthExact ? `₹${plan.perMonthInr}/mo` : `≈ ₹${plan.perMonthInr}/mo`
      )
    );

    // Only when there is a saving. A "0% OFF" line under the monthly plan is
    // noise that makes the cheapest option look like the worst one.
    if (plan.savingPercent > 0) {
      card.appendChild(el("span", "mb-plan-save", `${plan.savingPercent}% OFF`));
    }

    card.addEventListener("click", () => {
      selectedPlan = plan.id;
      renderPlans();
      renderCta();
    });

    host.appendChild(card);
  }
}

// ── Tag-type selector ──────────────────────────────────────────────────────

function renderScopes() {
  const host = byId("mbScopes");
  fill(host, "mb-in-2");

  for (const scope of data.scopes) {
    const pill = el("button", "mb-scope");
    pill.type = "button";
    pill.setAttribute("role", "tab");
    pill.setAttribute("aria-selected", scope.id === selectedScope ? "true" : "false");

    const icon = el("span");
    icon.innerHTML = svg(SCOPE_ICONS[scope.id] || ICONS.dot, 15);
    pill.appendChild(icon);
    pill.appendChild(el("span", null, scope.label));

    pill.addEventListener("click", () => {
      selectedScope = scope.id;
      renderScopes();
      renderFeatures();
    });

    host.appendChild(pill);
  }
}

// ── Feature grid ───────────────────────────────────────────────────────────

function renderFeatures() {
  const host = byId("mbFeats");
  fill(host, "mb-in-3");

  const shown = data.features.filter((f) => f.scopes.includes(selectedScope));

  shown.forEach((feature, index) => {
    const tile = el("div", "mb-feat");

    // Cycled rather than stored per feature, so the palette stays even however
    // many tiles a tag type happens to show.
    const icon = el("span", `mb-feat-ic c${(index % 6) + 1}`);
    icon.innerHTML = svg(ICONS[feature.icon] || ICONS.dot);

    tile.appendChild(icon);
    tile.appendChild(el("span", "mb-feat-lb", feature.label));
    host.appendChild(tile);
  });
}

// ── Action ─────────────────────────────────────────────────────────────────

function renderCta() {
  const plan = data.plans.find((p) => p.id === selectedPlan);
  const cta = byId("mbCta");

  byId("mbCtaText").textContent = plan ? `Go Pro — ₹${plan.priceInr}` : "Go Pro";

  // Disabled while there is no membership SKU and no recurring-billing path.
  // The flag comes from the server, so the day checkout exists this starts
  // working without touching the page.
  cta.disabled = !data.checkoutEnabled;

  const note = byId("mbNote");
  if (data.checkoutEnabled) {
    note.hidden = true;
    return;
  }

  note.hidden = false;
  note.textContent =
    `Memberships are not on sale yet. Every premium tag already includes ` +
    `${data.trial.days} days free from the day you activate it, and we will ` +
    `open plans here before that runs out.`;
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function load() {
  let payload;

  try {
    const res = await fetch("/api/owner/membership", {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (res.status === 401) {
      window.location.href = "/owner-login";
      return;
    }

    payload = await res.json();
  } catch {
    // Clear the skeleton on the way out. A shimmer that never resolves is a
    // page that looks like it is still loading forever, which is worse than an
    // error — nobody knows to retry.
    for (const id of ["mbPlans", "mbScopes", "mbFeats"]) fill(byId(id), null);

    // The banner goes entirely, rather than being emptied. Its whole content is
    // the trial length, and that is exactly what could not be fetched — an
    // empty "  Days FREE" is a worse answer than no banner at all.
    //
    // Its shimmer classes are dropped as well as the banner being hidden.
    // display:none does stop the animation, so this is not what the owner sees
    // — it is so that no element is left in a loading state that a later change
    // could unhide, and so "is anything still loading?" has one honest answer:
    // the absence of .mb-sk in the document.
    byId("mbTrialDays").className = "mb-trial-days";
    byId("mbTrialNote").className = "";
    document.querySelector(".mb-trial").hidden = true;

    const note = byId("mbNote");
    note.hidden = false;
    note.textContent = "Could not load membership plans. Please check your connection and try again.";
    return;
  }

  if (!payload || !payload.ok) return;

  data = payload;
  // The popular plan is the one pre-selected, matching the reference — and the
  // monthly one if nothing is flagged, never nothing at all, so the sticky
  // button always names a price.
  selectedPlan = (data.plans.find((p) => p.popular) || data.plans[0] || {}).id || null;
  selectedScope = (data.scopes[0] || {}).id || null;

  // className is cleared rather than the shimmer class removed one by one:
  // these two spans carry nothing else, and a leftover mb-sk would keep the
  // text transparent — invisible content that reads as a blank banner.
  // Just the digits — "DAYS" is set in the markup beside them, and the tile
  // stacks the two. Writing the server's "90 Days" headline in here would put
  // the word twice on one badge.
  const days = byId("mbTrialDays");
  days.className = "mb-trial-days";
  days.textContent = String(data.trial.days);
  byId("mbTrialTag").hidden = false;

  const note = byId("mbTrialNote");
  note.className = "";
  note.textContent = data.trial.note;

  document.querySelector(".mb-trial").classList.add("mb-in");

  renderPlans();
  renderScopes();
  renderFeatures();
  renderCta();

  // Last: every renderer above checks it to decide whether to animate.
  loading = false;
}

load();
