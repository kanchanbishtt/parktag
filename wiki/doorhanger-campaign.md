# Car door hanger campaign

A 4.5in x 11in hanger left on parked cars. Every hanger carries a **real unclaimed
tag**, not a demo: the owner scans it, activates it with their own plate and phone
(the normal `/tag/<token>` wizard), and tears off the bottom card to keep on the
dashboard. From then on it is an ordinary E-Tag.

## Two free contacts

The hanger promises "First 2 contacts free" so an owner can have a friend scan
the card and call them, and still have a real contact left.

- `tags.freeContactAllowance` (integer 1-10, absent means 1) is stamped on the
  batch by `print-doorhangers.js --apply`. Junk values read as 1, never more.
- `tags.freeContactsSpent` counts spends. `spendFreeContactPipeline()` in
  `lib/core/call-access.js` increments it and sets `freeContactUsed` in one
  update once the count reaches the allowance.
- `freeContactUsed` still means "locked" and is the only flag gates read, so
  nothing downstream changed.

## Design source

The design is made in Figma ("ParkTag Door Hanger", Edit Tree Projects) and
used as-is: both sides are exported at 300 dpi (1425 x 3375 px, bleed included)
into `scripts/doorhanger/art/front.png` and `back.png`, with the card's sample
QR and serial hidden. The print script only overlays each hanger's unique QR
and serial (`SLOTS` in `template.js`). To change the design, edit Figma,
re-export both sides the same way, and replace the PNGs. The card QR is
generated in pure black to match the Figma sample.

Checks before every re-export:

- **Tear line.** The perforation sits 7.8in from the top of the trim on both
  sides. Below it is the dashboard card (front: the tag QR; back: the sticker
  upsell, facing the driver). Nothing may cross that line.
- **No stray QR codes.** Besides the hanger's own tag, the only scannable code
  allowed on the front is the marketing demo link inside the sticker photo
  (`qr.azency.in/parktag`). An earlier photo carried a competitor's live tag QR
  (app.ngf132.com); scan any new photo before using it.
- **Demo QR on the back** (`qr.azency.in/parktag`) is a dynamic code owned by
  the marketing team; its destination is changed there, not here.
- **Price** on the back must match the live offer (currently Duo Pack ₹399,
  MRP ₹499).

## Print run

1. Admin → Issuance: issue a batch with the car / windscreen mount type.
2. `node --env-file=.env src/backend/scripts/print-doorhangers.js --batch <n> --out batch-<n>.html --apply`
3. Open the HTML in Chrome, Save as PDF. The page size includes 0.125in bleed; fronts and backs alternate.
4. For the vendor proof, add `--dieline` (magenta trim, 1.5in hole and slit).

`--sample N` makes a watermarked proof with fake tokens and no database. Never print it.
