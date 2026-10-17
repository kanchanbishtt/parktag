// The owner pages as an installable app.
//
// Three files make a page installable: a manifest the browser can read, icons
// it can show, and a service worker it can register. Each is served by this
// app in a particular way (the worker stamped and never cached for long, the
// manifest under the static handler, the offline page as a public shell), and
// each owner page has to point at them. The scanner pages must not: a stranger
// at someone else's windscreen is never asked to install anything.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, createTestOwner, purgeLoginCollections, uniqueAddress } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import { renderServiceWorker, serviceWorkerVersion } from "../lib/core/pwa.js";

let app;
let collections;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  const owner = await createTestOwner(collections, { email: "pwa-owner@example.invalid" });
  cookie = await createSession(app, {
    id: String(owner._id), role: "owner", email: owner.email, displayName: owner.displayName
  });
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

function get(url, { signedIn = false, headers = {} } = {}) {
  return app.inject({
    method: "GET",
    url,
    headers: { accept: "text/html", ...headers },
    remoteAddress: uniqueAddress(),
    ...(signedIn ? { cookies: { wavetag_session: cookie } } : {})
  });
}

// ── the manifest ────────────────────────────────────────────────────────────

test("the manifest is served as a manifest and points at the owner app", async () => {
  const response = await get("/manifest.webmanifest");
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /application\/manifest\+json/);

  const manifest = JSON.parse(response.body);
  assert.equal(manifest.name, "ParkTag");
  assert.equal(manifest.start_url, "/owner");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
});

test("every icon the manifest names is a PNG this app serves", async () => {
  const manifest = JSON.parse((await get("/manifest.webmanifest")).body);
  const purposes = new Set();
  for (const icon of manifest.icons) {
    const response = await get(icon.src);
    assert.equal(response.statusCode, 200, icon.src);
    assert.match(String(response.headers["content-type"]), /image\/png/, icon.src);
    // The PNG signature, so a 200 with the 404 page in it would still fail.
    assert.equal(response.rawPayload.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", icon.src);
    purposes.add(icon.purpose);
  }
  // Android masks its own shape out of a maskable icon and shows an "any"
  // icon as drawn; a launcher needs one of each to look right.
  assert.ok(purposes.has("any"), "an icon with purpose any");
  assert.ok(purposes.has("maskable"), "an icon with purpose maskable");
});

// ── the service worker ──────────────────────────────────────────────────────

test("the worker is served from the root, stamped, and never cached for long", async () => {
  const response = await get("/sw.js");
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /text\/javascript/);
  assert.equal(response.headers["cache-control"], "no-cache");
  assert.ok(response.headers.etag, "an ETag, so the update check can be a 304");

  assert.doesNotMatch(response.body, /__SW_VERSION__/, "the version placeholder was filled in");
  assert.match(response.body, /parktag-offline-/);
  assert.match(response.body, /"\/offline"/);
});

test("the worker answers a repeat update check with a 304", async () => {
  const first = await get("/sw.js");
  const again = await get("/sw.js", { headers: { "if-none-match": first.headers.etag } });
  assert.equal(again.statusCode, 304);
});

test("the worker's version moves with the offline page and the asset stamp", () => {
  const a = serviceWorkerVersion({ assetVersion: "stamp1", offlineHtml: "<p>one</p>" });
  const b = serviceWorkerVersion({ assetVersion: "stamp1", offlineHtml: "<p>two</p>" });
  const c = serviceWorkerVersion({ assetVersion: "stamp2", offlineHtml: "<p>one</p>" });
  assert.notEqual(a, b, "a changed offline page rolls the worker");
  assert.notEqual(a, c, "a changed asset stamp rolls the worker");
  assert.equal(a, serviceWorkerVersion({ assetVersion: "stamp1", offlineHtml: "<p>one</p>" }));

  const rendered = renderServiceWorker('const V = "__SW_VERSION__";', {
    assetVersion: "stamp1", offlineHtml: "<p>one</p>"
  });
  assert.equal(rendered, `const V = "${a}";`);
});

test("the worker source is not reachable unstamped through the static handler", async () => {
  // Lives under src/backend/assets, outside the static root, like analytics.js.
  const response = await get("/assets/sw.js");
  assert.equal(response.statusCode, 404);
});

// ── the offline page ────────────────────────────────────────────────────────

test("the offline page is a public shell that needs nothing else to render", async () => {
  const response = await get("/offline");
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /text\/html/);
  assert.match(response.body, /You are offline/);
  // The worker keeps only this one file. A stylesheet or script it had to
  // fetch would not arrive when the page is actually needed.
  assert.doesNotMatch(response.body, /<link[^>]+rel="stylesheet"/);
  assert.doesNotMatch(response.body, /<script/);
});

// ── the pages ───────────────────────────────────────────────────────────────

const OWNER_PAGES_SIGNED_OUT = [
  "/owner-login",
  "/owner-verify",
  "/register-owner",
  "/forgot-password",
  "/reset-password",
  "/owner-vehicle-detail"
];
const OWNER_PAGES_SIGNED_IN = [
  "/owner-welcome",
  "/owner-documents",
  "/owner-login-pin",
  "/owner-membership"
];

function assertInstallable(body, url) {
  assert.match(body, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/, `${url}: manifest link`);
  assert.match(body, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/, `${url}: iOS meta`);
  assert.match(body, /<script src="\/scripts\/pwa\.js\?v=[0-9a-f]{12}" defer><\/script>/, `${url}: pwa.js, stamped`);
}

test("every owner page carries the manifest and the install script", async () => {
  for (const url of OWNER_PAGES_SIGNED_OUT) {
    const response = await get(url);
    assert.equal(response.statusCode, 200, url);
    assertInstallable(response.body, url);
  }
  for (const url of OWNER_PAGES_SIGNED_IN) {
    const response = await get(url, { signedIn: true });
    assert.equal(response.statusCode, 200, url);
    assertInstallable(response.body, url);
  }
});

test("the install script is served stamped and immutable like the other scripts", async () => {
  const page = await get("/owner-login");
  const [, version] = page.body.match(/\/scripts\/pwa\.js\?v=([0-9a-f]{12})/);
  const response = await get(`/scripts/pwa.js?v=${version}`);
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["cache-control"]), /immutable/);
  assert.match(response.body, /serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(response.body, /menuInstallRow/);
});

test("the dashboard has the install row, hidden until the browser offers", async () => {
  const response = await get("/owner-welcome", { signedIn: true });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /id="menuInstallRow" style="display:none"/);
  assert.match(response.body, /onclick="ptInstallApp\(\)"/);
});

test("the strict sign-in pages can still load the install script", async () => {
  // These pages drop 'unsafe-inline' from script-src; a file from 'self' is
  // exactly what that policy is for, so it must still be allowed.
  const response = await get("/owner-login");
  const policy = String(response.headers["content-security-policy"]);
  const scriptSrc = policy.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
  assert.ok(scriptSrc, "a script-src directive");
  assert.match(scriptSrc, /'self'/);
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
});

test("the scanner and the shop pages offer no app to install", async () => {
  for (const url of ["/get", "/shop", "/verify", "/offline"]) {
    const response = await get(url);
    assert.equal(response.statusCode, 200, url);
    assert.doesNotMatch(response.body, /manifest\.webmanifest/, url);
    assert.doesNotMatch(response.body, /scripts\/pwa\.js/, url);
  }
});
