// The Clear Dashboard Plate is sold with the Duo Pack (pt-car-2) only.
//
// The storefronts hide it for every other pack, but a hidden checkbox is not a
// rule: create-order is what refuses it, so that is what this pins. Razorpay is
// deliberately unconfigured, so an accepted plate is proven by reaching the
// "Razorpay not configured." guard -- past every validation, before any order.

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app, collections, previous;

const ADDRESS = {
  fullName: "Plate QA", phone: "9812345678", line1: "1 QA St",
  city: "Noida", state: "Uttar Pradesh", pincode: "201301"
};

const createOrder = (body) =>
  app.inject({ method: "POST", url: "/api/shop/guest/create-order", remoteAddress: uniqueAddress(), payload: body });

before(async () => {
  ({ app, collections } = await startTestApp());
  previous = await collections.storeSettings.findOne({ _id: "public-shop" });
  await collections.storeSettings.updateOne(
    { _id: "public-shop" },
    { $set: { dashboardPlate: { enabled: true, pricePaise: 4900 } } },
    { upsert: true }
  );
});

after(async () => {
  if (previous) await collections.storeSettings.replaceOne({ _id: "public-shop" }, previous);
  else await collections.storeSettings.deleteOne({ _id: "public-shop" });
  await stopTestApp(app);
});

describe("dashboard plate is Duo Pack only", () => {
  test("the catalogue says which pack the plate belongs to", async () => {
    const res = await app.inject({ method: "GET", url: "/api/shop/public-catalogue", remoteAddress: uniqueAddress() });
    const plate = res.json().addOns.find((item) => item.id === "dashboard-plate");
    assert.deepEqual(plate.productIds, ["pt-car-2"]);
    assert.equal(plate.amountPaise, 4900);
  });

  test("plate with pt-car-2 is accepted", async () => {
    const res = await createOrder({ productId: "pt-car-2", address: ADDRESS, addOnId: "dashboard-plate" });
    assert.equal(res.statusCode, 500, res.body);
    assert.equal(res.json().error, "Razorpay not configured.");
  });

  test("plate with pt-car-1 is rejected", async () => {
    const res = await createOrder({ productId: "pt-car-1", address: ADDRESS, addOnId: "dashboard-plate" });
    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.json().error, /only available with the Duo Pack/);
  });

  // These two are sold out, and that refusal comes first: there is no point
  // explaining which pack the plate goes with for a pack that cannot be bought.
  for (const productId of ["pt-bike-1", "pt-combo"]) {
    test(`plate with ${productId} is rejected as sold out`, async () => {
      const res = await createOrder({ productId, address: ADDRESS, addOnId: "dashboard-plate" });
      assert.equal(res.statusCode, 409, res.body);
      assert.match(res.json().error, /sold out/i);
    });
  }
});
