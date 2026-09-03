// Carrying a chosen pack from the public storefront into the real checkout.
//
// /get shows prices to a signed-out visitor, and its Order buttons name a pack.
// /shop is what turns that into either the login screen or the dashboard's shop
// tab, and it has to carry the chosen pack across without becoming a way to put
// arbitrary text into a redirect.
//
// The value arrives in a query string on a public page and every hop after this
// one puts it into a URL, so it is validated HERE, once, against the same
// catalogue create-order prices from. Downstream — login.js parking it in
// sessionStorage, welcome.js handing it to the shop — trusts that check, which
// is why it is worth pinning.

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { SHOP_PRODUCTS } from "../lib/integrations/payments.js";
import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app;

const shop = (url) => app.inject({ method: "GET", url, remoteAddress: uniqueAddress() });

before(async () => {
  ({ app } = await startTestApp());
});

after(async () => {
  await stopTestApp(app);
});

describe("carrying a pack from the storefront into checkout", () => {
  test("a signed-out visitor is sent to sign in, with the pack kept", async () => {
    const res = await shop("/shop?sku=pt-car-2");

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "/owner-login?next=shop&sku=pt-car-2");
  });

  test("every real product survives the hop", async () => {
    for (const id of Object.keys(SHOP_PRODUCTS)) {
      const res = await shop(`/shop?sku=${encodeURIComponent(id)}`);
      assert.equal(
        res.headers.location,
        `/owner-login?next=shop&sku=${encodeURIComponent(id)}`,
        `${id} was dropped on the way to checkout`
      );
    }
  });

  test("no pack named is still just the shop", async () => {
    const res = await shop("/shop");

    assert.equal(res.headers.location, "/owner-login?next=shop");
  });

  // The security half. A pack id that is not a pack is dropped rather than
  // echoed onward — otherwise this route would put attacker-chosen text into a
  // Location header and, two hops later, into sessionStorage.
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
      const res = await shop(`/shop?sku=${encodeURIComponent(raw)}`);

      assert.equal(res.headers.location, "/owner-login?next=shop");
    });
  }

  // Query strings can carry arrays, and `SHOP_PRODUCTS[["pt-car-2"]]` coerces
  // to the string and would match a real product. getShopProduct's typeof guard
  // is what stops that; this is the test that says so out loud.
  test("an array is not a product id", async () => {
    const res = await shop("/shop?sku[]=pt-car-2");

    assert.equal(res.headers.location, "/owner-login?next=shop");
  });

  // Whatever it does with the pack, it must not answer the page itself to
  // somebody with no session.
  test("it never serves the dashboard to a signed-out visitor", async () => {
    for (const url of ["/shop", "/shop?sku=pt-car-2", "/shop?sku=NOT-A-PRODUCT"]) {
      const res = await shop(url);
      assert.equal(res.statusCode, 302);
      assert.ok(res.headers.location.startsWith("/owner-login"), `${url} did not require sign-in`);
    }
  });
});
