// The price breakdown a buyer sees after paying: MRP, the code's discount, any
// add-on, delivery and the total actually taken.
//
// Built from the STORED order and nothing else. Every surface that shows it
// (the storefront confirmation, /track-order, the e-mail, the admin views and
// the Razorpay notes) reads these rows rather than doing its own arithmetic, so
// the buyer cannot be shown two different accounts of one payment. Nothing here
// looks at the live catalogue: a price change next month must not rewrite what
// last month's buyer was told they paid.

function rupees(paise) {
  return `₹${(Math.round(Number(paise) || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// Rows of { label, paise, text, total? }, or null when the order cannot be
// itemised honestly. COD orders are left out: their amount carries a surcharge
// and, once converted, a prepaid discount, neither of which this models.
export function orderBreakdown(order) {
  if (!order || typeof order.amount !== "number" || order.paymentMethod === "cod") return null;

  const addOns = (Array.isArray(order.addOns) ? order.addOns : [])
    .filter((item) => item && Number(item.amountPaise) > 0);
  const addOnPaise = addOns.reduce((sum, item) => sum + Number(item.amountPaise), 0);
  const promoPaise = Math.max(0, Number(order.promoDiscountPaise) || 0);
  const referralPaise = order.referredBy ? Math.max(0, Number(order.referralDiscountPaise) || 0) : 0;
  const deliveryPaise = Math.max(0, Number(order.shippingFeePaise) || 0);
  // mrpPaise is written on every guest order from this change on. Older rows
  // are worked back from what they do store.
  // ponytail: the fallback is wrong only when a discount hit the ₹1 floor.
  const mrpPaise = Number.isFinite(order.mrpPaise)
    ? order.mrpPaise
    : order.amount + promoPaise + referralPaise - addOnPaise - deliveryPaise;
  const quantity = Number(order.quantity) > 1 ? Number(order.quantity) : 1;

  const rows = [{ label: quantity > 1 ? `MRP (${quantity} packs)` : "MRP", paise: mrpPaise }];
  if (promoPaise) rows.push({ label: `Discount (${order.promoCode || "code"})`, paise: -promoPaise });
  if (referralPaise) rows.push({ label: "Referral discount", paise: -referralPaise });
  for (const item of addOns) rows.push({ label: item.name || "Add-on", paise: Number(item.amountPaise) });
  // A handover has no parcel, so no delivery line at all.
  if (order.fulfilment !== "handover") rows.push({ label: "Delivery", paise: deliveryPaise, text: deliveryPaise ? undefined : "Free" });
  rows.push({ label: "Total paid", paise: order.amount, total: true });

  return rows.map((row) => ({
    ...row,
    text: row.text || (row.paise < 0 ? `-${rupees(-row.paise)}` : rupees(row.paise))
  }));
}

// One line, for the places that only take text: Razorpay notes, Slack, admin.
export function breakdownText(rows, separator = " | ") {
  return (rows || []).map((row) => `${row.label} ${row.text}`).join(separator);
}
