import { getCaptchaToken } from "../recaptcha.js";

// Failed requests are counted (and the last failing status kept) because most
// page loaders catch their own errors and paint a message instead of throwing;
// the Refresh button reads these to know whether its reload actually worked.
let fetchFailures = 0;
let lastFailedStatus = 0;

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    fetchFailures += 1;
    lastFailedStatus = 0;
    throw error;
  }
  const raw = await response.text();

  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // Non-JSON body: almost always a proxy/gateway error page (e.g. a 502/504
    // "upstream error" when the request timed out upstream). Surface something
    // readable instead of a raw "Unexpected token 'u'" JSON.parse crash.
    const snippet = raw.trim().slice(0, 120);
    fetchFailures += 1;
    lastFailedStatus = response.status;
    throw new Error(
      response.ok
        ? `Unexpected non-JSON response from server${snippet ? `, ${snippet}` : ""}`
        : `Server error ${response.status}${snippet ? `, ${snippet}` : ""}`
    );
  }

  if (!response.ok) {
    fetchFailures += 1;
    lastFailedStatus = response.status;
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

function setIssueMessage(message) {
  const target = byId("issue-output");

  if (!target) {
    return;
  }

  target.innerHTML = `
    <p class="empty-copy">${esc(message)}</p>
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
          <img class="pt-figma-qr" src="${esc(tag.qrDataUrl)}" alt="QR ${esc(tag.token)}"/>
          <div class="pt-figma-serial">${esc(tag.serial || "")}</div>
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
      <strong style="font-size:1rem;color:#03162D">✓ ${esc(formatCount(count))} QR tag${count !== 1 ? "s" : ""} generated${batchBits ? `, ${esc(batchBits)}` : ""}.</strong>
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
    <p class="empty-copy">${esc(message)}</p>
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
      ? `<span class="pt-pq-variant">Entered as ${raws.map((r) => esc(JSON.stringify(r))).join(", ")}, one batch, one serial run</span>`
      : "";

    return `
      <section class="pt-pq-batch">
        <div class="pt-pq-batch-head">
          <div style="min-width:0">
            <h3 class="pt-pq-batch-title">${batchTitle}</h3>
            <p class="pt-pq-batch-meta">${batchCount} tag${batchCount === 1 ? "" : "s"} · ${runs.length} generation${runs.length === 1 ? "" : "s"}</p>
            ${variantNote}
          </div>
          <div class="pt-pq-batch-actions">
            ${group.key === "__no_batch__" ? "" : raws.map((raw) => `
              <button class="pt-pq-danger" onclick="deleteBatch('${jsAttr(raw)}')">Delete batch${raws.length > 1 ? ` ${esc(JSON.stringify(raw))}` : ""}</button>
            `).join("")}
          </div>
        </div>
        ${runs.map((run, index) => pqRunHtml(group, run, index)).join("")}
      </section>
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

  const newest = index === 0 && !legacy;

  return `
    <div class="pt-pq-run${open ? " is-open" : ""}${newest ? " is-newest" : ""}">
      <div class="pt-pq-run-head">
        <input type="checkbox" class="pq-select-all pt-pq-run-check" data-ids="${esc(idsCsv)}" ${allSelected ? "checked" : ""} onchange="togglePqSelectBatch('${jsAttr(idsCsv)}', this.checked)" title="Select this generation for export" />
        <button type="button" class="pt-pq-run-toggle" aria-expanded="${open ? "true" : "false"}" onclick="togglePqRun('${jsAttr(runKey)}')">
          <span class="pt-pq-caret" data-open="${open ? "1" : "0"}" aria-hidden="true">
            <svg width="9" height="12" viewBox="0 0 8 12" fill="none"><path d="M1.5 1L6.5 6l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <span class="pt-pq-run-label">
            <span class="pt-pq-run-title">${legacy ? "Earlier tags (no generation recorded)" : `Generated ${esc(when)}`}</span>
            <span class="pt-pq-run-meta"><span>${run.tags.length} tag${run.tags.length === 1 ? "" : "s"}</span> ${range ? `<span class="pt-pq-range">${esc(range)}</span>` : ""} <span class="pt-pq-mount" data-mount="${esc(first.mountType || "windscreen_interior")}">${esc(pqMountLabel(first.mountType))}</span></span>
          </span>
        </button>
        <div class="pt-pq-run-actions">
          ${newest ? `<span class="pt-pq-badge">NEWEST</span>` : ""}
          ${_pqPrinted ? "" : `<button class="pt-pq-act" onclick="markRunPrinted(${markArgs})">Mark printed</button>`}
        </div>
      </div>
      ${visibleTags.map(tag => `
        <article class="queue-row" ${_pqHighlightId === tag.id ? 'data-pq-hit="1"' : ""}>
          <input type="checkbox" class="pq-select pt-pq-run-check" data-id="${esc(tag.id)}" ${_pqSelected.has(tag.id) ? "checked" : ""} onchange="togglePqSelect('${jsAttr(tag.id)}', this.checked)" />
          <strong><span class="pt-pq-serial">${tag.serial ? esc(tag.serial) : ", "}</span><span class="pt-pq-tier" data-tier="${tag.premium ? "premium" : "free"}">${tag.premium ? "PREMIUM" : "FREE"}</span><span class="pt-pq-token" title="${esc(tag.token)}">${esc(tag.token)}</span></strong>
          <span class="pt-pq-status">${esc(pqOddStatus(tag))}</span>
          <a href="${esc(tag.claimUrl)}" target="_blank" rel="noreferrer" title="${esc(tag.claimUrl)}">${esc(tag.claimUrl)}</a>
          ${tag.printStatus !== "printed" ? `<button class="pt-pq-act" onclick="markPrinted('${jsAttr(tag.id)}')">Mark printed</button>` : `<span style="color:#FF2700;font-weight:700">✓ Printed</span>`}
        </article>
      `).join("")}
      ${open && run.tags.length > visibleTags.length ? `
        <div class="pt-pq-more">
          <span>Showing ${visibleTags.length} of ${run.tags.length} rows. The checkbox above still selects all ${run.tags.length}.</span>
          <button class="pt-pq-act" onclick="pqShowAllRows('${jsAttr(runKey)}')">Show all ${run.tags.length}</button>
        </div>` : ""}
    </div>`;
}

// One chunk of an export, with the rate limiter treated as back-pressure rather
// than a failure.
//
// A print run is thousands of stickers over many requests, so it is the one
// flow that can legitimately reach the limit. Failing the whole export there
// threw away every chunk already fetched and left the operator with nothing —
// which is exactly what happened on a 3000-tag run. Waiting and retrying costs
// seconds and keeps the work.
//
// fetchJson is not used here because it discards the status code, and 429 has
// to be told apart from a real error.
async function pqFetchExportChunk(ids, onWait) {
  const MAX_RETRIES = 6;
  let attempt = 0;

  for (;;) {
    const response = await fetch("/api/admin/print-queue/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids })
    });

    if (response.status === 429) {
      attempt += 1;
      if (attempt > MAX_RETRIES) {
        throw new Error(
          "The server is still limiting requests after several retries. Wait a minute and export the rest."
        );
      }
      // Honour Retry-After (seconds) when the limiter sends it; otherwise widen
      // the wait each time, capped so a run never stalls indefinitely.
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30000, 2000 * 2 ** (attempt - 1));
      if (onWait) onWait(waitMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`Server error ${response.status}, ${raw.trim().slice(0, 120)}`);
    }
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }
}

