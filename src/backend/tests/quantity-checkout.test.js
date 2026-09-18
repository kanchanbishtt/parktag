import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { validateAddress } from "../lib/core/address.js";

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
  test("valid input reaches the missing-payment-configuration guard", async () => {
    const res = await guestCreateOrder({ productId: "pt-car-2", address: ADDRESS });
    assert.equal(res.statusCode, 500, res.body);
    assert.equal(res.json().error, "Razorpay not configured.");
  });
  test("a missing quantity defaults to 1 (back-compat with existing clients)", async () => {
    await collections.shopOrders.insertOne({
      orderId: "order_qty_one", orderNumber: "PT-QTY-ONE", ownerId: null,
      guest: true, status: "created", productId: "pt-car-2", variant: null,
      promoCode: null, amount: 49900, currency: "INR",
      shippingAddress: validateAddress(ADDRESS).address, createdAt: new Date().toISOString()
    });
    const res = await guestCreateOrder({ productId: "pt-car-2", address: ADDRESS });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().orderId, "order_qty_one");
    assert.equal(res.json().amount, 49900);
    assert.equal(await collections.shopOrders.countDocuments({}), 1);
  });
  test("quantity 3 reuses the correctly priced multi-pack order", async () => {
    await collections.shopOrders.insertOne({
      orderId: "order_qty_three", orderNumber: "PT-QTY-THREE", ownerId: null,
      guest: true, status: "created", productId: "pt-car-2", variant: null,
      quantity: 3, promoCode: null, amount: 149700, currency: "INR",
      shippingAddress: validateAddress(ADDRESS).address, createdAt: new Date().toISOString()
    });
    const res = await guestCreateOrder({ productId: "pt-car-2", address: ADDRESS, quantity: 3 });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().orderId, "order_qty_three");
    assert.equal(res.json().amount, 149700);
  });
});
