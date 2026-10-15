// What a Meta visitor sees before the first scroll on /get.
//
// Recordings of 60 recent Meta visits showed 87% never tapped anything and the
// median stay was 35 seconds. The price sat in a buy card under two large
// photos and in a fixed bar whose line was cut off with an ellipsis, and the
// "Sound familiar?" proof came after the comparison section. Three changes,
// pinned here:
//
//   1. a price line under the four perks, above the photos;
//   2. the fixed bar's line no longer carries the COD note that truncated it;
//   3. the WhatsApp-group proof comes straight after the buy card.
//
// The price line must stay plain text. begin_checkout means a pressed Order
// button (checkout-intent-count.test.js); a tappable price would bring back the
// card-tap behaviour removed on 2026-10-03.
//
// Read as text, like get-sold-out.test.js: no browser, no database.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, "../../frontend/pages/get.html"), "utf8");
const getJs = await readFile(path.join(HERE, "../../frontend/scripts/get.js"), "utf8");

test("a price line sits above the photos, as plain text", () => {
  const line = html.indexOf('id="gtFirstPrice"');
  assert.ok(line > -1, "the first-screen price line exists");
  assert.ok(line < html.indexOf('class="gt-show"'), "it comes before the photos");
  assert.ok(line > html.indexOf('class="gt-perks"'), "and after the four perks");

  const tag = html.slice(html.lastIndexOf("<", line), html.indexOf(">", line) + 1);
  assert.match(tag, /^<p /, "a paragraph, not a link or button");
  assert.doesNotMatch(tag, /data-sku|href|data-goto/, "tapping the price buys nothing and goes nowhere");
});

test("the price line and the bar both come from the catalogue", () => {
  const render = getJs.slice(getJs.indexOf("function renderBar("), getJs.indexOf("function renderAddOn("));
  assert.match(render, /byId\("gtFirstPrice"\)/, "the line is filled by renderBar");
  assert.match(render, /sub\.textContent = priceLine;/, "the bar shows the price line without the COD note");
  assert.match(render, /first\.textContent = priceLine \+ codNote/, "COD is named on the first screen instead");
});

test("the WhatsApp-group proof comes straight after the buy card", () => {
  const hero = html.indexOf('class="gt-hero');
  const heard = html.indexOf('class="gt-heard"');
  const diff = html.indexOf('class="gt-diff"');
  const how = html.indexOf('class="gt-how"');
  assert.ok(hero < heard && heard < diff && diff < how, "hero, proof, comparison, how it works");
});
