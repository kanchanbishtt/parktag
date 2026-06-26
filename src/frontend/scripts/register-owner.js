const VEHICLE_LABELS = {
  car: "Car", bike: "Bike", scooter: "Scooter",
  auto_rickshaw: "Auto Rickshaw", truck: "Truck",
  bus: "Bus", bicycle: "Bicycle", e_scooter: "E-Scooter"
};

// Type-specific icon SVGs (inline, colour-neutral — uses currentColor)
const VEHICLE_SVGS = {
  car: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="8" width="20" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 8l2-4h10l2 4" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="7" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="17" cy="18" r="1.5" fill="currentColor"/>
  </svg>`,
  bike: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="6" cy="16" r="3" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.8"/>
    <path d="M6 16l4-6h4l2 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 10V7m0 3l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  scooter: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="2.5" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="19" cy="17" r="2.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 17h2l2-5h6l1 3h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 12V9l3-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
  auto_rickshaw: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="7" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M17 11h3l1 4h-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="7" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="17" cy="18" r="1.5" fill="currentColor"/>
    <path d="M3 11h14" stroke="currentColor" stroke-width="1.5"/>
  </svg>`,
  truck: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="1" y="6" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M15 9h4l3 3v4h-7V9z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="5.5" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="18.5" cy="18" r="1.5" fill="currentColor"/>
  </svg>`,
  bus: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/>
    <path d="M3 10h18" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="8" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="16" cy="18" r="1.5" fill="currentColor"/>
    <path d="M7 4v6M17 4v6" stroke="currentColor" stroke-width="1.5"/>
  </svg>`,
  bicycle: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="3" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="19" cy="17" r="3" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 17l4-6h4l1 3M13 11l2 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M9 11H7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="9" cy="7" r="1.5" stroke="currentColor" stroke-width="1.5"/>
  </svg>`,
  e_scooter: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="2.5" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="19" cy="17" r="2.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M5 17h2l2-5h6l1 3h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 12V9l3-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M14 5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,
};

let vehicles = [];

// Indian vehicle number: 2 letters + 1-2 digits + 1-3 letters + 1-4 digits (spaces optional)
const PLATE_RE = /^[A-Z]{2}\s?[0-9]{1,2}\s?[A-Z]{1,3}\s?[0-9]{1,4}$/;

function validateMobile(raw) {
  if (!raw || !raw.trim()) return "This field is required.";
  const digits = raw.replace(/[^\d]/g, "");
  const ten = digits.length === 10 ? digits
    : (digits.length === 12 && digits.startsWith("91")) ? digits.slice(2)
    : null;
  if (!ten || !/^[6-9]\d{9}$/.test(ten)) return "Enter a valid 10-digit Indian mobile number.";
  return null;
}

function setMobileError(msg) {
  const err = document.getElementById("mobile-error");
  const inp = document.getElementById("mobile-number");
  if (!err || !inp) return;
  if (msg) {
    err.textContent = msg;
    err.style.display = "block";
    inp.style.borderColor = "#DC2626";
  } else {
    err.textContent = "";
    err.style.display = "none";
    inp.style.borderColor = "";
  }
}

async function loadOwnerMobile() {
  const inp = document.getElementById("mobile-number");
  if (!inp) return;

  try {
    const res = await fetch("/api/owner/dashboard");
    if (!res.ok) return;
    const data = await res.json();
    const mobile = data?.owner?.mobile || "";
    if (!mobile) return;
    const digits = mobile.replace(/[^\d]/g, "");
    const ten = digits.length >= 10 ? digits.slice(-10) : "";
    if (!ten) return;
    inp.value = ten;
    inp.readOnly = true;
    inp.style.background = "#F3F4F6";
    inp.style.color = "#6B7280";
    inp.title = "Mobile number from your account";
  } catch (_) {}
}

function validatePlate(raw, type) {
  if (!raw) return "Please enter the vehicle number.";
  if (type === "bicycle") {
    return raw.replace(/\s/g, "").length >= 3
      ? null
      : "Enter a valid frame number or ID (min. 3 characters).";
  }
  return PLATE_RE.test(raw)
    ? null
    : "Invalid format. Use Indian format — e.g. DL 01 AB 1234.";
}

function setPlateError(msg) {
  const err = document.getElementById("plate-error");
  const inp = document.getElementById("vehicle-number");
  if (!err || !inp) return;
  if (msg) {
    err.textContent = msg;
    err.style.display = "block";
    inp.style.borderColor = "#DC2626";
  } else {
    err.textContent = "";
    err.style.display = "none";
    inp.style.borderColor = "";
  }
}

function setStatus(msg, tone = "info") {
  const el = document.getElementById("av-status");
  if (!el) return;
  el.textContent = msg;
  el.dataset.tone = tone;
}

function svgFor(type) {
  return VEHICLE_SVGS[type] || VEHICLE_SVGS.car;
}

function renderList() {
  const list = document.getElementById("vehicle-list");
  if (!list) return;
  if (!vehicles.length) { list.innerHTML = ""; return; }
  list.innerHTML = vehicles.map((v, i) => `
    <div class="av-item">
      <div class="av-item-icon">${svgFor(v.type)}</div>
      <div class="av-item-info">
        <p class="av-item-type">${VEHICLE_LABELS[v.type] || v.type}</p>
        <p class="av-item-num">${v.number}</p>
      </div>
      <button class="av-item-del" data-idx="${i}" aria-label="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `).join("");

  list.querySelectorAll(".av-item-del").forEach(btn => {
    btn.addEventListener("click", () => {
      vehicles.splice(Number(btn.dataset.idx), 1);
      renderList();
    });
  });
}

