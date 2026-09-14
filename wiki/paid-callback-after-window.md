# Paid callback after the free window (₹20)

Clarified product decision, 2026-09-14.

## What it is

A premium tag includes calling a scanner back, but only for **10 minutes** from the
scanner's contact. After that the owner could not call back at all.

The ₹20 paid callback fixes exactly that: once the free 10 minutes are over, the
owner can pay ₹20 to reopen the callback for **that one contact**, for **10 minutes
from the payment**. Inside those 10 minutes it behaves like the free window — Call
Back works, and redialling is included.

## Who gets it

| Tag / state                         | Inside free 10 min | After free 10 min          |
|-------------------------------------|--------------------|----------------------------|
| Premium, call service running       | Call Back (free)   | **Call Back ₹20**          |
| Premium, paid ₹20 (10 min running)  | —                  | Call Back                  |
| Premium, call service lapsed        | Renew to call back | nothing                    |
| E-Tag                               | Premium to call back | nothing                  |

- Offered on the **newest contact per vehicle** (one that left a number and did not
  end in a conversation), for as long as the activity list shows it (**48 hours**).
- **Not** sold to E-Tags. The first version (PR #239/#243) sold it to E-Tags as a
  one-time pass — that was a misunderstanding of the brief and has been replaced.
- **Not** sold to a lapsed premium tag: the answer there is the subscription.

## How it is built

- The pass **is the paid `callbackOrders` row**. `paidAt` starts the 10 minutes.
  Nothing is written to the tag or the contact.
- Settling an order is a conditional `created → paid` update, so the browser's
  `verify-payment` and Razorpay's webhook can race without restarting the clock.
- `verify-payment` registers the Exotel bridge in the same request and returns the
  virtual number — no second round trip between the money and the call.
- The webhook only settles the order. It never places a call (the owner may have
  walked away); the dashboard then shows Call Back on that row for the rest of the
  10 minutes.
- Code: `src/backend/lib/core/callback-pass.js`, `src/backend/routes/owner/callback-pass.js`,
  `register-call` in `src/backend/routes/owner/dashboard.js`,
  `src/frontend/scripts/owner/callback-eligibility.js`.

## Changing the numbers

`CALLBACK_PASS_PAISE`, `CALLBACK_PASS_WINDOW_MS` and `CALLBACK_PASS_MAX_AGE_MS` live
in `lib/core/callback-pass.js`. The dashboard publishes the price and horizon, so the
page follows automatically. The free window itself (`CALLBACK_WINDOW_MS`) is also
written into the owner alert templates — see the comment on it before changing it.
