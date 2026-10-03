# Why placing a Cash on Delivery order took five seconds

Investigated 2026-10-03 after a report that "Place order" on `/shop` with Cash
on Delivery took at least five seconds.

## Where the time went

Guest `create-order` with `paymentMethod: "cod"` wrote the order and then,
before answering, waited for four providers in a line:

1. Delhivery `create.json` (the waybill), then Delhivery `fm/request/new` (the
   pickup; one per day, so usually a database insert that is refused as a
   duplicate), then for an internal order Delhivery `api/p/edit` to void it.
2. `consumePromo` (one database write).
3. The WhatsApp confirmation through Meta, which wants the waybill for its
   status line.
4. The Meta conversion (already fire-and-forget).

Each is a round trip from a server that is far from India and from its
database (`wiki/checkout-speed.md` has the measurements: about 250 ms per
request hop, 120 to 240 ms per database trip, a second or so per provider).
Summed, two to four seconds after the order existed, for a confirmation screen
that shows nothing those providers decide.

Before the write, the same handler also did its database trips one after
another: lock, open-order lookup, courier and address check, proof burn, per-IP
cap, order number, insert.

On the page, `/shop` minted its reCAPTCHA token at the tap. The sheet had
already loaded Google's script for the OTP send, so this cost one `execute`,
not a script download, but it was still on the tap.

The signed-in `/api/shop/place-cod` had the same shape after its insert.

## What changed

- **`lib/core/after-reply.js`**: `afterReply(log, label, work)` runs work on the
  next turn of the event loop, never lets a failure escape (logged with the
  label), and tracks it until it settles. `settleAfterReply()` waits for all of
  it: `server.js` calls it between draining HTTP and closing Mongo, and
  `tests/helpers.js` calls it in `stopTestApp`.
- **Guest COD** (`placeGuestCodLocked`): after `insertOne`, the courier booking,
  the promo burn, the confirmation and the conversion are handed to
  `afterReply`, in that order (the confirmation still waits for the waybill).
  The reply goes as soon as the order is written. The courier and the address
  check are started before the phone lock is taken, and the order number is
  drawn beside the proof burn, so two database trips and the provider waits
  overlap.
- **Signed-in `place-cod`**: the booking and the confirmation are handed off the
  same way.
- **`/shop`**: for a pack that takes COD, the bot-check token is minted when
  the delivery step opens and kept fresh (`fresh-captcha.js`), as `/get` already
  did. Online orders on `/shop` still send no token and do not load Google.

## What the buyer waits for now

Roughly: the request hop, the bot check (Google), the lock, the open-order
lookup, the proof burn and per-IP cap, the insert. About a second from the
current server region. The WhatsApp confirmation arrives a few seconds after
the screen, which is the right order.

## What to watch

- A deploy that kills the process between the reply and the booking leaves an
  order with no `waybill` and no `shipmentError`. `settleAfterReply` in the
  shutdown path covers a graceful stop; a hard kill does not. The admin order
  view already shows `shipment_failed` for a recorded error; an order with
  neither after a few minutes is the case to look for.
- `bookCodShipment` still writes `shipmentError` on failure, so
  `scripts/retry-shipment.mjs` works as before.

Tests: `src/backend/tests/cod-order-speed.test.js` (no database) and the new
case in `guest-cod.test.js`.
