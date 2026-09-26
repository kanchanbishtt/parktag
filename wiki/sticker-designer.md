# Sticker Designer (admin)

`/admin/sticker-designer` edits the QR sticker artwork in layers and chooses
which design prints. Built on Fabric.js 6.9.1 (MIT), vendored at
`src/frontend/vendor/fabric/` because the CSP only allows first-party scripts.

## How a design prints

- A design is the artwork (one SVG, the 1000 x 600 sticker box, everything
  except the QR and serial) plus a layout: where the QR and serial go.
- Every print path overlays each tag's own QR and serial on that artwork,
  exactly as it always did on the fixed Figma file:
  Print Queue → Export QRs, and `/admin/sticker/:token`.
- Exactly one design is **Live** (published). With none live, the original
  `images/org-parktag-sticker.svg` and its old positions are used unchanged.
- The live design is never edited in place: edit it, then save as a new draft
  and publish that. "Go back to the original artwork" unpublishes.

## Constraints worth knowing

- QR placeholder: kept square, unrotated, inside the sticker, at least 150
  units wide (about 16mm); the editor warns under about 23mm.
- The QR and serial are always the top layers, because print draws them on
  top of the artwork anyway.
- Text fonts are limited to fonts every computer has. The artwork is shown
  as an `<img>`, which cannot load web fonts, so a Google font would fall
  back on the print machine. Use "Preview print" to see the real result.
- Uploaded images are embedded (data URLs); SVG uploads become vector layers.
  Anything that could run script or fetch outside files is refused on save.
- Not covered: door hangers (own Figma PDF) and the owner pages that show a
  picture of the sticker (`welcome.html`, `vehicle-detail.html`) still use
  the original artwork.
