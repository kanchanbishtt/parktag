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

## Print run

1. Admin → Issuance: issue a batch with the car / windscreen mount type.
2. `node --env-file=.env src/backend/scripts/print-doorhangers.js --batch <n> --out batch-<n>.html --apply`
3. Open the HTML in Chrome, Save as PDF. The page size includes 0.125in bleed; fronts and backs alternate.
4. For the vendor proof, add `--dieline` (magenta trim, 1.5in hole and slit).

`--sample N` makes a watermarked proof with fake tokens and no database. Never print it.
