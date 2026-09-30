// The delivery layer in app.js: raw page shells are not reachable through the
// static root, pages and the analytics bundle carry validators, /api answers are
// no-store unless a route says otherwise, module imports are stamped with the
// asset version, and assets stay out of the rate limit.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "../../frontend");

let app;
let version;

before(async () => {
  ({ app } = await startTestApp());
  const page = await app.inject({ method: "GET", url: "/get" });
  version = page.body.match(/\/styles\/get\.css\?v=([a-f0-9]+)/)[1];
});

after(async () => {
  await stopTestApp(app);
});

const get = (url, headers = {}) =>
  app.inject({ method: "GET", url, headers, remoteAddress: uniqueAddress() });

// ── S1: pages/ is not part of the static root ───────────────────────────────

test("raw page shells are a 404, however the path is spelled", async () => {
  for (const url of [
    "/pages/admin/overview.html",
    "/pages/owner/welcome.html",
    "/pages/scanner/index.html",
    "/pages/hub.html",
    "/%70ages/admin/overview.html",
    "/PAGES/admin/overview.html",
    "/pages/../pages/admin/overview.html",
    "/scripts/../pages/admin/overview.html",
    "/pages//admin/overview.html"
  ]) {
    const response = await get(url);
    assert.equal(response.statusCode, 404, `${url} must not serve a page shell`);
    assert.ok(!response.body.includes("<html"), `${url} leaked markup`);
  }
});

test("every page shell still has a working named route", async () => {
  for (const url of ["/get", "/direct", "/shop", "/verify", "/track-order", "/report-tag", "/owner-login", "/admin"]) {
    const response = await get(url);
    assert.equal(response.statusCode, 200, url);
    assert.match(response.headers["content-type"], /text\/html/);
  }
  // Session-gated pages redirect rather than serve to a stranger.
  for (const name of [
    "overview", "etags", "activations", "issuance", "print-queue", "traffic", "marketing",
    "promo-codes", "reviews", "api-tokens", "owners", "activity", "admins", "sticker-designer"
  ]) {
    assert.equal((await get(`/admin/${name}`)).statusCode, 302, `/admin/${name}`);
  }
  assert.equal((await get("/owner-welcome")).statusCode, 302);
  // The hub page was removed upstream; its old URL is not a page.
  assert.equal((await get("/hub")).statusCode, 404);
});

test("assets outside pages/ are unaffected", async () => {
  assert.equal((await get("/styles/styles.css")).statusCode, 200);
  assert.equal((await get("/fonts/inter-latin-var.woff2")).statusCode, 200);
});

// ── M12: pages from memory, with validators on public shells ─────────────────

test("a public shell carries an ETag and answers If-None-Match with 304", async () => {
  for (const url of ["/get", "/shop", "/verify", "/track-order"]) {
    const first = await get(url);
    assert.equal(first.statusCode, 200);
    assert.match(first.headers.etag, /^W\/"[a-f0-9]{40}"$/, url);
    assert.match(first.headers["cache-control"], /no-cache/);

    const second = await get(url, { "if-none-match": first.headers.etag });
    assert.equal(second.statusCode, 304, url);
    assert.equal(second.body, "");

    const other = await get(url, { "if-none-match": 'W/"something-else"' });
    assert.equal(other.statusCode, 200);
  }
});

test("no-store pages get no validator and stay no-store", async () => {
  for (const url of ["/owner-login", "/admin", "/register-owner"]) {
    const response = await get(url);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["cache-control"], /no-store/, url);
    assert.equal(response.headers.etag, undefined, `${url} must not be revalidatable`);
  }
  // The scanner shell is served from memory and stays exactly no-store.
  const scanner = await get(`/tag/${"a".repeat(64)}`);
  assert.equal(scanner.statusCode, 200);
  assert.match(scanner.headers["cache-control"], /no-store/);
  assert.equal(scanner.headers.etag, undefined);
  const stamped = await get("/get");
  assert.ok(!stamped.body.includes("__ASSET_VERSION__"));
});

// ── L4: analytics bundle ─────────────────────────────────────────────────────

test("/pt-analytics.js is cacheable with stale-while-revalidate, an ETag and a 304", async () => {
  const first = await get("/pt-analytics.js");
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["cache-control"], "public, max-age=300, stale-while-revalidate=86400");
  assert.equal(first.headers["cross-origin-resource-policy"], "cross-origin");
  assert.ok(first.headers.etag);
  assert.doesNotMatch(first.body, /__GA4_MEASUREMENT_ID__|__META_PIXEL_ID__|__CLARITY_PROJECT_ID__/);

  const second = await get("/pt-analytics.js", { "if-none-match": first.headers.etag });
  assert.equal(second.statusCode, 304);
  assert.equal(second.headers["cross-origin-resource-policy"], "cross-origin");
});

// ── M14: /api defaults to no-store ───────────────────────────────────────────