// QR-only export: bare codes, no sticker artwork, on A4 portrait. 5 x 6 per
// page; the grid and QR size live in print-queue.html (.pt-qr-a4).
const QR_ONLY_PER_PAGE = 30;
const QR_ONLY_PAGE_STYLE_ID = "pq-qr-only-page";

function qrOnlyCellHtml(tag) {
  return `
    <div class="pt-qr-cell">
      <img src="${esc(tag.qrDataUrl)}" alt="QR ${esc(tag.serial || "")}"/>
      <div class="pt-qr-serial">${esc(tag.serial || "")}</div>
    </div>`;
}

// @page cannot be scoped to a class, so the A4 size is a rule added after the
// sticker's A6 one (the later rule wins) and removed again for a sticker export.
// Appended to <body>, not <head>: the A6 rule lives in a <style> inside the
// page body, and a <head> rule would come before it and lose.
function setQrOnlyPageSize(on) {
  const existing = document.getElementById(QR_ONLY_PAGE_STYLE_ID);
  if (!on) { if (existing) existing.remove(); return; }
  if (existing) return;
  const style = document.createElement("style");
  style.id = QR_ONLY_PAGE_STYLE_ID;
  style.textContent = "@media print { @page { margin: 0; size: 210mm 297mm; } }";
  document.body.appendChild(style);
}

function exportQrsForPrint() {
  return runPrintExport({ qrOnly: false });
}

function exportQrOnlyForPrint() {
  return runPrintExport({ qrOnly: true });
}

