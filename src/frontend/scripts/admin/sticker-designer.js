// /admin/sticker-designer: a layer editor for the QR sticker, on Fabric.js
// (vendored at /vendor/fabric, MIT). The canvas is the sticker's 1000 x 600
// box. Two layers are placeholders the print run fills per tag: the QR code
// and the serial. Everything else is artwork, saved as one SVG.
//
// Wrapped in a function: admin pages load classic scripts into one global
// scope (shell.js shares it).
(() => {
  const W = 1000;
  const H = 600;
  const MM_PER_UNIT = 105 / W;
  const SAMPLE_QR_URL = "/api/admin/sticker-designs/sample-qr.svg";
  const SAMPLE_SERIAL = "PT-01-000123";
  // Kept on each layer when the design is saved, so it reopens as it was.
  const EXTRA_PROPS = ["ptRole", "ptName", "ptLocked"];
  const HISTORY_LIMIT = 60;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const MAX_RASTER_EDGE = 2400;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = {
    limits: null,
    designs: [],
    current: null,
    meta: null, // { id, name, status } of the design in the editor
    dirty: false,
    history: [],
    future: [],
    restoring: false,
    busy: false
  };

  let canvas = null;

  if (typeof window.fabric === "undefined") {
    $("page-status").textContent = "The editor library did not load. Reload the page.";
    $("page-status").dataset.tone = "error";
    return;
  }
  const fabric = window.fabric;

  // ── Server ──────────────────────────────────────────────────────────────

  async function api(url, { method = "GET", body } = {}) {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      // A gateway error page, not JSON.
    }
    if (res.status === 401 || res.status === 403) {
      window.location.replace("/admin");
      throw new Error("Signed out.");
    }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || (res.status === 413 ? "The design is too large. Use smaller images." : `Request failed (${res.status}).`));
    }
    return data;
  }

  function setPageStatus(message, tone = "info") {
    const el = $("page-status");
    el.textContent = message || "";
    el.dataset.tone = tone;
  }

  function setEditorStatus(message, tone = "info") {
    const el = $("editor-status");
    el.textContent = message || "";
    el.dataset.tone = tone;
  }

  // ── Designs list ────────────────────────────────────────────────────────

  const STATUS_LABEL = { published: ["live", "Live"], draft: ["draft", "Draft"], retired: ["retired", "Retired"] };

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  async function loadDesigns() {
    const data = await api("/api/admin/sticker-designs");
    state.limits = data.limits;
    state.designs = data.designs;
    state.current = data.current;
    renderDesigns();
  }

  function renderDesigns() {
    const live = state.designs.find((d) => d.status === "published");
    $("live-line").innerHTML = live
      ? `Printing now: <b>${esc(live.name)}</b>, published ${esc(fmtDate(live.publishedAt))}.`
      : "Printing now: <b>the original artwork</b>. Publish a design to change it.";
    $("unpublish-line").hidden = !live;

    const list = $("designs-list");
    if (!state.designs.length) {
      list.innerHTML = `<p class="muted empty">No designs yet. Start one from the original artwork above.</p>`;
      return;
    }
    list.innerHTML = state.designs.map((d) => {
      const [cls, label] = STATUS_LABEL[d.status] || ["retired", d.status];
      const open = state.meta?.id === d.id;
      return `
        <div class="design-row" data-id="${esc(d.id)}">
          <div>
            <span class="design-name">${esc(d.name)}</span><span class="badge ${cls}">${label}</span>
            <div class="design-meta">Edited ${esc(fmtDate(d.updatedAt))}${open ? " · open below" : ""}</div>
          </div>
          <div class="design-actions">
            <button class="btn sm" type="button" data-act="open">${d.status === "published" ? "View / copy" : "Edit"}</button>
            ${d.status === "published" ? "" : `<button class="btn sm" type="button" data-act="publish">Publish</button>`}
            ${d.status === "published" ? "" : `<button class="btn sm btn-danger" type="button" data-act="delete">Delete</button>`}
          </div>
        </div>`;
    }).join("");
  }

  $("designs-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-act]");
    const row = event.target.closest(".design-row");
    if (!button || !row) return;
    const design = state.designs.find((d) => d.id === row.dataset.id);
    if (!design) return;
    const act = button.dataset.act;
    try {
      if (act === "open") {
        if (!confirmDiscard()) return;
        await openDesign(design.id);
      } else if (act === "publish") {
        await publishDesign(design);
      } else if (act === "delete") {
        if (!window.confirm(`Delete "${design.name}"? This cannot be undone.`)) return;
        await api(`/api/admin/sticker-designs/${design.id}`, { method: "DELETE" });
        if (state.meta?.id === design.id) closeEditor(true);
        await loadDesigns();
        setPageStatus(`Deleted "${design.name}".`);
      }
    } catch (error) {
      setPageStatus(error.message, "error");
    }
  });

  document.querySelectorAll("[data-new]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirmDiscard()) return;
      button.disabled = true;
      try {
        await newDesign(button.dataset.new);
      } catch (error) {
        setPageStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  $("unpublish-button").addEventListener("click", async () => {
    if (!window.confirm("Go back to the original artwork? Print runs from now on will use it. The live design stays in the list as Retired.")) return;
    try {
      await api("/api/admin/sticker-designs/unpublish", { method: "POST" });
      await loadDesigns();
      if (state.meta) updateEditorState();
      setPageStatus("Print runs use the original artwork again.");
    } catch (error) {
      setPageStatus(error.message, "error");
    }
  });

  async function publishDesign(design) {
    const live = state.designs.find((d) => d.status === "published");
    const message = live
      ? `Publish "${design.name}"? Every sticker exported from now on prints with it, instead of "${live.name}". Stickers already printed are not affected.`
      : `Publish "${design.name}"? Every sticker exported from now on prints with it, instead of the original artwork. Stickers already printed are not affected.`;
    if (!window.confirm(message)) return false;
    await api(`/api/admin/sticker-designs/${design.id}/publish`, { method: "POST" });
    await loadDesigns();
    if (state.meta?.id === design.id) {
      state.meta.status = "published";
      updateEditorState();
    }
    setPageStatus(`"${design.name}" is live. The next Print Queue export uses it.`);
    return true;
  }

  // ── Canvas setup ────────────────────────────────────────────────────────

  function ensureCanvas() {
    if (canvas) return canvas;
    canvas = new fabric.Canvas("sticker-canvas", {
      width: W,
      height: H,
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selectionColor: "rgba(255, 39, 0, 0.08)",
      selectionBorderColor: "#FF2700"
    });
    fabric.InteractiveFabricObject.ownDefaults.cornerColor = "#FF2700";
    fabric.InteractiveFabricObject.ownDefaults.cornerStrokeColor = "#ffffff";
    fabric.InteractiveFabricObject.ownDefaults.borderColor = "#FF2700";
    fabric.InteractiveFabricObject.ownDefaults.transparentCorners = false;
    fabric.InteractiveFabricObject.ownDefaults.cornerSize = 12;

    canvas.on("object:moving", ({ target }) => keepInside(target));
    canvas.on("object:scaling", ({ target }) => {
      if (target.ptRole === "qr") constrainQr(target);
      renderProps();
    });
    canvas.on("object:modified", () => changed());
    canvas.on("text:changed", () => changed());
    canvas.on("selection:created", () => { renderLayers(); renderProps(); });
    canvas.on("selection:updated", () => { renderLayers(); renderProps(); });
    canvas.on("selection:cleared", () => { renderLayers(); renderProps(); });
    canvas.on("object:moving", () => renderProps());

    window.addEventListener("resize", fitCanvas);
    return canvas;
  }

  // Shown smaller on screen; the document stays 1000 x 600 so positions are
  // in sticker units. Fabric maps the pointer through the CSS scale.
  function fitCanvas() {
    if (!canvas) return;
    const stage = $("stage");
    const available = Math.max(240, stage.clientWidth - 34);
    const cssWidth = Math.min(W, available);
    canvas.setDimensions({ width: `${cssWidth}px`, height: `${Math.round((cssWidth * H) / W)}px` }, { cssOnly: true });
    canvas.calcOffset();
  }

  function roleOf(obj) {
    return obj?.ptRole || null;
  }

  function findRole(role) {
    return canvas.getObjects().find((o) => o.ptRole === role) || null;
  }

  // The placeholders are what the print run replaces per tag. They stay square
  // (QR) or one line (serial), unrotated, inside the sticker, and on top: the
  // print overlays them above the artwork, so a layer above them on the canvas
  // would be hidden under them on paper anyway.
  function configurePlaceholder(obj) {
    const common = {
      lockRotation: true,
      lockSkewingX: true,
      lockSkewingY: true,
      lockScalingFlip: true,
      originX: "left",
      originY: "top",
      angle: 0,
      skewX: 0,
      skewY: 0,
      flipX: false,
      flipY: false
    };
    if (obj.ptRole === "qr") {
      obj.set({ ...common, ptName: "QR code", ptLocked: false, selectable: true, evented: true, borderColor: "#FF2700", borderScaleFactor: 2 });
      obj.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, mtr: false });
    } else if (obj.ptRole === "serial") {
      obj.set({ ...common, ptName: "Serial number", ptLocked: false, selectable: true, evented: true, editable: false, lockScalingX: true, lockScalingY: true, scaleX: 1, scaleY: 1, text: SAMPLE_SERIAL });
      obj.setControlsVisibility({ tl: false, tr: false, bl: false, br: false, mt: false, mb: false, mtr: false, ml: true, mr: true });
    }
  }

  function applyLock(obj) {
    const locked = Boolean(obj.ptLocked);
    obj.set({ selectable: !locked, evented: !locked });
  }

  async function makeQrPlaceholder(layout) {
    const img = await fabric.FabricImage.fromURL(SAMPLE_QR_URL);
    const scale = layout.qr.size / img.width;
    img.set({ ptRole: "qr", left: layout.qr.x, top: layout.qr.y, scaleX: scale, scaleY: scale });
    configurePlaceholder(img);
    return img;
  }

  function makeSerialPlaceholder(layout) {
    const s = layout.serial;
    const text = new fabric.Textbox(SAMPLE_SERIAL, {
      ptRole: "serial",
      left: s.x,
      top: s.y,
      width: s.width,
      fontSize: s.fontSize,
      fill: s.fill,
      fontFamily: s.fontFamily,
      textAlign: s.align,
      charSpacing: 60,
      visible: s.visible !== false
    });
    configurePlaceholder(text);
    return text;
  }

  async function ensurePlaceholders(layout = state.limits.defaultLayout) {
    if (!findRole("qr")) canvas.add(await makeQrPlaceholder(layout));
    if (!findRole("serial")) canvas.add(makeSerialPlaceholder(layout));
    keepPlaceholdersOnTop();
  }

  function keepPlaceholdersOnTop() {
    const qr = findRole("qr");
    const serial = findRole("serial");
    if (qr) canvas.bringObjectToFront(qr);
    if (serial) canvas.bringObjectToFront(serial);
  }

  function constrainQr(obj) {
    const min = state.limits.qrMinSize;
    let size = Math.max(obj.getScaledWidth(), obj.getScaledHeight());
    size = Math.min(Math.max(size, min), W, H);
    const scale = size / obj.width;
    obj.set({ scaleX: scale, scaleY: scale });
    keepInside(obj);
  }

  function keepInside(obj) {
    if (obj.ptRole !== "qr" && obj.ptRole !== "serial") return;
    const width = obj.getScaledWidth();
    const height = obj.getScaledHeight();
    obj.set({
      left: Math.min(Math.max(obj.left, 0), Math.max(0, W - width)),
      top: Math.min(Math.max(obj.top, 0), Math.max(0, H - height))
    });
    obj.setCoords();
  }

  // ── History ─────────────────────────────────────────────────────────────

  function snapshot() {
    return JSON.stringify(canvas.toObject(EXTRA_PROPS));
  }

  function resetHistory() {
    state.history = [snapshot()];
    state.future = [];
    updateUndoButtons();
  }

  function changed() {
    if (state.restoring || !canvas) return;
    keepPlaceholdersOnTop();
    state.history.push(snapshot());
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.future = [];
    markDirty(true);
    updateUndoButtons();
    renderLayers();
    renderProps();
  }

  async function restore(json) {
    state.restoring = true;
    try {
      canvas.discardActiveObject();
      await canvas.loadFromJSON(json);
      canvas.getObjects().forEach((obj) => {
        if (obj.ptRole) configurePlaceholder(obj);
        applyLock(obj);
      });
      canvas.requestRenderAll();
    } finally {
      state.restoring = false;
    }
    $("bg-color").value = toHex(canvas.backgroundColor) || "#ffffff";
    renderLayers();
    renderProps();
  }

  async function undo() {
    if (state.history.length < 2) return;
    state.future.push(state.history.pop());
    await restore(state.history[state.history.length - 1]);
    markDirty(true);
    updateUndoButtons();
  }

  async function redo() {
    if (!state.future.length) return;
    const next = state.future.pop();
    state.history.push(next);
    await restore(next);
    markDirty(true);
    updateUndoButtons();
  }

  function updateUndoButtons() {
    $("undo-button").disabled = state.history.length < 2;
    $("redo-button").disabled = !state.future.length;
  }

  function markDirty(dirty) {
    state.dirty = dirty;
    updateEditorState();
  }

  // ── Opening designs ─────────────────────────────────────────────────────

  async function startEditor(meta, build) {
    ensureCanvas();
    $("editor").hidden = false;
    fitCanvas();
    state.meta = meta;
    state.restoring = true;
    try {
      canvas.discardActiveObject();
      canvas.clear();
      canvas.backgroundColor = "#ffffff";
      await build();
      await ensurePlaceholders();
      canvas.getObjects().forEach(applyLock);
      canvas.requestRenderAll();
    } finally {
      state.restoring = false;
    }
    $("design-name").value = meta.name;
    $("bg-color").value = toHex(canvas.backgroundColor) || "#ffffff";
    resetHistory();
    markDirty(!meta.id);
    renderDesigns();
    renderLayers();
    renderProps();
    setEditorStatus(meta.status === "published"
      ? "This is the live design. Changes are saved as a copy, which you then publish."
      : "");
    $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadIntoCanvas(canvasJson) {
    await canvas.loadFromJSON(JSON.parse(canvasJson));
    canvas.getObjects().forEach((obj) => {
      if (obj.ptRole) configurePlaceholder(obj);
    });
  }

  async function openDesign(id) {
    const { design } = await api(`/api/admin/sticker-designs/${id}`);
    await startEditor({ id: design.id, name: design.name, status: design.status }, () => loadIntoCanvas(design.canvasJson));
  }

  async function fetchOriginalSvg() {
    const res = await fetch(state.limits.defaultArtworkUrl, { credentials: "same-origin" });
    if (!res.ok) throw new Error("Could not load the original artwork.");
    return res.text();
  }

  async function newDesign(kind) {
    const stamp = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
    if (kind === "live") {
      const liveId = state.current?.designId;
      if (liveId) {
        const { design } = await api(`/api/admin/sticker-designs/${liveId}`);
        await startEditor({ id: null, name: `Copy of ${design.name}`.slice(0, 80), status: "draft" }, () => loadIntoCanvas(design.canvasJson));
        return;
      }
      kind = "original";
    }
    if (kind === "blank") {
      await startEditor({ id: null, name: `New sticker ${stamp}`, status: "draft" }, async () => {});
      return;
    }
    const svg = await fetchOriginalSvg();
    const asLayers = kind === "original-layers";
    await startEditor({ id: null, name: `Sticker ${stamp}`, status: "draft" }, async () => {
      await addSvg(svg, { asLayers, name: "Original artwork", fill: true, lock: !asLayers });
    });
  }

  // ── Adding layers ───────────────────────────────────────────────────────

  function nameFor(obj) {
    if (obj.ptName) return obj.ptName;
    if (obj.type === "i-text" || obj.type === "textbox" || obj.type === "text") {
      const text = String(obj.text || "").replace(/\s+/g, " ").trim();
      return `Text: ${text.slice(0, 24) || "(empty)"}`;
    }
    return ({ rect: "Rectangle", circle: "Circle", ellipse: "Ellipse", line: "Line", image: "Image", group: "Group", path: "Shape", polygon: "Shape", polyline: "Shape", triangle: "Triangle" })[obj.type] || "Layer";
  }

  function addAndSelect(obj, { center = true } = {}) {
    if (center) {
      canvas.centerObject(obj);
    }
    canvas.add(obj);
    keepPlaceholdersOnTop();
    canvas.setActiveObject(obj);
    obj.setCoords();
    canvas.requestRenderAll();
    changed();
  }

  function addShape(kind) {
    let obj;
    if (kind === "text") {
      obj = new fabric.IText("Your text", { fontFamily: "Arial", fontSize: 56, fontWeight: "bold", fill: "#03162D" });
    } else if (kind === "rect") {
      obj = new fabric.Rect({ width: 280, height: 120, fill: "#FF2700", rx: 0, ry: 0 });
    } else if (kind === "circle") {
      obj = new fabric.Circle({ radius: 70, fill: "#03162D" });
    } else if (kind === "line") {
      obj = new fabric.Line([0, 0, 320, 0], { stroke: "#03162D", strokeWidth: 6, strokeLineCap: "round" });
    }
    if (obj) addAndSelect(obj);
  }

  // SVGs are parsed into vector layers rather than embedded as a picture, so
  // they stay sharp at any print size. One layer (a group) unless asked to
  // split, when each shape becomes its own layer.
  async function addSvg(svgText, { asLayers, name, fill = false, lock = false }) {
    const { objects, options } = await fabric.loadSVGFromString(svgText);
    const parts = objects.filter(Boolean);
    if (!parts.length) throw new Error("That SVG has nothing Fabric can draw.");
    // Built at the file's own coordinates: the group keeps every shape where
    // the SVG put it. Its measured size is no guide to the artwork's box,
    // because shapes a clip-path trims still count towards it.
    const group = new fabric.Group(parts);
    if (fill) {
      // Map the file's viewBox onto the sticker box, scaling about (0, 0) so
      // positions scale with the shapes.
      const boxWidth = options.viewBoxWidth || options.width || W;
      const boxHeight = options.viewBoxHeight || options.height || H;
      const sx = W / boxWidth;
      const sy = H / boxHeight;
      group.set({ scaleX: sx, scaleY: sy, left: group.left * sx, top: group.top * sy });
    } else {
      const scale = Math.min(1, (W * 0.6) / group.width, (H * 0.6) / group.height);
      group.set({ scaleX: scale, scaleY: scale });
      canvas.centerObject(group);
    }
    group.setCoords();

    if (asLayers && group.type === "group") {
      const items = group.removeAll();
      items.forEach((item) => canvas.add(item));
    } else {
      group.set({ ptName: name, ptLocked: lock });
      applyLock(group);
      canvas.add(group);
    }
    keepPlaceholdersOnTop();
  }

  function readFile(file, as) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read that file."));
      if (as === "text") reader.readAsText(file);
      else reader.readAsDataURL(file);
    });
  }

  // Very large photos are scaled down: 2400px across a 105mm sticker is still
  // about 580 dpi, and every byte of the image is stored twice with the design.
  async function shrinkRaster(dataUrl, type) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (longest <= MAX_RASTER_EDGE) return dataUrl;
    const k = MAX_RASTER_EDGE / longest;
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(type === "image/jpeg" ? "image/jpeg" : "image/png", 0.92);
  }

  $("image-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canvas) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setEditorStatus("That file is over 5 MB. Use a smaller image.", "error");
      return;
    }
    try {
      const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
      if (isSvg) {
        state.restoring = true;
        try {
          await addSvg(await readFile(file, "text"), { asLayers: $("svg-layers").checked, name: file.name.replace(/\.svg$/i, "").slice(0, 40) || "SVG" });
        } finally {
          state.restoring = false;
        }
        canvas.requestRenderAll();
        changed();
      } else {
        const dataUrl = await shrinkRaster(await readFile(file, "dataurl"), file.type);
        const img = await fabric.FabricImage.fromURL(dataUrl);
        const scale = Math.min(1, (W * 0.6) / img.width, (H * 0.6) / img.height);
        img.set({ scaleX: scale, scaleY: scale, ptName: file.name.slice(0, 40) });
        addAndSelect(img);
      }
      setEditorStatus(`Added ${file.name}.`);
    } catch (error) {
      setEditorStatus(error.message || "Could not add that file.", "error");
    }
  });

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => addShape(button.dataset.add));
  });

  $("bg-color").addEventListener("input", (event) => {
    canvas.backgroundColor = event.target.value;
    canvas.requestRenderAll();
  });
  $("bg-color").addEventListener("change", () => changed());

  // ── Layers panel ────────────────────────────────────────────────────────

  const ICONS = {
    eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>',
    eyeOff: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    lock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2"/></svg>',
    unlock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="m6 15 6-6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  // A dot of the layer's colour: split artwork is mostly "Shape" layers, and
  // the colour is what tells them apart.
  function swatch(obj) {
    if (obj.ptRole || isText(obj) || obj.type === "image" || obj.type === "group") return "";
    const hex = toHex(obj.fill) || toHex(obj.stroke);
    return hex ? `<span class="swatch" style="background:${hex}"></span>` : "";
  }

  function renderLayers() {
    if (!canvas) return;
    const objects = canvas.getObjects();
    const active = new Set(canvas.getActiveObjects());
    $("layers").innerHTML = objects.map((obj, index) => ({ obj, index })).reverse().map(({ obj, index }) => {
      const role = roleOf(obj);
      const pinned = role === "qr" || role === "serial";
      const classes = ["layer", active.has(obj) ? "is-active" : "", obj.visible === false ? "is-hidden" : ""].join(" ");
      return `
        <li class="${classes}" data-index="${index}" title="${pinned ? "Placeholder filled per sticker. Always on top." : "Double-click to rename"}">
          <button type="button" data-act="vis" aria-label="${obj.visible === false ? "Show" : "Hide"} layer" aria-pressed="${obj.visible !== false}" ${role === "qr" ? "disabled" : ""}>${obj.visible === false ? ICONS.eyeOff : ICONS.eye}</button>
          <button type="button" data-act="lock" aria-label="${obj.ptLocked ? "Unlock" : "Lock"} layer" aria-pressed="${Boolean(obj.ptLocked)}" ${pinned ? "disabled" : ""}>${obj.ptLocked ? ICONS.lock : ICONS.unlock}</button>
          <span class="layer-name">${swatch(obj)}${esc(nameFor(obj))}${pinned ? '<span class="pin">PER TAG</span>' : ""}</span>
          <span class="layer-tools">
            <button type="button" data-act="up" aria-label="Move layer up" ${pinned ? "disabled" : ""}>${ICONS.up}</button>
            <button type="button" data-act="down" aria-label="Move layer down" ${pinned ? "disabled" : ""}>${ICONS.down}</button>
            <button type="button" data-act="del" aria-label="Delete layer" ${pinned ? "disabled" : ""}>${ICONS.del}</button>
          </span>
        </li>`;
    }).join("");
  }

  $("layers").addEventListener("click", (event) => {
    const row = event.target.closest(".layer");
    if (!row || !canvas) return;
    const obj = canvas.getObjects()[Number(row.dataset.index)];
    if (!obj) return;
    const act = event.target.closest("button[data-act]")?.dataset.act;
    if (act === "vis") {
      obj.set("visible", obj.visible === false);
      if (obj.visible === false && canvas.getActiveObject() === obj) canvas.discardActiveObject();
      canvas.requestRenderAll();
      changed();
    } else if (act === "lock") {
      obj.set("ptLocked", !obj.ptLocked);
      applyLock(obj);
      if (obj.ptLocked && canvas.getActiveObject() === obj) canvas.discardActiveObject();
      canvas.requestRenderAll();
      changed();
    } else if (act === "up") {
      canvas.bringObjectForward(obj);
      changed();
    } else if (act === "down") {
      canvas.sendObjectBackwards(obj);
      changed();
    } else if (act === "del") {
      removeObjects([obj]);
    } else if (!obj.ptLocked && obj.visible !== false) {
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      renderLayers();
      renderProps();
    } else {
      setEditorStatus(obj.ptLocked ? "That layer is locked. Unlock it to select it." : "That layer is hidden. Show it to select it.");
    }
  });

  $("layers").addEventListener("dblclick", (event) => {
    const row = event.target.closest(".layer");
    if (!row || event.target.closest("button")) return;
    const obj = canvas.getObjects()[Number(row.dataset.index)];
    if (!obj || obj.ptRole) return;
    const name = window.prompt("Layer name", nameFor(obj));
    if (name === null) return;
    obj.set("ptName", name.trim().slice(0, 60) || undefined);
    changed();
  });

  function removeObjects(objects) {
    const removable = objects.filter((o) => !o.ptRole);
    if (!removable.length) {
      setEditorStatus("The QR code and serial cannot be deleted: every sticker needs them. Hide the serial instead if you do not want it printed.");
      return;
    }
    canvas.discardActiveObject();
    canvas.remove(...removable);
    canvas.requestRenderAll();
    changed();
  }

  // ── Properties panel ────────────────────────────────────────────────────

  function toHex(color) {
    if (typeof color !== "string" || !color) return null;
    try {
      return `#${new fabric.Color(color).toHex().slice(0, 6)}`.toLowerCase();
    } catch {
      return null;
    }
  }

  function num(value, digits = 0) {
    const k = 10 ** digits;
    return Math.round(Number(value) * k) / k;
  }

  function field(label, input) {
    return `<label class="field">${esc(label)}${input}</label>`;
  }

  function numberInput(prop, value, { min, max, step = 1 } = {}) {
    return `<input type="number" data-prop="${prop}" value="${esc(value)}" step="${step}"${min !== undefined ? ` min="${min}"` : ""}${max !== undefined ? ` max="${max}"` : ""} />`;
  }

  function colorInput(prop, value) {
    const hex = toHex(value);
    return hex ? `<input type="color" data-prop="${prop}" value="${hex}" />` : `<input type="text" value="Gradient or pattern" disabled />`;
  }

  function fontSelect(value) {
    const fonts = state.limits.fonts;
    const current = fonts.includes(value) ? value : null;
    return `<select data-prop="fontFamily">${current ? "" : `<option selected>${esc(value)} (not print-safe)</option>`}${fonts.map((f) => `<option value="${esc(f)}"${f === current ? " selected" : ""}>${esc(f)}</option>`).join("")}</select>`;
  }

  function isText(obj) {
    return obj.type === "i-text" || obj.type === "textbox" || obj.type === "text";
  }

  function renderProps() {
    const el = $("props");
    if (!canvas) return;
    const objects = canvas.getActiveObjects();
    if (!objects.length) {
      el.innerHTML = `<p class="muted small">Select a layer to edit it.</p>`;
      return;
    }
    if (objects.length > 1) {
      el.innerHTML = `
        <p class="note">${objects.length} layers selected.</p>
        <div class="btns">
          <button class="btn sm" type="button" data-cmd="center-h">Centre across</button>
          <button class="btn sm" type="button" data-cmd="center-v">Centre down</button>
          <button class="btn sm btn-danger" type="button" data-cmd="delete">Delete</button>
        </div>`;
      return;
    }
    const obj = objects[0];
    const role = roleOf(obj);
    const x = num(obj.left, 1);
    const y = num(obj.top, 1);
    const w = num(obj.getScaledWidth(), 1);
    const h = num(obj.getScaledHeight(), 1);
    let html = "";

    if (role === "qr") {
      const mm = num(w * MM_PER_UNIT, 1);
      html += `<p class="note">Each sticker prints its own QR code here. Kept square, unrotated and inside the sticker.</p>`;
      html += `<div class="row2">${field("X", numberInput("left", x))}${field("Y", numberInput("top", y))}</div>`;
      html += field(`Size (${mm} mm)`, numberInput("qrSize", w, { min: state.limits.qrMinSize, max: H }));
      if (w < 220) html += `<p class="warn">Under about 23 mm the code gets harder to scan through a windscreen. Keep it large, with a light background right around it.</p>`;
    } else if (role === "serial") {
      html += `<p class="note">Each sticker prints its own serial here (sample shown).</p>`;
      html += `<div class="row2">${field("X", numberInput("left", x))}${field("Y", numberInput("top", y))}</div>`;
      html += `<div class="row2">${field("Box width", numberInput("width", num(obj.width, 1), { min: 20, max: W }))}${field("Size", numberInput("fontSize", obj.fontSize, { min: 6, max: 80 }))}</div>`;
      html += `<div class="row2">${field("Colour", colorInput("fill", obj.fill))}${field("Align", alignSelect(obj.textAlign))}</div>`;
      html += field("Font", fontSelect(obj.fontFamily));
    } else {
      html += `<div class="row2">${field("X", numberInput("left", x))}${field("Y", numberInput("top", y))}</div>`;
      html += `<div class="row2">${field("Width", numberInput("scaledWidth", w, { min: 1 }))}${field("Height", numberInput("scaledHeight", h, { min: 1 }))}</div>`;
      html += `<div class="row2">${field("Rotation", numberInput("angle", num(obj.angle, 1), { min: -360, max: 360 }))}${field("Opacity %", numberInput("opacityPct", num((obj.opacity ?? 1) * 100), { min: 0, max: 100 }))}</div>`;
      if (isText(obj)) {
        html += field("Font", fontSelect(obj.fontFamily));
        html += `<div class="row2">${field("Size", numberInput("fontSize", obj.fontSize, { min: 4, max: 400 }))}${field("Colour", colorInput("fill", obj.fill))}</div>`;
        html += `<div class="row2">${field("Align", alignSelect(obj.textAlign))}${field("Line height", numberInput("lineHeight", num(obj.lineHeight, 2), { min: 0.5, max: 3, step: 0.05 }))}</div>`;
        html += `<div class="btns">
          <button class="btn sm" type="button" data-cmd="bold" aria-pressed="${obj.fontWeight === "bold" || Number(obj.fontWeight) >= 600}"><b>B</b></button>
          <button class="btn sm" type="button" data-cmd="italic" aria-pressed="${obj.fontStyle === "italic"}"><i>I</i></button>
          <button class="btn sm" type="button" data-cmd="underline" aria-pressed="${Boolean(obj.underline)}"><u>U</u></button>
        </div>`;
      } else if (obj.type !== "image" && obj.type !== "group") {
        html += `<div class="row2">${field("Fill", colorInput("fill", obj.fill))}${field("Outline", colorInput("stroke", obj.stroke || "#000000"))}</div>`;
        html += field("Outline width", numberInput("strokeWidth", obj.strokeWidth || 0, { min: 0, max: 100 }));
        if (obj.type === "rect") html += field("Corner radius", numberInput("radius", obj.rx || 0, { min: 0, max: 300 }));
      }
      html += `<div class="btns">
        <button class="btn sm" type="button" data-cmd="duplicate">Duplicate</button>
        <button class="btn sm" type="button" data-cmd="center-h">Centre across</button>
        <button class="btn sm" type="button" data-cmd="center-v">Centre down</button>
        <button class="btn sm" type="button" data-cmd="front">To front</button>
        <button class="btn sm" type="button" data-cmd="back">To back</button>
        ${obj.type === "group" ? '<button class="btn sm" type="button" data-cmd="ungroup">Split into layers</button>' : ""}
        <button class="btn sm btn-danger" type="button" data-cmd="delete">Delete</button>
      </div>`;
    }
    el.innerHTML = html;
  }

  function alignSelect(value) {
    return `<select data-prop="textAlign">${["left", "center", "right"].map((a) => `<option value="${a}"${a === value ? " selected" : ""}>${a[0].toUpperCase()}${a.slice(1)}</option>`).join("")}</select>`;
  }

  function applyProp(obj, prop, raw) {
    const value = typeof raw === "string" && raw !== "" && !Number.isNaN(Number(raw)) && prop !== "fill" && prop !== "stroke" && prop !== "fontFamily" && prop !== "textAlign" ? Number(raw) : raw;
    switch (prop) {
      case "qrSize": {
        const size = Math.min(Math.max(Number(value) || 0, state.limits.qrMinSize), H);
        obj.set({ scaleX: size / obj.width, scaleY: size / obj.height });
        break;
      }
      case "scaledWidth":
        if (value > 0) obj.set("scaleX", value / obj.width);
        break;
      case "scaledHeight":
        if (value > 0) obj.set("scaleY", value / obj.height);
        break;
      case "opacityPct":
        obj.set("opacity", Math.min(Math.max(Number(value) || 0, 0), 100) / 100);
        break;
      case "radius":
        obj.set({ rx: Number(value) || 0, ry: Number(value) || 0 });
        break;
      default:
        if (value === "" || (typeof value === "number" && !Number.isFinite(value))) return;
        obj.set(prop, value);
    }
    if (obj.ptRole) keepInside(obj);
    obj.setCoords();
    canvas.requestRenderAll();
  }

  $("props").addEventListener("input", (event) => {
    const input = event.target.closest("[data-prop]");
    const obj = canvas?.getActiveObject();
    if (!input || !obj || obj.type === "activeselection") return;
    applyProp(obj, input.dataset.prop, input.value);
  });
  $("props").addEventListener("change", (event) => {
    if (event.target.closest("[data-prop]")) {
      changed();
    }
  });

  $("props").addEventListener("click", async (event) => {
    const cmd = event.target.closest("button[data-cmd]")?.dataset.cmd;
    const obj = canvas?.getActiveObject();
    if (!cmd || !obj) return;
    if (cmd === "delete") {
      removeObjects(canvas.getActiveObjects());
      return;
    }
    if (cmd === "center-h") canvas.centerObjectH(obj);
    else if (cmd === "center-v") canvas.centerObjectV(obj);
    else if (cmd === "front") canvas.bringObjectToFront(obj);
    else if (cmd === "back") canvas.sendObjectToBack(obj);
    else if (cmd === "bold") obj.set("fontWeight", obj.fontWeight === "bold" || Number(obj.fontWeight) >= 600 ? "normal" : "bold");
    else if (cmd === "italic") obj.set("fontStyle", obj.fontStyle === "italic" ? "normal" : "italic");
    else if (cmd === "underline") obj.set("underline", !obj.underline);
    else if (cmd === "duplicate") {
      await duplicate(obj);
      return;
    } else if (cmd === "ungroup" && obj.type === "group") {
      const index = canvas.getObjects().indexOf(obj);
      canvas.discardActiveObject();
      const items = obj.removeAll();
      canvas.remove(obj);
      items.forEach((item, i) => canvas.insertAt(index + i, item));
    }
    obj.setCoords?.();
    canvas.requestRenderAll();
    changed();
  });

  async function duplicate(obj) {
    if (obj.ptRole) return;
    const copy = await obj.clone(EXTRA_PROPS);
    copy.set({ left: obj.left + 20, top: obj.top + 20 });
    addAndSelect(copy, { center: false });
  }

  // ── Keyboard ────────────────────────────────────────────────────────────

  document.addEventListener("keydown", async (event) => {
    if (!canvas || $("editor").hidden || !$("preview-modal").hidden) return;
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const active = canvas.getActiveObject();
    if (active?.isEditing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) await redo();
      else await undo();
    } else if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      await redo();
    } else if (mod && event.key.toLowerCase() === "d" && active) {
      event.preventDefault();
      await duplicate(active);
    } else if ((event.key === "Delete" || event.key === "Backspace") && active) {
      event.preventDefault();
      removeObjects(canvas.getActiveObjects());
    } else if (active && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      active.set({ left: active.left + dx, top: active.top + dy });
      if (active.ptRole) keepInside(active);
      active.setCoords();
      canvas.requestRenderAll();
      changed();
    }
  });

  $("undo-button").addEventListener("click", undo);
  $("redo-button").addEventListener("click", redo);

  // ── Save, publish, preview ──────────────────────────────────────────────

  function collect() {
    canvas.discardActiveObject();
    const qr = findRole("qr");
    const serial = findRole("serial");
    const layout = {
      qr: { x: qr.left, y: qr.top, size: qr.getScaledWidth() },
      serial: {
        x: serial.left,
        y: serial.top,
        width: serial.width * serial.scaleX,
        fontSize: serial.fontSize,
        fill: toHex(serial.fill) || "#000000",
        fontFamily: serial.fontFamily,
        align: serial.textAlign,
        visible: serial.visible !== false
      }
    };
    const canvasJson = snapshot();
    // The artwork is everything except the two placeholders, which the print
    // run draws per tag on top of it.
    qr.excludeFromExport = true;
    serial.excludeFromExport = true;
    let artworkSvg;
    try {
      artworkSvg = canvas.toSVG({ suppressPreamble: true, width: String(W), height: String(H), viewBox: { x: 0, y: 0, width: W, height: H } });
    } finally {
      qr.excludeFromExport = false;
      serial.excludeFromExport = false;
    }
    return { name: $("design-name").value.trim(), canvasJson, artworkSvg, layout };
  }

  async function save({ asCopy = false } = {}) {
    if (state.busy || !canvas) return null;
    const body = collect();
    if (!body.name) {
      setEditorStatus("Give the design a name first.", "error");
      $("design-name").focus();
      return null;
    }
    const creating = asCopy || !state.meta.id || state.meta.status === "published";
    if (creating && state.meta.id && (asCopy || state.meta.status === "published") && body.name === state.meta.name) {
      body.name = `Copy of ${body.name}`.slice(0, 80);
      $("design-name").value = body.name;
    }
    state.busy = true;
    setEditorStatus("Saving…");
    try {
      const { design } = creating
        ? await api("/api/admin/sticker-designs", { method: "POST", body })
        : await api(`/api/admin/sticker-designs/${state.meta.id}`, { method: "PUT", body });
      state.meta = { id: design.id, name: design.name, status: design.status };
      markDirty(false);
      await loadDesigns();
      setEditorStatus(creating ? `Saved as a new draft, "${design.name}".` : "Saved.", "ok");
      return design;
    } catch (error) {
      setEditorStatus(error.message, "error");
      return null;
    } finally {
      state.busy = false;
    }
  }

  $("save-button").addEventListener("click", () => save());
  $("save-copy-button").addEventListener("click", () => save({ asCopy: true }));

  $("publish-button").addEventListener("click", async () => {
    let design = state.meta;
    if (state.dirty || !design.id || design.status === "published") {
      if (design.status === "published" && !state.dirty) {
        setEditorStatus("This design is already live.");
        return;
      }
      design = await save();
      if (!design) return;
    }
    try {
      await publishDesign({ id: design.id, name: design.name });
    } catch (error) {
      setEditorStatus(error.message, "error");
    }
  });

  $("preview-button").addEventListener("click", async () => {
    let id = state.meta.id;
    if (state.dirty || !id) {
      const design = await save();
      if (!design) return;
      id = design.id;
    }
    try {
      const { design } = await api(`/api/admin/sticker-designs/${id}`);
      const box = $("preview-sticker");
      box.innerHTML = `
        <img class="bg" src="${esc(design.print.artworkUrl)}" alt="Sticker artwork" />
        <img class="qr" style="${esc(design.print.styles.qr)}" src="${SAMPLE_QR_URL}" alt="Sample QR" />
        <div style="${esc(design.print.styles.serial)}">${SAMPLE_SERIAL}</div>`;
      $("preview-modal").hidden = false;
      $("preview-close").focus();
    } catch (error) {
      setEditorStatus(error.message, "error");
    }
  });

  function closePreview() {
    $("preview-modal").hidden = true;
    $("preview-button").focus();
  }
  $("preview-close").addEventListener("click", closePreview);
  $("preview-modal").addEventListener("click", (event) => {
    if (event.target === $("preview-modal")) closePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("preview-modal").hidden) closePreview();
  });

  function confirmDiscard() {
    return !state.dirty || !state.meta || window.confirm("Discard the unsaved changes to this design?");
  }

  function closeEditor(force = false) {
    if (!force && !confirmDiscard()) return;
    state.meta = null;
    markDirty(false);
    $("editor").hidden = true;
    setEditorStatus("");
    renderDesigns();
  }

  $("close-button").addEventListener("click", () => closeEditor());
  $("design-name").addEventListener("input", () => markDirty(true));

  function updateEditorState() {
    if (!state.meta) return;
    const live = state.meta.status === "published";
    const label = !state.meta.id ? "New, not saved" : live ? "Live" : state.meta.status === "retired" ? "Retired" : "Draft";
    $("design-state").textContent = `${label}${state.dirty && state.meta.id ? " · unsaved changes" : ""}`;
    $("save-button").disabled = live && !state.dirty;
    $("save-button").textContent = live ? "Save as new draft" : "Save";
    $("save-copy-button").hidden = !state.meta.id || live;
    $("publish-button").disabled = live && !state.dirty;
    $("publish-button").textContent = live && !state.dirty ? "Live" : "Publish";
  }

  window.addEventListener("beforeunload", (event) => {
    if (state.dirty && state.meta) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  loadDesigns().catch((error) => setPageStatus(error.message, "error"));
})();
