// begin_checkout (Meta's InitiateCheckout) must mean "tapped an Order button",
// not "tapped somewhere on a pack card". Card taps used to open checkout too
// and were counted as select_item (GA4-only). Since 2026-10-03 a card tap does
// nothing at all (see get-card-tap.test.js): the sheet opens only from Order,
// so every begin_checkout is a pressed button and there is no card event.
//
// Read as text, like get-sold-out.test.js: no browser, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const getJs = await readFile(path.join(HERE, "../../frontend/scripts/get.js"), "utf8");
const analytics = await readFile(path.join(HERE, "../assets/analytics.js"), "utf8");

test("begin_checkout fires only for an Order control, and a card tap sends nothing", () => {
  const handler = getJs.slice(getJs.indexOf('const link = event.target.closest("a[data-sku]");'));
  assert.ok(handler.indexOf('ptTrack("begin_checkout"') > -1, "the Order handler reports begin_checkout");
  assert.doesNotMatch(getJs, /select_item/, "no card tap is reported: there is no card tap");
  assert.doesNotMatch(getJs, /\.gt-pack\[data-sku\]/, "the handler matches Order controls, never the card");
});

test("select_item stays GA4-only in the vocabulary, should a page ever send it", () => {
  assert.match(analytics, /select_item:\s*\{ ga: "select_item",\s*pixel: null \}/);
});