// Door hangers: the server renders the whole print sheet (Figma artwork plus
// each tag's QR) and gives the tags the hanger's free contacts, so this only
// sends the selection and puts the returned page in a new window to print.
async function exportDoorhangersForPrint() {
  const visible = new Set(_pqVisibleIds);
  const ids = [
    ..._pqVisibleIds.filter((id) => _pqSelected.has(id)),
    ...[..._pqSelected].filter((id) => !visible.has(id))
  ];
  if (ids.length === 0) {
    setStatus("Select the tag(s) you want on door hangers first.", "info");
    return;
  }
  const dieline = Boolean(byId("doorhanger-dieline")?.checked);
  if (!window.confirm(
    `Make ${ids.length} door hanger${ids.length === 1 ? "" : "s"}${dieline ? " (with dieline)" : ""}?\n\n` +
    "Each tag gets 2 free contacts, because the hanger promises \"First 2 contacts free\"."
  )) return;

  // Opened now, inside the click, so pop-up blockers allow it; filled below.
  const win = window.open("", "_blank");
  if (!win) {
    setStatus("Allow pop-ups for this site to open the door hanger print sheet.", "error");
    return;
  }
  win.document.write('<p style="font:15px system-ui,sans-serif;padding:32px;color:#03162D">Preparing door hangers…</p>');
  setStatus(`Preparing ${ids.length} door hanger${ids.length === 1 ? "" : "s"}…`, "info");

  try {
    const response = await fetch("/api/admin/print-queue/doorhangers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, dieline })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Request failed (${response.status})`);

    win.document.open();
    win.document.write(data.html);
    win.document.close();
    const skipped = data.skipped ? ` ${data.skipped} selected tag(s) were skipped (claimed, printed or demo stock).` : "";
    setStatus(`${data.count} door hangers ready in the new window: Print, then Save as PDF with margins set to None.${skipped}`, "success");
  } catch (error) {
    win.close();
    setStatus(error instanceof Error ? error.message : "Could not prepare the door hangers.", "error");
  }
}

async function runPrintExport({ qrOnly }) {
  const overlay = byId("qr-export-overlay");
  const grid = byId("qr-export-grid");
  const countLabel = byId("export-count-label");
  if (!overlay || !grid) return;

  // Set before anything renders, so a QR-only run never prints on A6 paper and
  // a sticker run after it never prints on A4.
  setQrOnlyPageSize(qrOnly);
  // An A4 sheet (210mm) is wider than the sticker preview's 760px column.
  grid.style.maxWidth = qrOnly ? "none" : "760px";

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
    //
    // The chunk size comes from the server so the two cannot drift; it is the
    // largest the export endpoint accepts, which keeps the request count — and
    // so the load on the rate limiter — as low as it can be. At 100 per chunk a
    // 3000-tag run was exactly 30 requests against a 30/minute limit, and died
    // on the last one with "Too many requests" after nearly all the work.
    const CHUNK = Number(_pqData && _pqData.exportMaxPerRequest) || 250;
    const tags = [];
    const totalChunks = Math.ceil(selectedIds.length / CHUNK);

    for (let i = 0; i < selectedIds.length; i += CHUNK) {
      const chunk = selectedIds.slice(i, i + CHUNK);
      const data = await pqFetchExportChunk(chunk, (waitMs) => {
        grid.innerHTML = `<p style="color:#6B7280">Loading QR codes… ${tags.length}/${selectedIds.length}<br>
          <span style="font-size:.9em">Server is pacing the run, continuing in ${Math.ceil(waitMs / 1000)}s. Nothing is lost.</span></p>`;
      });
      tags.push(...(data.tags || []));
      const done = Math.min(i + CHUNK, selectedIds.length);
      grid.innerHTML = `<p style="color:#6B7280">Loading QR codes… ${done}/${selectedIds.length}
        <span style="font-size:.9em">(batch ${Math.floor(i / CHUNK) + 1} of ${totalChunks})</span></p>`;
    }

    // A tag can leave the queue between selecting and exporting (claimed, or
    // marked printed in another tab). Say so rather than printing a short run
    // and letting it be discovered at the guillotine.
    if (tags.length < selectedIds.length) {
      setStatus(
        `${selectedIds.length - tags.length} of ${selectedIds.length} selected tags are no longer printable and were left out.`,
        "info"
      );
    }

    if (!tags.length) {
      if (countLabel) countLabel.textContent = "0 tags to print";
      grid.innerHTML = `<p style="color:#6B7280">No unclaimed tags to export.</p>`;
      return;
    }

    if (qrOnly) {
      const pages = Math.ceil(tags.length / QR_ONLY_PER_PAGE);
      if (countLabel) {
        countLabel.textContent = `${tags.length} QR code${tags.length !== 1 ? "s" : ""} · ${pages} A4 page${pages !== 1 ? "s" : ""} · print at 100% / actual size`;
      }
      let pagesHtml = "";
      for (let i = 0; i < tags.length; i += QR_ONLY_PER_PAGE) {
        pagesHtml += `<div class="pt-qr-a4">${tags.slice(i, i + QR_ONLY_PER_PAGE).map(qrOnlyCellHtml).join("")}</div>`;
      }
      grid.innerHTML = pagesHtml;
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
    grid.innerHTML = `<p style="color:#DC2626">Failed to load: ${esc(err.message)}</p>`;
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

// Which sticker a run prints — the one thing on the card the printer acts on.
// Anything issued before mount types existed is windscreen stock, so a missing
// value reads as windscreen rather than as "unknown".
function pqMountLabel(mountType) {
  return mountType === "exterior_surface" ? "BIKE · back glue" : "CAR · front glue";
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

// Print status, but only when it says something the tab does not. Every row of
// "To Print" is pending_print and every row of the printed tab is printed, so
// spelling it out on each line was a column of identical text. Anything else —
// a status this UI does not set — still shows, because that is worth seeing.
function pqOddStatus(tag) {
  const expected = _pqPrinted ? "printed" : "pending_print";
  const status = tag.printStatus || "pending_print";
  return status === expected ? "" : status;
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
      return `<option value="${esc(group.key)}"${group.key === _pqBatchFilter ? " selected" : ""}>${esc(name)}, ${count} tag${count === 1 ? "" : "s"}, ${gens} generation${gens === 1 ? "" : "s"}</option>`;
    })
    .join("");

  select.innerHTML =
    `<option value=""${_pqBatchFilter ? "" : " selected"}>All batches, ${tags.length} tag${tags.length === 1 ? "" : "s"}</option>` +
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
      ? `${hit.serial}, ${hits.length} matches across batches, showing the first.`
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

// ── Overview: one number per admin page, each card linking to that page ──
function formatCount(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function timeAgo(iso) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  // Clamped at both ends so the boundaries never read "0 yrs" or "12 mo".
  if (days < 365) return `${Math.min(11, Math.max(1, Math.round(days / 30.44)))} mo ago`;
  const years = Math.max(1, Math.round(days / 365.25));
  return `${years} yr${years === 1 ? "" : "s"} ago`;
}

function overviewCard({ href, label, value, sub }) {
  return `
    <a class="pt-admin-stat" href="${esc(href)}">
      <p class="pt-admin-stat-label">${esc(label)}</p>
      <p class="pt-admin-stat-value">${esc(formatCount(value))}</p>
      ${sub ? `<p class="ov-sub">${esc(sub)}</p>` : ""}
    </a>`;
}

// The overview's period: the four the summary route accepts. Kept in the URL
// (?days=) so a reload or the sidebar's Refresh stays on the chosen period.
const OVERVIEW_PERIODS = {
  1: { phrase: "past day", short: "1d" },
  7: { phrase: "past 7 days", short: "7d" },
  30: { phrase: "past month", short: "1 mo" },
  365: { phrase: "past year", short: "1 yr" }
};
let _overviewDays = (() => {
  const wanted = Number(new URLSearchParams(location.search).get("days"));
  return OVERVIEW_PERIODS[wanted] ? wanted : 7;
})();
let _overviewRequest = 0;

function renderOverviewSummary(data) {
  const target = byId("overview-summary");
  if (!target) return;

  const s = data.summary;
  const period = OVERVIEW_PERIODS[data.windowDays] || { phrase: `past ${data.windowDays} days`, short: `${data.windowDays}d` };
  // Visits are counted in whole days and only kept for 180 of them, so the
  // visitors card names its own window when that differs from the period.
  const trafficDays = data.trafficDays || data.windowDays;
  const trafficWindow = trafficDays === 1
    ? "today"
    : trafficDays < data.windowDays ? `last ${trafficDays} days, all that is kept` : period.phrase;
  const sections = [
    {
      title: "Needs attention",
      cards: [
        { href: "/admin/activations", label: "Sold, not activated", value: s.activations.awaiting, sub: "Paid or COD orders with no live tag yet" },
        { href: "/admin/print-queue", label: "Unprinted tags", value: s.printQueue.unprinted, sub: "Waiting in the print queue" },
        { href: "/admin/activity", label: `Failed contacts (${period.short})`, value: s.contacts.failed, sub: "Calls or messages the provider could not deliver" }
      ]
    },
    {
      title: "Customers",
      cards: [
        { href: "/admin/owners", label: "Owners", value: s.owners.total, sub: `+${formatCount(s.owners.new)} in the ${period.phrase}` },
        { href: "/admin/etags", label: "Customer tags", value: s.tags.customer, sub: `${formatCount(s.tags.active)} active` },
        { href: "/admin/activations", label: "Premium tags activated", value: s.activations.premiumActivated, sub: `${formatCount(s.activations.premiumLive)} live now` },
        { href: "/admin/activations", label: "E-Tag stickers activated", value: s.activations.etag, sub: "Issued stickers with an owner" }
      ]
    },
    {
      title: "Stock",
      cards: [
        { href: "/admin/issuance", label: "Batches issued", value: s.batches.count, sub: `${formatCount(s.batches.issued)} tags · ${formatCount(s.batches.activated)} activated` },
        { href: "/admin/print-queue", label: "Printed, awaiting claim", value: s.printQueue.printedAwaitingClaim, sub: "Printed stickers nobody has claimed" },
        { href: "/admin/etags?claim=unclaimed&category=premium", label: "Unsold premium stock", value: s.stock.premiumUnsold, sub: "Premium tags nobody holds yet" },
        { href: "/admin/marketing", label: "Field demo stickers", value: s.fieldDemo.units, sub: `${formatCount(s.fieldDemo.available)} available · ${formatCount(s.fieldDemo.activated)} activated · ${formatCount(s.fieldDemo.sold)} sold` }
      ]
    },
    {
      title: `Usage · ${period.phrase}`,
      cards: [
        { href: "/admin/activity", label: "Contact requests", value: s.contacts.new, sub: `${formatCount(s.contacts.total)} all-time` },
        { href: "/admin/traffic", label: "Site visitors", value: s.traffic.visitors, sub: `${formatCount(s.traffic.views)} page views · ${trafficWindow}` }
      ]
    }
  ];

  target.innerHTML = sections
    .map((section) => `
      <p class="ov-section-title">${esc(section.title)}</p>
      <div class="pt-admin-stats">${section.cards.map(overviewCard).join("")}</div>`)
    .join("");
}

async function loadOverviewSummary() {
  // Numbered so a slow answer for a period the admin has already moved off
  // cannot overwrite the one they picked after it.
  const request = ++_overviewRequest;
  const target = byId("overview-summary");
  target?.setAttribute("aria-busy", "true");
  try {
    const data = await fetchJson(`/api/admin/overview/summary?days=${_overviewDays}`);
    if (request === _overviewRequest) renderOverviewSummary(data);
    return data;
  } finally {
    if (request === _overviewRequest) target?.removeAttribute("aria-busy");
  }
}

function syncOverviewPeriodButtons() {
  for (const button of document.querySelectorAll("#overview-period [data-days]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.days) === _overviewDays));
  }
}

async function selectOverviewPeriod(days) {
  if (!OVERVIEW_PERIODS[days] || days === _overviewDays) return;
  _overviewDays = days;
  syncOverviewPeriodButtons();
  const url = new URL(location.href);
  url.searchParams.set("days", String(days));
  history.replaceState(null, "", url);
  try {
    await loadOverviewSummary();
    if (days === _overviewDays) setStatus("", "info");
  } catch (error) {
    if (days !== _overviewDays) return; // superseded by a later pick
    // Only a signed-out answer leaves the page, as on first load.
    if (lastFailedStatus === 401 || lastFailedStatus === 403) {
      window.location.href = "/admin";
      return;
    }
    setStatus(error instanceof Error ? error.message : "Could not load the overview for that period.", "error");
  }
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
        `Seeded active token ${seeded.tag.token} and claimable token ${seeded.claimableTag?.token || "-"}.`
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
    // Admin sign-in has its own endpoint. The shared /api/auth/login used to
    // take the role from this body, which made the public owner sign-in surface
    // an admin one too; the role is now fixed by the route it is posted to.
    // The reCAPTCHA token is "" wherever reCAPTCHA is not configured.
    const recaptchaToken = await getCaptchaToken("admin_login");
    await fetchJson("/api/auth/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        recaptchaToken
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

  // replace(), not href: the admin console the user just left must not be one
  // Back press away, on a shared machine least of all.
  window.location.replace("/admin");
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

  // Caught here as well as server-side, so the operator is told before a run is
  // attempted rather than after. The server still refuses a missing value — it
  // is the only check a direct POST cannot skip.
  const mountType = byId("issue-mount-type")?.value || "";
  if (!mountType) {
    setStatus("Choose which sticker this run prints before generating.", "error");
    setIssueMessage("No batch generated. A sticker type is required.");
    byId("issue-mount-type")?.focus();
    return;
  }

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
        premiumBatch: byId("issue-premium-batch")?.checked,
        mountType
      })
    });

    renderIssuedTag(data);
    await loadBatchSummary();
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
  const n = _pqSelected.size;
  for (const [id, text] of [["export-qr-button", "Export QRs"], ["export-qr-only-button", "QR only"], ["export-doorhanger-button", "Door hanger PDF"]]) {
    const btn = byId(id);
    if (!btn) continue;
    // Keep the icon; only swap the trailing text node.
    const label = n > 0 ? `${text} (${n})` : text;
    const textNode = [...btn.childNodes].reverse().find((node) => node.nodeType === 3 && node.textContent.trim());
    if (textNode) textNode.textContent = ` ${label}`;
    else btn.append(document.createTextNode(` ${label}`));
  }
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

// What a premium tag's cover looks like today, in a few words.
function membershipNote(membership) {
  if (!membership) return null;
  const left = `${formatCount(membership.daysLeft)}d left`;
  if (membership.state === "trial") return { tone: "ok", text: `Free year · ${left}` };
  if (membership.state === "subscribed") return { tone: "ok", text: `Member · ${left}` };
  if (membership.state === "open") return { tone: "ok", text: "Member · no end date" };
  if (membership.state === "lapsed") return { tone: "warn", text: "Membership lapsed" };
  return null;
}

// A tag card: the plate, one grey line (type · serial · vehicle), then a short
// coloured line for anything worth noticing. Text rather than pills, so the
// card never wraps into a stack of badges.
function ownerTagHtml(tag) {
  const title = tag.plateNumber || tag.vehicleLabel || "No plate yet";
  // Each piece stays whole and carries its own "·", so a narrow card wraps
  // before a separator, never inside a serial or with a "·" left dangling.
  const type = `<span class="ow-type${tag.premium ? " is-premium" : ""}">${tag.premium ? "Premium" : "E-Tag"}</span>`;
  const meta = [tag.serial, tag.plateNumber && tag.vehicleLabel ? tag.vehicleLabel : ""]
    .filter(Boolean)
    .map((part) => ` <span class="ow-nw">· ${esc(part)}</span>`)
    .join("");
  const notes = [];
  if (tag.status !== "active") notes.push({ tone: "warn", text: "Inactive" });
  if (tag.demoSticker) notes.push({ tone: "demo", text: "Demo sticker" });
  const membership = membershipNote(tag.membership);
  if (membership) notes.push(membership);
  return `
    <a class="ow-tag" href="/admin/etags?q=${encodeURIComponent(tag.serial)}" title="Open in Tags">
      <span class="ow-tag-plate">${esc(title)}</span>
      <span class="ow-tag-meta"><span class="ow-nw">${type}</span>${meta}</span>
      ${notes.map((n) => `<span class="ow-tag-note" data-tone="${n.tone}">${esc(n.text)}</span>`).join("")}
    </a>`;
}

// One tag on show; the rest open from a small arrow in that card's corner,
// whose words ("Show 3 more tags") appear only on hover or keyboard focus. The
// one on show is the one most likely to matter: live before switched off,
// Premium before E-Tag.
function ownerTagsHtml(tags, ownerId) {
  if (!tags.length) return `<span class="ow-muted">No tags</span>`;
  const rank = (t) => (t.status === "active" ? 0 : 2) + (t.premium ? 0 : 1);
  const sorted = tags.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
  const [first, ...rest] = sorted;
  if (!rest.length) return `<div class="ow-tags">${ownerTagHtml(first)}</div>`;
  const listId = `ow-more-${ownerId}`;
  const label = ownerMoreLabel(false, rest.length);
  return `<div class="ow-tags">
      <div class="ow-tag-first">
        ${ownerTagHtml(first)}
        <button type="button" class="ow-more-btn" aria-expanded="false" aria-controls="${esc(listId)}" data-count="${rest.length}" aria-label="${esc(label)}" data-tip="${esc(label)}"></button>
      </div>
      <div class="ow-tags" id="${esc(listId)}" hidden>${rest.map(ownerTagHtml).join("")}</div>
    </div>`;
}

function ownerMoreLabel(open, count) {
  const tags = `${formatCount(count)} more ${count === 1 ? "tag" : "tags"}`;
  return open ? `Hide ${tags}` : `Show ${tags}`;
}

function toggleOwnerTags(button) {
  const list = document.getElementById(button.getAttribute("aria-controls"));
  if (!list) return;
  const open = button.getAttribute("aria-expanded") !== "true";
  list.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  const label = ownerMoreLabel(open, Number(button.dataset.count) || 0);
  button.setAttribute("aria-label", label);
  button.dataset.tip = label;
}

// An email may break after its "@" when the column is narrow, rather than
// wherever the last letter happens to fall.
function ownerContactHtml(value) {
  const at = value.indexOf("@");
  return at > 0 ? `${esc(value.slice(0, at + 1))}<wbr>${esc(value.slice(at + 1))}` : esc(value);
}

function ownerRowHtml(owner) {
  const name = owner.displayName
    ? `<p class="ow-name">${esc(owner.displayName)}${owner.demo ? `<span class="ow-badge" data-tone="demo">Demo</span>` : ""}</p>`
    : `<p class="ow-name ow-muted">Unnamed owner${owner.demo ? `<span class="ow-badge" data-tone="demo">Demo</span>` : ""}</p>`;
  const contact = [owner.mobile, owner.email].filter(Boolean);
  const tags = owner.tagList || [];
  const joined = owner.createdAt ? new Date(owner.createdAt) : null;
  return `
    <tr>
      <td data-label="Owner">${name}</td>
      <td data-label="Contact">${contact.length ? contact.map((c) => `<p class="ow-small${c === owner.mobile ? " ow-nw" : ""}">${ownerContactHtml(c)}</p>`).join("") : `<span class="ow-muted">—</span>`}</td>
      <td data-label="Tags">${ownerTagsHtml(tags, owner.id)}</td>
      <td data-label="Orders"><span class="ow-num">${esc(formatCount(owner.orders))}</span></td>
      <td data-label="Joined">${joined && !Number.isNaN(joined.getTime())
        ? `<span class="ow-nw">${esc(joined.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }))}</span><p class="ow-small ow-nw">${esc(timeAgo(owner.createdAt))}</p>`
        : `<span class="ow-muted">—</span>`}</td>
    </tr>`;
}

