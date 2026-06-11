async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function setStatus(message, tone = "info") {
  const el = document.getElementById("register-owner-status");
  el.textContent = message;
  el.dataset.tone = tone;
}

function renderQrResult(data) {
  document.getElementById("reg-form-shell").hidden = true;
  document.getElementById("reg-success-shell").hidden = false;

  document.getElementById("register-owner-qr-wrap").hidden = false;
  document.getElementById("register-owner-qr").src = data.tag.qrDataUrl;

  const plate = document.getElementById("reg-plate-number").value.trim().toUpperCase();
  const nickname = document.getElementById("reg-vehicle-label").value.trim();

  document.getElementById("register-owner-summary").innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--pt-border)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="8" width="20" height="10" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 8l2-4h10l2 4" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="18" r="1.5" fill="currentColor"/><circle cx="17" cy="18" r="1.5" fill="currentColor"/></svg>
      <span style="font-weight:600">Plate Number</span>
      <span style="margin-left:auto;font-weight:800;letter-spacing:0.06em">${plate || "—"}</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--pt-border)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><path d="M14 14h2v2h-2zM18 14h3M14 18v3M18 18h3v3h-3z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span style="font-weight:600">Tag ID</span>
      <span style="margin-left:auto;font-weight:700;font-size:0.85rem">${data.tag.token}</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span style="font-weight:600">Vehicle Nickname</span>
      <span style="margin-left:auto;font-weight:700">${nickname || "—"}</span>
    </div>
  `;
}

async function registerOwner() {
  try {
    const data = await fetchJson("/api/register-owner", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        displayName: document.getElementById("reg-name").value.trim(),
        email: document.getElementById("reg-email").value.trim(),
        password: document.getElementById("reg-password").value.trim(),
        phone: document.getElementById("reg-phone").value.trim(),
        vehicleLabel: document.getElementById("reg-vehicle-label").value.trim(),
        plateNumber: document.getElementById("reg-plate-number").value.trim(),
        stickerRequested: document.getElementById("reg-sticker-requested").checked
      })
    });

    renderQrResult(data);
    setStatus("Owner registered and QR generated successfully.", "success");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Owner registration failed",
      "error"
    );
  }
}

document
  .getElementById("register-owner-button")
  .addEventListener("click", registerOwner);
