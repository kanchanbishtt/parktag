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

// Branded two-panel E-Tag sticker — a pixel-exact port of the owner E-Tag PDF
// sticker (`.wl-pt-sticker` in pages/owner/welcome.html): same logo image,
// "SCAN TO CONNECT" tagline, 60/40 white+red split, identical font sizes,
// icon row and note copy. Inline styles + print-color-adjust so the export
// sheet prints in colour. Used by batch-issuance output and print export.
function stickerHtml(tag) {
  const idLine = tag.token ? `Tag ${tag.token}` : "—";
  return `
    <div style="width:420px;font-family:'Inter','Segoe UI',Arial,sans-serif;color:#03162D;-webkit-print-color-adjust:exact;print-color-adjust:exact">
      <div style="display:flex;width:100%;border-radius:18px;overflow:hidden;border:2px solid #03162D;-webkit-print-color-adjust:exact;print-color-adjust:exact">
        <!-- Left: white panel -->
        <div style="flex:0 0 60%;background:#fff;padding:22px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <img src="/images/light-logo.png" alt="ParkTag" style="height:26px;width:auto;display:block" />
            <div style="font-size:7px;font-weight:800;letter-spacing:.2em;color:#6B7280;margin-top:5px">SCAN TO CONNECT</div>
          </div>
          <p style="font-size:29px;font-weight:900;color:#03162D;line-height:1.12;margin:16px 0 0;letter-spacing:-0.01em">Scan the code<br>to <u style="text-decoration:underline;text-decoration-thickness:2.5px;text-underline-offset:2px">contact the<br>vehicle owner.</u></p>
          <div>
            <p style="font-size:7px;font-weight:700;letter-spacing:.05em;color:#6B7280;margin-top:14px;line-height:1.6;text-transform:uppercase">Scan using phone camera, Google Lens or any QR scanner app. Visit www.parktag.me for more.</p>
            <p style="font-size:7px;color:#9CA3AF;margin-top:6px;letter-spacing:.02em">${idLine}</p>
          </div>
        </div>
        <!-- Right: red panel -->
        <div style="flex:0 0 40%;background:#FF2700;padding:18px 14px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;-webkit-print-color-adjust:exact;print-color-adjust:exact">
          <div style="background:#fff;border-radius:12px;padding:10px">
            <img src="${tag.qrDataUrl}" alt="QR ${tag.token}" style="width:150px;height:150px;display:block" />
          </div>
          <div style="font-size:8.5px;font-weight:800;color:#fff;margin-top:11px;text-align:center">Park<span style="font-weight:600;opacity:.9">Tag</span>.me &nbsp;·&nbsp; <span style="font-weight:600;opacity:.9">vehicle tag</span></div>
          <div style="display:flex;gap:13px;margin-top:11px">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#fff" stroke-width="1.7"/><path d="M9.2 16V8h3.1a2.4 2.4 0 0 1 0 4.8H9.2" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 5.5l13 13" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#fff" stroke-width="1.7"/><path d="M7 12h10" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></svg>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 3.5l9 15.5H3l9-15.5Z" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9.5v4M12 16.5h.01" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6.5 4.5C6 4 5.2 3.9 4.7 4.4 3.9 5.1 3.4 6.3 3.5 7.5c.2 4 2 7.6 5 10.5 2.9 2.9 6.5 4.8 10.5 5 1.2.1 2.4-.4 3.1-1.2.5-.5.4-1.3-.1-1.8l-2.6-2.3c-.4-.4-1-.4-1.5-.1l-1.4.9c-.3.2-.7.1-1-.1l-3-3c-.3-.3-.3-.7-.1-1l.9-1.4c.3-.5.3-1.1-.1-1.5L6.5 4.5Z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </div>
          <p style="font-size:7.5px;font-weight:700;color:#fff;text-align:center;margin-top:8px;line-height:1.5">Wrong parking, emergency contact,<br>any issue with the vehicle — scan the QR.</p>
        </div>
      </div>
    </div>`;
}

