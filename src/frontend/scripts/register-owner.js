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
  document.getElementById("register-owner-output").innerHTML = `
    <article class="journey-result-card">
      <p class="eyebrow">Registration complete</p>
      <strong>${data.owner.displayName}</strong>
      <span>Your owner account is active and your WaveTag is ready to use.</span>
      <div class="summary-list">
        <span>Email: ${data.owner.email}</span>
        <span>Tag status: ${data.tag.status}</span>
        <span>Sticker: ${data.tag.stickerRequested ? "Requested" : "Not requested"}</span>
      </div>
      <a href="${data.tag.claimUrl}" target="_blank" rel="noreferrer">${data.tag.claimUrl}</a>
    </article>
  `;
  document.getElementById("register-owner-qr-wrap").hidden = false;
  document.getElementById("register-owner-qr").src = data.tag.qrDataUrl;
  document.getElementById("register-owner-summary").innerHTML = `
    <strong>${data.tag.token}</strong>
    <span>Status: ${data.tag.status}</span>
    <span>Print state: ${data.tag.printStatus}</span>
    <span>Save this QR or keep the link below for later.</span>
    <a href="${data.tag.claimUrl}" target="_blank" rel="noreferrer">${data.tag.claimUrl}</a>
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
