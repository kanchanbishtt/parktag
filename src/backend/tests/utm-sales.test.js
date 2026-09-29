// Sales by tagged link: grouping, money and what counts as a sale. Pure, so no database.
import test from "node:test";
import assert from "node:assert/strict";

import { summariseUtmSales } from "../lib/core/utm-sales.js";

const hanger = { source: "doorhanger", medium: "print", campaign: "doorhanger-flat100" };

test("groups by tagged link and counts only paid and COD as sales", () => {
  const { totals, groups } = summariseUtmSales([
    { status: "paid", amount: 39900, promoCode: "DOORHANGER100", promoDiscountPaise: 10000, attribution: hanger },
    { status: "cod", amount: 44800, promoCode: "DOORHANGER100", promoDiscountPaise: 10000, attribution: hanger },
    { status: "created", amount: 39900, attribution: hanger },
    { status: "paid", amount: 49900, attribution: { source: "whatsapp", medium: "group", campaign: "society" } }
  ]);

  const h = groups.find((g) => g.source === "doorhanger");
  assert.equal(h.checkoutsStarted, 3);
  assert.equal(h.orders, 2);
  assert.equal(h.paid, 1);
  assert.equal(h.cod, 1);
  assert.equal(h.revenue, 847);
  assert.equal(h.discountGiven, 200);
  assert.equal(h.conversionPct, 66.7);
  assert.deepEqual(h.promoCodes, ["DOORHANGER100"]);

  assert.equal(totals.orders, 3);
  assert.equal(totals.revenue, 1346);
  assert.equal(groups[0].source, "doorhanger", "biggest revenue first");
});

test("an order with no utm_source, or no attribution at all, is untagged", () => {
  const { groups } = summariseUtmSales([
    { status: "paid", amount: 49900 },
    { status: "paid", amount: 49900, attribution: null },
    { status: "paid", amount: 49900, attribution: { medium: "print" } }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].source, "(untagged)");
  assert.equal(groups[0].medium, null, "a medium without a source is not a campaign");
  assert.equal(groups[0].orders, 3);
});

test("the same source in two campaigns stays two rows", () => {
  const { groups } = summariseUtmSales([
    { status: "paid", amount: 1000, attribution: { source: "doorhanger", campaign: "a" } },
    { status: "paid", amount: 1000, attribution: { source: "doorhanger", campaign: "b" } }
  ]);
  assert.deepEqual(groups.map((g) => g.campaign).sort(), ["a", "b"]);
});

test("no orders is an empty report, not a crash or a NaN", () => {
  const { totals, groups } = summariseUtmSales([]);
  assert.deepEqual(groups, []);
  assert.equal(totals.revenue, 0);
  assert.equal(totals.conversionPct, 0);
});

test("a row with a missing or junk amount adds nothing instead of poisoning the total", () => {
  const { totals } = summariseUtmSales([
    { status: "paid", attribution: hanger },
    { status: "paid", amount: "abc", attribution: hanger },
    { status: "paid", amount: 39900, attribution: hanger }
  ]);
  assert.equal(totals.revenue, 399);
  assert.equal(totals.orders, 3);
});
