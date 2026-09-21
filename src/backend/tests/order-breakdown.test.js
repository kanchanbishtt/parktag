// The price breakdown shown after payment, and the funnel events around it.
//
// Pure: no database, no app. The breakdown is read off a stored order, so the
// cases here are stored-order shapes; the storefront checks are source-level,
// the same way the other checkout tests hold down what the pages send.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orderBreakdown, breakdownText } from "../lib/core/order-breakdown.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (file) => readFile(path.join(root, file), "utf8");

// A LAUNCH100 Duo Pack with the plate, as guest create-order stores it.
const LAUNCH_DUO_WITH_PLATE = {
  paymentMethod: "online",
  amount: 44800,
  quantity: 1,
  mrpPaise: 49900,
  promoCode: "LAUNCH100",
  promoDiscountPaise: 10000,
  addOns: [{ id: "dashboard-plate", name: "Clear Dashboard Plate", amountPaise: 4900 }],
  shippingFeePaise: 0,
  referredBy: null,
  referralDiscountPaise: 0
};

describe("orderBreakdown", () => {
  test("itemises MRP, launch discount, plate, free delivery and the total paid", () => {
    assert.deepEqual(
      orderBreakdown(LAUNCH_DUO_WITH_PLATE).map(({ label, text, total }) => [label, text, Boolean(total)]),
      [
        ["MRP", "₹499", false],
        ["Discount (LAUNCH100)", "-₹100", false],
        ["Clear Dashboard Plate", "₹49", false],
        ["Delivery", "Free", false],
        ["Total paid", "₹448", true]
      ]
    );
  });

  test("the rows add up to what was actually taken", () => {
    const rows = orderBreakdown(LAUNCH_DUO_WITH_PLATE);
    const lines = rows.filter((row) => !row.total).reduce((sum, row) => sum + row.paise, 0);
    assert.equal(lines, rows.find((row) => row.total).paise);
  });

  test("an order stored before mrpPaise existed is worked back from its own fields", () => {
    const { mrpPaise, shippingFeePaise, ...legacy } = LAUNCH_DUO_WITH_PLATE;
    assert.equal(orderBreakdown(legacy)[0].paise, 49900);
  });

  test("never reads the live catalogue: the stored MRP wins", () => {
    const rows = orderBreakdown({ ...LAUNCH_DUO_WITH_PLATE, mrpPaise: 45000, amount: 39900, addOns: [] });
    assert.equal(rows[0].text, "₹450");
  });

  test("names the pack count and a referral discount when there is one", () => {
    const rows = orderBreakdown({
      paymentMethod: "online", amount: 89800, quantity: 2, mrpPaise: 99800,
      promoCode: "LAUNCH100", promoDiscountPaise: 5000,
      referredBy: "owner-1", referralDiscountPaise: 5000
    });
    assert.equal(rows[0].label, "MRP (2 packs)");
    assert.ok(rows.some((row) => row.label === "Referral discount" && row.paise === -5000));
  });

  test("a charged delivery fee is shown as an amount, a handover has no delivery line", () => {
    const shipped = orderBreakdown({ paymentMethod: "online", amount: 54800, mrpPaise: 49900, shippingFeePaise: 4900 });
    assert.equal(shipped.find((row) => row.label === "Delivery").text, "₹49");
    const handover = orderBreakdown({ paymentMethod: "online", amount: 30000, mrpPaise: 49900, promoCode: "HANDOVER", promoDiscountPaise: 19900, fulfilment: "handover" });
    assert.equal(handover.some((row) => row.label === "Delivery"), false);
  });

  test("COD and malformed orders get no breakdown rather than a wrong one", () => {
    assert.equal(orderBreakdown({ paymentMethod: "cod", amount: 54900 }), null);
    assert.equal(orderBreakdown({}), null);
    assert.equal(orderBreakdown(null), null);
    assert.equal(breakdownText(null), "");
  });

  test("breakdownText is one line for notes, Slack and admin", () => {
    assert.equal(
      breakdownText(orderBreakdown(LAUNCH_DUO_WITH_PLATE)),
      "MRP ₹499 | Discount (LAUNCH100) -₹100 | Clear Dashboard Plate ₹49 | Delivery Free | Total paid ₹448"
    );
  });
});

describe("funnel events", () => {
  const STOREFRONTS = ["src/frontend/scripts/shop.js", "src/frontend/scripts/get.js", "src/frontend/scripts/direct.js"];

  for (const file of STOREFRONTS) {
    test(`${path.basename(file)} fires each checkout step exactly once`, async () => {
      const source = await read(file);
      for (const name of ["view_item", "begin_checkout", "add_shipping_info", "add_payment_info", "add_on_selected", "purchase"]) {
        const calls = source.match(new RegExp(`ptTrack\\("${name}"`, "g")) || [];
        assert.equal(calls.length, 1, `${name} should have one call site in ${file}, found ${calls.length}`);
      }
      assert.match(source, /renderBreakdown\(done\.breakdown\)/, "the confirmation must render the server's breakdown");
    });
  }

  test("direct.js prices begin_checkout from the re-checked code for ANY pack, plus the plate", async () => {
    const source = await read("src/frontend/scripts/direct.js");
    assert.doesNotMatch(source, /sku === HERO_PACK\s*\n?\s*\?\s*promoState\.payablePaise/);
    const buy = source.slice(source.indexOf("async function buy("), source.indexOf("function renderBreakdown("));
    const recheck = buy.indexOf("await checkCode(sku)");
    const begin = buy.indexOf('ptTrack("begin_checkout"');
    assert.ok(recheck > -1 && begin > recheck, "begin_checkout must fire after the code is re-checked for this pack");
    assert.match(buy, /value: \(payablePaise \+ \(addOn\?\.amountPaise \|\| 0\)\) \/ 100/);
  });

  test("the landing banner reports select_promotion with the offer's code", async () => {
    const source = await read("landing/app/components/LaunchOffer.tsx");
    assert.match(source, /ptTrack\?\.\("select_promotion", \{\s*promotion_id: offer\.code/);
  });

  test("every new event is mapped and its parameters survive the allow-list", async () => {
    const source = await read("src/backend/assets/analytics.js");
    for (const name of ["add_shipping_info", "add_payment_info", "select_promotion", "add_on_selected"]) {
      assert.match(source, new RegExp(`${name}:\\s*\\{ ga: "${name}"`), `${name} is not in the event map`);
    }
    const allowList = source.slice(source.indexOf("var ALLOWED"), source.indexOf("function sanitize"));
    assert.match(allowList, /\bpromotion_id: 1\b/);
  });
});
