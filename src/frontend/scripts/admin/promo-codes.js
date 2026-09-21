// Promo codes.
//
// A code negotiated over WhatsApp or in a car park is worth whatever it is
// worth. That number is decided HERE, once, by an admin -- never typed by a
// buyer and never computed on /get or /direct, which only ever send the code
// itself and let the server say what it is worth (see promo-codes.js and the
// header of direct.js). This page is the one place that number gets set.
//
// A code is revoked, never deleted: the row stays in the table, dimmed, so it
// still answers "what did we once offer" for a customer asking why a code
// stopped working.

const rowsEl = document.getElementById("rows");
const msgEl = document.getElementById("msg");
const platePriceEl = document.getElementById("plate-price");
const plateEnabledEl = document.getElementById("plate-enabled");
const plateSaveEl = document.getElementById("plate-save");

function show(kind, text) {
  msgEl.className = "msg " + kind;
  msgEl.textContent = text;
}

function clearMsg() {
  msgEl.className = "msg";
  msgEl.textContent = "";
}

async function loadShopSettings() {
  try {
    const res = await fetch("/api/admin/shop-settings", { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) { window.location.href = "/admin"; return; }
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || "Could not load shop settings.");
    const settings = payload.data || {};
    platePriceEl.value = settings.pricePaise ? String(Math.round(settings.pricePaise / 100)) : "";
    plateEnabledEl.checked = settings.enabled === true;
  } catch (err) {
    show("err", err.message || "Could not load shop settings.");
  }
}

plateSaveEl?.addEventListener("click", async () => {
  const rupeesValue = Number.parseFloat(platePriceEl.value);
  if (!Number.isFinite(rupeesValue) || rupeesValue < 1) {
    show("err", "Enter the dashboard plate price before making it available.");
    platePriceEl.focus();
    return;
  }
  plateSaveEl.disabled = true;
  plateSaveEl.textContent = "Saving…";
  clearMsg();
  try {
    const res = await fetch("/api/admin/shop-settings", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pricePaise: Math.round(rupeesValue * 100),
        enabled: plateEnabledEl.checked
      })
    });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || "Could not save the add-on.");
    show("ok", plateEnabledEl.checked ? "Dashboard plate is live in the shop for the Duo Pack." : "Dashboard plate saved but hidden from the shop.");
  } catch (err) {
    show("err", err.message || "Could not save the add-on.");
  } finally {
    plateSaveEl.disabled = false;
    plateSaveEl.textContent = "Save add-on";
  }
});