// Full-page E-Tag print layout — a 1:1 match of the owner Vehicle-Detail PDF
// (pages/owner/vehicle-detail.html #etag-print): instruction block + free-
// contact note + dashed cut + two-panel sticker. Class-based markup that
// relies on the `#qr-export-grid .pt-*` styles in print-queue.html. One tag
// per `.pt-page` (page-break-after: always) so the export prints one per page.
function etagPrintPageHtml(tag) {
  const idLine = tag.token ? `Tag ${tag.token}` : "—";
  // Premium tags carry unlimited private contact — the freebox reflects that
  // instead of the single-free-contact copy used on the free E-Tag.
  const freeboxHtml = tag.premium
    ? `<div class="pt-freebox">This is a <b>Premium ParkTag E-Tag</b> — finders can reach you with <b>unlimited private contact</b> via masked call or WhatsApp (your number stays private). No further upgrade needed.</div>`
    : `<div class="pt-freebox">This free E-Tag includes <b>1 free contact</b> — a finder can reach you once via masked call or WhatsApp (your number stays private). For unlimited contact, upgrade to the official physical ParkTag sticker.</div>`;
  return `
  <div class="pt-page">
    <div class="pt-wrap">
      <div class="pt-instr">
        <p style="margin:0 0 3px">Thank you for generating your free ParkTag E-Tag.</p>
        <span class="pt-instr-h">How to fix the E-Tag to your windscreen</span>
        <ol>
          <li>Print this page on a photo sheet or regular paper.</li>
          <li>Cut the tag along the dotted line.</li>
          <li>Attach the tag:<br>
            &nbsp;- Apply glue (e.g., Feviglue) or transparent double-sided tape to the front of the tag.<br>
            &nbsp;- Place it on your dashboard or windscreen with the QR facing out.
          </li>
        </ol>
        ${freeboxHtml}
      </div>
      <div class="pt-cut">
        <div class="pt-sticker">
          <!-- Left: white panel -->
          <div class="pt-left">
            <div>
              <img class="pt-logo" src="/images/light-logo.png" alt="ParkTag"/>
              <div class="pt-tagline">SCAN TO CONNECT</div>
            </div>
            <p class="pt-head">Scan the code<br>to <u>contact the<br>vehicle owner.</u></p>
            <div>
              <p class="pt-scaninfo">Scan using phone camera, Google Lens or any QR scanner app. Visit www.parktag.me for more.</p>
              <p class="pt-etagline">${idLine}</p>
            </div>
          </div>
          <!-- Right: red panel -->
          <div class="pt-right">
            <div class="pt-qr-box">
              <img class="pt-qr" src="${tag.qrDataUrl}" alt="QR ${tag.token}"/>
            </div>
            <div class="pt-rt-brand">Park<span>Tag</span>.me &nbsp;·&nbsp; <span>vehicle tag</span></div>
            <div class="pt-icons">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#fff" stroke-width="1.7"/><path d="M9.2 16V8h3.1a2.4 2.4 0 0 1 0 4.8H9.2" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 5.5l13 13" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#fff" stroke-width="1.7"/><path d="M7 12h10" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></svg>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 3.5l9 15.5H3l9-15.5Z" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9.5v4M12 16.5h.01" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6.5 4.5C6 4 5.2 3.9 4.7 4.4 3.9 5.1 3.4 6.3 3.5 7.5c.2 4 2 7.6 5 10.5 2.9 2.9 6.5 4.8 10.5 5 1.2.1 2.4-.4 3.1-1.2.5-.5.4-1.3-.1-1.8l-2.6-2.3c-.4-.4-1-.4-1.5-.1l-1.4.9c-.3.2-.7.1-1-.1l-3-3c-.3-.3-.3-.7-.1-1l.9-1.4c.3-.5.3-1.1-.1-1.5L6.5 4.5Z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </div>
            <p class="pt-rt-note">Wrong parking, emergency contact,<br>any issue with the vehicle — scan the QR.</p>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderIssuedTag(data) {
  const target = byId("issue-output");
  const tags = data.tags || [];

  if (!target) return;

  if (!tags.length) {
    target.innerHTML = `<p class="empty-copy">No tag batch issued yet.</p>`;
    return;
  }

  target.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:16px;padding:4px 0">${tags.map(stickerHtml).join("")}</div>`;
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

  const countEl = byId("print-queue-count");
  if (countEl) {
    countEl.textContent = `${tags.length} tag${tags.length !== 1 ? "s" : ""} in queue`;
  }

  if (!target) {
    return;
  }

  // Prune selections for tags no longer in the queue, then remember the
  // current ids so "Select all" / export fallback see the full visible set.
  _pqVisibleIds = tags.map((t) => t.id);
  const visibleSet = new Set(_pqVisibleIds);
  for (const id of [..._pqSelected]) if (!visibleSet.has(id)) _pqSelected.delete(id);

  if (!tags.length) {
<<<<<<< HEAD
    target.innerHTML = `<p class="empty-copy">Queue is empty. All tags have been printed or none have been issued yet.</p>`;
=======
    _pqUpdateExportLabel();
    target.innerHTML = `<p class="empty-copy">${_pqPrinted ? "No printed tags are awaiting a claim." : "Nothing waiting to be printed — issue a batch to populate the queue."}</p>`;
>>>>>>> upstream/main
    return;
  }

  // Group by batchNumber
  const batches = {};
  for (const tag of tags) {
    const key = tag.batchNumber || "__no_batch__";
    if (!batches[key]) batches[key] = { batchNumber: tag.batchNumber, batchLabel: tag.batchLabel, tags: [] };
    batches[key].tags.push(tag);
  }

  target.innerHTML = Object.values(batches).map(batch => {
    const batchKey = batch.batchNumber || "__no_batch__";
    const batchTitle = batch.batchNumber
      ? `Batch ${batch.batchNumber}${batch.batchLabel ? ` · ${batch.batchLabel}` : ""}`
      : "No batch assigned";
    const batchIds = batch.tags.map((t) => t.id);
    const batchIdsCsv = batchIds.join(",");
    const allSelected = batchIds.length > 0 && batchIds.every((id) => _pqSelected.has(id));
    return `
      <div style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:8px 12px;background:#F1F1F0;border-radius:8px;border:1px solid #E5E7EB">
          <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:0.9rem;cursor:pointer">
            <input type="checkbox" class="pq-select-all" data-ids="${batchIdsCsv}" ${allSelected ? "checked" : ""} onchange="togglePqSelectBatch('${batchIdsCsv}', this.checked)" style="width:16px;height:16px;cursor:pointer" />
            ${batchTitle} <span style="font-weight:400;color:#6B7280">(${batch.tags.length} tags)</span>
          </label>
          ${batch.batchNumber ? `<button class="action small" style="color:#DC2626;background:#FEF2F2;border-color:#FECACA" onclick="deleteBatch('${batch.batchNumber}')">Delete batch</button>` : ""}
        </div>
        ${batch.tags.map(tag => `
          <article class="queue-row">
            <input type="checkbox" class="pq-select" data-id="${tag.id}" ${_pqSelected.has(tag.id) ? "checked" : ""} onchange="togglePqSelect('${tag.id}', this.checked)" style="width:16px;height:16px;cursor:pointer;flex:0 0 auto" />
            <strong>${tag.token} ${tag.premium
              ? `<span style="display:inline-block;background:#FF2700;color:#fff;font-size:0.62rem;font-weight:800;letter-spacing:.04em;padding:2px 7px;border-radius:20px;vertical-align:middle;margin-left:4px">PREMIUM</span>`
              : `<span style="display:inline-block;background:#F1F1F0;color:#6B7280;font-size:0.62rem;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:20px;vertical-align:middle;margin-left:4px">FREE</span>`}</strong>
            <span>Print status: <strong>${tag.printStatus}</strong></span>
            <a href="${tag.claimUrl}" target="_blank" rel="noreferrer" style="word-break:break-all;font-size:0.82rem">${tag.claimUrl}</a>
            ${tag.printStatus !== "printed" ? `<button class="action small" onclick="markPrinted('${tag.id}')">Mark as printed</button>` : `<span style="color:#FF2700;font-weight:700">✓ Printed</span>`}
          </article>
        `).join("")}
      </div>
    `;
  }).join("");

  _pqUpdateExportLabel();
}

