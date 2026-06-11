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
  const el = byId("admin-auth-status");

  if (!el) {
    return;
  }

  el.textContent = message;
  el.dataset.tone = tone;
}

function currentAdminPage() {
  return document.querySelector("[data-admin-page]")?.dataset.adminPage || "login";
}

function goToOverview() {
  window.location.href = "/admin/overview";
}

function setReadyState(message, tone = "info") {
  const card = byId("admin-ready-card");
  const copy = byId("admin-ready-copy");

  if (!card || !copy) {
    return;
  }

  card.hidden = false;
  copy.textContent = message;
  copy.dataset.tone = tone;
}

function renderCounts(counts) {
  const target = byId("admin-counts");

  if (!target) {
    return;
  }

  target.innerHTML = `
    <article class="stat-card"><span class="stat-label">Owners</span><strong>${counts.owners}</strong></article>
    <article class="stat-card"><span class="stat-label">Tags</span><strong>${counts.tags}</strong></article>
    <article class="stat-card"><span class="stat-label">Requests</span><strong>${counts.requests}</strong></article>
    <article class="stat-card"><span class="stat-label">Pending Print</span><strong>${counts.pendingPrint}</strong></article>
  `;

  if (counts.owners === 0 && counts.tags === 0) {
    setReadyState(
      "No seeded admin data is visible in the current environment. Run demo seed first.",
      "error"
    );
  } else {
    setReadyState(
      "Current environment is ready for issuance, queue review, and owner monitoring.",
      "success"
    );
  }
}

function renderOwners(owners) {
  const target = byId("owner-monitor-list");

  if (!target) {
    return;
  }

  if (!owners.length) {
    target.innerHTML = `<p class="empty-copy">No owners available yet.</p>`;
    return;
  }

  target.innerHTML = owners
    .map(
      (owner) => `
        <article class="monitor-card">
          <div>
            <strong>${owner.displayName}</strong>
            <p>${owner.email}</p>
          </div>
          <div class="monitor-meta">
            <span>Credits: ${owner.credits}</span>
            <span>Tags: ${owner.tags}</span>
            <span>Active: ${owner.activeTags}</span>
            ${owner.latestTagToken ? `<span>Latest tag: ${owner.latestTagToken}</span>` : ""}
          </div>
        </article>
      `
    )
    .join("");
}

function renderRegistrations(registrations) {
  const target = byId("registration-feed");

  if (!target) {
    return;
  }

  if (!registrations?.length) {
    target.innerHTML = `<p class="empty-copy">No recent owner registrations yet.</p>`;
    return;
  }

  target.innerHTML = registrations
    .map(
      (item) => `
        <article class="queue-row">
          <strong>${item.displayName}</strong>
          <span>${item.email}</span>
          <span>Tags: ${item.tags}</span>
          <span>Active: ${item.activeTags}</span>
          ${item.latestTagToken ? `<span>Latest tag: ${item.latestTagToken}</span>` : ""}
          <span>Created: ${new Date(item.createdAt).toLocaleString()}</span>
        </article>
      `
    )
    .join("");
}

function renderRequests(requests) {
  const target = byId("request-feed");

  if (!target) {
    return;
  }

  if (!requests.length) {
    target.innerHTML = `<p class="empty-copy">No recent activity loaded yet.</p>`;
    return;
  }

  target.innerHTML = requests
    .map(
      (item) => `
        <article class="queue-row">
          <strong>${item.token}</strong>
          <span>Phone: ${item.phone}</span>
          <span>Action: ${item.action}${item.messageChannel ? ` (${item.messageChannel})` : ""}</span>
          <span>Status: ${item.status}</span>
          ${item.provider ? `<span>Provider: ${item.provider}</span>` : ""}
          ${item.providerWebhookStatus ? `<span>Provider status: ${item.providerWebhookStatus}</span>` : ""}
          ${item.providerStatusCode ? `<span>Provider code: ${item.providerStatusCode}</span>` : ""}
          ${item.providerError ? `<span>Provider error: ${item.providerError}</span>` : ""}
          ${item.providerErrorDetail ? `<span>Provider detail: ${item.providerErrorDetail}</span>` : ""}
          <span>Created: ${new Date(item.createdAt).toLocaleString()}</span>
        </article>
      `
    )
    .join("");
}

function setIssueMessage(message) {
  const target = byId("issue-output");

  if (!target) {
    return;
  }

  target.innerHTML = `
    <p class="empty-copy">${message}</p>
  `;
}