function addVehicle() {
  const type = document.getElementById("vehicle-type")?.value;
  const raw  = (document.getElementById("vehicle-number")?.value || "").trim().toUpperCase().replace(/\s+/g, " ");

  if (!type) { setStatus("Please select a vehicle type.", "error"); return; }

  const mobileVal = (document.getElementById("mobile-number")?.value || "").trim();
  const mobileErr = validateMobile(mobileVal);
  if (mobileErr) {
    setMobileError(mobileErr);
    document.getElementById("mobile-number")?.focus();
    return;
  }

  const plateErr = validatePlate(raw, type);
  if (plateErr) { setPlateError(plateErr); document.getElementById("vehicle-number")?.focus(); return; }

  const isDup = vehicles.some(v => v.number === raw);
  if (isDup) { setPlateError("Vehicle already added."); return; }

  // Check against saved vehicles in localStorage
  try {
    const uid = sessionStorage.getItem("pt_uid");
    const key = uid ? "pt_vehicles_" + uid.replace(/[^a-z0-9]/gi, "_").toLowerCase() : "pt_pending_vehicles";
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    const existsInSaved = saved.some(v => (v.number || "").toUpperCase() === raw);
    if (existsInSaved) { setPlateError("Vehicle already added."); return; }
  } catch (_) {}

  setPlateError("");
  vehicles.push({ type, number: raw });
  renderList();
  setStatus("", "info");

  document.getElementById("vehicle-type").value = "";
  document.getElementById("vehicle-number").value = "";
  document.getElementById("vehicle-type").focus();
}

// ── E-Tag popup ──────────────────────────────────────────────

function showEtagPopup() {
  document.getElementById("etag-overlay")?.classList.add("active");
}

function hideEtagPopup() {
  document.getElementById("etag-overlay")?.classList.remove("active");
}

function populatePrintTemplate() {
  // Use the first vehicle for the E-Tag
  const v = vehicles[0];
  const vehicleNum = v ? v.number : "—";
  const el = document.getElementById("print-vehicle-num");
  if (el) el.textContent = vehicleNum;
}

function downloadEtag() {
  populatePrintTemplate();
  hideEtagPopup();
  // Start saving in the background — don't await before print, Chrome blocks
  // window.print() when the user-gesture context is lost after an async call.
  const savingPromise = saveVehicles();
  window.print();
  window.addEventListener("afterprint", async () => {
    await savingPromise;
    window.location.href = "/owner-welcome";
  }, { once: true });
}

function savePendingVehicles() {
  if (!vehicles.length) return;
  try {
    const uid = sessionStorage.getItem("pt_uid");
    // Write directly to the user-scoped key if we know who the user is,
    // otherwise fall back to the pending key that dashboard will merge on next load.
    const key = uid
      ? "pt_vehicles_" + uid.replace(/[^a-z0-9]/gi, "_").toLowerCase()
      : "pt_pending_vehicles";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    const existingNums = new Set(existing.map(v => (v.number || "").toUpperCase()));
    const merged = [...existing, ...vehicles.filter(v => !existingNums.has((v.number || "").toUpperCase()))];
    localStorage.setItem(key, JSON.stringify(merged));
    // Also write to pending as backup so dashboard merge picks it up if uid was stale
    if (uid) {
      const pend = JSON.parse(localStorage.getItem("pt_pending_vehicles") || "[]");
      const pendNums = new Set(pend.map(v => (v.number || "").toUpperCase()));
      const pendMerged = [...pend, ...vehicles.filter(v => !pendNums.has((v.number || "").toUpperCase()))];
      localStorage.setItem("pt_pending_vehicles", JSON.stringify(pendMerged));
    }
  } catch (_) {}
}

async function saveMobile(mobile) {
  const digits = mobile.replace(/[^\d]/g, "");
  const normalized = digits.length === 10 ? `+91${digits}` : `+${digits}`;
  try {
    await fetch("/api/owner/mobile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile: normalized })
    });
  } catch (_) {}
}

