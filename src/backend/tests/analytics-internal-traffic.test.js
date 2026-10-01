// Our own devices are not measured.
//
// On 1 Oct 2026 one morning of checkout testing put two "purchases" and 26
// begin_checkouts into GA4 and the Pixel, and a 135-click session into Clarity
// that accounted for most of the day's dead clicks. The order ledger already
// knew those orders were ours (lib/core/internal-orders.js); the browser did
// not. These tests pin the browser half: the bundle itself, and the route that
// serves it to the office network.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { INTERNAL_ANALYTICS_BUNDLE } from "../lib/analytics.js";

const SOURCE = readFileSync(new URL("../assets/analytics.js", import.meta.url), "utf8")
  .replaceAll("__GA4_MEASUREMENT_ID__", "G-TEST123")
  .replaceAll("__META_PIXEL_ID__", "1770706673979280")
  .replaceAll("__CLARITY_PROJECT_ID__", "ym5jfuzyki");

// A browser just real enough to run the bundle: a cookie jar that honours
// Max-Age=0 and records every write.
function browser({ cookie = "", search = "", pathname = "/get", hostname = "app.parktag.me" } = {}) {
  const jar = new Map(cookie ? cookie.split("; ").map((pair) => pair.split("=")) : []);
  const loaded = [];
  const listeners = {};
  const cookieWrites = [];
  const idle = [];

  const doc = {
    createElement: () => ({ set src(v) { loaded.push(v); }, get src() { return ""; }, set async(_v) {}, setAttribute() {} }),
    head: { appendChild: () => {} },
    currentScript: null,
    querySelector: () => ({
      getAttribute: () => "app",
      src: "https://app.parktag.me/pt-analytics.js"
    }),
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
    readyState: "complete",
    addEventListener: () => {},
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(text) {
      cookieWrites.push(text);
      const [pair, ...attributes] = text.split("; ");
      const [name, value] = pair.split("=");
      if (attributes.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, value);
    }
  };
  const win = {
    location: { hostname, pathname, search, protocol: "https:", href: `https://${hostname}${pathname}${search}` },
    document: doc,
    navigator: { userAgent: "test" },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    // Idle really is later: the bundle queues its three vendor loaders after
    // asking for the callback, so running it inline would start none of them.
    requestIdleCallback: (cb) => idle.push(cb),
    matchMedia: () => ({ matches: false }),
    console: { warn() {} },
    URL
  };
  win.window = win;

  new Function("window", "document", "navigator", "setTimeout", "URL", SOURCE)(win, doc, win.navigator, () => 0, URL);
  idle.forEach((cb) => cb());
  return { win, doc, loaded, listeners, jar, cookieWrites };
}

