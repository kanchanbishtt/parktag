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
let isPremium     = false;

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
        // Stamp the unique E-Tag ID + activation status onto the print sticker (spec §9).
        const idEl = document.getElementById("print-etag-id");
        if (idEl && tag.etagId) idEl.textContent = String(tag.etagId).replace(/^PT-/, "");
        const stEl = document.getElementById("print-status");
        if (stEl) stEl.textContent = tag.status === "inactive" ? "Inactive" : "Active";
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

// ── Premium / Buy official sticker ────────────────────────────
function updatePremiumUI() {
  const badge = document.getElementById("vd-premium-badge");
  const buyBtn = document.getElementById("buy-premium-btn");
  const activeNote = document.getElementById("premium-active-note");
  const copy = document.getElementById("premium-copy");
  if (isPremium) {
    if (badge) badge.style.display = "inline-block";
    if (buyBtn) buyBtn.style.display = "none";
    if (activeNote) activeNote.style.display = "block";
    if (copy) copy.textContent = "This E-Tag is premium. Call & WhatsApp are always available.";
  } else {
    if (badge) badge.style.display = "none";
    if (buyBtn) { buyBtn.style.display = ""; buyBtn.disabled = !realId; }
    if (activeNote) activeNote.style.display = "none";
  }
}

document.getElementById("buy-premium-btn")?.addEventListener("click", async () => {
  const btn = document.getElementById("buy-premium-btn");
  if (!realId) { alert("Open this vehicle from your dashboard to purchase."); return; }
  if (typeof window.Razorpay === "undefined") { alert("Payment unavailable right now. Please try again."); return; }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Starting payment…";
  try {
    const res = await fetch(`/api/owner/tags/${realId}/purchase-order`, { method: "POST", headers: { "content-type": "application/json" } });
    const order = await res.json();
    if (!res.ok) throw new Error(order.error || "Could not start payment.");

    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: "ParkTag",
      description: order.productName,
      theme: { color: "#1A9D20" },
      handler: async (resp) => {
        const v = await fetch(`/api/owner/tags/${realId}/purchase-verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(resp)
        });
        const vd = await v.json();
        if (v.ok && vd.premium) {
          isPremium = true;
          updatePremiumUI();
          alert("Payment successful — your E-Tag is now Premium! Unlimited private contact is enabled.");
        } else {
          alert(vd.error || "Payment could not be verified. If you were charged, contact support.");
          btn.disabled = false; btn.textContent = original;
        }
      },
      modal: { ondismiss: () => { btn.disabled = false; btn.textContent = original; } }
    });
    rzp.open();
  } catch (e) {
    alert(e.message || "Could not start payment.");
    btn.disabled = false; btn.textContent = original;
  }
});
