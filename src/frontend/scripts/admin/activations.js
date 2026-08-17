const qInput = document.getElementById("q");
const activatedRows = document.getElementById("activatedRows");
const unactivatedRows = document.getElementById("unactivatedRows");
const activatedCount = document.getElementById("activatedCount");
const unactivatedCount = document.getElementById("unactivatedCount");

const REMINDER_MSG =
  "Hi! Your ParkTag premium sticker is ready to activate. Scan it or open your ParkTag dashboard to activate and start receiving masked calls. Reply here if you need help.";

let DATA = { activated: [], unactivated: [] };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return s; }
}
// Digits-with-country-code for tel:/wa.me. 10-digit → +91; strip a leading 0.
function waDigits(mobile) {
  let d = String(mobile || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d;
}
function telCell(mobile) {
  if (!mobile) return `<span class="muted">—</span>`;
  const d = waDigits(mobile);
  return `<a class="tel" href="tel:+${esc(d)}">${esc(mobile)}</a>`;
}

function matches(row, q) {
  if (!q) return true;
  return [row.plateNumber, row.vehicleLabel, row.ownerName, row.ownerEmail, row.ownerMobile, row.orderNumber, row.productName, row.etagId, row.serial]
    .some((v) => String(v || "").toLowerCase().includes(q));
}

function renderActivated(q) {
  const list = DATA.activated.filter((r) => matches(r, q));
  activatedCount.textContent = `${list.length} activated`;
  if (!list.length) {
    activatedRows.innerHTML = `<tr><td colspan="7" class="empty">No activated premium tags${q ? " match your search" : " yet"}.</td></tr>`;
    return;
  }
  activatedRows.innerHTML = list.map((t) => `
    <tr>
      <td data-label="E-Tag ID"><b>${esc(t.etagId)}</b></td>
      <td data-label="Sticker serial">${t.serial ? `<b>${esc(t.serial)}</b>` : `<span class="muted">—</span>`}</td>
      <td data-label="Vehicle"><span class="plate">${esc(t.plateNumber || "—")}</span>${t.vehicleLabel ? `<br><span class="muted">${esc(t.vehicleLabel)}</span>` : ""}</td>
      <td data-label="Owner">${esc(t.ownerName || "—")}${t.ownerEmail ? `<br><span class="muted">${esc(t.ownerEmail)}</span>` : ""}</td>
      <td data-label="Mobile">${telCell(t.ownerMobile)}</td>
      <td data-label="Activated On">${fmtDate(t.activatedAt)}</td>
      <td data-label="Status"><span class="pill ${t.status === "active" ? "active" : "inactive"}">${esc(t.status || "—")}</span></td>
    </tr>`).join("");
}

function renderUnactivated(q) {
  const list = DATA.unactivated.filter((r) => matches(r, q));
  unactivatedCount.textContent = `${list.length} to remind`;
  if (!list.length) {
    unactivatedRows.innerHTML = `<tr><td colspan="7" class="empty">No sold-but-unactivated tags${q ? " match your search" : ""}.</td></tr>`;
    return;
  }
  unactivatedRows.innerHTML = list.map((o) => {
    const pay = o.paymentMethod === "cod" ? `<span class="pill cod">COD</span>` : `<span class="pill prepaid">Prepaid</span>`;
    const d = waDigits(o.ownerMobile);
    const remind = o.ownerMobile
      ? `<span class="remind">
           <a class="wa" href="https://wa.me/${esc(d)}?text=${encodeURIComponent(REMINDER_MSG)}" target="_blank" rel="noopener">WhatsApp</a>
           <a href="tel:+${esc(d)}">Call</a>
         </span>`
      : `<span class="muted">no mobile</span>`;
    return `
      <tr>
        <td data-label="Order #"><b>${esc(o.orderNumber || "—")}</b>${o.waybill ? `<br><span class="muted">AWB ${esc(o.waybill)}</span>` : ""}</td>
        <td data-label="Product">${esc(o.productName || "—")}</td>
        <td data-label="Owner">${esc(o.ownerName || "—")}${o.ownerEmail ? `<br><span class="muted">${esc(o.ownerEmail)}</span>` : ""}</td>
        <td data-label="Mobile">${telCell(o.ownerMobile)}</td>
        <td data-label="Payment">${pay}</td>
        <td data-label="Placed On">${fmtDate(o.placedAt)}</td>
        <td data-label="Remind">${remind}</td>
      </tr>`;
  }).join("");
}

function renderAll() {
  const q = qInput.value.trim().toLowerCase();
  renderActivated(q);
  renderUnactivated(q);
}

async function load() {
  try {
    const res = await fetch("/api/admin/activations");
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    DATA = { activated: data.activated || [], unactivated: data.unactivated || [] };
    renderAll();
  } catch {
    activatedRows.innerHTML = `<tr><td colspan="7" class="err">Could not load activations.</td></tr>`;
    unactivatedRows.innerHTML = `<tr><td colspan="7" class="err">Could not load orders.</td></tr>`;
    activatedCount.textContent = "—";
    unactivatedCount.textContent = "—";
  }
}

qInput.addEventListener("input", renderAll);
load();
