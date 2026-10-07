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

function dateText(iso) {
  return iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function windowText(row) {
  if (!row.startsAt && !row.expiresAt) return "Always";
  return `${row.startsAt ? dateText(row.startsAt) : "Now"} → ${row.expiresAt ? dateText(row.expiresAt) : "No end"}`;
}

// Where to send buyers for this code. /direct pre-fills ?promo= into its code
// field and opens on the code's first pack, so the buyer types nothing.
function campaignLink(row) {
  const params = new URLSearchParams({ promo: row.code });
  if (row.productIds?.[0]) params.set("sku", row.productIds[0]);
  return `${location.origin}/direct?${params}`;
}

function usesText(row) {
  const used = Number(row.usedCount) || 0;
  const cap = row.singleUse ? 1 : (row.maxUses != null ? Number(row.maxUses) : null);
  return cap != null ? `${used} / ${cap}` : `${used} / ∞`;
}

function cell(label, text) {
  const td = document.createElement("td");
  td.dataset.label = label;
  td.textContent = text;
  return td;
}

function actionButton(text, action, code) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.dataset.promoAction = action;
  btn.dataset.code = code;
  return btn;
}

function renderRow(row, report) {
  const tr = document.createElement("tr");
  const status = statusOf(row);
  if (status === "revoked") tr.className = "is-revoked";

  const codeTd = document.createElement("td");
  codeTd.dataset.label = "Code";
  const codeSpan = document.createElement("span");
  codeSpan.className = "code";
  codeSpan.textContent = row.code;
  codeTd.append(codeSpan);
  if (row.autoApply === true) {
    const web = document.createElement("span");
    web.className = "pill website";
    web.textContent = "Website offer";
    codeTd.append(web);
  }

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
  actWrap.append(
    actionButton(status === "revoked" ? "Activate" : "Revoke", status === "revoked" ? "activate" : "revoke", row.code),
    actionButton("Edit", "edit", row.code),
    actionButton("Copy link", "copy", row.code)
  );
  actTd.append(actWrap);

  tr.append(
    codeTd, discountTd, shippingTd, freeShipTd,
    cell("Window", windowText(row)),
    usesTd,
    cell("Paid orders", String(report?.paidOrders || 0)),
    cell("Revenue", rupees(report?.revenuePaise || 0)),
    cell("Discount given", rupees(report?.discountPaise || 0)),
    statusTd, actTd
  );
  return tr;
}

function setRowsMessage(text, cls) {
  rowsEl.innerHTML = "";
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 11;
  td.className = cls;
  td.textContent = text;
  tr.append(td);
  rowsEl.append(tr);
}

async function load() {
  setRowsMessage("Loading…", "empty");

  let data;
  let report = new Map();
  try {
    const [res, reportRes] = await Promise.all([
      fetch("/api/admin/promo-codes", { credentials: "same-origin" }),
      fetch("/api/admin/promo-codes/report", { credentials: "same-origin" })
    ]);
    if (res.status === 401 || res.status === 403) { window.location.href = "/admin"; return; }
    data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not load promo codes.");
    // The report is extra, not essential: codes still list if it fails.
    const reportData = await reportRes.json().catch(() => null);
    if (reportRes.ok && reportData?.ok) report = new Map(reportData.data.map((r) => [r.code, r]));
    else show("err", reportData?.error || "Could not load the redemption report.");
  } catch (err) {
    setRowsMessage(err.message || "Could not load promo codes.", "empty");
    return;
  }

  const list = data.data || [];
  if (!list.length) {
    setRowsMessage("No promo codes yet. Use New code to create one.", "empty");
    return;
  }

  rowsByCode = new Map(list.map((row) => [row.code, row]));
  rowsEl.innerHTML = "";
  for (const row of list) rowsEl.append(renderRow(row, report.get(row.code)));
}

let rowsByCode = new Map();

