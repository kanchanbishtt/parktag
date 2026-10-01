// captureClientError: the browser-reported counterpart to captureServerError.
// Tests stay at the same boundary the rest of sentry.js is tested at (see
// sentry-scrub.test.js) — without a SENTRY_DSN, which is how every test and
// dev run operates, the SDK is never initialized, and the function's whole
// contract there is "never throw, never do anything observable".
import test from "node:test";
import assert from "node:assert/strict";

import { captureClientError } from "../lib/integrations/sentry.js";

test("does nothing, and does not throw, when Sentry is not initialized", () => {
  assert.doesNotThrow(() => {
    captureClientError({
      message: "address-step failed to load after retry",
      context: "checkout-loader",
      extra: { url: "https://app.parktag.me/get", userAgent: "FBAN/FB4A" }
    });
  });
});

test("a missing message, missing context or missing extra does not throw", () => {
  assert.doesNotThrow(() => captureClientError({}));
  assert.doesNotThrow(() => captureClientError());
  assert.doesNotThrow(() => captureClientError({ message: "x" }));
});
