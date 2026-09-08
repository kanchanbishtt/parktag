// Landing-page traffic geography.
//
// Everything rendered here is an aggregate the server already grouped — this
// file only lays it out. Values come from a geo provider and from our own
// referrer parsing, so every one of them is written with textContent and never
// with innerHTML.

const msgEl = document.getElementById("msg");
const countsEl = document.getElementById("counts");
const bodyEl = document.getElementById("body");
const rangesEl = document.getElementById("ranges");

let days = 30;
let inFlight = null;

function showError(text) {
  msgEl.className = "msg err";
  msgEl.textContent = text;
}

function clearMsg() {
  msgEl.className = "msg";
  msgEl.textContent = "";
}

function renderCounts(totals, range) {
  countsEl.replaceChildren();
  const cards = [
    [totals.views, "Page views"],
    [totals.visitors, "Visitors"],
    [range.days + " days", "Range"]
  ];
  // Only worth showing when it is actually happening — a zero here is the
  // normal case and would just be noise.
  if (totals.unknownGeo > 0) cards.push([totals.unknownGeo, "Unresolved"]);

  for (const [value, label] of cards) {
    const el = document.createElement("div");
    el.className = "count";
    const b = document.createElement("b");
    b.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    el.append(b, span);
    countsEl.append(el);
  }
}

function renderList(title, rows) {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = title;
  card.append(h);

  if (!rows.length) {
    const p = document.createElement("div");
    p.className = "row-sub";
    p.textContent = "Nothing recorded yet.";
    card.append(p);
    return card;
  }

  // Bars are scaled against the busiest row, not the total, so a list with one
  // dominant entry still shows the shape of everything under it.
  const top = rows[0].views || 1;

  for (const row of rows) {
    const el = document.createElement("div");
    el.className = "row";

    const name = document.createElement("div");
    name.className = "row-name";
    name.textContent = row.key;

    const num = document.createElement("div");
    num.className = "row-num";
    num.textContent = String(row.views);

    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = row.visitors + (row.visitors === 1 ? " visitor" : " visitors");

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = Math.max(2, Math.round((row.views / top) * 100)) + "%";
    bar.append(fill);

    el.append(name, num, sub, document.createElement("span"), bar);
    card.append(el);
  }
  return card;
}

// The shop funnel: views of /shop, checkouts started, orders paid. Counted by
// the server rather than by a browser tag, so an ad blocker cannot remove it.
function renderFunnel(funnel) {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = "Shop funnel";
  card.append(h);

  const t = funnel.totals;
  const steps = [
    ["Shop views", t.shopViews],
    ["Checkouts started", t.checkoutsStarted],
    ["Paid", t.paid]
  ];
  // Scaled against the top of the funnel, so the drop between steps is the
  // thing the bars actually show.
  const top = t.shopViews || t.checkoutsStarted || 1;

  for (const [label, value] of steps) {
    const el = document.createElement("div");
    el.className = "row";

    const name = document.createElement("div");
    name.className = "row-name";
    name.textContent = label;

    const num = document.createElement("div");
    num.className = "row-num";
    num.textContent = String(value);

    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = top ? Math.round((value / top) * 100) + "%" : "";

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = Math.max(2, Math.round((value / top) * 100)) + "%";
    bar.append(fill);

    el.append(name, num, sub, document.createElement("span"), bar);
    card.append(el);
  }

  return card;
}

// Everyone who typed a delivery address and did not pay. The whole reason the
// funnel is worth having: these are people who can still be called.
function renderAbandoned(rows) {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = "Abandoned checkouts (" + rows.length + ")";
  card.append(h);

  for (const row of rows) {
    const el = document.createElement("div");
    el.className = "row";

    const name = document.createElement("div");
    name.className = "row-name";
    name.textContent = row.name || row.orderNumber || "Unknown";

    const num = document.createElement("div");
    num.className = "row-num";
    num.textContent = row.amount ? "Rs " + Math.round(row.amount / 100) : "";

    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = [row.productName, row.city, when(row.createdAt)].filter(Boolean).join(" · ");

    // A tap-to-message link rather than a number to copy out by hand. The
    // point of the list is that following one of these up takes one tap.
    const act = document.createElement("span");
    if (row.phone) {
      const wa = document.createElement("a");
      wa.href = "https://wa.me/91" + String(row.phone).replace(/\D/g, "").slice(-10);
      wa.target = "_blank";
      wa.rel = "noopener";
      wa.textContent = row.phone;
      act.append(wa);
    }

    el.append(name, num, sub, act, document.createElement("div"));
    card.append(el);
  }
  return card;
}

