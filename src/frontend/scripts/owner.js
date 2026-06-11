async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function byId(id) {
  return document.getElementById(id);
}

function hasEl(id) {
  return Boolean(byId(id));
}

function setStatus(message, tone = "info") {
  const el = byId("owner-auth-status");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}

function renderSummary(owner) {
  const target = byId("owner-profile");
  if (!target) return;
  target.innerHTML = `
    <div><strong>Owner:</strong> ${owner.displayName}</div>
    <div><strong>Email:</strong> ${owner.email}</div>
    <div><strong>Credits:</strong> ${owner.credits}</div>
  `;
}

const stickerRequestPending = new Set();

function stickerStatusLabel(tag) {
  if (tag.printStatus === "printed") return `<span class="status-badge" data-tone="success">Sticker printed</span>`;
  if (tag.printStatus === "pending_print") return `<span class="status-badge" data-tone="info">Sticker order placed</span>`;
  return "";
}

function renderTags(tags) {
  const select = byId("owner-tag-select");
  const list = byId("owner-tags-list");
  const qrList = byId("owner-qr-list");

  if (select) {
    select.innerHTML = tags
      .map(
        (tag) =>
          `<option value="${tag.id}">${tag.vehicleLabel || "Vehicle"} · ${tag.status}</option>`
      )
      .join("");
  }

  if (list) {
    if (!tags.length) {
      list.innerHTML = `<p class="empty-copy">No tags linked to this owner yet.</p>`;
    } else {
      list.innerHTML = tags
        .map(
          (tag) => `
            <article class="queue-row">
              <strong>${tag.vehicleLabel || "Registered vehicle"}</strong>
              <span>Token: ${tag.token}</span>
              <span>Status: ${tag.status}</span>
              ${tag.plateNumber ? `<span>Plate: ${tag.plateNumber}</span>` : ""}
              ${stickerStatusLabel(tag)}
            </article>
          `
        )
        .join("");
    }
  }

  if (qrList) {
    if (!tags.length) {
      qrList.innerHTML = `<p class="empty-copy">No QR codes yet.</p>`;
    } else {
      qrList.innerHTML = tags.map((tag) => `
        <article class="qr-card">
          <img src="${tag.qrDataUrl}" alt="QR for ${tag.vehicleLabel}" class="qr-preview" />
          <div class="qr-card-body">
            <strong>${tag.vehicleLabel || "Vehicle"}</strong>
            <span class="meta-copy">Token: ${tag.token}</span>
            ${stickerStatusLabel(tag)}
            <div class="actions stacked-actions">
              <a href="${tag.qrDataUrl}" download="wavetag-${tag.token}.png" class="action subtle small">
                Download QR
              </a>
              ${tag.printStatus === "pending_print" || tag.printStatus === "printed"
                ? `<button class="action small" disabled>Sticker ${tag.printStatus === "printed" ? "printed" : "order placed"}</button>`
                : `<button class="action small" id="sticker-btn-${tag.id}" onclick="requestSticker('${tag.id}', '${tag.token}')">
                    Request sticker print
                  </button>`
              }
            </div>
          </div>
        </article>
      `).join("");
    }
  }
}

function renderRequests(requests) {
  const list = byId("owner-requests-list");
  if (!list) return;

  if (!requests.length) {
    list.innerHTML = `<p class="empty-copy">No recent requests yet.</p>`;
    return;
  }

  list.innerHTML = requests
    .map((request) => {
      const channel =
        request.action === "message"
          ? request.messageChannel === "whatsapp"
            ? "WhatsApp"
            : "SMS"
          : "Call";

      return `
        <article class="queue-row">
          <strong>${channel} request</strong>
          <span>Token: ${request.token}</span>
          <span>Phone: ${request.phone}</span>
          <span>Status: ${request.status}</span>
          ${request.provider ? `<span>Provider: ${request.provider}</span>` : ""}
          ${request.providerWebhookStatus ? `<span>Provider status: ${request.providerWebhookStatus}</span>` : ""}
          ${request.providerError ? `<span>Provider error: ${request.providerError}</span>` : ""}
          ${
            request.message
              ? `<span>Message: ${request.message}</span>`
              : ""
          }
          <span>Created: ${new Date(request.createdAt).toLocaleString()}</span>
        </article>
      `;
    })
    .join("");
}

async function loadOwnerDashboard() {
  try {
    const data = await fetchJson("/api/owner/dashboard");
    renderSummary(data.owner);
    renderTags(data.tags);
    renderRequests(data.requests);
    setStatus("Owner dashboard loaded.", "success");
  } catch (error) {
    if (error.message.includes("Authentication required")) {
      window.location.href = "/owner";
    } else {
      setStatus(
        error instanceof Error ? error.message : "Failed to load dashboard",
        "error"
      );
    }
  }
}

async function loginOwner() {
  const email = byId("owner-email")?.value;
  const password = byId("owner-password")?.value;

  try {
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        role: "owner",
        email,
        password
      })
    });

    window.location.href = "/owner";
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Owner login failed",
      "error"
    );
  }
}

async function logoutOwner() {
  await fetchJson("/api/auth/logout", {
    method: "POST"
  });

  window.location.href = "/owner";
}

async function requestSticker(tagId, token) {
  const btn = byId(`sticker-btn-${tagId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Placing order..."; }

  try {
    await fetchJson(`/api/owner/tags/${tagId}/request-sticker`, { method: "POST" });
    if (btn) { btn.textContent = "Sticker order placed"; }
    setStatus(`Sticker order placed for ${token}. We'll ship it to you soon.`, "success");
    await loadOwnerDashboard();
  } catch (error) {
    if (btn) { btn.disabled = false; btn.textContent = "Request sticker print"; }
    setStatus(error instanceof Error ? error.message : "Failed to place sticker order", "error");
  }
}

window.requestSticker = requestSticker;

async function updateTagStatus(status) {
  const tagId = byId("owner-tag-select")?.value;

  if (!tagId) {
    setStatus("Select a tag first.", "error");
    return;
  }

  try {
    await fetchJson(`/api/owner/tags/${tagId}/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ status })
    });

    setStatus(`Tag set to ${status}.`, "success");
    await loadOwnerDashboard();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Failed to update tag status",
      "error"
    );
  }
}

if (hasEl("owner-login-button")) {
  byId("owner-login-button").addEventListener("click", loginOwner);
}

if (hasEl("owner-logout-button")) {
  byId("owner-logout-button").addEventListener("click", logoutOwner);
}

if (hasEl("owner-set-active")) {
  byId("owner-set-active").addEventListener("click", () => updateTagStatus("active"));
}

if (hasEl("owner-set-inactive")) {
  byId("owner-set-inactive").addEventListener("click", () => updateTagStatus("inactive"));
}

if (hasEl("owner-profile")) {
  await loadOwnerDashboard();
}
