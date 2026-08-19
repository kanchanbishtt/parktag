// Checkout audit, MEDIUM: the price the buyer agreed to was not the price they
// were asked for.
//
// The "Choose your pack" sheet carried its own hard-coded copy of the catalog,
// totalled it, and printed "No extra charge for COD" underneath. It had no idea
// COD_SURCHARGE_PAISE existed, because the only copy of that lived on the
// server — so place-cod wrote the order for catalog + ₹50 and told Delhivery to
// collect exactly that at the door. Someone who chose Cash on Delivery on the
// strength of that line met a courier asking for ₹50 more, after the parcel had
// already been dispatched.
//
// The fix gives the sheet one place to read prices from: GET /api/shop/pricing,
// serving the same constants the order routes charge from. What these tests pin
// down is that the two really are the same numbers — a quoted price the order
// path does not honour is the whole defect, and it came from a second copy
// drifting, not from anyone writing the wrong figure on purpose.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Nothing here needs Razorpay — pricing and place-cod never call it — and the
// developer .env holds LIVE credentials, so remove them rather than rely on no
// code path reaching out. A regression that made one reach out would create
// real orders in the ParkTag account on every run.
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-pricing@parktag-test.invalid");
const PHONE = "+919812345678";

let app;
let collections;
let ownerId;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});

  const owner = await createTestOwner(collections, {
    email: OWNER_EMAIL,
    // Pre-trusted, so place-cod never asks for an OTP and nothing is dispatched.
    codVerifiedPhone: PHONE
  });
  ownerId = owner._id;
  cookie = await createSession(app, {
    id: String(ownerId), role: "owner", email: owner.email, displayName: owner.displayName
  });
  await collections.addresses.insertOne({
    ownerId, fullName: "Pricing QA", phone: PHONE, line1: "1 Test St",
    city: "Delhi", state: "Delhi", pincode: "110001"
  });
});

function getPricing(withCookie = true) {
  return app.inject({
    method: "GET",
    url: "/api/shop/pricing",
    remoteAddress: uniqueAddress(),
    ...(withCookie ? { cookies: { wavetag_session: cookie } } : {})
  });
}

function placeCod(productId) {
  return app.inject({
    method: "POST",
    url: "/api/shop/place-cod",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    payload: { productId }
  });
}

describe("the checkout can find out what things cost", () => {
  test("a signed-in owner gets the price list", async () => {
    const response = await getPricing();

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.codSurchargePaise, "number", "no COD surcharge reported");
    assert.equal(typeof body.flashDiscountPaise, "number", "no flash discount reported");
    assert.ok(body.products && body.products["pt-car-2"], "the catalog is missing from the price list");
    assert.equal(typeof body.products["pt-car-2"].amountPaise, "number");
  });

  test("it still needs a session, like the rest of /api/shop", async () => {
    // Not a secret — it is a shop's price list — but there is no reason to open
    // an endpoint to the internet that the rest of the surface keeps closed.
    const response = await getPricing(false);

    assert.equal(response.statusCode, 401, `unauthenticated caller got ${response.statusCode}`);
  });
});

describe("the quoted price is the price that gets charged", () => {
  // The defect was never a wrong number typed somewhere. It was two copies of
  // the price, one of which nobody updated. These assertions fail the moment
  // they part company again.

  for (const productId of ["pt-car-1", "pt-car-2", "pt-car-4", "pt-bike-1", "pt-car-2-bike"]) {
    test(`COD on ${productId} collects exactly what the sheet quotes`, async () => {
      const pricing = (await getPricing()).json();
      const quoted = pricing.products[productId].amountPaise + pricing.codSurchargePaise;

      const placed = await placeCod(productId);
      assert.equal(placed.statusCode, 200, placed.body);

      assert.equal(
        placed.json().amount,
        quoted,
        "the order was written for a different amount than the checkout quoted"
      );

      // And that is the figure Delhivery is told to collect, which is where a
      // mismatch actually reaches the customer.
      const order = await collections.shopOrders.findOne({ orderNumber: placed.json().orderNumber });
      assert.equal(order.amount, quoted, "the courier would collect an amount nobody agreed to");
    });
  }

  test("the surcharge is a real one, not zero", async () => {
    // If it were zero the assertions above would hold trivially while the sheet
    // said nothing about COD costing more — which is the state that shipped.
    const pricing = (await getPricing()).json();

    assert.ok(
      pricing.codSurchargePaise > 0,
      "COD carries no surcharge — the display fix is then untested, so re-check the sheet"
    );
  });

  test("prepaying a COD order lands back exactly on the catalog price", async () => {
    // The confirmation screen offers "Pay X online now", where X is the COD
    // total minus the flash discount. That has to be the catalog price the pack
    // sheet showed, or the offer quotes a third different number.
    const pricing = (await getPricing()).json();
    const placed = await placeCod("pt-car-2");
    assert.equal(placed.statusCode, 200, placed.body);

    assert.equal(
      placed.json().amount - pricing.flashDiscountPaise,
      pricing.products["pt-car-2"].amountPaise,
      "the flash offer does not bring a COD order back to the catalog price"
    );
  });
});

describe("the checkout page reads its prices from the server", () => {
  // Coarse on purpose: the defect lived in the page, and there is no DOM
  // harness here. What this catches is the fix being reverted — the page going
  // back to totalling its own copy of the catalog with no idea a surcharge
  // exists. It cannot check what the sheet renders; the assertions above check
  // that the numbers it is handed are the right ones.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const CHECKOUT_PAGE = path.join(here, "../../frontend/pages/owner/welcome.html");

  test("it asks the server for the price list", async () => {
    const page = await readFile(CHECKOUT_PAGE, "utf8");

    assert.ok(
      page.includes("/api/shop/pricing"),
      "the checkout no longer fetches server prices — it is back on its own hard-coded copy"
    );
  });

  test("the Cash on Delivery total is derived from the server's surcharge", async () => {
    const page = await readFile(CHECKOUT_PAGE, "utf8");

    assert.ok(
      page.includes("codSurchargePaise"),
      "the COD total is not built from the surcharge the server actually applies"
    );
  });
});
