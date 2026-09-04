# Shop login wall — conversion leak on all paid traffic

**Status:** fixed, 4 September 2026. `/shop` now serves the public storefront
with guest checkout to a signed-out visitor, and every buy button on the marketing
site points at it. `/get`, where the storefront was first built, redirects to
`/shop`. Signed-in owners still land on the dashboard's shop tab. The rest of this
document is the investigation as it stood before the fix.
**Priority (was):** high before any ad spend scales. Every rupee of paid traffic hits this.
**Related:** `docs/ANALYTICS_EVENTS.md` (the instrumentation that can now measure it)

---

## The problem

A signed-out visitor who clicks any "Buy" or "Order Now" button on the marketing
site is sent to a login screen **before they have seen a single price, product or
cart**.

`src/backend/app.js`:

```js
app.get("/shop", async (request, reply) => {
  const session = await readSession(app, request);
  if (!session || session.role !== "owner") {
    return reply.redirect("/owner-login?next=shop");   // <-- the wall
  }
  return reply.redirect("/owner-welcome?shop=1");
});
```

The shop UI itself lives inside the owner dashboard
(`scripts/owner/welcome-shop.js`, rendered into `pages/owner/welcome.html` and
opened with `?shop=1`), so there is currently no signed-out surface that can show
a product at all.

### Every affected CTA

| File | Count | Destination |
|---|---|---|
| `landing/app/components/SiteHeader.tsx` | 6 | `${APP_URL}/shop` |
| `landing/app/page.tsx` | 4 | `${APP_URL}/shop` |
| `landing/app/components/SiteHeader.tsx` + `page.tsx` | 6 | `${APP_URL}/owner-login` |

10 CTAs land on the wall. The other 6 go to login directly. **All 16 entry points
from the marketing site require authentication before a price is visible.**

Counts rather than line numbers: this area of the landing site changes often and
pinned line numbers go stale within a sprint. Re-derive with:

```
grep -rn 'APP_URL}/shop\|APP_URL}/owner-login' landing/app/
```

The same URL is about to be used as the Google Business Profile product landing
page and as the destination for Meta ads, which is what makes this urgent rather
than merely untidy.

---

## Why it matters

Asking for a phone number before showing a price inverts the normal order of a
purchase. The visitor is being asked to pay a cost (identify yourself) before
receiving any value (see what it costs, see what it is).

This is a hypothesis, not a measured number, and it should be measured rather
than assumed. The good news is that it now can be: the analytics work adds
`view_item` and `begin_checkout`, so the ratio of landing-site sessions to
`view_item` will show the size of the drop directly. **Get a week of that data
before deciding how much to invest in the fix.**

---

## Why this is not a one-line fix

Guest checkout is not a small change. Every shop endpoint binds to a session:

```
src/backend/routes/shop/index.js — every one of these reads request.session.userId:
  create-order · verify-payment · cod-otp/send
  place-cod · cod-prepay-order · cod-prepay-verify
```

Orders, tags and addresses all hang off `ownerId`. Removing the session
requirement means either creating an owner record at checkout time or
introducing a parallel guest-order model, and the second one would fork the
entire order lifecycle. Do not do the second one.

Worth noting before scoping: **sign-in here is already just phone plus OTP, and
it creates the account** (`verify-otp` returns `isNewUser`). COD checkout
separately verifies a delivery phone by OTP anyway (`cod-otp/send`). So the
account is close to free at the moment of purchase. The friction is almost
entirely about *when* it is asked for, not *that* it is asked for.

---

## Recommended fix

### Phase 1 — public shop page (small, do this one)

Give signed-out visitors a real product page. Keep the checkout exactly as it is.

1. Add `GET /shop` rendering a **public** page listing the four SKUs from the
   catalogue with prices, images and descriptions. No session required.
2. The Buy button on that page routes to `/owner-login?next=shop` as today.
3. Signed-in visitors keep redirecting straight to `/owner-welcome?shop=1`.

This removes the wall in front of *price discovery*, which is the part that
costs the most, and changes nothing about the order model, auth or payments.

The catalogue is currently hard-coded at the top of
`scripts/owner/welcome-shop.js` as `const PRODUCTS`. Phase 1 should lift it into
a shared module both surfaces import, otherwise the public page and the dashboard
shop will drift on price within a month. The server already resolves real prices
from its own catalogue at `create-order`, so `PRODUCTS` is display-only and safe
to share.

**Estimate:** roughly a day, mostly the page itself.

### Phase 2 — OTP at the point of payment (larger, only if Phase 1 data justifies it)

Let the visitor pick a product, enter a delivery address and reach the payment
step, and only then ask for the phone-and-OTP that creates the account. The
account still exists before the order is written, so `ownerId` binding and the
whole order lifecycle stay intact.

Do not start this before Phase 1 has run for two weeks with analytics attached.
It is a meaningfully bigger change to the checkout flow and the data may well
say Phase 1 recovered most of the loss.

---

## Immediate mitigation, no code

Point the **Google Business Profile product landing pages** and any ad
destination at `https://parktag.me` rather than `app.parktag.me/shop`. The
marketing site shows products and prices without an account. This costs nothing
and should be done today regardless of when Phase 1 ships.

---

## Acceptance criteria

- [ ] A signed-out visitor can see all four SKUs and their prices without logging in
- [ ] `PRODUCTS` is defined in one place and imported by both the public page and the dashboard shop
- [ ] Signed-in behaviour is unchanged (`/shop` still goes to `/owner-welcome?shop=1`)
- [ ] No shop API loses its session binding
- [ ] `view_item` fires on the public page, so the funnel stays measurable
- [ ] GBP and ad landing URLs updated
