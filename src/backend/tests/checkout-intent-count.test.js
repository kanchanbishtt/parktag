// begin_checkout (Meta's InitiateCheckout) must mean "tapped an Order button",
// not "tapped somewhere on a pack card". Card taps still open checkout, but
// Clarity showed most of them are people looking at the card, and counting
// them inflated checkouts well past real intent. They go to select_item, which
// is GA4-only so it never reaches Meta's optimiser.
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

test("begin_checkout fires only for an Order button, card taps send select_item", () => {
  const begin = getJs.indexOf('ptTrack(fromButton ? "begin_checkout" : "select_item"');
  assert.ok(begin > -1, "the Order handler must choose the event by what was tapped");
  assert.match(getJs, /const fromButton = Boolean\(button\);/);
});

test("select_item is GA4-only and never reaches the Meta pixel", () => {
  assert.match(analytics, /select_item:\s*\{ ga: "select_item",\s*pixel: null \}/);
});