async function exportQrsForPrint() {
  const overlay = byId("qr-export-overlay");
  const grid = byId("qr-export-grid");
  const countLabel = byId("export-count-label");
  if (!overlay || !grid) return;

  grid.innerHTML = `<p style="color:#6B7280">Loading QR codes...</p>`;
  overlay.style.display = "block";

  try {
    const data = await fetchJson("/api/admin/print-queue/export");
    let tags = data.tags || [];
    // If the admin ticked specific tags, export only those; otherwise export
    // the whole sheet (original behaviour).
    if (_pqSelected.size > 0) tags = tags.filter((tag) => _pqSelected.has(tag.id));

    if (countLabel) countLabel.textContent = `${tags.length} tag${tags.length !== 1 ? "s" : ""} ready to print`;

    if (!tags.length) {
      grid.innerHTML = `<p style="color:#6B7280">No unclaimed tags to export.</p>`;
      return;
    }

    grid.innerHTML = tags.map(tag => etagPrintPageHtml(tag)).join("");
  } catch (err) {
    grid.innerHTML = `<p style="color:#DC2626">Failed to load: ${err.message}</p>`;
  }
}

async function markPrinted(tagId) {
  try {
    await fetchJson(`/api/admin/print-queue/${tagId}/mark-printed`, { method: "POST" });
    await loadPrintQueue();
  } catch (err) {
    alert(`Failed to mark as printed: ${err.message}`);
  }
}

