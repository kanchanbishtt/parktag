// The progress bar must never claim work is finished before it is.
//
// WHY THIS IS A TEST AND NOT A CODE REVIEW NOTE.
//
// The whole point of a determinate bar is that its position means something. A
// bar that fills on a timer is a decoration wearing the costume of information,
// and this one sits on the flow that tells somebody their alert reached a
// vehicle owner. If it can reach 100% before the server has answered, the
// screen has lied about the one thing it exists to report.
//
// So the rules pinned here are:
//
//   1. `done()` is the ONLY thing that fills the bar. No timer, no easing path,
//      and no `advance()` may paint 100%.
//   2. Easing inside a segment stops at that segment's ceiling.
//   3. `fail()` leaves the bar where it stopped rather than completing first.
//   4. Every flow that starts a run also finishes AND destroys it on both the
//      success and the failure path, or a card keeps a stale bar.
//   5. Nothing in the run can throw into a request path.
//
// Read as text plus a headless exercise of the module's own arithmetic, so it
// needs no browser and no database.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(path.join(HERE, p), "utf8");

const ux = await read("../../frontend/scripts/ux-feedback.js");
const scanner = await read("../../frontend/scripts/scanner/app.js");
const shop = await read("../../frontend/scripts/shop.js");
const get = await read("../../frontend/scripts/get.js");

describe("the bar cannot fill before the work does", () => {
  test("only done() paints 100%", () => {
    // paint(1) is a full bar. It must appear exactly once, inside done().
    const fills = ux.match(/paint\(1\)/g) || [];
    assert.equal(fills.length, 1, "something other than done() can fill the bar");

    const doneFn = ux.slice(ux.indexOf("      done() {"), ux.indexOf("      // Stops exactly where"));
    assert.match(doneFn, /paint\(1\)/, "done() does not fill the bar");
  });

  test("easing is clamped to the current segment's ceiling", () => {
    const tick = ux.slice(ux.indexOf("    function tick() {"), ux.indexOf("    function enter("));
    assert.match(tick, /ceilingFor\(index\)/, "the easing does not read a ceiling");
    assert.match(tick, /if \(room <= 0\.001\) return;/, "the easing is not clamped, so it can run past a boundary");
  });

  test("fail() does not complete the bar first", () => {
    const failFn = ux.slice(ux.indexOf("      fail(message) {"), ux.indexOf("      destroy() {"));
    assert.doesNotMatch(failFn, /paint\(/, "fail() repaints the bar instead of leaving it where it stopped");
  });
});

describe("the arithmetic behind the bar", () => {
  // Recreated from the module so the maths is exercised rather than eyeballed.
  // If ux-feedback's weighting changes, this drifts and should be updated with it.
  const ceilingFor = (steps, i) => {
    const total = steps.reduce((sum, s) => sum + (s.weight || 1), 0);
    return steps.slice(0, i + 1).reduce((sum, s) => sum + (s.weight || 1), 0) / total;
  };

  test("segment ceilings rise and end at exactly 1", () => {
    const steps = [{ weight: 2 }, { weight: 1 }, { weight: 3 }];
    const ceilings = steps.map((_, i) => ceilingFor(steps, i));
    assert.deepEqual(ceilings.map((c) => Number(c.toFixed(4))), [0.3333, 0.5, 1]);
    for (let i = 1; i < ceilings.length; i += 1) {
      assert.ok(ceilings[i] > ceilings[i - 1], "a later segment does not sit further along the bar");
    }
  });

  test("easing approaches a ceiling without reaching it", () => {
    // The shape that makes a wait look alive without lying: each tick closes a
    // fraction of the remaining gap, so it decelerates and never arrives.
    let shown = 0;
    const ceiling = 0.5;
    for (let i = 0; i < 500; i += 1) shown += (ceiling - shown) * 0.06;
    assert.ok(shown < ceiling, "the easing reaches the ceiling, so a segment can look complete when it is not");
    assert.ok(shown > ceiling * 0.9, "the easing stalls so far short that the bar looks stuck");
  });
});

describe("every run is cleaned up on both paths", () => {
  const flows = [
    ["scanner", scanner],
    ["shop checkout", shop],
    ["get checkout", get]
  ];

  test("each file that begins a run also fails one and destroys one", () => {
    for (const [name, source] of flows) {
      if (!/\.begin\(\)/.test(source)) continue;
      assert.match(source, /\.fail\(/, `${name} starts a run with no failure path`);
      assert.match(source, /\.destroy\(\)/, `${name} starts a run and never tears it down`);
      assert.match(source, /\.done\(\)/, `${name} starts a run that can never complete`);
    }
  });

  test("the paced runs clear their timers on both outcomes", () => {
    // A left-running timer would keep advancing a bar on a card that has gone.
    for (const [name, source] of [["scanner", scanner], ["shop", shop], ["get", get]]) {
      const stops = (source.match(/stopPacing\(\)|stopOrderPacing\(\)/g) || []).length;
      if (!/setTimeout\(\(\) => \w+Steps\.advance\(\)/.test(source)) continue;
      assert.ok(stops >= 2, `${name} paces a run but clears the timers on fewer than two paths`);
    }
  });
});

describe("progress can never break the thing it decorates", () => {
  test("each stepRun helper falls back to a no-op", () => {
    for (const [name, source] of [["scanner", scanner], ["shop", shop], ["get", get]]) {
      const helper = source.slice(source.indexOf("function stepRun("));
      assert.ok(helper, `${name} has no stepRun helper`);
      assert.match(helper.slice(0, 900), /catch\s*\{/, `${name}'s stepRun can throw into a request path`);
      assert.match(helper.slice(0, 900), /begin\(\)\s*\{\s*\}/, `${name}'s stepRun has no inert fallback`);
    }
  });

  test("only one indicator runs at a time", () => {
    // ux-feedback auto-starts the top bar on any .pt-btn click. Cards that own
    // a step run opt out via the attribute, or the page shows two answers.
    assert.match(ux, /data-pt-owns-progress/, "the top bar no longer stands down for a step run");
  });
});

describe("the label is announced, not just drawn", () => {
  test("the bar reports its value and the label is a live region", () => {
    assert.match(ux, /role="progressbar"/);
    assert.match(ux, /aria-valuenow/);
    assert.match(ux, /aria-live="polite"/);
  });
});
