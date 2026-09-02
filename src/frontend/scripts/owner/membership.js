// ── Membership screen ──────────────────────────────────────────────────────
//
// Renders the plans, the tag-type selector and the feature grid from
// /api/owner/membership. Nothing on this page is authored here: prices,
// savings, the trial length and the feature labels all arrive from the server,
// because a number typed into the browser is a number that drifts from the
// constant the backend actually enforces.
//
// Wired with addEventListener only. /owner-membership is in PAYMENT_STRICT_PAGES
// (app.js): its CSP serves script-src-attr 'none', so an onclick here would not
// error — it would silently never fire. That policy also allows exactly one
// third-party script origin, checkout.razorpay.com, which is what lets the
// checkout below open at all.

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

const svg = (paths, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths}</svg>`;

let data = null;
let selectedPlan = null;
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

// ── Feature grid ───────────────────────────────────────────────────────────

function renderFeatures() {
  const host = byId("mbFeats");
  fill(host, "mb-in-2");

  // Every feature, in the order the server sends them. There was a tag-type
  // selector filtering this; it had three positions and one useful answer, so
  // it went and the list is simply what a membership buys.
  data.features.forEach((feature, index) => {
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

  // The flag comes from the server, so an environment with no Razorpay
  // configured shows the page and says why rather than opening a sheet that
  // cannot complete.
  cta.disabled = !data.checkoutEnabled || busy;

  const note = byId("mbNote");

  if (!data.checkoutEnabled) {
    note.hidden = false;
    note.textContent =
      `Memberships are not on sale here yet. Every premium tag already includes ` +
      `${data.trial.days} days free from the day you activate it.`;
    return;
  }

  // Already a member: say so rather than selling them what they hold. Buying
  // again stays allowed and stays correct — the server extends from the end of
  // the current period, not from today — so the button stays live.
  if (data.subscription && data.subscription.active && data.subscription.currentPeriodEnd) {
    note.hidden = false;
    note.textContent =
      `You are a member until ${formatDate(data.subscription.currentPeriodEnd)}. ` +
      `Buying again adds to that date rather than restarting from today.`;
    return;
  }

  note.hidden = true;
}

// ── Checkout ───────────────────────────────────────────────────────────────

// Guards the button for the whole round trip. Two taps mint two Razorpay orders
// for one intended purchase and both are payable. The server hands back an
// order already started, but only once the first request has returned, and the
// gap between two fast taps is exactly where that does not help.
let busy = false;

function formatDate(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "the end of your term";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function setBusy(on, label) {
  busy = on;
  if (label) {
    byId("mbCta").disabled = true;
    byId("mbCtaText").textContent = label;
    return;
  }
  renderCta();
}

function showNote(text) {
  const note = byId("mbNote");
  note.hidden = false;
  note.textContent = text;
}

async function startCheckout() {
  if (busy) return;

  const plan = data.plans.find((p) => p.id === selectedPlan);
  if (!plan) return;

  setBusy(true, "Starting…");

  let order;
  try {
    const res = await fetch("/api/owner/membership/create-order", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: plan.id })
    });

    if (res.status === 401) {
      window.location.href = "/owner-login";
      return;
    }

    order = await res.json();
    if (!res.ok || !order.ok) {
      setBusy(false);
      showNote(order && order.error ? order.error : "Could not start the payment. Please try again.");
      return;
    }
  } catch {
    setBusy(false);
    showNote("Could not reach the payment service. Please check your connection and try again.");
    return;
  }

  // checkout.js is loaded by the page. If it is not there — an extension blocked
  // it, or a CSP that does not allow the origin — say so, rather than throwing a
  // ReferenceError inside a handler nobody sees and leaving the button dead.
  if (typeof window.Razorpay !== "function") {
    setBusy(false);
    showNote("The payment window could not load. Please disable any blockers and try again.");
    return;
  }

  const rzp = new window.Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    order_id: order.orderId,
    // Razorpay always renders a merchant name beside the header image, and an
    // empty string makes it fall back to the account's business name. A
    // zero-width space is non-empty yet renders nothing, leaving just the logo
    // — the same trick the shop checkout uses.
    name: "​",
    description: `ParkTag Premium — ${plan.label}`,
    image: "/images/parktag-checkout-logo.png",
    prefill: order.prefill || {},
    theme: { color: "#FF2700" },
    modal: {
      // Dismissing the sheet is not a failure. The order stays at "created" and
      // the same one comes back next time, so the button simply returns.
      ondismiss() {
        setBusy(false);
      }
    },
    handler: async function (response) {
      setBusy(true, "Confirming…");

      try {
        const verifyRes = await fetch("/api/owner/membership/verify-payment", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          })
        });

        const result = await verifyRes.json();

        if (verifyRes.ok && result.ok) {
          data.subscription = { active: true, currentPeriodEnd: result.currentPeriodEnd };
          setBusy(false);

          // The receipt is what the SERVER recorded, not the figures this page
          // was holding from create-order — assembled before the payment and
          // never reconciled with it. The shop's confirmation follows the same
          // rule, for the same reason.
          const parts = [];
          if (result.orderNumber) parts.push(`Order ${result.orderNumber}.`);
          parts.push(
            result.currentPeriodEnd
              ? `You are a member until ${formatDate(result.currentPeriodEnd)}.`
              : "Your membership is being set up."
          );
          showNote(`Payment received. ${parts.join(" ")}`);
          renderPlans();
          return;
        }

        // The money has gone and this request failed. Do NOT report a failed
        // payment: the webhook is a second, browser-independent path to the same
        // activation and has very likely already run or is about to. "We have
        // your payment" is both true and the only thing that stops a second one.
        setBusy(false);
        showNote(
          "We have your payment. Confirming it is taking longer than usual — your " +
            "membership will activate shortly, and there is no need to pay again."
        );
      } catch {
        setBusy(false);
        showNote(
          "We have your payment but could not reach us to confirm it. Your " +
            "membership will activate shortly — please do not pay again."
        );
      }
    }
  });

  rzp.open();
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
    for (const id of ["mbPlans", "mbFeats"]) fill(byId(id), null);

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
  renderFeatures();
  renderCta();
  // Wired here, not in the markup: /owner-membership refuses inline handlers
  // (script-src-attr 'none'), so an onclick would not error — it would silently
  // never fire.
  byId("mbCta").addEventListener("click", startCheckout);

  // Last: every renderer above checks it to decide whether to animate.
  loading = false;
}

load();
