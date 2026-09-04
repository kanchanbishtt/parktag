// The public shop, and the pack id that travels with it.
//
// /shop serves the storefront to a signed-out visitor, prices, packs and a
// guest checkout, no login. It used to redirect to /owner-login, which is the
// wall docs/SHOP_LOGIN_WALL.md describes, and these tests pin that it no longer
// does.
//
// /get is where the storefront lived first. It redirects to /shop and carries a
// chosen pack across in the query string. That value arrives on a public URL and
// is put into a Location header, so it is validated against the same catalogue
// create-order prices from; these tests are what stops that validation from
// quietly being removed.

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { SHOP_PRODUCTS } from "../lib/integrations/payments.js";
import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app;

const get = (url) => app.inject({ method: "GET", url, remoteAddress: uniqueAddress() });

before(async () => {
  ({ app } = await startTestApp());
});

after(async () => {
  await stopTestApp(app);
});

describe("/shop is public", () => {
  test("a signed-out visitor gets the storefront, not a login screen", async () => {
    const res = await get("/shop");

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.body, /Pick your ParkTag/);
    assert.doesNotMatch(res.body, /owner-welcome/, "served something from the dashboard");
  });

  test("a pack in the query string does not change that", async () => {
    for (const url of ["/shop?sku=pt-car-2", "/shop?sku=NOT-A-PRODUCT", "/shop?sku[]=pt-car-2"]) {
      const res = await get(url);
      assert.equal(res.statusCode, 200, `${url} did not serve the shop`);
      assert.match(res.body, /Pick your ParkTag/);
    }
  });

  // The value is read client-side to highlight a card. It must not come back
  // out of the server in any form.
  test("the pack id is never echoed into the page", async () => {
    const res = await get("/shop?sku=%3Cscript%3Ealert(1)%3C%2Fscript%3E");

    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
  });
});

describe("/get forwards to /shop", () => {
  test("with no pack named", async () => {
    const res = await get("/get");

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "/shop");
  });

  test("every real product survives the hop", async () => {
    for (const id of Object.keys(SHOP_PRODUCTS)) {
      const res = await get(`/get?sku=${encodeURIComponent(id)}`);
      assert.equal(res.statusCode, 302);
      assert.equal(
        res.headers.location,
        `/shop?sku=${encodeURIComponent(id)}`,
        `${id} was dropped on the way to the shop`
      );
    }
  });

  // The security half. A pack id that is not a pack is dropped rather than
  // echoed onward, otherwise this route would put attacker-chosen text into a
  // Location header.
  for (const [name, raw] of [
    ["an unknown id", "NOT-A-PRODUCT"],
    ["markup", "<script>alert(1)</script>"],
    ["a prototype key", "constructor"],
    ["another prototype key", "__proto__"],
    ["a newline, which would split the header", "pt-car-2\nX-Injected: 1"],
    ["an absolute URL", "https://example.com/"],
    ["a path traversal", "../../admin"]
  ]) {
    test(`${name} is dropped, not carried`, async () => {
      const res = await get(`/get?sku=${encodeURIComponent(raw)}`);

      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, "/shop");
    });
  }

  // Query strings can carry arrays, and `SHOP_PRODUCTS[["pt-car-2"]]` coerces
  // to the string and would match a real product. getShopProduct's typeof guard
  // is what stops that; this is the test that says so out loud.
  test("an array is not a product id", async () => {
    const res = await get("/get?sku[]=pt-car-2");

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "/shop");
  });
});
