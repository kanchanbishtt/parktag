# The activation queue: what "sold, not activated" means

Written 2026-10-06, after owners who had activated and were using their
stickers turned up on the admin "Sold, not activated" list.

## How the list is built

The list is made of **orders**, not tags (`buildActivationQueue` in
`routes/admin/index.js`). A paid or COD order stays on it until one of these
is true:

- it minted a premium tag online (a replacement upgrade);
- its owner account holds a live premium tag;
- its replace-target free tag was upgraded or removed;
- every sticker it holds is linked to it. Capacity is pack size times quantity.

A sticker is linked to its order **only at activation**
(`lib/core/order-linking.js`): the phone typed at activation is matched
against the delivery phone of the oldest paid order with a free slot. A wrong
link is treated as worse than none, so nothing else ever links.

## Why real customers were on the list

Checked against production on 2026-10-06, four rows:

| Case | Why it showed |
| --- | --- |
| Two Pack-of-2 buyers, each using one sticker | The pack is done only when both stickers are live. The tile said "not activated" for people who had activated. |
| A reseller's 10-pack order | Its twenty stickers go to twenty other people who activate on their own phones. None match the reseller's delivery phone, ever. |
| A buyer with no tag under his phone or name | Either not activated yet, or activated on a number the order never saw. The system cannot tell those apart on its own. |
| A hand sale recorded after the customer activated | `record-manual-order.mjs` stamps the order at noon on the sale date and wrote nothing else; the activation had already happened, so there was no order to link to. |

## What changed

1. **The tile counts only orders with nothing live.** Multi-packs with some
   stickers live are counted apart ("N more packs are partly activated") and
   wear a green "1 of 2 live" badge on the page.
2. **Reseller orders are counted, not listed.** A note on the page says how
   many and why.
3. **Recording a hand sale back-links.** `backlinkOrder` takes stickers
   already activated on the order's phone, oldest first, up to the pack size.
4. **Another number: suggest, then link by hand.** Each row carries up to five
   unlinked activations that could be the buyer's, with reasons: same name,
   same email, or a plate registered in the delivery state
   (`lib/core/plate-state.js`), and activated after the order (36 hours of
   slack for a hand sale recorded that evening). A state match on its own only
   counts within 14 days of the order. "Link to this order" calls
   `POST /api/admin/activations/:id/link`, which uses the same
   one-slot-per-sticker write as the automatic path and refuses a sticker
   already on an order, an internal tag, or a full order.

## What still cannot be known

- A buyer who activated on a number nobody can connect to the order, with a
  different name and a plate from another state, is invisible. The
  reconciliation report (`/api/admin/reconciliation`) still lists every
  activated-but-unlinked sticker for a human to look at.
- Reseller stock cannot be followed to the end customer unless reseller
  stickers are issued as their own batch and counted by batch.
