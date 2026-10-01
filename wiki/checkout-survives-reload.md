# A reload does not lose the checkout

Fixed 2026-10-01. The delivery address step is one sheet
(`src/frontend/scripts/owner/address-step.js`) opened by four pages. Only `/get`
brought it back after a reload. On `/shop`, `/direct` and the dashboard shop the
sheet closed and everything typed into it was gone.

## Two parts, and who owns each

**1. What was typed: the sheet owns it.** The sheet keeps its own draft in
`sessionStorage` (`pt_addr_draft`): the fields, the Cash on Delivery choice and
an *unticked* WhatsApp box. Every page that opens the sheet gets them back with
no code of its own. `/get` used to do this from outside by reading the sheet's
elements; that copy is gone.

- Saved on every keystroke and choice, and after the sheet fills a box itself
  (pincode lookup, a picked suggestion).
- The draft records its mode. A guest's draft is never poured into a signed-in
  owner's profile form, or the other way round.
- **Guest:** kept when they back out (picking another pack must not mean typing
  it again). Forgotten when the order is paid or placed.
- **Owner:** forgotten when they back out (their saved address stands) and when
  the address is saved. So a draft only exists if the page was reloaded
  mid-form, and in that case the sheet reopens on the form, not the confirm card.
- After a reload the sheet adopts the history entry it had added, so Back does
  not need two presses.

**2. Whether to reopen, and on what: the page owns it.** Only the page knows
which pack was being bought.

| Page | Kept in `sessionStorage` | Reopened on load |
| --- | --- | --- |
| `/get` | counts, add-on tick, open pack (`pt_get_cart`) | the delivery step |
| `/shop` | add-on tick, open pack (`pt_shop_cart`) | the delivery step |
| `/direct` | counts, add-on tick, typed code, open pack (`pt_direct_cart`) | the delivery step |
| dashboard shop | product, variant, step, pack selection (`pt_dash_checkout`) | the product sheet, the delivery step or the pack step |

The three public pages share `src/frontend/scripts/checkout-cart.js`.

## Rules worth keeping

- **Backing out is a decision.** Dismissing the sheet clears the "open" marker,
  so a reload does not reopen what the buyer closed.
- **A finished order is never reopened.** The cart is cleared the moment payment
  succeeds (before verify) and when a COD order is placed.
- **A reopened checkout is not a new one.** `begin_checkout` and
  `add_on_selected` are not fired again on a reload.
- **Storage is untrusted and optional.** A saved pack that is sold out, unknown
  or not a string is ignored. With storage disabled the pages work as before and
  simply forget on reload.
- **`sessionStorage`, not `localStorage`.** An address is personal: it lasts for
  the tab and is gone when the tab closes. The dashboard clears it at sign-out.
- On the dashboard, a `?shop=1&sku=` link still in the address bar does not
  start a second checkout over the restored one (`ptStartBuy`).

## Adding a page that uses the address sheet

Typed fields come back for free. To reopen the sheet after a reload, save a
marker before calling `ptCollectAddress`, clear it when the buyer backs out or
the order completes, and call your buy function on load when the marker is set.
`checkout-cart.js` does the storage. Call its `clear()` when the order exists:
it also clears the sheet's draft.

Tests: `src/backend/tests/checkout-survives-reload.test.js` runs the real pages
and the real sheet in jsdom, with a reload modelled as a fresh window that
starts with the old window's `sessionStorage`.
