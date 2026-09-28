import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The bundle runs in a browser, so exercise it the way one does: give it a
// window with a hostname and see whether it tries to load anything.
const SOURCE = readFileSync(new URL("../assets/analytics.js", import.meta.url), "utf8")
  .replaceAll("__GA4_MEASUREMENT_ID__", "G-TEST123")
  .replaceAll("__META_PIXEL_ID__", "1770706673979280")
  .replaceAll("__CLARITY_PROJECT_ID__", "ym5jfuzyki");

function run(hostname, pathname = "/get") {
  const loaded = [];
  const script = { set src(v) { loaded.push(v); }, get src() { return ""; } };
  const doc = {
    createElement: () => ({ ...script, set async(_v) {}, setAttribute() {} }),
    head: { appendChild: (el) => loaded.push(String(el.src || "")) },
    body: { appendChild: () => {} },
    currentScript: { getAttribute: () => "app", dataset: { surface: "app" } },
    querySelector: () => ({ getAttribute: () => "app" }),
    querySelectorAll: () => [],
    getElementsByTagName: () => [{ parentNode: { insertBefore: (el) => loaded.push(String(el.src || "")) } }],
    cookie: "",
    // Vendor tags start once the page is idle, so present a loaded page.
    readyState: "complete",
    addEventListener: () => {}
  };
  const win = {
    location: { hostname, pathname, search: "", protocol: "https:", href: `https://${hostname}${pathname}` },
    document: doc,
    navigator: { userAgent: "test" },
    addEventListener: () => {},
    requestIdleCallback: (cb) => cb(),
    matchMedia: () => ({ matches: false })
  };
  win.window = win;
  // The bundle also arms an 8 s fallback timer; keep it from outliving the test.
  const fn = new Function("window", "document", "navigator", "setTimeout", SOURCE);
  fn(win, doc, win.navigator, () => 0);
  return { loaded, ptTrack: typeof win.ptTrack };
}

test("a developer machine loads no tags at all", () => {
  for (const host of ["localhost", "127.0.0.1", "parktag-staging.up.railway.app", "abc.ngrok.io"]) {
    const { loaded, ptTrack } = run(host);
    assert.deepEqual(loaded, [], `${host} should load nothing`);
    assert.equal(ptTrack, "function", "ptTrack still exists so call sites do not throw");
  }
});

test("production hosts still load the tags", () => {
  for (const host of ["parktag.me", "www.parktag.me", "app.parktag.me"]) {
    const { loaded } = run(host);
    assert.ok(loaded.length > 0, `${host} should load its tags`);
  }
});