// Whole rupees, matching how every other admin/shop page reads out paise.
function rupees(paise) {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

// Action-oriented, not the raw enum. A naive title-case of "per_unit" reads
// as "Per_unit" -- these are what the mode actually does to the price.
const MODE_LABEL = {
  flat: "Flat",
  per_unit: "Per unit",
  percent: "Percent"
};

// Exhaustive: a promo code is either active or revoked, and there is no third
// state, so the map names both rather than deriving a label from `active`.
const STATUS_LABEL = {
  active: "Active",
  revoked: "Revoked"
};

function statusOf(row) {
  return row.active === false ? "revoked" : "active";
}

function discountValueText(row) {
  if (row.discountMode === "percent") return `${Number(row.discountPercent) || 0}%`;
  return rupees(Number(row.discountPaise) || 0);
}

function shippingText(row) {
  // null/undefined means this code does not override the catalogue's own
  // shipping fee, which is not the same thing as a fee of zero.
  if (row.shippingFeePaise == null) return "—";
  const paise = Number(row.shippingFeePaise) || 0;
  return paise === 0 ? "Free" : rupees(paise);
}

function freeShipText(row) {
  return row.freeShippingAbovePaise != null ? rupees(Number(row.freeShippingAbovePaise) || 0) : "—";
}

function usesText(row) {
  const used = Number(row.usedCount) || 0;
  const cap = row.singleUse ? 1 : (row.maxUses != null ? Number(row.maxUses) : null);
  return cap != null ? `${used} / ${cap}` : `${used} / ∞`;
}

function renderRow(row) {
  const tr = document.createElement("tr");
  const status = statusOf(row);
  if (status === "revoked") tr.className = "is-revoked";

  const codeTd = document.createElement("td");
  codeTd.dataset.label = "Code";
  const codeSpan = document.createElement("span");
  codeSpan.className = "code";
  codeSpan.textContent = row.code;
  codeTd.append(codeSpan);

  const discountTd = document.createElement("td");
  discountTd.dataset.label = "Discount";
  discountTd.textContent = `${MODE_LABEL[row.discountMode] || row.discountMode || MODE_LABEL.flat} · ${discountValueText(row)}`;

  const shippingTd = document.createElement("td");
  shippingTd.dataset.label = "Shipping";
  shippingTd.textContent = shippingText(row);

  const freeShipTd = document.createElement("td");
  freeShipTd.dataset.label = "Free ship above";
  freeShipTd.textContent = freeShipText(row);

  const usesTd = document.createElement("td");
  usesTd.dataset.label = "Uses";
  usesTd.textContent = usesText(row);

  const statusTd = document.createElement("td");
  statusTd.dataset.label = "Status";
  const pill = document.createElement("span");
  pill.className = `pill ${status}`;
  pill.textContent = STATUS_LABEL[status];
  statusTd.append(pill);

  const actTd = document.createElement("td");
  actTd.dataset.label = "Actions";
  const actWrap = document.createElement("div");
  actWrap.className = "act";
  const actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.textContent = status === "revoked" ? "Activate" : "Revoke";
  actionBtn.dataset.promoAction = status === "revoked" ? "activate" : "revoke";
  actionBtn.dataset.code = row.code;
  actWrap.append(actionBtn);
  actTd.append(actWrap);

  tr.append(codeTd, discountTd, shippingTd, freeShipTd, usesTd, statusTd, actTd);
  return tr;
}

function setRowsMessage(text, cls) {
  rowsEl.innerHTML = "";
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 7;
  td.className = cls;
  td.textContent = text;
  tr.append(td);
  rowsEl.append(tr);
}

async function load() {
  setRowsMessage("Loading…", "empty");

  let data;
  try {
    const res = await fetch("/api/admin/promo-codes", { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) { window.location.href = "/admin"; return; }
    data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not load promo codes.");
  } catch (err) {
    setRowsMessage(err.message || "Could not load promo codes.", "empty");
    return;
  }

  const list = data.data || [];
  if (!list.length) {
    setRowsMessage("No promo codes yet. Use New code to create one.", "empty");
    return;
  }

  rowsEl.innerHTML = "";
  for (const row of list) rowsEl.append(renderRow(row));
}

rowsEl.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-promo-action]");
  if (!btn || btn.disabled) return;

  const code = btn.dataset.code;
  const action = btn.dataset.promoAction;
  if (action === "revoke" && !window.confirm(`Pause ${code}? The offer will disappear from the storefront immediately.`)) return;

  clearMsg();
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = action === "activate" ? "Activating…" : "Revoking…";

  try {
    const res = await fetch(`/api/admin/promo-codes/${encodeURIComponent(code)}/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    if (res.status === 401 || res.status === 403) { window.location.href = "/admin"; return; }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not revoke this code.");
    show("ok", action === "activate" ? `Activated ${code}.` : `Paused ${code}.`);
  } catch (err) {
    show("err", err.message || "Could not revoke this code.");
    btn.textContent = original;
    btn.disabled = false;
  } finally {
    await load();
  }
});

// ── Create a code ────────────────────────────────────────────────────────────

const fabEl = document.getElementById("add-fab");
const sheetEl = document.getElementById("add-sheet");
const formEl = document.getElementById("add-form");
const codeEl = document.getElementById("add-code");
const modeEl = document.getElementById("add-mode");
const rupeesEl = document.getElementById("add-discount-rupees");
const percentEl = document.getElementById("add-discount-percent");
const shippingEl = document.getElementById("add-shipping-rupees");
const freeShipEl = document.getElementById("add-free-ship-rupees");
const productsEl = document.getElementById("add-products");
const maxUsesEl = document.getElementById("add-max-uses");
const expiresEl = document.getElementById("add-expires");
const cancelEl = document.getElementById("add-cancel");
const submitEl = document.getElementById("add-submit");
const sheetMsgEl = document.getElementById("add-msg");
const modeFields = Array.from(document.querySelectorAll("[data-mode-field]"));

// Only the field the chosen mode actually charges against is shown. Leaving
// both visible invites a value typed into the field the mode ignores, which
// then looks applied and is not.
function syncModeFields() {
  const mode = modeEl.value;
  for (const el of modeFields) {
    const modes = el.dataset.modeField.split(",");
    el.style.display = modes.includes(mode) ? "block" : "";
  }
}

function setSheetError(text) {
  sheetMsgEl.className = text ? "sheet-msg err" : "sheet-msg";
  sheetMsgEl.textContent = text || "";
}

function openSheet() {
  setSheetError("");
  codeEl.value = "";
  modeEl.value = "flat";
  syncModeFields();
  rupeesEl.value = "";
  percentEl.value = "";
  shippingEl.value = "";
  freeShipEl.value = "";
  productsEl.value = "";
  maxUsesEl.value = "";
  expiresEl.value = "";
  submitEl.disabled = false;
  submitEl.textContent = "Create code";
  sheetEl.showModal();
  codeEl.focus();
}

if (fabEl && sheetEl) {
  fabEl.addEventListener("click", openSheet);
  cancelEl.addEventListener("click", () => sheetEl.close());
  modeEl.addEventListener("change", syncModeFields);

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    setSheetError("");

    const code = codeEl.value.trim().toUpperCase();
    if (!code) { setSheetError("Enter a code."); codeEl.focus(); return; }

    const mode = modeEl.value;
    // The API field is `discountMode` (see routes/admin/promo-codes.js's
    // WRITABLE_FIELDS) -- `mode` stays the local name only because it is
    // shorter to read here.
    const body = { code, discountMode: mode };

    // A UX nicety, not the real gate -- the server validates this again and
    // is what actually decides. This just saves a round trip for the obvious
    // mistakes.
    if (mode === "percent") {
      const pct = Number.parseFloat(percentEl.value);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        setSheetError("Percent off must be more than 0 and at most 100.");
        percentEl.focus();
        return;
      }
      body.discountPercent = pct;
    } else {
      const rupeesValue = Number.parseFloat(rupeesEl.value);
      if (!Number.isFinite(rupeesValue) || rupeesValue <= 0) {
        setSheetError("Discount must be more than ₹0.");
        rupeesEl.focus();
        return;
      }
      body.discountPaise = Math.round(rupeesValue * 100);
    }

    if (shippingEl.value.trim()) {
      const s = Number.parseFloat(shippingEl.value);
      if (Number.isFinite(s) && s >= 0) body.shippingFeePaise = Math.round(s * 100);
    }
    if (freeShipEl.value.trim()) {
      const f = Number.parseFloat(freeShipEl.value);
      if (Number.isFinite(f) && f >= 0) body.freeShippingAbovePaise = Math.round(f * 100);
    }
    const productIds = productsEl.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (productIds.length) body.productIds = productIds;
    if (maxUsesEl.value.trim()) {
      const maxUses = Number.parseInt(maxUsesEl.value, 10);
      if (!Number.isInteger(maxUses) || maxUses < 1) {
        setSheetError("Maximum uses must be a whole number greater than 0.");
        maxUsesEl.focus();
        return;
      }
      body.maxUses = maxUses;
    }
    if (expiresEl.value) body.expiresAt = new Date(expiresEl.value).toISOString();

    submitEl.disabled = true;
    submitEl.textContent = "Creating…";

    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.status === 401 || res.status === 403) { window.location.href = "/admin"; return; }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not create this code.");

      // Kept inside the dialog until it succeeds: a refusal ("code already
      // exists", "malformed") is something to correct here, not a message to
      // read after the form has vanished.
      sheetEl.close();
      show("ok", data.message || `Created ${code}.`);
      await load();
    } catch (err) {
      setSheetError(err.message || "Could not create this code.");
      submitEl.disabled = false;
      submitEl.textContent = "Create code";
    }
  });
}

loadShopSettings();
load();