rowsEl.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-promo-action]");
  if (!btn || btn.disabled) return;

  const code = btn.dataset.code;
  const action = btn.dataset.promoAction;
  if (action === "edit") { openSheet(rowsByCode.get(code)); return; }
  if (action === "copy") {
    const link = campaignLink(rowsByCode.get(code));
    try {
      await navigator.clipboard.writeText(link);
      show("ok", `Copied ${link}. The code is applied automatically when the buyer opens it.`);
    } catch {
      window.prompt("Copy this link:", link);
    }
    return;
  }
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
const startsEl = document.getElementById("add-starts");
const expiresEl = document.getElementById("add-expires");
const autoApplyEl = document.getElementById("add-auto-apply");
const titleEl = document.getElementById("add-title");
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

// An ISO instant as the local "YYYY-MM-DDTHH:mm" a datetime-local input takes.
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const paiseToRupeesInput = (paise) => (paise != null ? String(Math.round(Number(paise) / 100)) : "");

// The code being edited, or null when the sheet is creating a new one.
let editingCode = null;

function openSheet(row = null) {
  editingCode = row ? row.code : null;
  setSheetError("");
  titleEl.textContent = row ? `Edit ${row.code}` : "Create a promo code";
  codeEl.value = row ? row.code : "";
  codeEl.readOnly = Boolean(row);
  modeEl.value = row?.discountMode || "flat";
  syncModeFields();
  rupeesEl.value = paiseToRupeesInput(row?.discountPaise);
  percentEl.value = row?.discountPercent != null ? String(row.discountPercent) : "";
  shippingEl.value = paiseToRupeesInput(row?.shippingFeePaise);
  freeShipEl.value = paiseToRupeesInput(row?.freeShippingAbovePaise);
  productsEl.value = Array.isArray(row?.productIds) ? row.productIds.join(", ") : "";
  maxUsesEl.value = row?.maxUses != null ? String(row.maxUses) : "";
  startsEl.value = toLocalInput(row?.startsAt);
  expiresEl.value = toLocalInput(row?.expiresAt);
  autoApplyEl.checked = row?.autoApply === true;
  submitEl.disabled = false;
  submitEl.textContent = row ? "Save changes" : "Create code";
  sheetEl.showModal();
  (row ? rupeesEl : codeEl).focus();
}

if (fabEl && sheetEl) {
  fabEl.addEventListener("click", () => openSheet());
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

    // On an edit a blank optional field clears what was stored, so it is sent
    // as null (or an empty pack list) rather than left out.
    if (editingCode) {
      Object.assign(body, { shippingFeePaise: null, freeShippingAbovePaise: null, productIds: [], maxUses: null, startsAt: null, expiresAt: null });
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
    // Always sent, so an edit can switch it off as well as on.
    body.autoApply = autoApplyEl.checked;
    if (startsEl.value) body.startsAt = new Date(startsEl.value).toISOString();
    if (expiresEl.value) body.expiresAt = new Date(expiresEl.value).toISOString();
    if (body.startsAt && body.expiresAt && body.startsAt >= body.expiresAt) {
      setSheetError("The start date must be before the expiry date.");
      startsEl.focus();
      return;
    }

    const editing = editingCode;
    if (editing) delete body.code;
    submitEl.disabled = true;
    submitEl.textContent = editing ? "Saving…" : "Creating…";

    try {
      const res = await fetch(editing ? `/api/admin/promo-codes/${encodeURIComponent(editing)}` : "/api/admin/promo-codes", {
        method: editing ? "PATCH" : "POST",
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
      show("ok", data.message || (editing ? `Saved ${code}.` : `Created ${code}.`));
      await load();
    } catch (err) {
      setSheetError(err.message || (editing ? "Could not save this code." : "Could not create this code."));
      submitEl.disabled = false;
      submitEl.textContent = editing ? "Save changes" : "Create code";
    }
  });
}

loadShopSettings();
load();