// Each keystroke starts a request; only the newest one may paint, so a slow
// earlier search can never overwrite the results of a later one.
let _ownersRequest = 0;
// 100 owners a page, numbered; the search runs on the server over every owner.
let _ownersPage = 1;

async function loadOwners() {
  const target = byId("owner-monitor-list");
  const countEl = byId("owners-count");
  const pagerEl = byId("owners-pager");
  const q = byId("owners-search")?.value.trim() || "";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (byId("owners-show-demo")?.checked) params.set("demo", "include");
  if (_ownersPage > 1) params.set("page", String(_ownersPage));
  const requestId = ++_ownersRequest;

  try {
    const data = await fetchJson(`/api/admin/owners${params.toString() ? `?${params}` : ""}`);
    if (requestId !== _ownersRequest || !target) return;

    // The server clamps a page past the end to the last one; follow it.
    _ownersPage = Number(data.page) || 1;
    if (pagerEl && window.renderPager) {
      window.renderPager(pagerEl, data, (n) => {
        _ownersPage = n;
        loadOwners().then(() => target.scrollIntoView({ block: "start" }));
      });
    }

    if (countEl) {
      const from = (_ownersPage - 1) * (Number(data.pageSize) || 100) + 1;
      const shown = Number(data.pages) > 1
        ? `Showing ${formatCount(from)}–${formatCount(from + data.owners.length - 1)} of ${formatCount(data.total)}`
        : `${formatCount(data.total)}`;
      // A pasted sticker link carries the tag's token; don't echo it back.
      const echo = q.length > 40 ? "your search" : `“${q}”`;
      countEl.textContent = `${shown} ${data.total === 1 ? "owner" : "owners"}${q ? ` matching ${echo}` : ""}.`;
    }

    if (!data.owners.length) {
      target.innerHTML = `<p class="pt-admin-empty">${q ? "No owners match that search." : "No owners registered yet."}</p>`;
      return;
    }

    target.innerHTML = `
      <table class="ow-table">
        <thead><tr><th>Owner</th><th>Contact</th><th>Tags</th><th>Orders</th><th>Joined</th></tr></thead>
        <tbody>${data.owners.map(ownerRowHtml).join("")}</tbody>
      </table>`;
  } catch (error) {
    if (requestId !== _ownersRequest) return;
    if (countEl) countEl.textContent = "";
    if (target) target.innerHTML = `<p class="pt-admin-empty">Failed to load owners.</p>`;
    const pagerEl = byId("owners-pager");
    if (pagerEl && window.renderPager) window.renderPager(pagerEl, { page: 1, pages: 1 });
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
        <strong>${esc(item.vehicleLabel || item.serial || "Unknown tag")}</strong>
        ${item.serial ? `<span>Sticker: <a href="/admin/etags?q=${encodeURIComponent(item.serial)}">${esc(item.serial)}</a></span>` : ""}
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
          <p class="pt-admin-row-meta au-last">${a.lastSignInAt ? `Last signed in ${esc(timeAgo(a.lastSignInAt))}` : "No sign-in recorded yet"}</p>
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
    fillAuditFilter(data.admins);
  } catch (error) {
    if (target) target.innerHTML = `<p class="empty-copy">Failed to load admins.</p>`;
  }
}