async function deleteBatch(batchNumber) {
  if (!confirm(`Delete ALL unclaimed tags in batch "${batchNumber}" (including any already printed)? This cannot be undone.`)) return;
  try {
    const data = await fetchJson(`/api/admin/tags/batch/${encodeURIComponent(batchNumber)}?confirm=1`, { method: "DELETE" });
    setStatus(`Deleted ${data.deleted} tags from batch ${batchNumber}.`, "success");
    await loadPrintQueue();
  } catch (err) {
    alert(`Failed to delete batch: ${err.message}`);
  }
}

async function clearAllUnprinted() {
  // Typed-confirmation safeguard for this mass delete. Printed tags are NOT
  // affected (they live in the separate "Printed" view).
  const answer = prompt('This permanently deletes ALL unprinted tags. Printed tags are kept.\n\nType DELETE to confirm.');
  if (answer !== "DELETE") return;
  try {
    const data = await fetchJson("/api/admin/tags/unclaimed/all?confirm=all", { method: "DELETE" });
    setStatus(`Cleared ${data.deleted} unprinted tag(s).`, "success");
    await loadPrintQueue();
  } catch (err) {
    alert(`Failed to clear queue: ${err.message}`);
  }
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
    const seeded = data.data || data;
    if (seeded?.tag?.token) {
      setIssueMessage(
        `Seeded active token ${seeded.tag.token} and claimable token ${seeded.claimableTag?.token || "—"}.`
      );
    }
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
    window.ptProgress?.finish();
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

function updatePremiumToggle(checkbox) {
  const track = byId("premium-toggle-track");
  const thumb = byId("premium-toggle-thumb");
  const row   = byId("premium-toggle-row");
  if (!track || !thumb) return;
  if (checkbox.checked) {
    track.style.background = "#FF2700";
    thumb.style.left = "22px";
    if (row) row.classList.add("is-premium");
  } else {
    track.style.background = "#D1D5DB";
    thumb.style.left = "2px";
    if (row) row.classList.remove("is-premium");
  }
}
window.updatePremiumToggle = updatePremiumToggle;

async function issueTag() {
  const btn = byId("issue-tag-button");
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }
  setIssueMessage("Generating QR batch, please wait…");

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
        stickerRequested: byId("issue-sticker-requested")?.checked,
        premiumBatch: byId("issue-premium-batch")?.checked
      })
    });

    renderIssuedTag(data);
    await loadAdminOverview();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to issue tag batch";
    setStatus(message, "error");
    setIssueMessage(`Issue failed: ${message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate QR batch"; }
    window.ptProgress?.finish();
  }
}

let _pqPrinted = false;
// Tags ticked in the queue for export. Empty ⇒ export all (preserves the
// original "export everything" behaviour). Survives re-renders of the queue.
const _pqSelected = new Set();
// Ids currently shown in the queue — used so "Select all" and the fallback
// know the full set, and so we can prune stale selections after a reload.
let _pqVisibleIds = [];

function _pqUpdateExportLabel() {
  const btn = byId("export-qr-button");
  if (!btn) return;
  const n = _pqSelected.size;
  // Keep the icon; only swap the trailing text node.
  const label = n > 0 ? `Export QRs (${n})` : "Export QRs";
  const textNode = [...btn.childNodes].reverse().find((node) => node.nodeType === 3 && node.textContent.trim());
  if (textNode) textNode.textContent = ` ${label}`;
  else btn.append(document.createTextNode(` ${label}`));
}

function togglePqSelect(id, checked) {
  if (checked) _pqSelected.add(id);
  else _pqSelected.delete(id);
  // Reflect batch "select all" checkbox states without a full re-render.
  document.querySelectorAll(".pq-select-all").forEach((box) => {
    const ids = (box.dataset.ids || "").split(",").filter(Boolean);
    box.checked = ids.length > 0 && ids.every((i) => _pqSelected.has(i));
  });
  _pqUpdateExportLabel();
}
window.togglePqSelect = togglePqSelect;

function togglePqSelectBatch(idsCsv, checked) {
  const ids = idsCsv.split(",").filter(Boolean);
  for (const id of ids) {
    if (checked) _pqSelected.add(id);
    else _pqSelected.delete(id);
  }
  // Sync the individual row checkboxes in this batch.
  for (const id of ids) {
    const box = document.querySelector(`.pq-select[data-id="${id}"]`);
    if (box) box.checked = checked;
  }
  _pqUpdateExportLabel();
}
window.togglePqSelectBatch = togglePqSelectBatch;

async function loadPrintQueue() {
  try {
    const url = _pqPrinted ? "/api/admin/print-queue?printed=1" : "/api/admin/print-queue";
    const data = await fetchJson(url);
    renderPrintQueue(data);
    setStatus("Print queue loaded.", "success");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load print queue";
    setQueueMessage(`Print queue failed: ${message}`);
    setStatus(message, "error");
  } finally {
    window.ptProgress?.finish();
  }
}

// Toggle between "To Print" (unprinted) and "Printed · awaiting claim" views.
function switchPqTab(printed) {
  _pqPrinted = Boolean(printed);
  const uBtn = byId("pq-tab-unprinted");
  const pBtn = byId("pq-tab-printed");
  if (uBtn) uBtn.className = _pqPrinted ? "pt-admin-btn pt-admin-btn-ghost" : "pt-admin-btn pt-admin-btn-primary";
  if (pBtn) pBtn.className = _pqPrinted ? "pt-admin-btn pt-admin-btn-primary" : "pt-admin-btn pt-admin-btn-ghost";
  // "Clear all unprinted" only applies to the unprinted view.
  const clearBtn = byId("clear-all-button");
  if (clearBtn) clearBtn.style.display = _pqPrinted ? "none" : "";
  loadPrintQueue();
}
window.switchPqTab = switchPqTab;

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
    const [meData, data] = await Promise.all([
      fetchJson("/api/admin/me"),
      fetchJson("/api/admin/admins")
    ]);
    const myEmail = meData.email;

    if (!target) return;

    if (!data.admins.length) {
      target.innerHTML = `<p class="empty-copy">No admins yet.</p>`;
      return;
    }
    target.innerHTML = data.admins.map((a) => `
      <div class="pt-admin-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <p class="pt-admin-row-title">${a.displayName}</p>
          <p class="pt-admin-row-meta">${a.email} &middot; Added ${new Date(a.createdAt).toLocaleString()}</p>
        </div>
        ${a.email !== myEmail ? `
          <button onclick="deleteAdmin('${a.id}')"
            style="flex-shrink:0;background:none;border:1.5px solid #FCA5A5;color:#DC2626;
                   border-radius:8px;padding:6px 14px;font-size:0.78rem;font-weight:700;
                   cursor:pointer;font-family:inherit;transition:background 150ms"
            onmouseover="this.style.background='#FEE2E2'"
            onmouseout="this.style.background='none'">Remove</button>
        ` : ""}
      </div>`).join("");
  } catch (error) {
    if (target) target.innerHTML = `<p class="empty-copy">Failed to load admins.</p>`;
  }
}

async function deleteAdmin(id) {
  if (!confirm("Remove this admin? They will lose dashboard access immediately.")) return;
  try {
    await fetchJson(`/api/admin/admins/${id}`, { method: "DELETE" });
    await loadAdmins();
  } catch (error) {
    const statusEl = byId("admin-mgmt-status");
    if (statusEl) {
      statusEl.textContent = error instanceof Error ? error.message : "Failed to remove admin";
      statusEl.dataset.tone = "error";
    }
  }
}
window.deleteAdmin = deleteAdmin;

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
    await loadAdmins();
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

  if (hasEl("export-qr-button")) {
    byId("export-qr-button").addEventListener("click", exportQrsForPrint);
  }

  if (hasEl("close-export-button")) {
    byId("close-export-button").addEventListener("click", () => {
      const overlay = byId("qr-export-overlay");
      if (overlay) overlay.style.display = "none";
    });
  }

  window.markPrinted = markPrinted;
  window.deleteBatch = deleteBatch;

  if (hasEl("clear-all-button")) {
    byId("clear-all-button").addEventListener("click", clearAllUnprinted);
  }

  if (hasEl("add-admin-button")) {
    byId("add-admin-button").addEventListener("click", createNewAdmin);
  }
}

bindEvents();

// Show Google auth errors redirected back from the server
const _urlError = new URLSearchParams(window.location.search).get("error");
if (_urlError && currentAdminPage() === "login") {
  const _errorMessages = {
    no_account: "No admin account found for this Google account.",
    db_unavailable: "Database unavailable. Please try again.",
    token_exchange_failed: "Google sign-in failed. Please try again.",
    auth_failed: "Authentication error. Please try again.",
    invalid_state: "Session expired. Please try again.",
  };
  setStatus(_errorMessages[_urlError] || "Sign-in failed. Please try again.", "error");
}

if (currentAdminPage() !== "login") {
  await refreshCurrentPage();
}
