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
used as-is: both frames are exported as **vector PDFs** into
`lib/print/doorhanger/art/front.pdf` and `back.pdf`, with the card's sample QR
and serial set to opacity 0 (not hidden: hiding collapses the auto-layout QR
box). Text and shapes stay vector, so nothing pixelates; only photos are
images. `template.js` embeds each side once and draws each hanger's QR as
vector squares plus its serial (`SLOTS`), so 1000 hangers is about 9 MB. To
change the design, edit Figma, re-export both frames as PDF the same way
(Figma's export, or the REST images endpoint with `format=pdf`), and replace
the two files.

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

## Print run (admin panel)

1. Admin → Batch Issuance: issue a batch with the car / windscreen mount type.
2. Admin → Print Queue: tick the batch's generation run (or individual tags).
3. Click **Door hanger PDF** (tick **Dieline** for the vendor's cutting proof).
   Confirm the prompt: the tags get 2 free contacts.
4. The print-ready PDF downloads. Send it to the printer as is: 4.75 x 11.25in
   pages (bleed included), front and back alternating.
5. After the printer has them, use **Mark printed** as for stickers.

Only unclaimed, unprinted, non-demo tags are printed; bike stock is refused.

## Print run (command line)

1. Admin → Issuance: issue a batch with the car / windscreen mount type.
2. `node --env-file=.env src/backend/scripts/print-doorhangers.js --batch <n> --out batch-<n>.pdf --apply`
3. The output is the print-ready PDF (0.125in bleed, fronts and backs alternating).
4. For the vendor proof, add `--dieline` (magenta trim, 1.5in hole and slit).

`--sample N` makes a watermarked proof with fake tokens and no database. Never print it.

## After the two contacts

The two free contacts are two free **calls**, and a call is only counted once
the scanner and the owner have been **connected for at least a second**
(2026-10-01): a call nobody answered costs nothing. Once both are spent the
private call and the Emergency call lock, and stay locked. The **WhatsApp alert keeps
working for life** and never spends a free call (owner's decision, 2026-10-01).

The owner is told once, on WhatsApp, that the free trial has ended (the
`parktag_free_trial_ended` template). The scan page keeps the WhatsApp tile and
says Private Call is not available. A scanner who reads the plate off a locked
tag is counted, and the owner is messaged, at most once a day, that someone could
not call them. Nothing sent to the owner says that WhatsApp still works. See
`locked-tag-flow.md`, section 5.
