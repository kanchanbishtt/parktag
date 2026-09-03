// The boot check that would have caught a five-week outage on day one.
//
// Production sold nothing online between 2026-07-28 and 2026-09-03. The cause
// was never in the code: RAZORPAY_KEY_ID carried a trailing newline from a
// dashboard paste, and Razorpay answered 401. Nothing noticed, because a padded
// credential is still a non-empty string — the app booted clean and reported
// itself healthy while every checkout failed.
//
// These tests pin the two things that make the check worth having: that a
// rejected credential is stated loudly, and that an unreachable API is NOT
// reported as a rejected credential. Confusing the two would send someone to
// edit a live payment key because of a network blip.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { classifyRazorpayProbe, verifyRazorpayCredentials } from "../lib/integrations/payments.js";

const CONFIGURED = { razorpayKeyId: "rzp_live_example", razorpayKeySecret: "secret" };

// Collects what the server would have logged, so the assertions are about the
// operator-visible outcome rather than an internal return value.
function recordingLog() {
  const lines = [];
  const push = level => (...args) => {
    const message = typeof args[0] === "string" ? args[0] : args[1];
    lines.push({ level, message: String(message) });
  };
  return { lines, info: push("info"), warn: push("warn"), error: push("error") };
}

describe("classifying a Razorpay credential probe", () => {
  test("200 is a pass", () => {
    const v = classifyRazorpayProbe(200);
    assert.equal(v.ok, true);
    assert.equal(v.level, "info");
  });

  // The whole point of the exercise. This has to be an error, not a warning:
  // it means the shop is taking no money.
  test("401 is an error that names the variables and the symptom", () => {
    const v = classifyRazorpayProbe(401);

    assert.equal(v.ok, false);
    assert.equal(v.level, "error");
    assert.match(v.message, /RAZORPAY_KEY_ID/);
    assert.match(v.message, /RAZORPAY_KEY_SECRET/);
    // The string the customer actually sees, so a support report and this log
    // line can be connected by someone searching for either.
    assert.match(v.message, /Failed to create order/);
    // Both real incidents were invisible characters or case. Say so.
    assert.match(v.message, /case/i);
  });

  // A 500 from Razorpay, or a proxy returning 502, says nothing about the keys.
  for (const status of [500, 502, 503, 429]) {
    test(`${status} is inconclusive, not a credential verdict`, () => {
      const v = classifyRazorpayProbe(status);

      assert.equal(v.level, "warn");
      assert.doesNotMatch(v.message, /AUTHENTICATION FAILED/);
    });
  }
});

describe("the boot credential check", () => {
  test("it sends the same Basic auth header order creation uses", async () => {
    let seenUrl = null;
    let seenAuth = null;
    const log = recordingLog();

    await verifyRazorpayCredentials(CONFIGURED, log, {
      fetchImpl: async (url, opts) => {
        seenUrl = url;
        seenAuth = opts.headers.Authorization;
        return { status: 200 };
      }
    });

    const decoded = Buffer.from(String(seenAuth).replace("Basic ", ""), "base64").toString();
    assert.equal(decoded, "rzp_live_example:secret");
    // A read call. If this ever becomes a POST it starts minting real orders on
    // every deploy.
    assert.match(seenUrl, /^https:\/\/api\.razorpay\.com\/v1\/orders\?/);
  });

  test("a 401 is logged at error level", async () => {
    const log = recordingLog();

    const result = await verifyRazorpayCredentials(CONFIGURED, log, {
      fetchImpl: async () => ({ status: 401 })
    });

    assert.equal(result.ok, false);
    assert.equal(log.lines.filter(l => l.level === "error").length, 1);
  });

  // The regression that matters most here: Razorpay being down must not print
  // the "your keys are wrong" message.
  test("an unreachable API warns, and never claims the keys are wrong", async () => {
    const log = recordingLog();

    const result = await verifyRazorpayCredentials(CONFIGURED, log, {
      fetchImpl: async () => { throw new Error("ECONNRESET"); }
    });

    assert.equal(result.unreachable, true);
    assert.equal(log.lines.some(l => l.level === "error"), false);
    assert.equal(log.lines.some(l => /AUTHENTICATION FAILED/.test(l.message)), false);
  });

  // A developer with no Razorpay account still has to be able to boot, and
  // must not be told their non-existent keys are broken.
  test("it stays quiet when Razorpay is not configured at all", async () => {
    const log = recordingLog();

    const result = await verifyRazorpayCredentials({ razorpayKeyId: "", razorpayKeySecret: "" }, log, {
      fetchImpl: async () => { throw new Error("should not be called"); }
    });

    assert.equal(result.skipped, true);
    assert.equal(log.lines.length, 0);
  });
});
