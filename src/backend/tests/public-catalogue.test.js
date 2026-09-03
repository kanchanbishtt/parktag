// The price list a stranger is allowed to read, and what it must never carry.
//
// /get is a shop window: it has to quote a price to somebody who has not signed
// in, because every buy button on the marketing site currently lands on a login
// screen before a price is visible (docs/SHOP_LOGIN_WALL.md).
//
// Opening a previously session-gated endpoint deserves its own tests for two
// separate reasons. One is that it must keep agreeing with what checkout
// charges — a storefront quoting a figure the order routes do not honour is
// worse than no storefront, and prices in this repo have drifted apart before.
// The other is that "public" is a promise about what is NOT in the response.

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { SHOP_PRODUCTS } from "../lib/integrations/payments.js";
import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app;

const get = () =>
  app.inject({ method: "GET", url: "/api/shop/public-catalogue", remoteAddress: uniqueAddress() });

before(async () => {
  ({ app } = await startTestApp());
});

after(async () => {
  await stopTestApp(app);
});

describe("the public price list", () => {
  // The point of the endpoint. No cookie, no session, no owner.
  test("it answers without a session", async () => {
    const res = await get();

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  });

  // The reason it exists rather than the page hard-coding numbers: this is the
  // same catalogue create-order resolves its amount from, so the two cannot
  // disagree about what a pack costs.
  test("every price is the catalogue price, to the paise", async () => {
    const { products } = (await get()).json();

    for (const [id, product] of Object.entries(SHOP_PRODUCTS)) {
      assert.ok(products[id], `${id} is missing from the public list`);
      assert.equal(
        products[id].amountPaise,
        Math.round(product.amount * 100),
        `${id} is advertised at a price the checkout does not charge`
      );
      assert.equal(products[id].name, product.name);
    }
  });

  test("it lists every product and invents none", async () => {
    const { products } = (await get()).json();

    assert.deepEqual(Object.keys(products).sort(), Object.keys(SHOP_PRODUCTS).sort());
  });

  // The COD surcharge is disclosed for the same reason the pack sheet discloses
  // it: a buyer agreeing to one figure and being asked for a higher one at the
  // door is exactly the bug this repo already shipped once.
  test("the COD surcharge is disclosed, not hidden", async () => {
    const body = (await get()).json();

    assert.equal(typeof body.codSurchargePaise, "number");
    assert.ok(body.codSurchargePaise >= 0);
  });

  // "Public" is a promise about the response shape. If this endpoint ever
  // starts reading a session, this is what should fail first.
  test("it carries nothing about an owner, a session or a tag", async () => {
    const res = await get();
    const raw = res.body.toLowerCase();

    for (const leaked of ["ownerid", "session", "cookie", "email", "mobile", "tagid", "token", "secret"]) {
      assert.ok(!raw.includes(leaked), `the public catalogue leaked "${leaked}"`);
    }

    // And it must not start setting one either.
    assert.equal(res.headers["set-cookie"], undefined);
    assert.deepEqual(Object.keys(res.json()).sort(), ["codSurchargePaise", "ok", "products"]);
  });
});
