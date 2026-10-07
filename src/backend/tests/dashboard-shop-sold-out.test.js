// The dashboard shop (welcome-shop.js) must show the packs we cannot ship as
// sold out, exactly as /shop and /get do. It did not: the server already
// refused pt-combo and pt-bike-1 at create-order and place-cod, but the grid
// on the signed-in shop drew them at "44% OFF" with a working tap, so a buyer
// walked through the address step and the pack step to be refused at the end.
//
// Read as text, the way shop-sold-out.test.js reads /shop: no browser, no
// database.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SHOP_PRODUCTS } from "../lib/integrations/payments.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(HERE, "../../frontend/scripts/owner/welcome-shop.js"), "utf8");
const css = await readFile(path.join(HERE, "../../frontend/styles/owner-welcome.css"), "utf8");

// The same list shop-sold-out.test.js keeps for /shop: stock is one fact.
const SOLD_OUT = ["pt-combo", "pt-bike-1"];

function declaredSoldOut(js) {
  const found = [];
  const re = /id:\s*"([^"]+)"([\s\S]*?)(?=\n\s{2}\{|\n\];)/g;
  let m;
  while ((m = re.exec(js)) !== null) {
    if (/soldOut:\s*true/.test(m[2])) found.push(m[1]);
  }
  return found;
}

describe("sold-out packs on the dashboard shop", () => {
  test("exactly the packs we cannot ship are marked sold out, and the server agrees", () => {
    const products = source.slice(source.indexOf("const PRODUCTS = ["), source.indexOf("// ── Skeleton helpers"));
    assert.deepEqual(declaredSoldOut(products).sort(), [...SOLD_OUT].sort());
    for (const id of SOLD_OUT) {
      assert.equal(SHOP_PRODUCTS[id] && SHOP_PRODUCTS[id].soldOut, true, `${id} is sold out on the page but not on the server`);
    }
  });

  test("a sold-out card has no tap, says so, and keeps its price", () => {
    // The onclick is only written for a pack that is not sold out.
    assert.match(source, /\$\{p\.soldOut \? "" : ` onclick="openProduct\(\$\{i\}\)"`\}/);
    assert.match(source, /\$\{p\.soldOut \? "SOLD OUT" : `\$\{shown\.discount\}% OFF`\}/);
    assert.match(source, /pt-shop-card\$\{p\.soldOut \? " pt-shop-card-out" : ""\}/);
    // The price row is not conditional on stock. `shown` is the server's price
    // (and launch offer) for the card; see launch-offer-parity.test.js.
    assert.match(source, /<span class="pt-shop-price">₹\$\{shown\.price\}<\/span>/);
    assert.match(css, /\.pt-shop-card-out \{ cursor: default;/);
    assert.match(css, /\.pt-shop-badge-out \{/);
  });

  test("the two ways past the grid refuse a sold-out pack too", () => {
    // A ?shop=1&sku= link, and the product sheet itself.
    assert.match(source, /if \(idx === -1 \|\| PRODUCTS\[idx\]\.soldOut\) return false;/);
    assert.match(source, /function openProduct\(idx\) \{[\s\S]*?if \(!PRODUCTS\[idx\] \|\| PRODUCTS\[idx\]\.soldOut\) return;/);
    // A checkout saved before the pack went out of stock is dropped on reload.
    assert.match(source, /PRODUCTS\.findIndex\(\(p\) => p\.id === saved\.sku && !p\.soldOut\)/);
  });
});