// "3h ago" reads faster than a timestamp when the question is whether a cart
// is still warm.
function when(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return mins + "m ago";
  if (mins < 1440) return Math.round(mins / 60) + "h ago";
  return Math.round(mins / 1440) + "d ago";
}

function renderDaily(daily) {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = "Views per day";
  card.append(h);

  if (!daily.length) {
    const p = document.createElement("div");
    p.className = "row-sub";
    p.textContent = "Nothing recorded yet.";
    card.append(p);
    return card;
  }

  const top = Math.max(...daily.map((d) => d.views), 1);
  const spark = document.createElement("div");
  spark.className = "spark";
  for (const point of daily) {
    const bar = document.createElement("div");
    bar.style.height = Math.max(2, Math.round((point.views / top) * 100)) + "%";
    // The only place the exact per-day number is available, so it goes in the
    // tooltip rather than being dropped.
    bar.title = point.key + ", " + point.views + " views, " + point.visitors + " visitors";
    spark.append(bar);
  }
  card.append(spark);

  const sub = document.createElement("div");
  sub.className = "row-sub";
  sub.textContent = daily[0].key + " → " + daily[daily.length - 1].key + " (IST)";
  card.append(sub);
  return card;
}

async function load() {
  // A fast double-click on the range buttons could otherwise let an older
  // response land after a newer one and render the wrong range.
  const token = {};
  inFlight = token;

  try {
    const res = await fetch("/api/admin/traffic?days=" + days, {
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });

    if (res.status === 401 || res.status === 403) {
      window.location.href = "/admin";
      return;
    }

    const data = await res.json().catch(() => null);
    if (inFlight !== token) return;

    if (!res.ok || !data || !data.ok) {
      showError((data && data.error) || "Could not load traffic (HTTP " + res.status + ").");
      return;
    }

    clearMsg();
    renderCounts(data.totals, data.range);

    bodyEl.replaceChildren();

    // Distinguish "nobody visited" from "the pipeline is not switched on" —
    // otherwise an unconfigured ingest key looks exactly like zero traffic.
    if (!data.configured) {
      const warn = document.createElement("div");
      warn.className = "note";
      const strong = document.createElement("strong");
      strong.textContent = "Traffic recording is off.";
      warn.append(
        strong,
        document.createTextNode(
          "Set ANALYTICS_INGEST_KEY to the same value on both the API service and the landing service, then redeploy. Until then no visit is recorded."
        )
      );
      bodyEl.append(warn);
    } else if (data.totals.views === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No visits recorded in this range yet.";
      bodyEl.append(empty);
      return;
    }

    // Before the landing-traffic early return below. The shop funnel is about
    // app.parktag.me and stands on its own: a day with no marketing-site visits
    // can still have somebody reach the shop through an ad's direct link, and
    // hiding the funnel then would hide exactly the case worth seeing.
    if (data.funnel) bodyEl.append(renderFunnel(data.funnel));
    if (data.abandoned && data.abandoned.length) bodyEl.append(renderAbandoned(data.abandoned));

    if (data.totals.views === 0) return;

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(
      renderList("Cities", data.cities),
      renderList("Countries", data.countries),
      renderList("Referrers", data.referrers),
      renderList("Pages", data.paths),
      renderList("Devices", data.devices),
      renderDaily(data.daily)
    );
    bodyEl.append(grid);
  } catch (err) {
    if (inFlight !== token) return;
    showError("Could not reach the server. Check your connection and try again.");
  }
}

rangesEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-days]");
  if (!button) return;
  days = Number(button.dataset.days);
  for (const el of rangesEl.querySelectorAll("button[data-days]")) {
    el.setAttribute("aria-pressed", el === button ? "true" : "false");
  }
  load();
});

load();
