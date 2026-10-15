// Routes removed in audit item 18 because nothing called them.
//
//   POST /api/auth/firebase-phone/verify-token   replaced by /send and /verify
//   GET  /api/auth/firebase-phone/recaptcha-key  the login page uses Firebase's own widget
//   POST /api/tags/:token/claim                  e-mail-and-password activation, replaced by /activate
//   POST /api/register-owner                     e-mail-and-password sign-up, no page called it
//   GET  /api/admin/etag-activations             the Activations page uses /api/admin/activations/recent
//   POST /api/owner/tags/:tagId/request-sticker  its only button went with pages/owner/dashboard.html
//
// Kept on purpose, though no page here calls them: owner Google sign-in, which
// a button can bring back; /api/admin/overview, which API tokens may read;
// /api/shop/reviews, where approved reviews are served; and
// /api/admin/mcp-calls, the AI connector audit trail.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, TEST_ORIGIN } from "./helpers.js";

let app;

before(async () => {
  ({ app } = await startTestApp());
});

after(async () => {
  await stopTestApp(app);
});

const call = (method, url) =>
  app.inject({ method, url, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN }, ...(method === "POST" ? { payload: {} } : {}) });

for (const [method, url] of [
  ["POST", "/api/auth/firebase-phone/verify-token"],
  ["GET", "/api/auth/firebase-phone/recaptcha-key"],
  ["POST", "/api/tags/removed-route-token/claim"],
  ["POST", "/api/register-owner"],
  ["GET", "/api/admin/etag-activations"],
  ["POST", "/api/owner/tags/65f0c0ffee0000000000abcd/request-sticker"]
]) {
  test(`${method} ${url} is gone`, async () => {
    assert.equal((await call(method, url)).statusCode, 404);
  });
}

// The neighbours that stay must still answer, so the removals cannot have taken
// a shared registration with them.
for (const [method, url, allowed] of [
  ["POST", "/api/auth/firebase-phone/send", [400, 403, 429, 503]],
  ["GET", "/api/admin/activations/recent?type=etag", [401]],
  ["GET", "/api/admin/overview", [401]],
  ["GET", "/api/admin/mcp-calls", [401]],
  ["GET", "/api/shop/reviews", [200]]
]) {
  test(`${method} ${url} is still there`, async () => {
    const { statusCode } = await call(method, url);
    assert.ok(allowed.includes(statusCode), `${url} answered ${statusCode}`);
  });
}