function renderIssuedTag(data) {
  const target = byId("issue-output");
  const tags = data.tags || [];

  if (!target) {
    return;
  }

  if (!tags.length) {
    target.innerHTML = `<p class="empty-copy">No tag batch issued yet.</p>`;
    return;
  }

  target.innerHTML = tags
    .map(
      (tag) => `
        <article class="qr-card">
          <img src="${tag.qrDataUrl}" alt="QR code for ${tag.token}" class="qr-preview" />
          <div class="qr-card-body">
            <strong>${tag.token}</strong>
            <span>Batch: ${tag.batchNumber || "-"}</span>
            <span>Label: ${tag.batchLabel || "-"}</span>
            <span>Print: ${tag.printStatus}</span>
            <a href="${tag.claimUrl}" target="_blank" rel="noreferrer">${tag.claimUrl}</a>
          </div>
        </article>
      `
    )
    .join("");

  setStatus("QR batch generated successfully.", "success");
}

function setQueueMessage(message) {
  const target = byId("print-queue-output");

  if (!target) {
    return;
  }

  target.innerHTML = `
    <p class="empty-copy">${message}</p>
  `;
}

function renderPrintQueue(data) {
  const target = byId("print-queue-output");
  const tags = data.tags || [];

  if (!target) {
    return;
  }

  if (!tags.length) {
    target.innerHTML = `<p class="empty-copy">No print queue loaded yet.</p>`;
    return;
  }

  target.innerHTML = tags
    .map(
      (tag) => `
        <article class="queue-row">
          <strong>${tag.token}</strong>
          <span>Batch: ${tag.batchNumber || "-"}</span>
          <span>Label: ${tag.batchLabel || "-"}</span>
          <span>Status: ${tag.printStatus}</span>
          <a href="${tag.claimUrl}" target="_blank" rel="noreferrer">Claim URL</a>
        </article>
      `
    )
    .join("");
}

async function loadAdminOverview() {
  const data = await fetchJson("/api/admin/overview");
  renderCounts(data.counts);
  renderOwners(data.owners || []);
  renderRequests(data.recentRequests || []);
  renderRegistrations(data.recentRegistrations || []);

  if (data.pendingPrintTags?.length === 0) {
    setQueueMessage("No unprinted tags yet. Issue a batch to populate the queue.");
  }

  return data;
}

async function seedAdminDemo() {
  try {
    const data = await fetchJson("/api/demo/seed", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });

    setStatus(
      "Demo setup created for the current environment. You can now sign in with admin@wavetag.local / demo1234.",
      "success"
    );
    setIssueMessage(
      `Seeded active token ${data.tag.token} and claimable token ${data.claimableTag.token}.`
    );
    setQueueMessage("Demo setup ready. Sign in and load the print queue.");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Demo seed failed",
      "error"
    );
  }
}

async function loginAdmin() {
  const email = byId("admin-email")?.value;
  const password = byId("admin-password")?.value;

  try {
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        role: "admin",
        email,
        password
      })
    });

    goToOverview();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Admin login failed";
    setStatus(
      `${message}. If this is local dev, click "Seed demo setup" first.`,
      "error"
    );
  }
}

async function logoutAdmin() {
  await fetchJson("/api/auth/logout", {
    method: "POST"
  });

  window.location.href = "/admin";
}

async function issueTag() {
  try {
    const data = await fetchJson("/api/admin/tags/issue", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        batchNumber: byId("issue-batch-number")?.value.trim(),
        batchLabel: byId("issue-batch-label")?.value.trim(),
        quantity: byId("issue-quantity")?.value.trim(),
        stickerRequested: byId("issue-sticker-requested")?.checked
      })
    });

    renderIssuedTag(data);
    await loadAdminOverview();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to issue tag batch";
    setStatus(message, "error");
    setIssueMessage(`Issue failed: ${message}`);
  }
}

async function loadPrintQueue() {
  try {
    const data = await fetchJson("/api/admin/print-queue");
    renderPrintQueue(data);
    setStatus("Print queue loaded.", "success");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load print queue";
    setQueueMessage(`Print queue failed: ${message}`);
    setStatus(message, "error");
  }
}

async function loadOwners() {
  const target = byId("owner-monitor-list");
  try {
    const data = await fetchJson("/api/admin/owners");
    if (!target) return;
    if (!data.owners.length) {
      target.innerHTML = `<p class="empty-copy">No owners registered yet.</p>`;
      return;
    }
    target.innerHTML = data.owners.map((owner) => `
      <article class="monitor-card">
        <div>
          <strong>${owner.displayName}</strong>
          <p>${owner.email}</p>
          <p>${owner.phone || ""}</p>
        </div>
        <div class="monitor-meta">
          <span>Credits: ${owner.credits}</span>
          <span>Tags: ${owner.tags}</span>
          <span>Active: ${owner.activeTags}</span>
          ${owner.tagTokens?.map(t => `<span>Token: ${t}</span>`).join("") || ""}
          <span>Joined: ${new Date(owner.createdAt).toLocaleString()}</span>
        </div>
      </article>`).join("");
  } catch (error) {
    if (target) target.innerHTML = `<p class="empty-copy">Failed to load owners.</p>`;
  }
}