// ── Sign-in activity (Admin Management) ──
// Newest first, 100 a page; the filter narrows it to one admin's email.
let _auditPage = 1;
let _auditRequest = 0;

function fillAuditFilter(admins) {
  const select = byId("audit-admin");
  if (!select) return;
  const chosen = select.value;
  select.innerHTML = `<option value="">All admins</option>` + admins
    .filter((a) => a.email)
    .map((a) => `<option value="${esc(String(a.email).toLowerCase())}">${esc(a.displayName || a.email)}</option>`)
    .join("");
  if ([...select.options].some((o) => o.value === chosen)) select.value = chosen;
}

function auditEventHtml(e) {
  const times = e.count > 1 ? ` ×${formatCount(e.count)}` : "";
  const [kind, what] =
    e.event === "login" ? ["in", `Signed in${e.method === "google" ? " with Google" : e.method === "password" ? " with password" : ""}`]
      : e.event === "logout" ? ["out", "Signed out"]
        : e.event === "login_locked" ? ["bad", `Blocked: too many failed attempts${times}`]
          : e.event === "admin_created" ? ["change", `Added admin ${e.target || ""}`.trim()]
            : e.event === "admin_removed" ? ["change", `Removed admin ${e.target || ""}`.trim()]
              : ["bad", e.reason === "no_account"
                ? `Failed Google sign-in: not an admin account${times}`
                : e.reason === "bot_check"
                  ? `Failed sign-in: bot check did not pass${times}`
                  : `Failed sign-in: wrong email or password${times}`];
  const when = e.at ? new Date(e.at) : null;
  return `
    <div class="au-row" data-kind="${kind}">
      <div>
        <p class="au-what">${esc(what)}</p>
        <p class="au-who">${esc(e.email || "Unknown email")}</p>
      </div>
      <p class="au-meta">
        <span title="${esc(when ? when.toLocaleString() : "")}">${esc(timeAgo(e.at))}</span>
        <span>${esc([e.browser, e.ip].filter(Boolean).join(" · ") || "—")}</span>
      </p>
    </div>`;
}

