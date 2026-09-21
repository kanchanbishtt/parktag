// A pack the storefront marks as sold out must not be buyable, and every
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
const SHOP_JS = path.join(HERE, "../../frontend/scripts/shop.js");
const ADDRESS_STEP_JS = path.join(HERE, "../../frontend/scripts/owner/address-step.js");

// Update this list when stock changes. It exists so that turning a pack back on
// is a deliberate edit in two places rather than a silent one in the page.
const SOLD_OUT = ["pt-combo", "pt-bike-1"];

const source = await readFile(SHOP_JS, "utf8");
const addressSource = await readFile(ADDRESS_STEP_JS, "utf8");

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

describe("sold-out packs on /shop", () => {
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
    // shop.js guards with `if (!pack.soldOut)` where get.js uses if/else. Both
    // are fine; what matters is that the assignment cannot run for a sold-out
    // pack, so assert the guard rather than one particular spelling of it.
    assert.match(
      source,
      /if \(!pack\.soldOut\) \{[\s\S]*?cta\.dataset\.sku = pack\.id;[\s\S]*?\}/,
      "cta.dataset.sku is set outside the !pack.soldOut guard"
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

  // Guest COD is back, but only where the server takes it: the page reads the
  // packs and the fee off the catalogue and sends a method, never an amount.
  // The old renderer advertised COD on every pack the business had not agreed.
  test("cash on delivery is offered from catalogue data, not page copy", () => {
    assert.doesNotMatch(source, /renderCod/, "the old COD renderer is back in shop.js");
    assert.match(source, /payload\.codProductIds/);
    assert.match(source, /payload\.codSurchargePaise/);
    assert.match(source, /addOnId: addOn\?\.id,\n\s*paymentMethod,/, "create-order must be told the chosen method");
  });

  test("no unsourced customer rating is shown", () => {
    assert.match(source, /const RATING = null;/, "the shop is showing a rating without a verified source");
    assert.doesNotMatch(source, /const RATING = \{/, "a hard-coded rating has returned");
  });

  test("checkout shows the selected pack and price before asking for an address", () => {
    assert.match(source, /orderSummary:\s*product/);
    assert.match(source, /name:\s*addOn\s*\?[^:]+:\s*product\.name/);
    assert.match(source, /amountPaise:\s*offerPrice/);
    assert.match(addressSource, /id="pt-addr-summary"/);
    assert.match(addressSource, /No payment is taken on this step/);
    assert.match(addressSource, /Free delivery/);
    assert.match(addressSource, /7-day replacement/);
    assert.match(addressSource, /UPI, cards or net banking/);
  });

  test("the launch offer and acrylic add-on are sent as identifiers, never client-authored prices", () => {
    assert.match(source, /promo:\s*_launchOffer/);
    assert.match(source, /addOnId:\s*addOn\?\.id/);
    // Duo Pack only: the plate is picked per sku, never from the checkbox alone.
    assert.match(source, /\(_addOn\.productIds \|\| \[\]\)\.includes\(sku\)/);
    assert.doesNotMatch(source, /selectedAddOn\(\)/);
    assert.doesNotMatch(source, /addOnAmount/);
  });

  // Revenue is what the server charged (e.g. 399 with LAUNCH100, 448 with the
  // plate), never the MRP, and the applied code travels as GA4 `coupon`.
  test("the purchase event reports the charged amount and the applied coupon", () => {
    assert.match(source, /_paidPaise = order\.amount \|\| 0;/);
    assert.match(source, /_paidCoupon = order\.promoCode \|\| null;/);
    assert.match(source, /value: _paidPaise \/ 100,\s*currency: "INR",\s*\.\.\.\(_paidCoupon \? \{ coupon: _paidCoupon \} : \{\}\)/);
  });
});