test("an /api response with no Cache-Control of its own is no-store", async () => {
  for (const url of ["/api/session", "/api/health", "/api/owner/dashboard", "/api/admin/overview"]) {
    const response = await get(url);
    assert.equal(response.headers["cache-control"], "no-store", `${url} (${response.statusCode})`);
  }
});

test("routes that set their own Cache-Control keep it", async () => {
  const catalogue = await get("/api/shop/public-catalogue");
  assert.equal(catalogue.statusCode, 200);
  assert.equal(catalogue.headers["cache-control"], "public, max-age=30");

  const reviews = await get("/api/shop/reviews");
  assert.equal(reviews.headers["cache-control"], "public, max-age=60");

  const recaptcha = await get("/api/auth/recaptcha/config");
  assert.equal(recaptcha.headers["cache-control"], "public, max-age=3600");
  // /api/auth/google/config exists only when GOOGLE_CLIENT_ID is set, which the
  // test harness clears, so it cannot be exercised here.
  const v2 = await get("/api/recaptcha/v2-config");
  assert.equal(v2.headers["cache-control"], "public, max-age=3600");
});

test("the catalogue is identical with and without a session or promo", async () => {
  const anonymous = await get("/api/shop/public-catalogue");
  const withCookie = await get("/api/shop/public-catalogue?promo=X", { cookie: "wavetag_session=nonsense" });
  assert.deepEqual(withCookie.json(), anonymous.json());
});

// ── M13: import stamping, end to end ─────────────────────────────────────────

test("a script requested with the current version has its imports stamped", async () => {
  const response = await get(`/scripts/get.js?v=${version}`);
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /javascript/);
  assert.match(response.headers["cache-control"], /immutable/);
  assert.ok(response.headers.etag);
  assert.ok(response.body.includes(`from "./recaptcha.js?v=${version}"`), "relative import not stamped");
  assert.ok(!/from "\.\/recaptcha\.js"/.test(response.body));

  const conditional = await get(`/scripts/get.js?v=${version}`, { "if-none-match": response.headers.etag });
  assert.equal(conditional.statusCode, 304);
});

test("a wrong or missing version leaves the file exactly as it is on disk", async () => {
  const disk = await fs.readFile(path.join(frontendRoot, "scripts/get.js"), "utf8");
  for (const url of ["/scripts/get.js", "/scripts/get.js?v=stale-version", "/scripts/get.js?v=__ASSET_VERSION__"]) {
    const response = await get(url);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, disk, `${url} must be served untouched`);
    assert.doesNotMatch(response.headers["cache-control"], /immutable/, url);
  }
});

test("the stamped graph is closed: every import resolves to a versioned, servable file", async () => {
  // Walk from the entry point the way a browser would and require that each
  // stamped import is itself served (stamped) and that none is loaded twice
  // under two different URLs.
  const seen = new Map();
  const queue = [`/scripts/owner/welcome.js?v=${version}`];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    const response = await get(url);
    assert.equal(response.statusCode, 200, url);
    seen.set(url, response.body);
    const importRe = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
    for (const [, spec] of response.body.matchAll(importRe)) {
      if (/^https?:/.test(spec)) continue;
      const resolved = new URL(spec, `http://x${url}`);
      assert.equal(resolved.searchParams.get("v"), version, `${spec} in ${url} is not stamped`);
      queue.push(resolved.pathname + resolved.search);
    }
  }
  const files = [...seen.keys()].map((u) => u.split("?")[0]);
  assert.equal(new Set(files).size, files.length, "a file is reachable under two URLs");
  assert.ok(files.length >= 3);
});

test("an absolute dynamic import is stamped too", async () => {
  const response = await get(`/scripts/owner/address-step.js?v=${version}`);
  assert.equal(response.statusCode, 200);
  assert.ok(
    response.body.includes(`import("/scripts/vendor/number-flow.js?v=${version}")`) ||
      !response.body.includes("/scripts/vendor/number-flow.js"),
    "number-flow import not stamped"
  );
  const flow = await get(`/scripts/vendor/number-flow.js?v=${version}`);
  assert.ok(flow.body.includes(`from"./esm-env.js?v=${version}"`), "minified import not stamped");
});

test("a path that escapes /scripts is never read", async () => {
  const response = await get(`/scripts/..%2f..%2fbackend%2fapp.js?v=${version}`);
  assert.notEqual(response.statusCode, 200);
  assert.ok(!response.body.includes("buildApp"));
});

// ── L2: assets do not count against the request budget ───────────────────────

test("asset requests are exempt from the global limit", async () => {
  const address = uniqueAddress();
  let last;
  for (let i = 0; i < 230; i += 1) {
    last = await app.inject({ method: "GET", url: "/styles/styles.css", remoteAddress: address });
  }
  assert.equal(last.statusCode, 200);
  const health = await app.inject({ method: "GET", url: "/api/health", remoteAddress: address });
  assert.equal(health.statusCode, 200);
});