async function loadAudit() {
  const target = byId("audit-list");
  const pagerEl = byId("audit-pager");
  const countEl = byId("audit-count");
  if (!target) return;
  const params = new URLSearchParams();
  const email = byId("audit-admin")?.value || "";
  if (email) params.set("email", email);
  if (_auditPage > 1) params.set("page", String(_auditPage));
  const requestId = ++_auditRequest;
  try {
    const data = await fetchJson(`/api/admin/audit${params.toString() ? `?${params}` : ""}`);
    if (requestId !== _auditRequest) return;
    _auditPage = Number(data.page) || 1;
    if (countEl) {
      countEl.textContent = data.total
        ? `${formatCount(data.total)} ${data.total === 1 ? "event" : "events"} in the last 90 days.`
        : "Admin sign-ins, sign-outs, failed attempts and admins added or removed, kept for 90 days.";
    }
    target.innerHTML = data.events.length
      ? data.events.map(auditEventHtml).join("")
      : `<p class="pt-admin-empty">${email ? "No sign-ins recorded for this admin yet." : "No sign-ins recorded yet."}</p>`;
    if (pagerEl && window.renderPager) {
      window.renderPager(pagerEl, data, (n) => {
        _auditPage = n;
        loadAudit().then(() => target.scrollIntoView({ block: "start" }));
      });
    }
  } catch (error) {
    if (requestId !== _auditRequest) return;
    target.innerHTML = `<p class="pt-admin-empty">Failed to load sign-in activity.</p>`;
    if (pagerEl && window.renderPager) window.renderPager(pagerEl, { page: 1, pages: 1 });
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

// The Batches card on the Issuance page: one row per issued batch. The key is
// the batch digits printed in the serial (PT-<key>-…), which is also what the
// E-Tags filter, the activations filter and the CSV route accept.
async function loadBatchSummary() {
  const target = byId("batch-summary");
  if (!target) return;
  let data;
  try {
    data = await fetchJson("/api/admin/tag-batches");
  } catch (error) {
    target.innerHTML = `<p class="pt-admin-empty">Could not load batches: ${esc(error instanceof Error ? error.message : "error")}</p>`;
    return;
  }
  const batches = data.batches || [];
  if (!batches.length) {
    target.innerHTML = `<p class="pt-admin-empty">No batches issued yet.</p>`;
    return;
  }
  const date = (iso) => (iso ? esc(new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })) : `<span class="muted">-</span>`);
  const rows = batches.map((b) => {
    const key = encodeURIComponent(b.key);
    const pct = b.total ? Math.round((b.activated / b.total) * 100) : 0;
    const type = b.premium && b.etag ? `${b.etag} E-Tag · ${b.premium} Premium` : b.premium ? "Premium" : "E-Tag";
    return `<tr>
      <td><b>${esc(b.key)}</b></td>
      <td>${esc(b.labels.join(", ") || "-")}</td>
      <td>${esc(type)}</td>
      <td>${b.total}</td>
      <td><b>${b.activated}</b> <span class="muted">(${pct}%)</span></td>
      <td>${b.unclaimed}</td>
      <td>${b.printed}</td>
      <td>${date(b.lastActivatedAt)}</td>
      <td><div class="bs-actions">
        <a href="/admin/etags?batch=${key}&claim=all">View tags</a>
        <a href="/admin/activations?batch=${key}">Activations</a>
        <a href="/api/admin/tag-batches/${key}/export.csv" download>CSV</a>
      </div></td>
    </tr>`;
  }).join("");
  target.innerHTML = `<table>
    <thead><tr><th>Batch</th><th>Label</th><th>Type</th><th>Issued</th><th>Activated</th><th>Unclaimed</th><th>Printed</th><th>Last activation</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// The sidebar's Refresh: reloads this page's data in place and says so, since
// an unchanged list redrawn looks exactly like a button that did nothing.
// Only a signed-out answer goes to the login page; any other failure stays put
// and says it could not refresh.
async function refreshFromButton(event) {
  const button = event.currentTarget;
  if (button.disabled) return;
  clearTimeout(button._resetTimer);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Refreshing…";

  const failuresBefore = fetchFailures;
  const started = Date.now();
  let ok = true;
  try {
    await refreshCurrentPage({ fromButton: true });
  } catch {
    ok = false;
  }
  if (fetchFailures > failuresBefore) {
    if (lastFailedStatus === 401 || lastFailedStatus === 403) {
      window.location.href = "/admin";
      return;
    }
    ok = false;
  }
  // A beat of "Refreshing…" even when the reload is instant, so it registers.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 450 - (Date.now() - started))));

  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.textContent = ok
    ? `✓ Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Couldn't refresh";
  button.dataset.result = ok ? "ok" : "error";
  button._resetTimer = setTimeout(() => {
    button.textContent = "Refresh";
    delete button.dataset.result;
  }, 3000);
}

