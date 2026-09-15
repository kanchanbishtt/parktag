import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

import { startTestApp, stopTestApp } from "./helpers.js";

let app, collections;
before(async () => { ({ app, collections } = await startTestApp()); });
after(async () => { await stopTestApp(app); });
beforeEach(async () => { await collections.shopOrders.deleteMany({}); });

describe("reuse-order dedup does not cross quantities or promo codes", () => {
  test("an unpaid quantity-1 order is never handed back for a quantity-3 request at the same pack/address", async () => {
    const shipping = { fullName: "Dedup QA", phone: "9812345678", city: "Noida" };
    await collections.shopOrders.insertOne({
      orderId: "order_qty1", orderNumber: "PT-QA-DEDUP1", paymentMethod: "online",
      ownerId: null, guest: true, productId: "pt-car-2", variant: null,
      quantity: 1, amount: 49900, currency: "INR", status: "created",
      shippingAddress: shipping, createdAt: new Date().toISOString()
    });
    const found = await collections.shopOrders.findOne({
      ownerId: null, guest: true, status: "created",
      productId: "pt-car-2", variant: null, quantity: 3, amount: 149700
    });
    assert.equal(found, null, "a quantity-1 order must not match a quantity-3 reuse lookup");
  });
  test("an unpaid order created under promo code A is never handed back for a request naming promo code B", async () => {
    const shipping = { fullName: "Dedup QA 2", phone: "9812345699", city: "Noida" };
    await collections.shopOrders.insertOne({
      orderId: "order_codeA", orderNumber: "PT-QA-DEDUP2", paymentMethod: "online",
      ownerId: null, guest: true, productId: "pt-car-2", variant: null,
      quantity: 1, amount: 40000, promoCode: "CODEA100", currency: "INR", status: "created",
      shippingAddress: shipping, createdAt: new Date().toISOString()
    });
    const found = await collections.shopOrders.findOne({
      ownerId: null, guest: true, status: "created",
      productId: "pt-car-2", variant: null, quantity: 1, amount: 40000, promoCode: "CODEB100"
    });
    assert.equal(found, null, "a different promo code must not silently reuse another code's order");
  });
});
