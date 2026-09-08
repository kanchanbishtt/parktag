# Order notifications — discarded attempt (Aug 2026)

A local branch built WhatsApp order notifications and Delhivery shipment
polling while, in parallel, the same ground was covered upstream on `staging`.
The local work was **discarded in favour of upstream**. This note records what
was attempted and which ideas are worth revisiting, so the thinking survives
even though the code does not.

## Why it was discarded

The work sat uncommitted while 59 commits landed on `origin/staging`. By the
time it was rebased, upstream had shipped its own order-confirmation path, and
three of the four pieces were superseded — in two cases by a better version.

This was a **semantic conflict**, not a textual one: both sides solved the same
problem in the same files. Git can flag the overlapping lines but cannot say
which implementation should win, so the resolution was a per-hunk judgement
call rather than a merge.

Root cause was process, not git: the branch was never pushed, so the divergence
surfaced all at once instead of daily.

## What was attempted, and what happened to each piece

| Piece | Outcome |
|---|---|
| CSP `scriptSrcAttr: ['unsafe-inline']` | **Already upstream**, identical fix, commit `07fc7ec`. Pure duplicate. |
| `notifyOrderStatus` — WhatsApp order notifications | **Superseded.** Upstream's `sendOrderConfirmation` does more: e-mail channel, COD-aware copy, amount, and errors logged rather than silently swallowed. |
| `parktag_order_update` with a `status` body variable | **Not adopted.** Good idea (see below) but blocked on Meta re-approval. |
| `pollShipmentStatuses` + `startShipmentPolling` | **Not adopted, and still a real gap.** See below. |
| `parktag_owner_notification_v2` template bump | **Not adopted.** Unrelated to orders; revisit separately if v2 is actually approved. |

## Ideas worth revisiting

### 1. Shipment polling (genuine gap — upstream has none)

`trackShipment()` exists in `lib/integrations/delhivery.js` with **zero
callers**. Upstream wrote the API client and never wired it up, so today the
buyer is told the order is confirmed and then hears nothing until the parcel
arrives. Delhivery pushes no webhooks on the current plan, so progress has to
be pulled.

The discarded implementation was sound and worth rebuilding:

- **Compare-and-set claim** — the update filter includes the previously stored
  status, and the write is only acted on when `modifiedCount === 1`. Two
  instances polling concurrently therefore cannot double-message the buyer.
  This is the part most naive implementations get wrong.
- **Terminal statuses** (`delivered`, `rto`, `returned`, `cancelled`, `lost`)
  set a flag that removes the order from the polling query, so the open-order
  scan does not grow without bound.
- **Dependency injection** for `track` and `notify` so the logic is testable
  without Mongo or Meta credentials.
- **`timer.unref()`** so the interval never holds the process open on shutdown.

Caveat: it was a 30-minute in-process `setInterval`, correct for one instance
only. Move to an external cron hitting an endpoint before scaling past one.

### 2. Status as a template variable

`parktag_order_update` is currently approved with three body variables:
`{{1}}` name, `{{2}}` order number, `{{3}}` tracking link. Adding `{{3}} status`
(pushing tracking to `{{4}}`) would let **one** approved template cover every
order state — "Payment received", "Shipped", "Out for delivery", "Delivered" —
instead of needing a fresh Meta approval per state.

Blocked on: re-approval of the template with four variables. Sending four
parameters to the three-variable template fails with Meta error `132000`
(parameter count mismatch).

Cheaper alternative that sidesteps approval entirely: send **progress updates
by e-mail** and keep WhatsApp on its approved three-variable confirmation.
E-mail has no template constraints and the transport already exists.

### 3. Both channels rather than fallback

Upstream sends e-mail and falls back to WhatsApp only when no e-mail is on
file. Arguably both should fire: one is the receipt the buyer keeps, the other
is the nudge they actually see. If revisited, dispatch them with
`Promise.allSettled` so one channel failing cannot suppress the other, and log
each failure with its channel name.

Related: WhatsApp arguably belongs on `shippingAddress.phone` rather than the
account holder's number — whoever receives the parcel is who needs the "out for
delivery" ping, and that is not always the account owner.

## Bug found along the way

`shopOrders` carries two different identifiers:

- `orderId` — the **Razorpay** order id (`order_Nx7f...`), internal
- `orderNumber` — the human sequential reference (`PT-260805-00042`)

Upstream introduced `orderNumber` during the divergence. Any notification code
must send `orderNumber`; the discarded branch predated it and would have sent a
Razorpay internal id to customers. Worth checking whenever new customer-facing
order messaging is added.

## Recovering the discarded code

Both branches were deleted, but the commits stay in the reflog for ~90 days:

- `32c8784` — original WIP (WhatsApp-only notifications + polling)
- `896f0e2` — merged version (both channels + polling), self-check passing

```bash
git show 896f0e2                 # inspect
git checkout -b recover 896f0e2  # restore
```

After the reflog expires these are unrecoverable, so port from them rather than
rebase — they are based on a `staging` that has since moved on.

## Process changes to avoid the repeat

- Push the branch on day one, draft PR. Conflicts then surface daily and small.
- `git pull --rebase origin staging` on the feature branch each morning.
- Keep branches under ~3 days; past that a branch is a fork.
- `git config --global rerere.enabled true` — git memorises conflict
  resolutions and replays them on repeat rebases.
- `git range-diff staging...<branch>` compares your series against upstream's
  take on the same work, which is more legible than reading conflict markers.
