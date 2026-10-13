# Referral flow: what has to be true for it to work

"Give ₹50, get a free month." Found broken end to end on 2026-09-30 although
every unit test passed, because the units were right and the journey between
them was not. The rules below are what the journey needs.

## The friend

- **The code lives until the order is placed.** `referral-link.js` parks
  `?ref=` in sessionStorage. It is cleared in `showDone`, not when an order is
  created: a buyer who closes the payment window and tries again must still
  have it, or the retry is charged the full price.
- **Quote only what will be charged.** `/get` asks `POST /api/shop/referral/check`
  before it shows anything. A confirmed code comes off the online price in the
  checkout sheet, with a badge. Cash on Delivery is priced without it, because
  the server never applies it there.
- **The server still decides.** `create-order` resolves the code again with the
  delivery phone, which the page check does not have. If it refuses (your own
  link), the response carries `referralRefused` and the page stops before
  payment, rather than opening Razorpay at a price the sheet did not show.

## The owner

- **The month goes on the premium tag closest to lapsing**, after any running
  trial or subscription, never on top of it. The write is conditional on the
  subscription that was read, so two friends paying together are two months.
- **An open-ended subscription is left alone.** `status: "active"` with no end
  date is unlimited; a reward must not put a date on it.
- **No premium tag: the month waits.** It is banked on the account and added
  the next time the dashboard loads with a premium tag present
  (`redeemReferralCredit`). The balance is claimed before it is spent.
- **They are told.** The card reports friends, months earned and months
  waiting. The `parktag_referral_reward` WhatsApp template is sent after the
  reward lands, best effort, never awaited by the payment path.

## Testing it

`referral-journey.test.js` drives the real routes with only Razorpay's order
mint replaced. `external-guard.js` refuses template sends in a test run, so the
message wording is tested through the pure `referralRewardMessage`.

## The friend who signs in on the way

The dashboard shop is a second checkout, and it used to forget the code: `/api/shop/create-order` read `ref` but `welcome-shop.js` never sent one. Reaching it is easy: `/get` has a "Sign in" button, and `/shop` sends a signed-in owner straight to `/owner-welcome?shop=1`.

- **The code is the same parked code.** `welcome.js` imports `referral-link.js`, so a code parked on `/get` or `/shop` earlier in the tab is still there, and a `?ref=` on the dashboard's own address is parked too. `/shop` carries a well-formed `ref` across its redirect for a signed-in owner. `welcome-shop.js` is a classic script, so it reads the code through `window.ptReferralCode` / `window.ptClearReferralCode`.
- **Same rules as `/get`.** The pack sheet quotes the discount only after `/api/shop/referral/check` confirms it (which, for a signed-in owner, refuses their own code), on the online price only. create-order checks the account and the delivery phone; if it refuses, the sheet stops before Razorpay, says why, and drops the code. The code is forgotten once an order is placed.
- **A reused order must name the same referrer.** The reward goes to whoever the order names, so the owner route's reuse filter includes `referredBy`.
