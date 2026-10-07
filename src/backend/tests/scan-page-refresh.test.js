// Refreshing a scan page must never show a raw error.
//
// After a scan, pt-analytics.js rewrites the address bar from /vehicle/<token>
// to plain "/vehicle", so the Meta Pixel never reports a tag token. Nothing
// served that path, so every refresh of a scan page (and every reopened tab)
// showed the person at the car `{"message":"Route GET:/vehicle not found",...}`.
//
// Fixed in two layers, both pinned here:
//   1. the scan page is served at the stripped path, and finds its token in the
//      tab's sessionStorage (scanner/app.js);
//   2. any other page address the app does not have gets a ParkTag "page not
//      found" screen, never Fastify's JSON. The API keeps its JSON 404.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(path.join(here, p), "utf8");
const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

let app;

before(async () => {
  ({ app } = await startTestApp());
});

after(async () => {
  await stopTestApp(app);
});

const get = (url, accept = BROWSER) =>
  app.inject({ method: "GET", url, remoteAddress: uniqueAddress(), headers: { accept } });

describe("the address a scan page is left on can be reloaded", () => {
  test("whatever path pt-analytics.js strips the token to is a page the app serves", async () => {
    const analytics = await read("../assets/analytics.js");
    const match = analytics.match(/history\.replaceState\(null, "", "([^"]+)"\)/);
    assert.ok(match, "could not find where pt-analytics.js rewrites the scan page URL");

    const res = await get(match[1]);
    assert.equal(res.statusCode, 200, `refreshing ${match[1]} gives ${res.statusCode}`);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.body, /scripts\/scanner\/app\.js/, `${match[1]} is not the scan page`);
    assert.match(res.headers["cache-control"], /no-store/, "the scan page must not be cached");
  });

  test("bare /tag is the scan page too", async () => {
    const res = await get("/tag");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /scripts\/scanner\/app\.js/);
  });

  test("the scan page keeps its token for the tab, and asks for a rescan when it has none", async () => {
    const scanner = await read("../../frontend/scripts/scanner/app.js");
    assert.match(scanner, /sessionStorage\.setItem\(SCAN_TOKEN_KEY, fromUrl\)/, "the token is no longer remembered for a reload");
    assert.match(scanner, /const TAG_TOKEN = resolveTagToken\(\);/);
    assert.match(scanner, /Scan the sticker again/);
    assert.doesNotMatch(scanner, /No tag token was found in the URL/, "a developer message is back in front of scanners");
    // Share sends the sticker's link, not the stripped address bar.
    assert.match(scanner, /\/tag\/\$\{TAG_TOKEN\}/);
  });
});

describe("an unknown address", () => {
  test("in a browser: a ParkTag page, not JSON", async () => {
    for (const url of ["/vehicle/short", "/no-such-page", "/owner-something-else", "/tag/abc/extra"]) {
      const res = await get(url);
      assert.equal(res.statusCode, 404, url);
      assert.match(res.headers["content-type"], /text\/html/, `${url} answered ${res.headers["content-type"]}`);
      assert.match(res.body, /Page not found/, url);
      assert.doesNotMatch(res.body, /"statusCode":404|Route GET/, `${url} showed the raw error`);
    }
  });

  test("the API, and anything that is not a page, keeps the JSON 404 it always had", async () => {
    for (const [url, accept] of [["/api/no-such-thing", BROWSER], ["/api/no-such-thing", "application/json"], ["/images/no-such.png", "image/avif,image/webp,*/*"]]) {
      const res = await get(url, accept);
      assert.equal(res.statusCode, 404, url);
      assert.match(res.headers["content-type"], /application\/json/, url);
      assert.deepEqual(res.json(), { message: `Route GET:${url} not found`, error: "Not Found", statusCode: 404 });
    }
  });
});