async function refreshCurrentPage({ fromButton = false } = {}) {
  try {
    const page = currentAdminPage();

    if (page === "overview") {
      await loadOverviewSummary();
    } else if (page === "issuance") {
      // A small signed-in check, so an expired session still lands on the login
      // page. This used to be /api/admin/overview: 500 owners, their tags and
      // 500 unprinted tags on every visit, none of which this page displays.
      await fetchJson("/api/admin/me");
      await loadBatchSummary();
    } else if (page === "print-queue") {
      await loadPrintQueue();
    } else if (page === "owners") {
      await loadOwners();
    } else if (page === "activity") {
      await loadActivity();
    } else if (page === "admins") {
      await Promise.all([loadAdmins(), loadAudit()]);
    }
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : "Unable to load the current admin environment.",
      "error"
    );

    // A refresh the admin asked for reports its own failure (see
    // refreshFromButton) instead of leaving the page.
    if (fromButton) throw error;

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
  // Bound on the form's submit, not the button's click, so Enter from either
  // field signs in the same way the button does. A click handler alone left the
  // keyboard with no way through.
  if (hasEl("admin-login-form")) {
    byId("admin-login-form").addEventListener("submit", (event) => {
      event.preventDefault();
      loginAdmin();
    });
  } else if (hasEl("admin-login-button")) {
    byId("admin-login-button").addEventListener("click", loginAdmin);
  }

  if (hasEl("admin-seed-button")) {
    byId("admin-seed-button").addEventListener("click", seedAdminDemo);
  }

  if (hasEl("admin-logout-button")) {
    byId("admin-logout-button").addEventListener("click", logoutAdmin);
  }

  if (hasEl("admin-refresh-button")) {
    byId("admin-refresh-button").addEventListener("click", refreshFromButton);
  }

  if (hasEl("overview-period")) {
    syncOverviewPeriodButtons();
    byId("overview-period").addEventListener("click", (event) => {
      const button = event.target.closest("[data-days]");
      if (button) selectOverviewPeriod(Number(button.dataset.days));
    });
  }

  if (hasEl("owners-search")) {
    // The Tags page links here as ?q=<email or phone>.
    const wanted = (new URLSearchParams(location.search).get("q") || "").trim().slice(0, 100);
    if (wanted) byId("owners-search").value = wanted;
    let timer = null;
    byId("owners-search").addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => { _ownersPage = 1; loadOwners(); }, 300);
    });
  }

  if (hasEl("owner-monitor-list")) {
    // The list is redrawn on every search, so the arrow is handled here, once.
    byId("owner-monitor-list").addEventListener("click", (event) => {
      const button = event.target.closest(".ow-more-btn");
      if (button) toggleOwnerTags(button);
    });
  }

  if (hasEl("audit-admin")) {
    byId("audit-admin").addEventListener("change", () => { _auditPage = 1; loadAudit(); });
  }

  if (hasEl("owners-show-demo")) {
    byId("owners-show-demo").addEventListener("change", () => { _ownersPage = 1; loadOwners(); });
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

  if (hasEl("export-qr-only-button")) {
    byId("export-qr-only-button").addEventListener("click", exportQrOnlyForPrint);
  }

  if (hasEl("export-doorhanger-button")) {
    byId("export-doorhanger-button").addEventListener("click", exportDoorhangersForPrint);
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
      setQrOnlyPageSize(false);
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

// Phone-width menu. The sidebar stays the navigation; below 760px the CSS
// parks it off-screen and this adds the button that slides it in. Every page
// starts with it closed, including one restored by the back button.
function setupAdminMenu() {
  const shell = document.querySelector(".pt-admin-shell");
  const sidebar = shell?.querySelector(".pt-admin-sidebar");
  const main = shell?.querySelector(".pt-admin-main");
  if (!shell || !sidebar || !main) return;

  if (!sidebar.id) sidebar.id = "pt-admin-sidebar";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pt-admin-menu-btn";
  button.setAttribute("aria-controls", sidebar.id);
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Menu`;
  main.prepend(button);

  const backdrop = document.createElement("div");
  backdrop.className = "pt-admin-backdrop";
  shell.append(backdrop);

  const setOpen = (open) => {
    shell.classList.toggle("is-menu-open", open);
    button.setAttribute("aria-expanded", String(open));
    if (open) sidebar.querySelector(".pt-admin-nav-item.is-active, .pt-admin-nav-item")?.focus();
  };

  button.addEventListener("click", () => setOpen(!shell.classList.contains("is-menu-open")));
  backdrop.addEventListener("click", () => setOpen(false));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shell.classList.contains("is-menu-open")) {
      setOpen(false);
      button.focus();
    }
  });
  window.addEventListener("pageshow", () => setOpen(false));
}

setupAdminMenu();
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
