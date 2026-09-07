// A pack the ad landing page marks as sold out must not be buyable, and every
// pack that is NOT sold out must still be.
//
// The grid is rendered in the browser, so what is worth pinning is not the
// pixels but the two rules underneath them:
//
//   1. the Order control on a sold-out card is built WITHOUT a data-sku, and
//   2. the delegated click handler that opens the guest checkout matches on
//      data-sku.
//
// Together those make the card inert. Rule 2 is the fragile one: the handler
// used to key on `a[href^='/shop']`, and when the hrefs became in-page anchors
// (so this ad landing page keeps its own paid traffic instead of handing it to
// /shop) that selector silently matched nothing — every Order button on the
// page stopped opening checkout while still looking perfectly fine. This test
// exists because that failure is invisible to every other kind of check.
//
// Read as text, the same way checkout-low-findings pins welcome-shop.js. Needs
// no browser and no database, which is the point: it runs everywhere.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SHOP_PRODUCTS } from "../lib/integrations/payments.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GET_JS = path.join(HERE, "../../frontend/scripts/get.js");

// Update this list when stock changes. It exists so that turning a pack back on
// is a deliberate edit in two places rather than a silent one in the page.
const SOLD_OUT = ["pt-combo", "pt-bike-1"];

const source = await readFile(GET_JS, "utf8");

// The `soldOut: true` entries the page actually declares.
function declaredSoldOut(js) {
  const found = [];
  const re = /id:\s*"([^"]+)"([\s\S]*?)(?=\n\s{2}\{|\n\];)/g;
  let m;
  while ((m = re.exec(js)) !== null) {
    if (/soldOut:\s*true/.test(m[2])) found.push(m[1]);
  }
  return found;
}

describe("sold-out packs on /get", () => {
  test("exactly the packs we cannot ship are marked sold out", () => {
    assert.deepEqual(declaredSoldOut(source).sort(), [...SOLD_OUT].sort());
  });

  test("every sold-out id is still a real product", () => {
    for (const id of SOLD_OUT) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, id),
        `${id} is marked sold out but is not in the catalog, so the card renders at no price at all`
      );
    }
  });

  test("a sold-out card is never given a data-sku", () => {
    assert.match(
      source,
      /if \(pack\.soldOut\) \{[\s\S]*?\} else \{[\s\S]*?cta\.dataset\.sku = pack\.id;[\s\S]*?\}/,
      "cta.dataset.sku is set outside the branch that excludes sold-out packs"
    );
    assert.equal(
      (source.match(/cta\.dataset\.sku = /g) || []).length,
      1,
      "a second place now sets data-sku on a pack control; check it cannot fire for a sold-out pack"
    );
  });

  // The regression that this file was written for.
  test("the checkout handler keys on data-sku, not on an href", () => {
    assert.match(
      source,
      /closest\("a\[data-sku\]"\)/,
      "the delegated Order handler no longer matches on data-sku, so Order buttons open nothing"
    );
    assert.doesNotMatch(
      source,
      /closest\("a\[href\^='\/shop'\]"\)/,
      "the handler still matches /shop hrefs, which this page no longer uses"
    );
  });

  // An ad landing page that links to the other storefront leaks the traffic it
  // was paid for.
  test("no Order control points at /shop", () => {
    assert.doesNotMatch(source, /href = `\/shop/, "a pack CTA still links to /shop");
    assert.doesNotMatch(source, /el\.href = `\/shop/, "a hero CTA still links to /shop");
  });
});
