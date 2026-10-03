# Why "Place order, pay on delivery" took two seconds, and what it does now

Investigated 2026-10-03 after a report that confirming the delivery address
took up to two seconds on `/shop` and `/get`.

## Where the time went

The delivery sheet (`scripts/owner/address-step.js`) is shared by `/shop`,
`/get`, `/direct` and the dashboard. Paying online, the tap closes the sheet
with no network call. The wait was on the Cash on Delivery path, where the tap
did three things in a row before the code screen appeared:

1. `POST /api/shop/address-check`: the server asks Ola Maps whether street,
   city and PIN agree (up to 3 s, usually well under 1 s). Button read
   "Checking address…".
2. A reCAPTCHA token, minted at that moment (`grecaptcha.execute`, a few
   hundred ms; more if Google's script had not loaded yet).
3. `POST /api/shop/guest/cod-otp/send`, which itself ran the bot check with
   Google, then the database lookups, then the Delhivery pincode answer, then
   the WhatsApp send through Meta, one after another. Button read "Sending
   code…".

Only then did "Confirm your mobile" appear. None of it needs the buyer to watch.

## What changed

- **The code screen appears at the tap.** It says the code is on its way
  ("Sending a 6-digit code on WhatsApp to …"), with Resend held until the send
  has landed. When the server answers, the line changes to "We sent …" and the
  resend timer starts. If the server refuses (open COD order on that number,
  PIN not served, bot check), the form comes back with that reason, exactly
  where it used to appear. The code itself takes a few seconds to reach
  WhatsApp, longer than any of this.
- **The address verdict is asked for at the same moment** and, only if Ola
  says the address does not hang together, lands on the code screen as an
  amber note: check the PIN and street, or enter the code to place it anyway.
  The "warn once, may place anyway" rule is unchanged; the warning moved from
  a second tap on the form to a note on the next screen. The back link now
  reads "Change address or mobile number", which is what it always did.
- **The bot-check token is minted when Cash on Delivery is chosen** and kept
  young while the form is typed (re-minted after 90 s on the next keystroke),
  so the send does not wait on Google. The token is single-use; the create-order
  token is a separate one the pages already keep fresh.
- **The server's code-send route** starts the bot check, the open-order lookup
  and the courier's pincode answer together and takes its decisions in the old
  order. That shortens the time to the WhatsApp message, not the tap.

Nothing personal leaves the sheet before the tap: the warm-up still sends the
pincode only, and the address check and the send still happen at the tap.

## What the buyer waits for now

Nothing measurable at the tap: a view switch. The WhatsApp code arrives after
the send has gone through (the request hop plus Meta, well under the time it
takes to switch to WhatsApp).

Tests: `src/backend/tests/cod-address-tap.test.js` (the real sheet in jsdom,
answers held back and released by hand; and the route's order read off the
source). `guest-cod-otp-wiring.test.js` updated for the new tap.
