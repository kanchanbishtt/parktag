# Website offers: one price for new visitors and existing customers

## The rule

A **website offer** is a promo code with **"Auto-apply on the website"**
switched on (Admin → Promo Codes, field `autoApply`). Every buyer gets it
without typing anything: signed out or signed in, on the landing site, `/shop`,
`/get` or the dashboard shop. No page keeps its own copy of an offer price.

| Where | Shows the price from | Charged how |
|---|---|---|
| Landing site (parktag.me) | `/api/shop/public-catalogue` → `offers`, `launchOffer`, `codSurchargePaise` (server-rendered: hero, Solo and Duo cards, COD line, FAQ, "Starting at") | links to `/shop?sku=…` |
| `/shop`, `/get` (signed out) | `/api/shop/public-catalogue` → `offers` | `/api/shop/guest/create-order` applies the website offer itself; the page sends no code |
| Dashboard shop (signed in) | `/api/shop/pricing` → `offers` | `create-order` and `place-cod` apply it; a code typed in the pack step replaces it |
| `/direct` | no offer, on purpose (list price + its own code box) | sends `listPrice: true`, so only a typed code applies |

The order routes and the catalogue all use `lib/core/promo-codes.js`:
`resolveCheckoutPromo()` (typed code if valid, else the best website offer) and
`readWebsiteOffers()` (the offer on each pack, plus `payableByQuantity` so `/get`
never does discount arithmetic of its own).

- **One code per order.** A valid typed code replaces the website offer. An
  invalid one falls back to the website offer, and the reason is returned as
  `promoRefused` and shown in the dashboard.
- **Two website offers on one pack:** the one that saves the buyer more wins.
- **Cash on delivery:** offers and codes apply, then the ₹49 fee is added
  (Duo: ₹399 + ₹49 = ₹448).
- **Guardrails:** a website offer can't be single-use, tied to one phone, or a
  hand-over code. An API token (MCP) can't switch one on; only the admin panel can.
- **Hand-over codes** are refused in the dashboard, because every dashboard order ships.

## How to run an offer

1. Admin → Promo Codes → create or edit a code: amount, packs (e.g.
   `pt-car-1`), optional start and expiry, and tick **Auto-apply on the
   website**.
2. Every page and route follows within the catalogue cache: 30 s on the app,
   60 s on the landing site.
3. To end it, untick the switch or revoke the code.

LAUNCH100 (₹100 off the Duo Pack) is the first website offer. On first boot
after this change, `commerce-defaults.js` turns the switch on for an existing
LAUNCH100 row that has never had it. After that, the admin's setting stands.

## Why this exists

The Duo Pack price disagreed with the landing page more than once. Each time,
one storefront was patched and another was missed. On 2026-10-07 the gap was
the dashboard shop. `/shop` sends a **signed-in** owner to
`/owner-welcome?shop=1&sku=…`, which had a hard-coded price list and order
routes that never applied the code. So the team and returning customers tapped
"Duo Pack · ₹399" and were charged ₹499, or ₹548 on COD. The landing page's
COD line ("₹529, offer online-only") and FAQ ("₹30 COD fee") were stale too.

## Keeping it that way

- A new storefront or checkout reads `offers` from the catalogue or
  `/api/shop/pricing`. It never writes a price or a code into the page.
- A new order route prices through `resolveCheckoutPromo()`.
- `tests/website-offer-parity.test.js` holds every route, signed in and
  signed out, to the catalogue's figure. That covers a second offer on another
  pack, quantity pricing, revoking, typed codes, `/direct` at list price and
  the admin guardrails. If you change the rules, change that test on purpose.
  Don't delete it.