async function saveVehicles() {
  const mobile = (document.getElementById("mobile-number")?.value || "").trim();
  if (mobile && !document.getElementById("mobile-number")?.readOnly) {
    await saveMobile(mobile);
  }
  const alreadyAdded = [];
  for (const v of vehicles) {
    try {
      const res = await fetch("/api/owner/local-vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: v.type, number: v.number })
      });
      if (res.status === 409) { alreadyAdded.push(v.number); continue; }
      if (!res.ok) throw new Error("api-failed");
    } catch {
      savePendingVehicles();
      return;
    }
  }
  if (alreadyAdded.length) {
    setStatus(`Already added: ${alreadyAdded.join(", ")}. Redirecting…`, "info");
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function skipEtag() {
  await saveVehicles();
  hideEtagPopup();
  window.location.href = "/owner-welcome";
}

// ── Submit ───────────────────────────────────────────────────

function submit() {
  // Auto-add any vehicle the user typed but didn't click "+ Add Vehicle" on
  const formType = document.getElementById("vehicle-type")?.value;
  const formNum  = (document.getElementById("vehicle-number")?.value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (formType && formNum) {
    const plateErr = validatePlate(formNum, formType);
    if (plateErr) { setPlateError(plateErr); document.getElementById("vehicle-number")?.focus(); return; }
    vehicles.push({ type: formType, number: formNum });
    renderList();
    setPlateError("");
    document.getElementById("vehicle-type").value = "";
    document.getElementById("vehicle-number").value = "";
  }

  const mobile = (document.getElementById("mobile-number")?.value || "").trim();
  const mobileErr = validateMobile(mobile);
  if (mobileErr) {
    setMobileError(mobileErr);
    document.getElementById("mobile-number")?.focus();
    return;
  }
  setMobileError("");

  const tokenRaw = (document.getElementById("token-input")?.value || "")
    .trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!vehicles.length && !tokenRaw) {
    setStatus("Add at least one vehicle or enter a sticker code.", "error");
    return;
  }

  if (tokenRaw) {
    if (tokenRaw.length !== 12) {
      setStatus("Sticker code must be exactly 12 characters.", "error");
      return;
    }
    savePendingVehicles();
    window.location.href = `/vehicle/${tokenRaw}`;
    return;
  }

  // No sticker code — show E-Tag popup
  showEtagPopup();
}

// ── Wire up events ───────────────────────────────────────────
document.getElementById("add-vehicle-btn")?.addEventListener("click", addVehicle);

document.getElementById("vehicle-number")?.addEventListener("input", e => {
  // Strip anything that isn't A-Z, 0-9, or space; auto-uppercase
  const cur = e.target.value;
  const clean = cur.replace(/[^A-Za-z0-9 ]/g, "").toUpperCase();
  if (cur !== clean) e.target.value = clean;
  // Clear error while user is actively editing
  setPlateError("");
});

document.getElementById("vehicle-number")?.addEventListener("blur", e => {
  const raw = e.target.value.trim().toUpperCase().replace(/\s+/g, " ");
  const type = document.getElementById("vehicle-type")?.value;
  if (raw) setPlateError(validatePlate(raw, type) || "");
});

document.getElementById("vehicle-number")?.addEventListener("keydown", e => {
  if (e.key === "Enter") addVehicle();
});

document.getElementById("submit-btn")?.addEventListener("click", submit);

document.getElementById("token-input")?.addEventListener("keydown", e => {
  if (e.key === "Enter") submit();
});

document.getElementById("etag-download-btn")?.addEventListener("click", downloadEtag);
document.getElementById("etag-skip-btn")?.addEventListener("click", skipEtag);

// Close popup if clicking outside the card
document.getElementById("etag-overlay")?.addEventListener("click", e => {
  if (e.target === document.getElementById("etag-overlay")) hideEtagPopup();
});

document.getElementById("mobile-number")?.addEventListener("input", () => setMobileError(""));

document.getElementById("mobile-edit-btn")?.addEventListener("click", () => {
  const inp = document.getElementById("mobile-number");
  const btn = document.getElementById("mobile-edit-btn");
  if (!inp || !btn) return;

  if (inp.readOnly) {
    inp.readOnly = false;
    inp.style.background = "";
    inp.style.color = "";
    inp.title = "";
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    btn.title = "Confirm";
    btn.setAttribute("aria-label", "Confirm mobile number");
    btn.classList.add("done");
    inp.focus();
    inp.select();
  } else {
    const err = validateMobile(inp.value.trim());
    if (err) { setMobileError(err); inp.focus(); return; }
    setMobileError("");
    inp.readOnly = true;
    inp.style.background = "#F3F4F6";
    inp.style.color = "#6B7280";
    inp.title = "Mobile number";
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    btn.title = "Edit mobile number";
    btn.setAttribute("aria-label", "Edit mobile number");
    btn.classList.remove("done");
  }
});

// Auto-fill mobile on page load
loadOwnerMobile();

