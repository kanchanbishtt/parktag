// Sales grouped by the tagged link the buyer arrived on.
//
// Every order carries `attribution` (utm_* copied from the pt_attr cookie at checkout, see attribution.js),
// so a campaign's sales are already recorded; nothing reads them back. This does.
//
// Last touch, like the cookie: a buyer who clicked a hanger QR on Monday and a WhatsApp link on Tuesday
// is counted under Tuesday's. An order with no utm_source, or from before attribution existed, is "(untagged)".
//
// Money is paise on the order (COD includes its surcharge) and rupees in the output.

// Same definition of a real order the /sales Slack command uses: our own test orders and giveaways are not sales.
export const REAL_ORDERS = { internal: { $ne: true }, channel: { $nin: ["internal", "giveaway"] }, deletedAt: null };

const SALE = new Set(["paid", "cod"]);
const rupees = (paise) => Math.round(paise) / 100;

function blank(a) {
  return {
    source: a.source || "(untagged)", medium: a.medium || null, campaign: a.campaign || null, content: a.content || null,
    checkoutsStarted: 0, orders: 0, paid: 0, cod: 0, revenuePaise: 0, discountPaise: 0, promoCodes: new Set()
  };
}

function finish(g) {
  const { revenuePaise, discountPaise, promoCodes, ...rest } = g;
  return {
    ...rest,
    conversionPct: g.checkoutsStarted ? Math.round((g.orders / g.checkoutsStarted) * 1000) / 10 : 0,
    revenue: rupees(revenuePaise), discountGiven: rupees(discountPaise), promoCodes: [...promoCodes].sort()
  };
}

/** @param orders shop orders with status, amount, promoCode, promoDiscountPaise, attribution. */
export function summariseUtmSales(orders) {
  const groups = new Map();
  const total = blank({ source: "all" });

  for (const o of orders) {
    const a = o.attribution?.source ? o.attribution : {};
    const key = [a.source, a.medium, a.campaign, a.content].map((v) => v || "").join("|");
    if (!groups.has(key)) groups.set(key, blank(a));

    for (const g of [groups.get(key), total]) {
      g.checkoutsStarted += 1; // every order row began as a checkout, paid or not
      if (!SALE.has(o.status)) continue;
      g.orders += 1;
      g[o.status] += 1;
      g.revenuePaise += Number(o.amount) || 0;
      g.discountPaise += Number(o.promoDiscountPaise) || 0;
      if (o.promoCode) g.promoCodes.add(o.promoCode);
    }
  }

  return {
    totals: finish(total),
    groups: [...groups.values()].map(finish).sort((x, y) => y.revenue - x.revenue || y.checkoutsStarted - x.checkoutsStarted)
  };
}
