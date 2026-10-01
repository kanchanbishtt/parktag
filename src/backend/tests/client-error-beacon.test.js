// POST /api/system/client-error: the beacon client-error-beacon.js fires on
// an uncaught error or a rejected promise. Public and same-origin, like the
// other analytics beacons, so these only confirm it answers correctly and
// never depends on Sentry being configured — see sentry-client-error.test.js
// for the scrubbing/capture contract itself.
import test from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, TEST_ORIGIN } from "./helpers.js";

test("POST /api/system/client-error", async (t) => {
  const { app } = await startTestApp();
  t.after(() => stopTestApp(app));

  await t.test("a reported error answers 204 with no body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/system/client-error",
      remoteAddress: uniqueAddress(),
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      payload: {
        message: "address-step failed to load after retry",
        context: "checkout-loader",
        url: "https://app.parktag.me/get",
        userAgent: "Mozilla/5.0 (Linux; Android 10) FBAN/FB4A"
      }
    });

    assert.equal(res.statusCode, 204);
    assert.equal(res.body, "");
  });

  await t.test("an empty or missing message still answers 204, not an error", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/system/client-error",
      remoteAddress: uniqueAddress(),
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      payload: { message: "   " }
    });
    assert.equal(empty.statusCode, 204);

    const missing = await app.inject({
      method: "POST",
      url: "/api/system/client-error",
      remoteAddress: uniqueAddress(),
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      payload: {}
    });
    assert.equal(missing.statusCode, 204);
  });

  await t.test("no session cookie or CSRF header is required — sendBeacon cannot send either", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/system/client-error",
      remoteAddress: uniqueAddress(),
      // No origin header at all: sendBeacon requests do not reliably carry
      // one, and this route sits outside CSRF_PROTECTED_PREFIXES in app.js
      // for exactly that reason.
      headers: { "content-type": "application/json" },
      payload: { message: "unhandledrejection" }
    });
    assert.equal(res.statusCode, 204);
  });

  await t.test("an oversized message is accepted and simply truncated, not rejected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/system/client-error",
      remoteAddress: uniqueAddress(),
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      payload: { message: "x".repeat(5000) }
    });
    assert.equal(res.statusCode, 204);
  });
});
