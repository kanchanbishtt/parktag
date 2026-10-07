# Launch offer pricing: one price on every storefront

## The rule

The launch offer (LAUNCH100, ₹100 off the Duo Pack, so ₹399) is a row in
`promoCodes`. Everything that shows it or charges it reads that row through
the server. No page keeps its own copy of the offer price.

| Where | Shows the offer from | Charges it how |
|---|---|---|
| Landing site (parktag.me) | `/api/shop/public-catalogue` → `launchOffer`, rendered on the server | n/a (links to `/shop?sku=pt-car-2`) |
| `/shop`, `/get` (signed out) | `/api/shop/public-catalogue` → `launchOffer` | the page sends `promo: "LAUNCH100"` to `/api/shop/guest/create-order` |
| Dashboard shop (signed in) | `/api/shop/pricing` → `launchOffer` | `create-order` and `place-cod` apply it **on the server**; the page sends no code |
| `/direct` | not shown on purpose (list price, typed coupon box) | only the code the buyer types |

Both endpoints build `launchOffer` with `readLaunchOffer()` in
`routes/shop/index.js`, so they cannot disagree. The code also applies to Cash
on Delivery: the Duo Pack is ₹399 + ₹49 = ₹448 on COD, signed in or out.

## Why this note exists

The Duo Pack price disagreed with the landing page more than once. Each time,
one storefront was patched and another was missed. On 2026-10-07 the gap was
the dashboard shop. `/shop` redirects a **signed-in owner** to
`/owner-welcome?shop=1&sku=…`, which had a hard-coded price list and order
routes that never applied the code. So anyone already signed in (the team, a
returning customer) tapped "Duo Pack · ₹399" and was charged ₹499 online or
₹548 on COD.

## How to keep it from coming back

- A new storefront or checkout reads `launchOffer` from one of the two
  endpoints. It never writes 399 or 499 into the page.
- A new order route for a signed-in buyer calls `ownerLaunchPromo()`, the same
  way `create-order` and `place-cod` do.
- `tests/launch-offer-parity.test.js` checks that the dashboard quotes and
  charges the landing page's figure (online, COD, the receipt fields, and
  verify-payment accepting it). It also checks that revoking the code removes
  it everywhere at once. If you change how the offer works, change that test
  deliberately. Don't delete it.
- To end or change the offer, edit or deactivate LAUNCH100 in the admin promo
  codes page. Every page and route follows within the catalogue cache (30 s
  in production, 60 s on the landing site).
