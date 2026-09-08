# ParkTag (WaveTag) - How It Works

ParkTag lets a stranger contact a parked car owner anonymously, without ever seeing the owner's private phone number.

---

## What ParkTag Can Do

- Issue a unique QR sticker per vehicle
- Let a stranger scan that QR from any phone browser with no app install
- Route a masked call or WhatsApp message from scanner to owner without exposing the owner's number
- Let owners control their tag status (active / inactive) from a simple dashboard
- Let admins issue stickers in batches and inspect all activity from a laptop

---

## How Customers Are Acquired

1. **Admin issues a batch of unclaimed QR stickers** from the admin dashboard.
2. Stickers are handed to car owners at parking lots, service centers, or via direct sale.
3. The owner visits the claim URL printed on the sticker and self-registers their vehicle.
4. Alternatively, a new owner can go directly to the ParkTag website and self-register without needing a pre-issued sticker.
5. After registration the owner receives their personal QR digitally (download) or can request a physical sticker.

---

## How a QR Gets Activated

1. Admin generates unclaimed tags - each tag has a unique backend token.
2. Owner scans the QR or opens the claim URL.
3. Owner creates an account and links the tag to their vehicle (plate number, contact phone).
4. Backend marks the tag as **claimed + active**.
5. The QR is now live. Any scanner who scans it reaches the owner contact flow.
6. Owner can toggle the tag **inactive** from their dashboard (for example, while the car is in a garage and cannot be reached).

---

## How the QR Helps a Vehicle Owner

- A stranger who finds the car in a bad situation (blocking, lights on, etc.) scans the sticker.
- The scanner sees only a masked vehicle number (e.g., `####8251`) - no private details.
- The scanner enters their own phone number and picks a contact action.
- The owner gets notified through a real call or WhatsApp message without the stranger ever seeing the owner's number.
- The owner's dashboard logs every contact request so nothing is missed.
- If the owner sets the tag to inactive, scanners can still leave a WhatsApp message as a fallback.

---

## How a Call Gets Placed

1. Scanner opens the active tag page and enters their phone number.
2. Scanner taps **Call Owner**.
3. Backend receives the request and calls the **scanner's phone** first through Exotel (the telephony provider).
4. Once the scanner picks up, Exotel bridges the call to the **owner's registered number**.
5. Neither party ever sees the other's raw number - both sides just answer a normal call.
6. The call attempt and outcome are logged in the database and visible on the owner and admin dashboards.

> If Exotel credentials are not configured, the backend records the request and returns a provider-safe error. No private numbers are leaked in either case.

---

## How a WhatsApp Message Gets Sent

1. Scanner taps **Leave WhatsApp Message** and types a short note.
2. Backend sends the message through the **Exotel WhatsApp channel** to the owner's registered number.
3. The owner receives the message on their WhatsApp without the scanner knowing the number.
4. Delivery and failure status from the Exotel webhook is stored and shown on dashboards.

---

## Summary Table

| Who | What they do |
|---|---|
| Admin | Issues QR sticker batches, monitors all tags and requests |
| Owner | Claims a tag, manages status, receives masked calls and messages |
| Scanner | Scans QR, enters their number, calls or messages the owner anonymously |
| Backend | Resolves tokens, bridges calls via Exotel, never exposes private numbers |
