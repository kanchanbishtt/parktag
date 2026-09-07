// One tap on a reason must be the whole answer.
//
// WHAT THIS PINS, AND WHY IT IS EASY TO BREAK AGAIN.
//
// On the reason card there is no submit button: tapping a reason IS the submit.
// An optional callback-number field was placed underneath those reasons, which
// put an input BELOW its own submit control. The natural order of the screen
// then fought the code:
//
//   tap a reason  ->  a 320ms timer fires  ->  the field is empty  ->  a nudge
//   is revealed and the handler RETURNS  ->  nothing advances
//
// The scanner sees a card that did nothing, types their number, and still
// nothing happens, because the send already fired and stopped. The only way
// forward was to tap the same reason a second time, which reads as the first tap
// having failed. Reported from the field as "it silently wants me to re-click".
//
// The fix moves the number to the plate card, which has a real Continue button
// under it, and leaves the reason card with exactly one job. So the rules are:
//
//   1. no input of any kind on the reason card,
//   2. the reason handler advances unconditionally, with no early return,
//   3. the number is offered on the plate card, and is optional there.
//
// Read as text: no browser, no database.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, "../../frontend/pages/scanner/index.html");
const APP = path.join(HERE, "../../frontend/scripts/scanner/app.js");

const page = await readFile(PAGE, "utf8");
const app = await readFile(APP, "utf8");

// The reason card's markup, comments stripped so a comment mentioning an input
// cannot satisfy or break these.
const reasonCard = page
  .slice(page.indexOf('id="reason-step"'), page.indexOf('id="reason-cancel"'))
  .replace(/<!--[\s\S]*?-->/g, "");

describe("the reason card asks one question and nothing else", () => {
  test("it contains no input, so nothing can sit below its own submit", () => {
    assert.doesNotMatch(
      reasonCard,
      /<input/,
      "an input is back on the reason card; a tap on a reason is the submit here, " +
        "so anything below it can never be filled in before the send has gone"
    );
  });

  test("the five reasons are still there", () => {
    assert.equal((reasonCard.match(/data-reason="/g) || []).length, 5);
  });

  test("nothing references the removed callback field", () => {
    for (const source of [page, app]) {
      assert.doesNotMatch(source, /reason-callback/, "a dead reference to the removed field remains");
    }
  });
});

describe("a tap on a reason advances", () => {
  // The handler body between the timer opening and its closing delay.
  const handler = app.slice(
    app.indexOf("reasonAdvanceTimer = setTimeout(() => {"),
    app.indexOf("}, REASON_ADVANCE_MS);")
  );

  test("the timer body has no early return", () => {
    assert.ok(handler.length > 0, "the reason advance timer could not be found");
    assert.doesNotMatch(
      handler,
      /\n\s+return;/,
      "the reason handler can bail out before advancing again, which is exactly " +
        "the bug: the first tap appears to do nothing and a second is required"
    );
  });

  test("it closes the sheet and moves to verification", () => {
    assert.match(handler, /closeReasonStep\(\);/);
    assert.match(handler, /requireVerification\("message"\);/);
  });

  test("the anonymous-send nudge that caused the second tap is gone", () => {
    assert.doesNotMatch(app, /anonymousSendConfirmed/);
    assert.doesNotMatch(app, /resetAnonymousNudge/);
  });
});

describe("the number is offered on the plate card, and is optional", () => {
  test("the plate card shows the number block for a WhatsApp alert too", () => {
    assert.match(app, /const offersNumber = action === "message";/);
    assert.match(app, /setHidden\("plate-verify-call-block", !wantsNumber && !offersNumber\);/);
  });

  test("blank is accepted, but a half-typed number is not silently dropped", () => {
    const guard = app.slice(app.indexOf('if (pendingVerifiedAction === "message")'));
    assert.match(
      guard.slice(0, 600),
      /if \(typed && typed\.replace\(\/\\D\/g, ""\)\.length < 10\)/,
      "the optional number is no longer validated when present; a number typed and " +
        "then discarded leaves the scanner believing the owner can call them back"
    );
  });

  test("the field says it is optional rather than looking required", () => {
    assert.match(app, /Your number \(optional\)/);
    assert.match(app, /<strong>Optional<\/strong>/);
  });
});

describe("icons are drawn, not typed", () => {
  // Emoji render as different artwork on every platform, cannot take a brand
  // colour, and size themselves off the font rather than the layout.
  test("no emoji survive as icons on the scan page", () => {
    const visible = page.replace(/<!--[\s\S]*?-->/g, "");
    const pictographs = [...visible].filter((ch) => {
      const cp = ch.codePointAt(0);
      return cp > 0x2500 && cp !== 0xfeff;
    });
    assert.deepEqual(pictographs, [], `emoji still used as icons: ${pictographs.join(" ")}`);
  });

  test("each reason row carries an svg icon", () => {
    assert.equal((page.match(/pt-chip-icon" aria-hidden="true"><svg/g) || []).length, 5);
  });
});
