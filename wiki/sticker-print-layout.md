# Sticker print / PDF export — how it works & how to edit it

This documents the admin **Print Queue → Export QRs → Print / Save PDF**
feature: what it does today and exactly where to change each part.

---

## What it does today

- On **Admin → Print Queue**, tick the tags you want, then click **Export QRs**.
- An overlay opens showing a **print sheet** of the selected stickers.
- Click **Print / Save PDF** to send to a printer or "Save as PDF".

Current behaviour:

| Behaviour | Detail |
|-----------|--------|
| **Selection required** | Clicking Export with nothing ticked does **not** export the whole queue — it shows *"Select the tag(s) you want to export first."* |
| **Sticker only** | Each sticker is just the two-panel card (white panel + red QR panel). No instruction / how-to text is printed. |
| **One per page** | Each sticker gets its own **portrait A4** page, centred, printed at its real **105mm × 63mm** die-cut size so it can be cut out and used as is. One `.pt-sheet` = one page. |
| **Page reference** | The overlay header shows e.g. *"9 tags to print"* — with one sticker per page that is also the page count. |

---

## Where the code lives

| Piece | File | Symbol / selector |
|-------|------|-------------------|
| Print + sticker CSS | `src/frontend/pages/admin/print-queue.html` | the `<style>` block, esp. `#qr-export-grid .pt-*` and `@media print` |
| Export overlay markup (Print/Close buttons) | same file | `#qr-export-overlay` |
| Export logic (selection, page estimate, dividers) | `src/frontend/scripts/admin/index.js` | `exportQrsForPrint()` |
| One sticker's HTML | same JS | `etagPrintPageHtml(tag)` |
| QR image resolution | `src/backend/lib/core/qr-output.js` | `createPrintQrDataUrl()` |

The sticker DOM for each tag:

```
.pt-page                         ← flow item (packs onto the page)
 └── .pt-wrap
      └── .pt-cut                 ← dashed cut border; kept whole (never split)
           └── .pt-sticker
                ├── .pt-left      ← white panel: logo, headline, tag id
                └── .pt-right     ← red panel: QR (.pt-qr), brand, icons
```

---

## Common edits

### 1. Fit MORE or FEWER stickers per page

Stickers pack by natural flow — the number per page is driven by the sticker's
**size** and the **gap** between them. In `print-queue.html`, inside `@media print`:

```css
#qr-export-grid .pt-page { margin: 0 0 8mm !important; ... }   /* gap between stickers */
```

- **More per page** → make the sticker smaller (see edit #2) and/or reduce `8mm`.
- **Fewer per page** → increase the gap (e.g. `14mm`) and/or enlarge the sticker.

> After changing the size/gap, the header's "(N/page)" estimate updates
> automatically — it is measured at export time (see edit #5 if it drifts).

### 2. Change the sticker size (QR + panels)

In `print-queue.html`, the on-page sticker size comes from these rules
(non-`@media print`, near the top of the `<style>`):

```css
#qr-export-grid .pt-qr    { width: 150px; height: 150px; }   /* QR size */
#qr-export-grid .pt-left  { flex: 0 0 60%; padding: 22px; }  /* white panel */
#qr-export-grid .pt-right { flex: 0 0 40%; padding: 18px 14px; } /* red panel */
```

- Smaller QR / less padding → shorter sticker → more per page.
- The 60/40 split controls how wide the white vs red panel is.

### 3. Change page margins / paper size

In `print-queue.html`, inside `@media print`:

```css
@page { margin: 1.2cm; size: A4; }
```

Change `1.2cm` for wider/narrower page margins, or `A4` to `Letter` etc.
If you change the top/bottom margin, also update the page-estimate constant in
edit #5.

### 4. Put the instruction / how-to text back on the sheet

The instructions were removed on purpose. To bring them back, edit
`etagPrintPageHtml(tag)` in `admin/index.js` and add an instruction block inside
`.pt-wrap`, **above** `.pt-cut`. (The old copy — "How to fix the E-Tag…", Print/
Cut/Attach steps, and the free/premium contact note — can be restored from git
history of `admin/index.js` if needed.) Note: adding a tall instruction block
per sticker will push the layout back toward one-per-page.

### 5. Fix the "pages" estimate if it drifts

The per-page count is estimated by measuring the rendered sticker height in
`exportQrsForPrint()` (`admin/index.js`):

```js
const PRINTABLE_PX = 1032; // A4 printable height ≈ 29.7cm − 2×1.2cm margin @96dpi
const GAP_PX = 30;         // ≈ the 8mm gap between stickers
```

- If you changed the `@page` margin, recompute `PRINTABLE_PX`
  (`(29.7 − 2×marginCm) / 2.54 × 96`).
- If you changed the `8mm` gap, update `GAP_PX` (`mm / 25.4 × 96`).

The label is shown with a `~` because exact packing depends on the browser's
print engine; it will be right or within one page.

### 6. Require / relax the selection rule

In `exportQrsForPrint()` (`admin/index.js`), this guard enforces "must select
first":

```js
if (_pqSelected.size === 0) {
  setStatus("Select the tag(s) you want to export first.", "info");
  return;
}
```

Delete this block to allow exporting the whole visible sheet when nothing is
ticked (the old behaviour).

---

## Printing tips (for the person doing the print)

- In the browser print dialog, set paper to **A4** and margins to **Default**.
- Turn **ON "Background graphics"** (Chrome: *More settings*). Without it, the
  **red QR panel prints white**. The CSS already requests colour printing
  (`print-color-adjust: exact`), but this checkbox can still override it.
- Use **"Save as PDF"** in the same dialog to get a PDF instead of paper.

---

## How the print isolation works (why there are no blank pages)

The export overlay lives deep inside the admin page. For printing, the
`@media print` block in `print-queue.html`:

1. **`display: none`** on the app chrome (`.pt-admin-sidebar`,
   `.pt-admin-page-header`, `.pt-admin-card`, `#admin-auth-status`) so it takes
   **no space** — this is what prevents blank pages before the stickers.
2. Collapses the `.pt-admin-shell` / `.pt-admin-main` wrappers to full-width
   `block` so the sticker isn't clipped into the narrow content column.
3. Shows only `#qr-export-overlay` (minus its on-screen toolbar).

> ⚠️ Do **not** switch these back to `visibility: hidden` — hidden-but-present
> elements still occupy space and reintroduce the blank-page bug.

---

## Notes

- Only the **admin batch export** is affected here. The single owner-side E-Tag
  PDF (`pages/owner/vehicle-detail.html` `#etag-print`) still includes its full
  instructions and is unchanged.
- The QR image itself is a high-res (1024px, error-correction "H") code from
  `createPrintQrDataUrl()`, so shrinking its on-page size stays crisp/scannable.
