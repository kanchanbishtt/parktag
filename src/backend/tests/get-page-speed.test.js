// How fast /get puts a price on screen. Every price on the page waits for
// /api/shop/public-catalogue, and in production that took 3–4 seconds to show:
// the request only started once get.js and its imports had downloaded, the
// endpoint made three Mongo round trips one after another, and a 1.8 MB
// autoplaying video and the hero PNG competed for the same connection.
// These pin the fixes, each of which is easy to undo without noticing.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { startTestApp, stopTestApp } from "./helpers.js";

const html = await readFile(new URL("../../frontend/pages/get.html", import.meta.url), "utf8");
const script = await readFile(new URL("../../frontend/scripts/get.js", import.meta.url), "utf8");

let app;

before(async () => {
  ({ app } = await startTestApp());
});

after(async () => {
  await stopTestApp(app);
});

test("the catalogue is preloaded, and get.js asks for it in a way that reuses the preload", () => {
  assert.match(html, /<link rel="preload" href="\/api\/shop\/public-catalogue" as="fetch" crossorigin="anonymous" \/>/);
  // Any init (a custom header, credentials) makes the browser ignore the
  // preloaded response and fetch it a second time.
  assert.match(script, /fetch\("\/api\/shop\/public-catalogue"\)/);
});

test("get.js's imports are preloaded with it", () => {
  const imports = [...script.matchAll(/^import .* from "\.\/([\w-]+\.js)";$/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const name of imports) {
    // Stamped like the import inside get.js (see import-stamp.js), or the
    // preload and the import are two different URLs and the file is fetched twice.
    assert.ok(
      html.includes(`<link rel="modulepreload" href="/scripts/${name}?v=__ASSET_VERSION__" />`),
      `modulepreload for ${name}`
    );
  }
});

test("the proof video does not download at page load", () => {
  const video = html.match(/<video[^>]*id="gtProofVideo"[^>]*>/s)?.[0];
  assert.ok(video, "the proof video is on the page");
  assert.doesNotMatch(video, /\sautoplay[\s>=]/, "autoplay makes the browser fetch the whole file at once");
  assert.match(video, /preload="none"/);
  assert.match(script, /function wireProofVideo\(\)/);
});

test("the hero image is the WebP, and the hidden add-on photo waits until it is shown", () => {
  assert.match(html, /src="\/images\/final-landing-sticker\.webp"[\s\S]{0,80}fetchpriority="high"/);
  assert.match(html, /<img id="gtAddonImage" loading="lazy"/);
});

test("the catalogue is not held to a per-route limit (that limit costs a Mongo round trip)", async () => {
  // It used to allow 60 a minute through the Mongo-backed store. Past that, from
  // one address, it must still answer; the app-wide in-memory limit remains.
  let last;
  for (let i = 0; i < 61; i++) {
    last = await app.inject({ method: "GET", url: "/api/shop/public-catalogue", remoteAddress: "203.0.113.77" });
  }
  assert.equal(last.statusCode, 200);
});
