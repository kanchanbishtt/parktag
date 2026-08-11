async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const raw = await response.text();

  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // Non-JSON body: almost always a proxy/gateway error page (e.g. a 502/504
    // "upstream error" when the request timed out upstream). Surface something
    // readable instead of a raw "Unexpected token 'u'" JSON.parse crash.
    const snippet = raw.trim().slice(0, 120);
    throw new Error(
      response.ok
        ? `Unexpected non-JSON response from server${snippet ? ` — ${snippet}` : ""}`
        : `Server error ${response.status}${snippet ? ` — ${snippet}` : ""}`
    );
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

// HTML-escape any value before interpolating it into innerHTML. Most fields
// rendered on this page (owner displayName/email/phone, contact-request
// phone/message, vehicle labels, provider error text, ...) originate from
// unauthenticated or self-service input (owner registration, the public scan
// page's /api/contact-requests). Without escaping, a malicious value stored
// in Mongo would execute as script in the admin's authenticated session the
// next time this dashboard renders it — a stored XSS that could act on the
// admin's behalf (e.g. call /api/admin/admins to mint a rogue admin account).
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Safe for a value placed inside a single-quoted JS string within an inline
// handler attribute, e.g. onclick="fn('${jsAttr(x)}')". esc() is NOT enough
// there: the browser HTML-decodes the attribute first, so an esc()'d quote
// (&#39;) becomes a real ' and breaks out of the JS string. Encoding every
// non-alphanumeric as a \xHH / \uHHHH escape leaves no HTML- or JS-special
// character intact, so neither layer can be broken out of.
function jsAttr(value) {
  return String(value == null ? "" : value).replace(/[^a-zA-Z0-9]/g, (c) => {
    const code = c.charCodeAt(0);
    return code < 256
      ? "\\x" + code.toString(16).padStart(2, "0")
      : "\\u" + code.toString(16).padStart(4, "0");
  });
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

function goToPrintQueue() {
  window.location.href = "/admin/print-queue";
}
window.goToPrintQueue = goToPrintQueue;

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
            <strong>${esc(owner.displayName)}</strong>
            <p>${esc(owner.email)}</p>
          </div>
          <div class="monitor-meta">
            <span>Credits: ${esc(owner.credits)}</span>
            <span>Tags: ${esc(owner.tags)}</span>
            <span>Active: ${esc(owner.activeTags)}</span>
            ${owner.latestTagToken ? `<span>Latest tag: ${esc(owner.latestTagToken)}</span>` : ""}
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
          <strong>${esc(item.displayName)}</strong>
          <span>${esc(item.email)}</span>
          <span>Tags: ${esc(item.tags)}</span>
          <span>Active: ${esc(item.activeTags)}</span>
          ${item.latestTagToken ? `<span>Latest tag: ${esc(item.latestTagToken)}</span>` : ""}
          <span>Created: ${esc(new Date(item.createdAt).toLocaleString())}</span>
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
          <strong>${esc(item.token)}</strong>
          <span>Phone: ${esc(item.phone)}</span>
          <span>Action: ${esc(item.action)}${item.messageChannel ? ` (${esc(item.messageChannel)})` : ""}</span>
          <span>Status: ${esc(item.status)}</span>
          ${item.provider ? `<span>Provider: ${esc(item.provider)}</span>` : ""}
          ${item.providerWebhookStatus ? `<span>Provider status: ${esc(item.providerWebhookStatus)}</span>` : ""}
          ${item.providerStatusCode ? `<span>Provider code: ${esc(item.providerStatusCode)}</span>` : ""}
          ${item.providerError ? `<span>Provider error: ${esc(item.providerError)}</span>` : ""}
          ${item.providerErrorDetail ? `<span>Provider detail: ${esc(item.providerErrorDetail)}</span>` : ""}
          <span>Created: ${esc(new Date(item.createdAt).toLocaleString())}</span>
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

// Batch export print layout — sticker only: dashed cut + two-panel sticker
// (white panel + red QR panel), no instruction / free-contact text. Class-based
// markup that relies on the `#qr-export-grid .pt-*` styles in print-queue.html.
// One tag per `.pt-page` (page-break-after: always) so the export prints one
// per page.
function etagPrintPageHtml(tag) {
  // Sticker only — no instructions text. Just the Figma artwork with the tag's QR.
  return `
  <div class="pt-page">
    <div class="pt-wrap">
      <div class="pt-cut">
        <div class="pt-figma-sticker">
          <img class="pt-figma-bg" src="/images/org-parktag-sticker.svg" alt="ParkTag sticker"/>
          <img class="pt-figma-qr" src="${tag.qrDataUrl}" alt="QR ${tag.token}"/>
          <div class="pt-figma-serial">${tag.serial || ""}</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderIssuedTag(data) {
  const target = byId("issue-output");
  if (!target) return;

  // The issue endpoint no longer returns a QR image per tag (that didn't scale
  // to large batches). It returns a count; the actual print sheets are produced
  // by the Print Queue export flow, on demand and in bounded chunks.
  const count = data.count ?? (Array.isArray(data.tags) ? data.tags.length : 0);

  if (!count) {
    target.innerHTML = `<p class="empty-copy">No tag batch issued yet.</p>`;
    return;
  }

  const batchBits = [data.batchNumber, data.batchLabel].filter(Boolean).join(" · ");
  target.innerHTML = `
    <div style="border:1px solid #BBF7D0;border-radius:12px;padding:20px;background:#F0FDF4">
      <strong style="font-size:1rem;color:#03162D">✓ ${count} QR tag${count !== 1 ? "s" : ""} generated${batchBits ? ` — ${batchBits}` : ""}.</strong>
      <p style="color:#4B5563;margin:8px 0 14px;font-size:0.9rem">They're queued for printing. Open the Print Queue to select the tags you want and export them as print-ready sheets (in batches).</p>
      <button class="action" onclick="goToPrintQueue()">Go to Print Queue →</button>
    </div>`;
  setStatus(`Generated ${count} tag${count !== 1 ? "s" : ""}.`, "success");
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
  _pqData = data;

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
    _pqUpdateExportLabel();
    pqRenderLookupBar(new Map(), tags);
    target.innerHTML = `<p class="empty-copy">${_pqPrinted ? "No printed tags are awaiting a claim." : "Nothing waiting to be printed, issue a batch to populate the queue."}</p>`;
    return;
  }

  // Group by batch, then by ISSUANCE RUN inside it.
  //
  // A batch is filled over several sittings — 1000 tags one day, 2000 more into
  // the same batch the next — and a sitting is what goes to the printer. Batch
  // was the only grouping before, so "select all" on batch 01 selected every
  // run it had ever held and the export re-printed work already sent out.
  const groups = pqGroupTags(tags);
  pqRenderLookupBar(groups, tags);

  // Batch filter is purely a view: _pqVisibleIds and _pqSelected above still
  // span the whole queue, so filtering never silently drops a selection.
  const shown = pqSortGroups(groups).filter(
    (group) => !_pqBatchFilter || group.key === _pqBatchFilter
  );

  if (!shown.length) {
    target.innerHTML = `<p class="empty-copy">No tags in batch ${esc(_pqBatchFilter)} in this view.</p>`;
    _pqUpdateExportLabel();
    return;
  }

  target.innerHTML = shown.map(group => {
    // Newest run first: the fresh one is what you came here to print.
    const runs = [...group.runs.values()].sort(
      (a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || ""))
    );
    const batchCount = runs.reduce((n, r) => n + r.tags.length, 0);
    const labels = [...group.labels].filter(Boolean);
    const batchTitle = group.key === "__no_batch__"
      ? "No batch assigned"
      : `Batch ${esc(group.key)}${labels.length ? ` · ${esc(labels.join(" / "))}` : ""}`;

    // Raw batchNumber values that reduce to this key. Normally one; more than
    // one means the same batch was typed differently at issuance ("1" and "01"),
    // which the serial counter already treats as ONE batch. Naming them keeps
    // that visible instead of silently merging.
    const raws = [...group.raws.keys()];
    const variantNote = raws.length > 1
      ? `<span style="font-weight:400;color:#B31C00;font-size:.8rem"> · entered as ${raws.map((r) => esc(JSON.stringify(r))).join(", ")} — one batch, one serial run</span>`
      : "";

    return `
      <div style="margin-bottom:26px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <h3 style="margin:0;font-size:1rem;font-weight:900">${batchTitle}
            <span style="font-weight:400;color:#6B7280">(${batchCount} tags across ${runs.length} generation${runs.length === 1 ? "" : "s"})</span>
            ${variantNote}
          </h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${group.key === "__no_batch__" ? "" : raws.map((raw) => `
              <button class="action small" style="color:#DC2626;background:#FEF2F2;border-color:#FECACA" onclick="deleteBatch('${jsAttr(raw)}')">Delete batch${raws.length > 1 ? ` ${esc(JSON.stringify(raw))}` : ""}</button>
            `).join("")}
          </div>
        </div>
        ${runs.map((run, index) => pqRunHtml(group, run, index)).join("")}
      </div>
    `;
  }).join("");

  _pqUpdateExportLabel();
  pqScrollToHit();
}

// One generation: a header that is always visible, and rows that are only in
// the DOM while it is expanded. Collapsed by default — a single production
// batch holds thousands of unprinted tags, and rendering every row made the
// page unusable to find anything in. The header carries what you actually look
// up by (date, count, serial range), so most trips never need to expand.
function pqRunHtml(group, run, index) {
  const ids = run.tags.map((t) => t.id);
  const idsCsv = ids.join(",");
  const allSelected = ids.length > 0 && ids.every((id) => _pqSelected.has(id));
  const first = run.tags[0] || {};
  const range = first.runSerialStart != null && first.runSerialEnd != null
    ? `${pqSerialLabel(first.batchNumber, first.runSerialStart)} → ${pqSerialLabel(first.batchNumber, first.runSerialEnd)}`
    : pqObservedRange(run);
  const when = run.issuedAt ? new Date(run.issuedAt).toLocaleString() : "date unknown";
  const legacy = run.runId === "__legacy__";
  const runKey = pqRunKey(group.key, run.runId);
  const open = _pqExpanded.has(runKey);
  const cap = _pqRowCap.get(runKey) || PQ_ROW_CAP;
  const visibleTags = open ? run.tags.slice(0, cap) : [];
  // Legacy tags carry no run id, so marking them printed has to be scoped by
  // batch — otherwise one click would mark every batch's legacy tags.
  const markArgs = legacy
    ? `'__legacy__', ${run.tags.length}, '${jsAttr(group.key)}'`
    : `'${jsAttr(run.runId)}', ${run.tags.length}`;

  return `
    <div style="margin-bottom:14px;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:${index === 0 && !legacy ? "#FFF4F1" : "#F1F1F0"};border-bottom:1px solid #E5E7EB;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:9px;min-width:0;flex:1 1 260px">
          <input type="checkbox" class="pq-select-all" data-ids="${esc(idsCsv)}" ${allSelected ? "checked" : ""} onchange="togglePqSelectBatch('${esc(idsCsv)}', this.checked)" style="width:16px;height:16px;cursor:pointer;flex:0 0 auto" title="Select this generation" />
          <button type="button" onclick="togglePqRun('${jsAttr(runKey)}')" style="display:flex;align-items:center;gap:8px;background:none;border:none;padding:0;font:inherit;font-weight:700;font-size:.88rem;color:#03162D;cursor:pointer;text-align:left;min-width:0">
            <span class="pt-pq-caret" data-open="${open ? "1" : "0"}">▶</span>
            <span style="min-width:0">
              ${legacy ? "Earlier tags (no generation recorded)" : `Generated ${esc(when)}`}
              <span style="font-weight:400;color:#6B7280">· ${run.tags.length} tag${run.tags.length === 1 ? "" : "s"}${range ? ` · ${esc(range)}` : ""}</span>
            </span>
          </button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${index === 0 && !legacy ? `<span style="background:#FF2700;color:#fff;font-size:.62rem;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:20px">NEWEST</span>` : ""}
          ${_pqPrinted ? "" : `<button class="action small" onclick="markRunPrinted(${markArgs})">Mark generation printed</button>`}
        </div>
      </div>
      ${visibleTags.map(tag => `
        <article class="queue-row" ${_pqHighlightId === tag.id ? 'data-pq-hit="1"' : ""}>
          <input type="checkbox" class="pq-select" data-id="${esc(tag.id)}" ${_pqSelected.has(tag.id) ? "checked" : ""} onchange="togglePqSelect('${esc(tag.id)}', this.checked)" style="width:16px;height:16px;cursor:pointer;flex:0 0 auto" />
          <strong>${tag.serial ? esc(tag.serial) + " · " : ""}${esc(tag.token)} ${tag.premium
            ? `<span style="display:inline-block;background:#FF2700;color:#fff;font-size:0.62rem;font-weight:800;letter-spacing:.04em;padding:2px 7px;border-radius:20px;vertical-align:middle;margin-left:4px">PREMIUM</span>`
            : `<span style="display:inline-block;background:#F1F1F0;color:#6B7280;font-size:0.62rem;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:20px;vertical-align:middle;margin-left:4px">FREE</span>`}</strong>
          <span>Print status: <strong>${esc(tag.printStatus)}</strong></span>
          <a href="${esc(tag.claimUrl)}" target="_blank" rel="noreferrer" style="word-break:break-all;font-size:0.82rem">${esc(tag.claimUrl)}</a>
          ${tag.printStatus !== "printed" ? `<button class="action small" onclick="markPrinted('${jsAttr(tag.id)}')">Mark as printed</button>` : `<span style="color:#FF2700;font-weight:700">✓ Printed</span>`}
        </article>
      `).join("")}
      ${open && run.tags.length > visibleTags.length ? `
        <div style="padding:10px 12px;background:#F9FAFB;border-top:1px solid #E5E7EB;font-size:.84rem;color:#6B7280">
          Showing ${visibleTags.length} of ${run.tags.length} rows.
          <button class="action small" style="margin-left:8px" onclick="pqShowAllRows('${jsAttr(runKey)}')">Show all ${run.tags.length}</button>
          <span style="margin-left:8px">The checkbox above still selects the whole generation.</span>
        </div>` : ""}
    </div>`;
}

async function exportQrsForPrint() {
  const overlay = byId("qr-export-overlay");
  const grid = byId("qr-export-grid");
  const countLabel = byId("export-count-label");
  if (!overlay || !grid) return;

  // Require an explicit selection — never default to exporting the whole sheet.
  //
  // Exported in the order the queue displays (serial ascending within a batch),
  // not the order the boxes happened to be ticked, so each chunk sent below is a
  // contiguous block of serials and the sheets print in one countable run.
  // Anything selected but no longer visible still goes, at the end.
  const visible = new Set(_pqVisibleIds);
  const selectedIds = [
    ..._pqVisibleIds.filter((id) => _pqSelected.has(id)),
    ...[..._pqSelected].filter((id) => !visible.has(id))
  ];
  if (selectedIds.length === 0) {
    setStatus("Select the tag(s) you want to export first.", "info");
    return;
  }

  grid.innerHTML = `<p style="color:#6B7280">Loading QR codes… 0/${selectedIds.length}</p>`;
  overlay.style.display = "block";

  try {
    // Fetch QR images in bounded chunks so a large selection never becomes one
    // heavy request (rendering thousands of QR PNGs at once is what used to time
    // out the gateway). Each chunk renders only its own tags.
    const CHUNK = 100;
    const tags = [];
    for (let i = 0; i < selectedIds.length; i += CHUNK) {
      const chunk = selectedIds.slice(i, i + CHUNK);
      const data = await fetchJson("/api/admin/print-queue/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: chunk })
      });
      tags.push(...(data.tags || []));
      grid.innerHTML = `<p style="color:#6B7280">Loading QR codes… ${Math.min(i + CHUNK, selectedIds.length)}/${selectedIds.length}</p>`;
    }

    if (!tags.length) {
      if (countLabel) countLabel.textContent = "0 tags to print";
      grid.innerHTML = `<p style="color:#6B7280">No unclaimed tags to export.</p>`;
      return;
    }

    if (countLabel) countLabel.textContent = `${tags.length} tag${tags.length !== 1 ? "s" : ""} to print`;

    // One sticker per portrait page. Each .pt-sheet is a page, so the on-screen
    // preview matches the print exactly.
    const perSheet = 1;
    let sheetsHtml = "";
    for (let i = 0; i < tags.length; i += perSheet) {
      const cells = tags.slice(i, i + perSheet).map(etagPrintPageHtml).join("");
      sheetsHtml += `<div class="pt-sheet">${cells}</div>`;
    }
    grid.innerHTML = sheetsHtml;
  } catch (err) {
    grid.innerHTML = `<p style="color:#DC2626">Failed to load: ${err.message}</p>`;
  }
}

// Mirrors batchKeyFor() server-side: digits only, padded to two.
//
// This is not cosmetic. The same key names the serial counter
// (counters._id = "tagSerial:<key>") and is printed on the sticker, so two tags
// whose raw batchNumber differs but whose key matches ("1" and "01") draw from
// ONE serial sequence and carry interchangeable serials — they are the same
// batch. Grouping the queue on the raw value listed them as two batches whose
// stickers collide, which is exactly the lookup this has to get right.
function pqBatchKey(batchNumber) {
  return String(batchNumber ?? 0).replace(/\D/g, "").padStart(2, "0");
}

// PT-<batch>-<serial>, matching what stickerSerialFor prints server-side.
function pqSerialLabel(batchNumber, serial) {
  return `PT-${pqBatchKey(batchNumber)}-${String(serial).replace(/\D/g, "").padStart(6, "0")}`;
}

// Batch (normalized) → generations → tags.
function pqGroupTags(tags) {
  const groups = new Map();

  for (const tag of tags) {
    const key = tag.batchNumber == null || tag.batchNumber === ""
      ? "__no_batch__"
      : pqBatchKey(tag.batchNumber);
    let group = groups.get(key);
    if (!group) {
      group = { key, raws: new Map(), labels: new Set(), runs: new Map() };
      groups.set(key, group);
    }
    if (tag.batchNumber != null && tag.batchNumber !== "") {
      const raw = String(tag.batchNumber);
      group.raws.set(raw, (group.raws.get(raw) || 0) + 1);
    }
    if (tag.batchLabel) group.labels.add(tag.batchLabel);

    // Tags issued before runs were recorded share one bucket per batch rather
    // than each becoming a generation of its own.
    const runId = tag.issuanceRunId || "__legacy__";
    let run = group.runs.get(runId);
    if (!run) {
      run = { runId, issuedAt: tag.issuedAt || tag.createdAt, tags: [] };
      group.runs.set(runId, run);
    }
    run.tags.push(tag);
  }

  return groups;
}

// A collapsed generation still has to be identifiable, so one with no recorded
// serial range falls back to the span of the serials it actually holds. Labelled
// "observed" because, unlike runSerialStart/End, it describes what is left in
// the queue rather than what was issued — tags already printed or claimed are
// not in this list, so the span can be narrower than the real generation.
function pqObservedRange(run) {
  const serials = run.tags.map((t) => t.serial).filter(Boolean).sort();
  if (!serials.length) return "";
  const first = serials[0];
  const last = serials[serials.length - 1];
  return first === last ? first : `${first} → ${last} (observed)`;
}

function pqRunKey(batchKey, runId) {
  return `${batchKey}::${runId}`;
}

// Batch order has to be the same everywhere or the dropdown stops being a map
// of the page. Ascending by batch number, with the unbatched stragglers last —
// they are a leftover, not a batch you go looking for.
function pqSortGroups(groups) {
  return [...groups.values()].sort((a, b) => {
    if (a.key === "__no_batch__") return 1;
    if (b.key === "__no_batch__") return -1;
    return Number(a.key) - Number(b.key) || a.key.localeCompare(b.key);
  });
}

function togglePqRun(runKey) {
  if (_pqExpanded.has(runKey)) _pqExpanded.delete(runKey);
  else _pqExpanded.add(runKey);
  _pqHighlightId = null;
  if (_pqData) renderPrintQueue(_pqData);
}
window.togglePqRun = togglePqRun;

function pqShowAllRows(runKey) {
  _pqRowCap.set(runKey, Infinity);
  if (_pqData) renderPrintQueue(_pqData);
}
window.pqShowAllRows = pqShowAllRows;

function pqSetExpandAll(expand) {
  _pqExpanded.clear();
  if (expand && _pqData) {
    for (const [key, group] of pqGroupTags(_pqData.tags || [])) {
      for (const runId of group.runs.keys()) _pqExpanded.add(pqRunKey(key, runId));
    }
  }
  if (_pqData) renderPrintQueue(_pqData);
}

// Populates the batch dropdown from the queue that is actually loaded, so it
// can never offer a batch with nothing in it. Built from ALL tags, not the
// filtered view, or selecting a batch would empty the list you select from.
function pqRenderLookupBar(groups, tags) {
  const select = byId("pq-batch-filter");
  const toggle = byId("pq-expand-toggle");

  if (toggle) {
    const anyOpen = _pqExpanded.size > 0;
    toggle.textContent = anyOpen ? "Collapse all" : "Expand all";
  }

  if (!select) return;

  // A batch can disappear between renders (marked printed, deleted). Fall back
  // to "all" rather than leaving the filter pointing at nothing.
  if (_pqBatchFilter && !groups.has(_pqBatchFilter)) {
    _pqBatchFilter = "";
    pqSetLookupNote("");
  }

  const options = pqSortGroups(groups)
    .map((group) => {
      const count = [...group.runs.values()].reduce((n, r) => n + r.tags.length, 0);
      const gens = group.runs.size;
      const name = group.key === "__no_batch__" ? "No batch assigned" : `Batch ${group.key}`;
      return `<option value="${esc(group.key)}"${group.key === _pqBatchFilter ? " selected" : ""}>${esc(name)} — ${count} tag${count === 1 ? "" : "s"}, ${gens} generation${gens === 1 ? "" : "s"}</option>`;
    })
    .join("");

  select.innerHTML =
    `<option value=""${_pqBatchFilter ? "" : " selected"}>All batches — ${tags.length} tag${tags.length === 1 ? "" : "s"}</option>` +
    options;
}

function pqSetLookupNote(message, tone) {
  const note = byId("pq-lookup-note");
  if (!note) return;
  note.textContent = message || "";
  if (tone) note.dataset.tone = tone;
  else delete note.dataset.tone;
}

// Accepts what is actually printed on a sticker and the shorthands people type
// from memory: "PT-01-001500", "01-001500", "1-1500", or a bare "1500" (which
// searches the selected batch, or every batch if none is selected).
function pqParseSerialQuery(raw) {
  const text = String(raw || "").trim().toUpperCase().replace(/^PT-/, "");
  if (!text) return null;

  const pair = /^(\d{1,6})[-\s/]+(\d{1,6})$/.exec(text);
  if (pair) {
    return { batchKey: pqBatchKey(pair[1]), unit: Number(pair[2]) };
  }

  const bare = /^(\d{1,6})$/.exec(text);
  if (bare) {
    return { batchKey: null, unit: Number(bare[1]) };
  }

  return null;
}

// Finds the tag a serial names, opens the generation holding it, and scrolls to
// it. Searching the loaded queue rather than the server keeps this instant and
// means a hit is always something you can act on right there.
function pqJumpToSerial() {
  const input = byId("pq-serial-jump");
  const query = pqParseSerialQuery(input ? input.value : "");

  if (!query) {
    pqSetLookupNote("Type a serial like 01-001500, or just 1500.", "warn");
    return;
  }

  const tags = (_pqData && _pqData.tags) || [];
  const batchKey = query.batchKey || (_pqBatchFilter && _pqBatchFilter !== "__no_batch__" ? _pqBatchFilter : null);
  const wanted = String(query.unit).padStart(6, "0");

  const hits = tags.filter((tag) => {
    if (!tag.serial) return false;
    const parts = tag.serial.split("-");           // PT-<batch>-<unit>
    if (parts.length !== 3) return false;
    if (batchKey && parts[1] !== batchKey) return false;
    return parts[2] === wanted;
  });

  if (!hits.length) {
    const where = batchKey ? `batch ${batchKey}` : "any batch";
    pqSetLookupNote(
      `No tag ${pqSerialLabel(batchKey || 0, query.unit)} in ${where} in this view. It may already be printed, or claimed by an owner.`,
      "warn"
    );
    return;
  }

  // A bare unit can match the same serial in more than one batch; show the
  // first and say so rather than pretending the lookup was unambiguous.
  const hit = hits[0];
  const group = pqBatchKey(hit.batchNumber);
  const runKey = pqRunKey(group, hit.issuanceRunId || "__legacy__");

  // A jump FOCUSES: everything else closes. Leaving earlier expansions open
  // meant each successive lookup added another generation's rows to the page,
  // rebuilding the wall of rows this was meant to get rid of.
  _pqExpanded.clear();
  _pqExpanded.add(runKey);
  _pqBatchFilter = group;
  _pqHighlightId = hit.id;
  // The row has to be inside the rendered slice, not cut off by the row cap.
  _pqRowCap.set(runKey, Infinity);

  pqSetLookupNote(
    hits.length > 1
      ? `${esc(hit.serial)} — ${hits.length} matches across batches, showing the first.`
      : `Found ${hit.serial}.`
  );

  if (_pqData) renderPrintQueue(_pqData);
}

// Runs after the queue re-renders, since the row only exists then.
function pqScrollToHit() {
  if (!_pqHighlightId) return;
  requestAnimationFrame(() => {
    const row = document.querySelector('.queue-row[data-pq-hit="1"]');
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

// Marks an entire generation printed in one request, so it leaves the queue and
// the next export cannot pick it up again. Per-tag marking was the only option
// before, which is why nothing was ever marked and every run kept reappearing.
//
// batchKey is passed for legacy groups only: those tags have no run id, so the
// server would otherwise match every batch's legacy tags at once.
async function markRunPrinted(runId, count, batchKey) {
  if (!confirm(`Mark all ${count} tags in this generation as printed? They leave the print queue and will not be included in future exports.`)) return;
  try {
    const body = { issuanceRunId: runId };
    if (runId === "__legacy__" && batchKey) {
      const group = pqGroupTags((_pqData && _pqData.tags) || []).get(batchKey);
      // Every raw spelling that reduces to this key — the server matches
      // batchNumber exactly, so all of them have to be named.
      body.batchNumbers = group ? [...group.raws.keys()] : [];
      if (batchKey === "__no_batch__") body.batchNumbers = [null];
    }
    const res = await fetchJson("/api/admin/print-queue/mark-run-printed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    // Selections point at tags that are about to disappear from the queue.
    _pqSelected.clear();
    await loadPrintQueue();
    alert(`${res.marked} tag(s) marked as printed.`);
  } catch (err) {
    alert(`Failed to mark generation as printed: ${err.message}`);
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
    // The "Seed demo setup" hint only applies to local dev (the demo/seed
    // routes are disabled in production), so don't leak it onto the live site.
    const isLocalDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    setStatus(
      isLocalDev
        ? `${message}. If this is local dev, click "Seed demo setup" first.`
        : message,
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

// The last queue payload, kept so expanding a generation, filtering by batch or
// jumping to a serial can re-render from memory instead of refetching. On a
// production-sized queue that response is ~1.7MB.
let _pqData = null;
// Normalized batch key currently filtered to; "" shows every batch. A view
// filter only — it never narrows _pqVisibleIds or _pqSelected, so a selection
// made in one batch survives switching to another.
let _pqBatchFilter = "";
// Run keys ("<batchKey>::<runId>") whose rows are expanded. Generations are
// collapsed by default: production holds thousands of unprinted tags in a
// single batch, and rendering every row is what made the queue unsearchable.
const _pqExpanded = new Set();
// Rows rendered per expanded generation before a "show all" prompt. Expanding a
// 2000-tag generation in one go locks the page up for seconds.
const PQ_ROW_CAP = 200;
const _pqRowCap = new Map();
// Tag id a serial lookup landed on, highlighted and scrolled to once.
let _pqHighlightId = null;

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
          <strong>${esc(owner.displayName)}</strong>
          <p>${esc(owner.email)}</p>
          <p>${esc(owner.phone || "")}</p>
        </div>
        <div class="monitor-meta">
          <span>Credits: ${esc(owner.credits)}</span>
          <span>Tags: ${esc(owner.tags)}</span>
          <span>Active: ${esc(owner.activeTags)}</span>
          ${owner.tagTokens?.map(t => `<span>Token: ${esc(t)}</span>`).join("") || ""}
          <span>Joined: ${esc(new Date(owner.createdAt).toLocaleString())}</span>
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
        <strong>${esc(item.vehicleLabel)}</strong>
        <span>Token: ${esc(item.token)}</span>
        <span>Phone: ${esc(item.phone)}</span>
        <span>Action: ${esc(item.action)}${item.messageChannel ? ` (${esc(item.messageChannel)})` : ""}</span>
        ${item.message ? `<span>Message: ${esc(item.message)}</span>` : ""}
        <span class="status-badge" data-tone="${item.status === "provider_started" ? "success" : item.status === "provider_failed" ? "error" : "info"}">${esc(item.status)}</span>
        ${item.providerError ? `<span class="error-note">${esc(item.providerError)}</span>` : ""}
        <span>${esc(new Date(item.createdAt).toLocaleString())}</span>
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
          <p class="pt-admin-row-title">${esc(a.displayName)}</p>
          <p class="pt-admin-row-meta">${esc(a.email)} &middot; Added ${esc(new Date(a.createdAt).toLocaleString())}</p>
        </div>
        ${a.email !== myEmail ? `
          <button onclick="deleteAdmin('${jsAttr(a.id)}')"
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

  if (hasEl("pq-batch-filter")) {
    byId("pq-batch-filter").addEventListener("change", (event) => {
      _pqBatchFilter = event.target.value || "";
      _pqHighlightId = null;
      pqSetLookupNote("");
      if (_pqData) renderPrintQueue(_pqData);
    });
  }

  if (hasEl("pq-serial-jump")) {
    const input = byId("pq-serial-jump");
    // Enter is how anyone types a code into a box; don't make them reach for
    // the button.
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        pqJumpToSerial();
      }
    });
    // Clearing the box (including via the search field's ✕) drops the
    // highlight, so a stale hit is not left outlined.
    input.addEventListener("input", () => {
      if (input.value.trim()) return;
      pqSetLookupNote("");
      if (_pqHighlightId) {
        _pqHighlightId = null;
        if (_pqData) renderPrintQueue(_pqData);
      }
    });
  }

  if (hasEl("pq-serial-jump-button")) {
    byId("pq-serial-jump-button").addEventListener("click", pqJumpToSerial);
  }

  if (hasEl("pq-expand-toggle")) {
    byId("pq-expand-toggle").addEventListener("click", () => {
      pqSetExpandAll(_pqExpanded.size === 0);
    });
  }

  if (hasEl("close-export-button")) {
    byId("close-export-button").addEventListener("click", () => {
      const overlay = byId("qr-export-overlay");
      if (overlay) overlay.style.display = "none";
    });
  }

  window.markPrinted = markPrinted;
  window.markRunPrinted = markRunPrinted;
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
