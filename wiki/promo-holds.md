# Promo code usage caps: holds

A capped code (single-use, or `maxUses`) is counted against **uses plus live holds**.

## Why

The cap used to be checked only when an order was created (`resolvePromo`) and
counted only when it was paid (`consumePromo`). Nothing counted the unpaid orders
in between, so several checkouts could all carry a single-use code at the
discount, and every one of them could then be paid.

## How it works

- Every order route (guest online, guest COD, dashboard online, dashboard COD)
  calls `holdPromoForOrder` once it knows the order number, before the order can
  be paid or placed. One conditional update, so two checkouts racing for the
  last slot cannot both get it.
- A hold is `{ orderNumber, holder, until }` in `promoCodes.holds`. `holder` is a
  hash of the delivery phone (no phone numbers in the admin list).
  `until` is 30 minutes ahead (`PROMO_HOLD_MS`).
- One live hold per buyer per code. A buyer who changes their cart, or switches
  from online to cash on delivery, moves the hold to the new order instead of
  being refused their own code. A reused checkout re-holds for the same order.
- `consumePromo` (paid online order, or COD placed) turns the hold into the use.
  COD still burns the code after the reply; the hold keeps the slot until then.
- Codes with no cap take no holds at all (the website offer LAUNCH100 is uncapped).
- Previews (`/api/shop/promo/check`) and the storefront offers ignore holds: they
  quote a price, they do not reserve one.

## What it cannot stop

Razorpay orders cannot be cancelled and payments are captured automatically, so a
payment that arrives after its order lost its hold (lapsed, or moved to the same
buyer's newer checkout) is still honoured. `consumePromo` records it and logs
`promo-over-cap`. Holds stop the main case: several buyers, or a forwarded code,
filling the cap many times over before anybody has paid.

If the cap fills between quoting and creating (a real race), the order route
answers 409 `PROMO_TAKEN`; the pages show the server's error text.
