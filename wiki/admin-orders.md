# The admin Orders page

Added 2026-10-06. Until then no admin screen showed an order with its amount,
address and payment mode together: the Activations page had the price and the
phone, the reconciliation report the order number, and the address lived only
in the order document and the courier booking.

## What it shows

`/admin/orders` (sidebar: Management → Orders). Views with counts:

| View | Filter |
| --- | --- |
| Sales | status paid or cod, not ours, not deleted (the default) |
| Abandoned | status created: the checkout opened and the buyer left |
| Ours | `internal: true` or `channel: "internal"`: the team's test orders |
| All | everything not deleted |

Newest first, 50 a page. Search covers order number, order id, payment id,
payment ref, waybill, product, promo code, buyer name, city, pincode and the
phone in any spelling (an Indian number is matched on its last ten digits).

Each row: order number and channel; product × quantity and stickers activated
of capacity; buyer, phone and the full address; the amount with how it was
paid; delivery state with the AWB linked to Delhivery tracking. Details adds
the price breakdown, payment id, paid-at, promo and referral discounts,
add-ons, email, the owner account, the campaign and any note.

## Payment modes

| Mode | Meaning |
| --- | --- |
| online | paid through Razorpay at checkout |
| cod | cash on delivery, still due; the amount includes the COD fee and says so |
| cod_prepaid | placed as COD, then paid online before delivery; the amount is what was paid, with the COD figure noted |
| manual | a sale recorded by hand (`record-manual-order.mjs`); the pill names the method, e.g. "Paid by UPI" |

An abandoned checkout reads "Not paid".

## Nothing is recomputed

The page reads the stored order through the helpers everything else uses:
`orderBreakdown` / `breakdownText` for the price lines (the same account the
buyer, the e-mail and Razorpay carry), `addressLine` for the address (what the
courier was given), `deliveryStateOf` from the Activations page (now exported
from `routes/admin/index.js`) for where the parcel is, `capacityOf` for how
many stickers the order holds. A signed-in COD order stores no fee field, so
the breakdown helper declines to itemise it and the page shows "—" there; the
amount is still right.

## Also

- `GET /api/admin/orders?view=&q=&page=` is on the API token read scope.
- MCP tool `parktag_orders` (read; customer text fenced as untrusted).
- Read-only. Cancelling, refunding or editing an order is not on this page.
