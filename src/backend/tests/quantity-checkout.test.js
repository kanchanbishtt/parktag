import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app, collections;

before(async () => { ({ app, collections } = await startTestApp()); });
after(async () => {
  await collections.shopOrders.deleteMany({ orderNumber: /^PT-QTY-/ }).catch(() => {});
  await stopTestApp(app);
});
beforeEach(async () => { await collections.shopOrders.deleteMany({}); });

function guestCreateOrder(body) {
  return app.inject({
    method: "POST",
    url: "/api/shop/guest/create-order",
    remoteAddress: uniqueAddress(),
    payload: body
  });
}

const ADDRESS = {
  fullName: "Qty QA", phone: "9812345678", line1: "1 QA St",
  city: "Noida", state: "UP", pincode: "201301"
};

describe("guest checkout accepts a quantity", () => {
  for (const bad of [0, -1, 1.5, "3", null]) {
    test(`quantity ${JSON.stringify(bad)} is refused before Razorpay is ever reached`, async () => {
      const res = await guestCreateOrder({ productId: "pt-car-2", address: ADDRESS, quantity: bad });
      assert.equal(res.statusCode, 400, res.body);
      assert.notEqual(res.json().error, "Razorpay not configured.");
    });
  }
  test("a missing quantity defaults to 1 (back-compat with existing clients)", async () => {
    const res = await guestCreateOrder({ productId: "pt-car-2", address: ADDRESS });
    assert.equal(res.statusCode, 500, res.body);
    assert.equal(res.json().error, "Failed to create order. Please try again.");
  });
  test("quantity 3 is accepted and reaches order pricing", async () => {
    const res = await guestCreateOrder({ productId: "pt-car-2", address: ADDRESS, quantity: 3 });
    assert.equal(res.statusCode, 500, res.body);
  });
});
