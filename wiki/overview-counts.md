# What the admin overview counts, checked against production

Audited 2026-10-06, after the activation queue turned out to list owners who
had activated (see `activation-queue.md`). Every other tile was read from the
code and compared with the live numbers.

## Tiles that reconcile

| Tile | How it is counted | Live check |
| --- | --- | --- |
| Unprinted tags | unclaimed, not printed, not demo stock | 0; batch deletion is a hard delete, so nothing deleted can linger here |
| Printed, awaiting claim | unclaimed, printed, not demo stock | 4,999 = 5,012 issued − 13 activated |
| Unsold premium stock | premium, no owner, not deleted, not demo stock | 3,000 |
| Batches issued | per batch, issued stock with a batch number | 4 batches, 5,012 tags |
| Site visitors | landing visits, bots filtered at record time | — |

## Tiles that counted us as customers

Owners, Customer tags, Premium tags activated, E-Tag stickers activated and
Contact requests counted every record with an owner. On production that meant:

- of 21 "customer tags", 8 were the team's own (test stickers on our own cars,
  the Batch-002 internal batch, a dashboard-only vehicle);
- "12 premium tags activated" was 8 customers;
- most recent contact requests were us testing the call flow against our own
  stickers.

Orders already had this rule (`isInternalPhone`, `INTERNAL_TEST_PHONES`); tags,
owners and contact requests did not.

**Now:** `internalScope()` in `lib/core/internal-orders.js` builds, once per
request, the filters for our tags (internal flag, Batch-002, or an owner whose
number is on the internal list), our owner accounts, and the contact requests
made against our tags. The overview leaves them out of the customer figures and
reports them apart as "N ours" in the tile subtitle. The Tags and Owners pages
still list every row and mark ours with an "Ours" chip, so a card still adds up
with its page.

It fails open like `isInternalPhone`: with no `INTERNAL_TEST_PHONES` set, only
Batch-002 is treated as ours. Check the Railway environment has the list.

## Failed contacts

The tile counted only `status: "provider_failed"`, which is what a refused
WhatsApp message lands as. The Exotel webhook writes the provider's own word
into `status` ("failed", "no-answer", "completed") with a normalised
`callOutcome`, so a call the provider could not place was never counted. It is
now: `provider_failed`, `status: "failed"` or `callOutcome: "failed"`.

**Still blind on production:** every call on the Activity feed sits at
"connecting" or "initiated". The Exotel flow has no status callback pointed at
`/api/provider/exotel/webhook` (the code handles it; the applet is not sending
it), so no call ever reaches a terminal status, and neither failed calls nor
answered ones can be seen. That is an Exotel dashboard setting, not a repo
change. The same owed check as the Connect applet ring time in
`backup-number.md`.

## Not changed

- The Activations page's "Activated" tab and the batch summary still include
  our stickers; they are inventory views, not customer counts.
- "Usage" site visitors are unaffected: our own browsers are dropped at record
  time by the internal-device cookie.