async function loadActivity() {
  const target = byId("request-feed");
  try {
    const data = await fetchJson("/api/admin/activity?limit=100");
    if (!target) return;
    if (!data.activity.length) {
      target.innerHTML = `<p class="empty-copy">No contact activity yet.</p>`;
      return;
    }
    target.innerHTML = data.activity.map((item) => `
      <article class="queue-row">
        <strong>${item.vehicleLabel}</strong>
        <span>Token: ${item.token}</span>
        <span>Phone: ${item.phone}</span>
        <span>Action: ${item.action}${item.messageChannel ? ` (${item.messageChannel})` : ""}</span>
        ${item.message ? `<span>Message: ${item.message}</span>` : ""}
        <span class="status-badge" data-tone="${item.status === "provider_started" ? "success" : item.status === "provider_failed" ? "error" : "info"}">${item.status}</span>
        ${item.providerError ? `<span class="error-note">${item.providerError}</span>` : ""}
        <span>${new Date(item.createdAt).toLocaleString()}</span>
      </article>`).join("");
  } catch (error) {
    if (target) target.innerHTML = `<p class="empty-copy">Failed to load activity.</p>`;
  }
}

async function loadAdmins() {
  const target = byId("admin-list");
  try {
    const data = await fetchJson("/api/admin/admins");
    if (!target) return;
    if (!data.admins.length) {
      target.innerHTML = `<p class="empty-copy">No admins yet.</p>`;
      return;
    }
    target.innerHTML = data.admins.map((a) => `
      <article class="monitor-card">
        <strong>${a.displayName}</strong>
        <span>${a.email}</span>
        <span>Added: ${new Date(a.createdAt).toLocaleString()}</span>
      </article>`).join("");
  } catch (error) {
    if (target) target.innerHTML = `<p class="empty-copy">Failed to load admins.</p>`;
  }
}

async function refreshCurrentPage() {
  try {
    const page = currentAdminPage();

    if (page === "overview" || page === "issuance") {
      await loadAdminOverview();
    } else if (page === "print-queue") {
      await loadPrintQueue();
    } else if (page === "owners") {
      await loadOwners();
    } else if (page === "activity") {
      await loadActivity();
    } else if (page === "admins") {
      await loadAdmins();
    }
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : "Unable to load the current admin environment.",
      "error"
    );

    if (currentAdminPage() !== "login") {
      window.location.href = "/admin";
    }
  }
}

async function createNewAdmin() {
  const email = byId("new-admin-email")?.value.trim();
  const password = byId("new-admin-password")?.value.trim();
  const displayName = byId("new-admin-name")?.value.trim();

  const statusEl = byId("admin-mgmt-status");

  if (!email || !password || !displayName) {
    if (statusEl) {
      statusEl.textContent = "All fields are required.";
      statusEl.dataset.tone = "error";
    }
    return;
  }

  try {
    await fetchJson("/api/admin/admins", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        displayName
      })
    });

    if (statusEl) {
      statusEl.textContent = "Admin account created successfully.";
      statusEl.dataset.tone = "success";
    }
    
    byId("new-admin-email").value = "";
    byId("new-admin-password").value = "";
    byId("new-admin-name").value = "";
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = error instanceof Error ? error.message : "Failed to create admin";
      statusEl.dataset.tone = "error";
    }
  }
}

function bindEvents() {
  if (hasEl("admin-login-button")) {
    byId("admin-login-button").addEventListener("click", loginAdmin);
  }

  if (hasEl("admin-seed-button")) {
    byId("admin-seed-button").addEventListener("click", seedAdminDemo);
  }

  if (hasEl("admin-logout-button")) {
    byId("admin-logout-button").addEventListener("click", logoutAdmin);
  }

  if (hasEl("admin-refresh-button")) {
    byId("admin-refresh-button").addEventListener("click", refreshCurrentPage);
  }

  if (hasEl("issue-tag-button")) {
    byId("issue-tag-button").addEventListener("click", issueTag);
  }

  if (hasEl("load-print-queue-button")) {
    byId("load-print-queue-button").addEventListener("click", loadPrintQueue);
  }

  if (hasEl("add-admin-button")) {
    byId("add-admin-button").addEventListener("click", createNewAdmin);
  }
}

bindEvents();

if (currentAdminPage() !== "login") {
  await refreshCurrentPage();
}
