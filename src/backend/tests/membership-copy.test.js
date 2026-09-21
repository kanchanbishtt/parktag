// The membership screen's copy, read as text so it runs without a database.
//
// WhatsApp scan alerts belong to the active ParkTag, not to Premium, and the
// included year is not a "trial" anybody signed up for. These pin the wording
// that says so; the API-level split is covered in membership.test.js.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { membershipFeatures, alwaysIncludedFeatures } from "../lib/core/membership-plans.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(HERE, "../../frontend/pages/owner/membership.html"), "utf8");
const js = await readFile(path.join(HERE, "../../frontend/scripts/owner/membership.js"), "utf8");

describe("membership screen copy", () => {
  test("WhatsApp sits under always included, not under Premium features", () => {
    assert.equal(membershipFeatures().some((f) => f.id === "whatsapp"), false);
    assert.ok(alwaysIncludedFeatures().some((f) => f.id === "whatsapp"));
    assert.match(html, /<h2 class="mb-h">Always included, no renewal required<\/h2>/);
  });

  test("no free-trial wording and no activation tile in the grid", () => {
    for (const source of [html, js]) {
      assert.doesNotMatch(source, /free trial|free year|Go Pro|free on activation/i);
    }
    assert.equal(membershipFeatures().some((f) => /free|activation/i.test(f.label)), false);
    assert.match(js, /\$\{data\.trial\.headline\} with your ParkTag/);
  });

  test("covered owners are offered Extend Premium", () => {
    assert.match(js, /covered \? "Extend Premium" : "Choose Premium"/);
  });
});