describe("our own devices are not measured", () => {
  test("a device holding the cookie loads no tags and still has ptTrack", () => {
    const { loaded, win } = browser({ cookie: "pt_internal=1" });
    assert.deepEqual(loaded, []);
    assert.equal(typeof win.ptTrack, "function");
    assert.equal(win.dataLayer, undefined, "GA4 was never set up");
    assert.equal(win.fbq, undefined, "the Pixel was never set up");
  });

  test("a device without it is measured as before", () => {
    const { loaded, win } = browser();
    assert.ok(loaded.some((src) => src.includes("googletagmanager.com")));
    assert.ok(Array.isArray(win.dataLayer));
  });

  test("?pt_internal=1 opts the device out, on the parent domain, for a year", () => {
    const { loaded, jar, cookieWrites } = browser({ hostname: "parktag.me", pathname: "/", search: "?utm_source=x&pt_internal=1" });
    assert.equal(jar.get("pt_internal"), "1");
    assert.deepEqual(loaded, [], "and the very page that set it is not measured");
    // The attributes are what make the app honour a flag set on the marketing
    // site, and the other way round.
    assert.deepEqual(cookieWrites, ["pt_internal=1; Max-Age=31536000; Path=/; Domain=parktag.me; SameSite=Lax; Secure"]);
  });

  test("?pt_internal=0 opts it back in", () => {
    const { loaded, jar } = browser({ cookie: "pt_internal=1", search: "?pt_internal=0" });
    assert.equal(jar.has("pt_internal"), false);
    assert.ok(loaded.length > 0, "measured again on the same page load");
  });

  test("a look-alike parameter or cookie does not count", () => {
    assert.ok(browser({ search: "?not_pt_internal=1" }).loaded.length > 0);
    assert.ok(browser({ search: "?pt_internal=10" }).loaded.length > 0);
    assert.ok(browser({ cookie: "xpt_internal=1" }).loaded.length > 0);
    assert.ok(browser({ cookie: "pt_internal=0" }).loaded.length > 0);
  });

  test("the cookie arriving mid-page stops the purchase that follows", () => {
    // The server sets it in answer to the order itself (markInternalDevice),
    // on a page that loaded as an ordinary visitor's.
    const { win, doc } = browser();
    const before = win.dataLayer.length;

    win.ptTrack("begin_checkout", { value: 399, currency: "INR" });
    assert.equal(win.dataLayer.length, before + 1, "measured while it was still a stranger");

    doc.cookie = "pt_internal=1; Max-Age=31536000";
    win.ptTrack("purchase", { value: 399, currency: "INR", transaction_id: "PT-1" });
    assert.equal(win.dataLayer.length, before + 1, "nothing sent once the device is ours");
  });

  test("the office network is served a bundle that defines ptTrack and nothing else", () => {
    const win = {};
    new Function("window", INTERNAL_ANALYTICS_BUNDLE)(win);
    assert.deepEqual(Object.keys(win), ["ptTrack"]);
    assert.doesNotThrow(() => win.ptTrack("purchase", { value: 399 }));
    assert.doesNotMatch(INTERNAL_ANALYTICS_BUNDLE, /googletagmanager|facebook|clarity|G-|__[A-Z_]+__/);
  });
});

describe("the office network is served a different bundle", () => {
  test("an internal IP gets the silent bundle uncached; a stranger gets the real one", async () => {
    process.env.INTERNAL_IPS = "203.0.113.7, 198.51.100.9";
    const { startTestApp, stopTestApp } = await import("./helpers.js");
    const { app } = await startTestApp();
    try {
      const ours = await app.inject({ method: "GET", url: "/pt-analytics.js", remoteAddress: "203.0.113.7" });
      assert.equal(ours.statusCode, 200);
      assert.equal(ours.body, INTERNAL_ANALYTICS_BUNDLE);
      // Stored, so it replaces a public copy already in the browser's cache;
      // never trusted, so a laptop taken home asks again; never shared.
      assert.equal(ours.headers["cache-control"], "private, no-cache");
      assert.equal(ours.headers["cross-origin-resource-policy"], "cross-origin");

      const theirs = await app.inject({ method: "GET", url: "/pt-analytics.js", remoteAddress: "203.0.113.8" });
      assert.equal(theirs.statusCode, 200);
      assert.match(theirs.body, /window\.ptTrack = dispatch/);
      assert.match(theirs.headers["cache-control"], /^public/);

      // An office browser still holding the public copy must not be told to
      // keep it.
      const revalidated = await app.inject({
        method: "GET",
        url: "/pt-analytics.js",
        remoteAddress: "203.0.113.7",
        headers: { "if-none-match": theirs.headers.etag }
      });
      assert.equal(revalidated.statusCode, 200);
      assert.equal(revalidated.body, INTERNAL_ANALYTICS_BUNDLE);

      // And the other way round: the laptop goes home holding the silent copy,
      // revalidates from a stranger's address, and must get the real bundle.
      assert.notEqual(ours.headers.etag, theirs.headers.etag);
      const wentHome = await app.inject({
        method: "GET",
        url: "/pt-analytics.js",
        remoteAddress: "203.0.113.8",
        headers: { "if-none-match": ours.headers.etag }
      });
      assert.equal(wentHome.statusCode, 200);
      assert.match(wentHome.body, /window\.ptTrack = dispatch/);

      const stillAtOffice = await app.inject({
        method: "GET",
        url: "/pt-analytics.js",
        remoteAddress: "203.0.113.7",
        headers: { "if-none-match": ours.headers.etag }
      });
      assert.equal(stillAtOffice.statusCode, 304);
    } finally {
      await stopTestApp(app);
      delete process.env.INTERNAL_IPS;
    }
  });
});
