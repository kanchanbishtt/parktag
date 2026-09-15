import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { discountPaiseFor, shippingFeePaiseFor } from "../lib/core/promo-codes.js";

describe("discountPaiseFor: flat mode", () => {
  test("flat comes off regardless of quantity", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "flat", discountPaise: 9900 }, { subtotalPaise: 149700, quantity: 3 }),
      9900
    );
  });
  test("an absent discountMode is treated as flat (back-compat)", () => {
    assert.equal(
      discountPaiseFor({ discountPaise: 9900 }, { subtotalPaise: 49900, quantity: 1 }),
      9900
    );
  });
  test("an unrecognised mode falls back to flat, not zero", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "teleport", discountPaise: 9900 }, { subtotalPaise: 49900, quantity: 1 }),
      9900
    );
  });
});

describe("discountPaiseFor: per_unit mode", () => {
  test("multiplies by quantity", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "per_unit", discountPaise: 5000 }, { subtotalPaise: 149700, quantity: 3 }),
      15000
    );
  });
  test("quantity 1 behaves exactly like flat", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "per_unit", discountPaise: 5000 }, { subtotalPaise: 49900, quantity: 1 }),
      5000
    );
  });
  test("a missing/zero/negative quantity floors to 1, never multiplies by 0 or goes negative", () => {
    for (const quantity of [0, -3, undefined, null]) {
      assert.equal(
        discountPaiseFor({ discountMode: "per_unit", discountPaise: 5000 }, { subtotalPaise: 49900, quantity }),
        5000
      );
    }
  });
});

describe("discountPaiseFor: percent mode", () => {
  test("computes a percentage of the subtotal", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "percent", discountPercent: 20 }, { subtotalPaise: 49900, quantity: 1 }),
      9980
    );
  });
  test("percent scales with the subtotal, not applied per-unit again", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "percent", discountPercent: 20 }, { subtotalPaise: 149700, quantity: 3 }),
      29940
    );
  });
  test("percent above 100 is clamped to 100", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "percent", discountPercent: 250 }, { subtotalPaise: 49900, quantity: 1 }),
      49900
    );
  });
  test("a negative percent is clamped to 0", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "percent", discountPercent: -10 }, { subtotalPaise: 49900, quantity: 1 }),
      0
    );
  });
  test("rounds to the nearest paisa", () => {
    assert.equal(
      discountPaiseFor({ discountMode: "percent", discountPercent: 33 }, { subtotalPaise: 29900, quantity: 1 }),
      Math.round(29900 * 0.33)
    );
  });
});

describe("shippingFeePaiseFor", () => {
  test("no fee configured means free shipping, exactly like today", () => {
    assert.equal(shippingFeePaiseFor({}, { subtotalPaise: 49900 }), 0);
    assert.equal(shippingFeePaiseFor({ shippingFeePaise: null }, { subtotalPaise: 49900 }), 0);
  });
  test("a configured fee applies below the threshold", () => {
    assert.equal(
      shippingFeePaiseFor({ shippingFeePaise: 4900, freeShippingAbovePaise: 99900 }, { subtotalPaise: 49900 }),
      4900
    );
  });
  test("the fee drops to zero AT the threshold, not only strictly above it", () => {
    assert.equal(
      shippingFeePaiseFor({ shippingFeePaise: 4900, freeShippingAbovePaise: 99900 }, { subtotalPaise: 99900 }),
      0
    );
  });
  test("one paisa below the threshold still charges the fee", () => {
    assert.equal(
      shippingFeePaiseFor({ shippingFeePaise: 4900, freeShippingAbovePaise: 99900 }, { subtotalPaise: 99899 }),
      4900
    );
  });
  test("a fee with no threshold always applies", () => {
    assert.equal(shippingFeePaiseFor({ shippingFeePaise: 4900 }, { subtotalPaise: 999900 }), 4900);
  });
  test("a negative configured fee is clamped to zero, not charged as a credit", () => {
    assert.equal(shippingFeePaiseFor({ shippingFeePaise: -500 }, { subtotalPaise: 49900 }), 0);
  });
});
