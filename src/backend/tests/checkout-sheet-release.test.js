// The checkout sheet must always be releasable.
//
// WHY THIS IS A TEST AND NOT A CODE REVIEW NOTE.
//
// Both storefronts open a modal sheet the moment an order starts, and hold a
// `_busy` flag for as long as a payment is in flight. hideSheet() refuses to
// close while that flag is set, which is right for a DISMISSAL gesture: the
// backdrop, Escape and the Done button must not close the sheet out from under
// a live checkout.
//
// It is wrong for everything else, and the two callers that are not dismissals
// both used to call hideSheet() and silently get nothing back:
//
//   1. A failed create-order. The catch block called hideSheet() and cleared
//      `_busy` on the NEXT line, so the guard swallowed the close and the buyer
//      was left on "Setting up your order" for good, with the real error
//      rendered underneath a sheet that would not lift. Every failure reaches
//      this path: a sold-out pack, a rejected address, the guest rate limit, a
//      Razorpay outage, any 5xx.
//
//   2. The hand-off to Razorpay. The comment there says the sheet is cleared so
//      that "leaving a half-filled bar underneath it would still be there if
//      the buyer dismissed the payment window" — which is exactly what
//      happened, because `_busy` is necessarily set at that point. Dismissing
//      Razorpay returned the buyer to a blank sheet over a page whose scroll
//      was still locked, recoverable only by reloading.
//
// So the rule pinned here is: closing is closeSheet(), which cannot refuse.
// hideSheet() is the dismissal wrapper, and nothing but a dismissal gesture may
// call it. Read as text, so it needs no browser and no database.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, "..", "..", "frontend", "scripts");

const STOREFRONTS = [
  { name: "get.js", file: path.join(SCRIPTS, "get.js") },
  { name: "shop.js", file: path.join(SCRIPTS, "shop.js") }
];

// The body of a top-level `function name() { ... }`, up to the first line that
// is a lone closing brace. Every function here is written that way.
function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}() {`);
  assert.notEqual(start, -1, `${name}() is not defined`);
  const rest = source.slice(start);
  const end = rest.indexOf("\n}");
  assert.notEqual(end, -1, `${name}() has no closing brace`);
  return rest.slice(0, end);
}

for (const { name, file } of STOREFRONTS) {
  describe(`${name}: the sheet can always be released`, () => {
    let source;

    test("reads", async () => {
      source = await readFile(file, "utf8");
      assert.ok(source.length > 0);
    });

    test("closeSheet() has no in-flight guard, or it could refuse like the old one", async () => {
      source = source || (await readFile(file, "utf8"));
      const body = bodyOf(source, "closeSheet");
      assert.ok(
        !body.includes("_busy"),
        "closeSheet() consults _busy, so it can refuse to close and the whole point is lost"
      );
      assert.ok(body.includes("hidden = true"), "closeSheet() does not hide anything");
      assert.ok(
        body.includes('document.body.style.overflow = ""'),
        "closeSheet() leaves the page scroll locked"
      );
    });

    test("hideSheet() keeps the guard and delegates rather than duplicating it", async () => {
      source = source || (await readFile(file, "utf8"));
      const body = bodyOf(source, "hideSheet");
      assert.ok(
        body.includes("if (_busy) return"),
        "hideSheet() lost its guard, so the backdrop can now close a live checkout"
      );
      assert.ok(
        body.includes("closeSheet()"),
        "hideSheet() no longer delegates, so the two can drift apart"
      );
    });

    // The regression itself. A future edit that moves `_busy = false` back below
    // the close would reintroduce the hang if these were hideSheet() again.
    test("nothing but a dismissal gesture calls hideSheet()", async () => {
      source = source || (await readFile(file, "utf8"));
      const offenders = source
        .split("\n")
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => /\bhideSheet\s*\(\s*\)/.test(line))
        .filter(({ line }) => !line.startsWith("function hideSheet"))
        .filter(({ line }) => !line.startsWith("//"))
        // the only legitimate call: the Escape handler
        .filter(({ line }) => !line.includes("Escape"));

      assert.deepEqual(
        offenders,
        [],
        `hideSheet() is called where it can be refused — use closeSheet(): ` +
          offenders.map((o) => `line ${o.n}: ${o.line}`).join(" / ")
      );
    });

    test("the failure paths clear _busy AND close unconditionally", async () => {
      source = source || (await readFile(file, "utf8"));
      const closes = source.match(/_busy = false;[^\n]*\n\s*closeSheet\(\);/g) || [];
      assert.equal(
        closes.length,
        2,
        "expected both failure paths (create-order failed, Razorpay absent) to clear _busy then closeSheet()"
      );
    });

    test("the hand-off to Razorpay closes the sheet before opening the payment window", async () => {
      source = source || (await readFile(file, "utf8"));
      const handoff = source.indexOf("rzp.open();");
      assert.notEqual(handoff, -1, "no rzp.open() found");
      const before = source.slice(0, handoff);
      const lastClose = before.lastIndexOf("closeSheet();");
      const lastHide = before.lastIndexOf("hideSheet();");
      assert.ok(
        lastClose > lastHide,
        "the sheet is handed to Razorpay via hideSheet(), which cannot close while _busy is set — " +
          "dismissing the payment window then strands the buyer on a blank sheet"
      );
    });
  });
}
