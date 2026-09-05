// The public shop, and the pack id that travels with it.
//
// /shop serves the storefront to a signed-out visitor, prices, packs and a
// guest checkout, no login. It used to redirect to /owner-login, which is the
// wall docs/SHOP_LOGIN_WALL.md describes, and these tests pin that it no longer
// does.
//
// /get is where the storefront lived first, and it is a page again rather than
// a redirect into /shop. Nothing links to it by design, so these tests are the
// only thing that would notice it breaking.
//
// It used to forward ?sku into a Location header, which is why there was a row
// of header-injection cases here. Serving a file echoes nothing back, so that
// surface is gone rather than guarded — what is left is the assertion that says
// so: whatever goes into the query, none of it reaches the page.

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

  // Every pack the catalogue sells, not a sample of three. This used to live on
  // the /get redirect, which is where sku was handled before; it belongs to
  // /shop now, and dropping it with the redirect would have quietly ended the
  // only check that a real product id survives the round trip.
  test("every real product id still serves the shop", async () => {
    for (const id of Object.keys(SHOP_PRODUCTS)) {
      const res = await get(`/shop?sku=${encodeURIComponent(id)}`);

      assert.equal(res.statusCode, 200, `${id} did not serve the shop`);
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

describe("/get is a page of its own", () => {
  test("it serves a storefront rather than forwarding to /shop", async () => {
    const res = await get("/get");

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.equal(res.headers.location, undefined, "still redirecting somewhere");
    assert.match(res.body, /Masked calls/, "served something other than the /get page");
  });

  test("it is its own page, not a second copy of /shop", async () => {
    const [page, shop] = [await get("/get"), await get("/shop")];

    assert.notEqual(page.body, shop.body, "/get and /shop served the same bytes");
    assert.match(page.body, /gtRecall/, "/get lost its order-recall bar");
    assert.match(shop.body, /shRecall/, "/shop lost its order-recall bar");
  });

  // The whole point of the page: it is handed out deliberately, so no other
  // page may quietly start pointing at it. This is what fails if one does.
  test("nothing else links to it", async () => {
    for (const url of ["/shop", "/track-order", "/owner-login"]) {
      const res = await get(url);
      assert.doesNotMatch(res.body, /href="\/get"/, `${url} now links to /get`);
    }
  });

  // The security half, rewritten rather than dropped. There is no Location
  // header left to inject into, so what remains to prove is only that none of
  // this reaches the page.
  for (const [name, raw] of [
    ["a real product id", "pt-car-2"],
    ["an unknown id", "NOT-A-PRODUCT"],
    ["markup", "<script>alert(1)</script>"],
    ["a prototype key", "constructor"],
    ["another prototype key", "__proto__"],
    ["a newline, which used to split the header", "pt-car-2\nX-Injected: 1"],
    ["an absolute URL", "https://example.com/"],
    ["a path traversal", "../../admin"]
  ]) {
    test(`${name} in ?sku is ignored, not echoed`, async () => {
      const res = await get(`/get?sku=${encodeURIComponent(raw)}`);

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers.location, undefined);
      assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
      assert.doesNotMatch(res.body, /X-Injected/);
      assert.doesNotMatch(res.body, /example\.com/);
    });
  }

  test("an array in ?sku is ignored too", async () => {
    const res = await get("/get?sku[]=pt-car-2");

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Masked calls/);
  });
});
