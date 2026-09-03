// Public order tracking: order number + last 4 of the delivery phone, in
// exchange for the live Delhivery status and checkpoint history.
//
// The whole result is built from DOM nodes and textContent rather than an
// HTML string. Scan labels and locations come straight out of Delhivery's API
// — third-party text this page does not control — so there is no point at
// which markup could be assembled from it.

const byId = (id) => document.getElementById(id);

const form = byId("track-form");
const orderInput = byId("track-order-id");
const lastFourInput = byId("track-last-four");
const submitButton = byId("track-submit");
const statusLine = byId("track-status");
const result = byId("track-result");

const IDLE_MESSAGE = "Your order ID is on the confirmation we sent you.";

// Mirrors the owner dashboard's labels so an order reads the same in My Orders
// and here. Anything not listed is a raw Delhivery status ("In Transit",
// "Delivered") and is shown as it comes.
const STATUS_LABELS = {
  processing: "Preparing to ship",
  cod_confirmed: "Confirmed · Cash on delivery",
  booking_failed: "Couldn't book courier yet — we'll retry",
  booked: "Booked with courier"
};

function humanizeStatus(status) {
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  return String(status || "Processing").replace(/_/g, " ");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true
  });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function setStatus(message, tone) {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderTimeline(scans) {
  const host = byId("track-timeline");
  host.replaceChildren();

  if (!scans.length) {
    host.append(el(
      "p",
      "pt-track-empty",
      "No courier updates yet. Each step will appear here once your parcel is scanned."
    ));
    return;
  }

  const list = el("ol", "pt-track-steps");
  scans.forEach((scan, index) => {
    // Newest first, so the top entry is where the parcel is now.
    const item = el("li", index === 0 ? "pt-track-step pt-track-step-now" : "pt-track-step");
    item.append(el("span", "pt-track-dot"));
    item.append(el("span", "pt-track-step-title", humanizeStatus(scan.status)));
    if (scan.location) item.append(el("span", "pt-track-step-place", scan.location));
    const when = formatDateTime(scan.dateTime);
    if (when) item.append(el("span", "pt-track-step-time", when));
    list.append(item);
  });
  host.append(list);
}

function renderResult(order) {
  byId("track-result-number").textContent = order.orderNumber || "Your order";

  // Product · ₹499 · COD · Ordered 28 Jul 2026 — only the parts we actually have.
  const meta = [];
  if (order.productName) meta.push(order.productName);
  if (typeof order.amount === "number") {
    meta.push(`₹${(order.amount / 100).toFixed(0)}${order.paymentMethod === "cod" ? " COD" : ""}`);
  }
  const ordered = formatDate(order.orderedAt);
  if (ordered) meta.push(`Ordered ${ordered}`);
  byId("track-result-meta").textContent = meta.join(" · ");

  byId("track-result-status").textContent = humanizeStatus(order.shippingStatus);

  const time = byId("track-result-time");
  const stamped = formatDateTime(order.statusDateTime);
  time.textContent = stamped;
  time.hidden = !stamped;

  renderTimeline(Array.isArray(order.scans) ? order.scans : []);

  const courier = byId("track-courier-link");
  if (order.trackingUrl) {
    courier.href = order.trackingUrl;
    courier.hidden = false;
  } else {
    courier.removeAttribute("href");
    courier.hidden = true;
  }

  result.hidden = false;
}

// ── Lookup ──────────────────────────────────────────────────────────────────

let inFlight = false;

async function lookUpOrder(event) {
  event.preventDefault();
  if (inFlight) return;

  const orderNumber = orderInput.value.trim();
  const lastFour = lastFourInput.value.trim();

  // Checked here only to save a pointless round trip and to say which field is
  // missing; the server validates both again and is the authority.
  if (!orderNumber) {
    setStatus("Enter your order ID to continue.", "error");
    orderInput.focus();
    return;
  }
  if (!/^\d{4}$/.test(lastFour)) {
    setStatus("Enter the last 4 digits of the delivery phone number.", "error");
    lastFourInput.focus();
    return;
  }

  inFlight = true;
  submitButton.disabled = true;
  result.hidden = true;
  setStatus("Looking up your order…", "info");

  try {
    const response = await fetch("/api/shop/track-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderNumber, lastFour })
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.ok) {
      // 429 is the shared per-IP limit rather than anything about this order.
      setStatus(
        response.status === 429
          ? "Too many lookups just now. Wait a minute and try again."
          : (data && data.error) || "Something went wrong. Please try again.",
        "error"
      );
      return;
    }

    renderResult(data.order || {});
    setStatus(IDLE_MESSAGE, "info");
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch {
    setStatus("Couldn't reach ParkTag. Check your connection and try again.", "error");
  } finally {
    inFlight = false;
    submitButton.disabled = false;
  }
}

form?.addEventListener("submit", lookUpOrder);

// Digits only, so a pasted "+91 98765 43210" can't leave letters in the field.
lastFourInput?.addEventListener("input", () => {
  const digits = lastFourInput.value.replace(/\D/g, "").slice(0, 4);
  if (digits !== lastFourInput.value) lastFourInput.value = digits;
});

byId("track-reset")?.addEventListener("click", () => {
  result.hidden = true;
  form.reset();
  setStatus(IDLE_MESSAGE, "info");
  orderInput.focus();
});

// Prefer the actual previous page — this is normally opened from the scan
// page's menu, and a buyer expects Back to return there rather than to the
// shop. The href stays as the fallback for a direct visit, where there is no
// same-tab history to go back to.
// Arriving from a "Track this order" link — the storefront's recall bar sends
// the order number this way. Only the number: the last 4 is the proof that
// opens the order, and a proof does not belong in a URL that lands in history,
// a bookmark or a shared link. So the number is filled and the cursor goes to
// the field the buyer still has to answer.
(function prefillFromLink() {
  let requested = "";
  try { requested = new URLSearchParams(location.search).get("order") || ""; } catch { return; }
  // Same shape the server normalises to. Anything else is ignored rather than
  // pasted into the field, so a junk query string cannot pre-fail the form.
  if (!/^PT-?\d{6}-?\d{5}$/i.test(requested.trim())) return;
  orderInput.value = requested.trim().toUpperCase();
  lastFourInput.focus();
})();

byId("track-back")?.addEventListener("click", (event) => {
  if (history.length > 1) {
    event.preventDefault();
    history.back();
  }
});
