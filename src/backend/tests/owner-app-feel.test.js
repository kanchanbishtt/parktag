// The owner pages inside the installed app, where Chrome shows them with no
// address bar and nothing else of its own. Whatever the page does not override
// still behaves like a browser tab, and the first phone test showed exactly
// that: Chrome's pull-to-refresh took over the dashboard's own, cancelled the
// touch sequence under it, and left "Refreshing…" open for good; the logo
// opened the marketing site as a Chrome tab with a toolbar.
//
// No database: every check here is over the served files and the scripts run
// in a vm against a stub document.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const pwaSource = await readFile(new URL("../../frontend/scripts/pwa.js", import.meta.url), "utf8");
const welcomeJs = await readFile(new URL("../../frontend/scripts/owner/welcome.js", import.meta.url), "utf8");
const welcomeCss = await readFile(new URL("../../frontend/styles/owner-welcome.css", import.meta.url), "utf8");
const sharedCss = await readFile(new URL("../../frontend/styles/styles.css", import.meta.url), "utf8");

// ── pull-to-refresh ─────────────────────────────────────────────────────────

// Runs the dashboard's pull-to-refresh block as the page would, with a stub
// document that records listeners and the indicator's class list.
function pullToRefreshPage() {
  const start = welcomeJs.indexOf("// ── Pull-to-refresh");
  const end = welcomeJs.indexOf("// ── Burger menu", start);
  assert.ok(start > 0 && end > start, "the pull-to-refresh block");
  const source = welcomeJs.slice(start, end);

  const listeners = {};
  const classes = new Set();
  let loads = 0;
  const indicator = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  const document = {
    documentElement: { scrollTop: 0 },
    body: { scrollTop: 0 },
    getElementById: (id) => (id === "ptrIndicator" ? indicator : null),
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };
  const context = vm.createContext({ document, load: () => { loads += 1; } });
  vm.runInContext(source, context);
  const fire = (type, y) => listeners[type]({ touches: [{ clientY: y }] });
  return { listeners, fire, visible: () => classes.has("visible"), loads: () => loads };
}

test("a pull the browser hands back refreshes; one it cancels just closes the indicator", () => {
  const page = pullToRefreshPage();
  assert.deepEqual(Object.keys(page.listeners).sort(), ["touchcancel", "touchend", "touchmove", "touchstart"]);

  // The usual pull: indicator opens past 10px, refresh fires past the threshold.
  page.fire("touchstart", 100);
  page.fire("touchmove", 130);
  assert.equal(page.visible(), true);
  page.fire("touchmove", 200);
  page.fire("touchend");
  assert.equal(page.visible(), false);
  assert.equal(page.loads(), 1);

  // The browser takes the drag over: touchcancel instead of touchend. The
  // indicator closes and nothing refreshes (the browser did not hand it back).
  page.fire("touchstart", 100);
  page.fire("touchmove", 200);
  assert.equal(page.visible(), true);
  page.fire("touchcancel");
  assert.equal(page.visible(), false, "the line that used to stay open");
  assert.equal(page.loads(), 1);

  // And a cancelled drag leaves nothing armed for the next touchend.
  page.fire("touchstart", 100);
  page.fire("touchend");
  assert.equal(page.loads(), 1);
});

test("the browser's own pull-to-refresh is switched off on the dashboard", () => {
  // Two refreshes on one drag is how the indicator got stuck in the first place.
  assert.match(welcomeCss, /html, body \{ overscroll-behavior-y: none; \}/);
});

// ── the installed app ───────────────────────────────────────────────────────

function openPage({ inApp, logos = 1 } = {}) {
  const store = new Map();
  if (inApp) store.set("pt_android_app", "1");
  const sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const classes = new Set();
  const links = Array.from({ length: logos }, () => {
    const attrs = { href: "https://parktag.me" };
    return { attrs, setAttribute: (k, v) => { attrs[k] = v; } };
  });
  const window = { location: { search: "" }, sessionStorage, addEventListener() {} };
  window.window = window;
  const document = {
    referrer: "",
    documentElement: { classList: { add: (c) => classes.add(c) } },
    getElementById: () => null,
    querySelectorAll: (selector) => (selector === 'a[aria-label="ParkTag home"]' ? links : [])
  };
  vm.runInContext(pwaSource, vm.createContext({ window, document, navigator: { userAgent: "Android" } }));
  return { marked: classes.has("pt-android-app"), logoHrefs: links.map((l) => l.attrs.href) };
}

test("inside the app the document is marked and the logo goes home, not to the marketing site", () => {
  assert.deepEqual(openPage({ inApp: true, logos: 2 }), { marked: true, logoHrefs: ["/owner", "/owner"] });
  assert.deepEqual(openPage({ inApp: false, logos: 2 }), { marked: false, logoHrefs: ["https://parktag.me", "https://parktag.me"] });
});

test("the shared stylesheet turns off the browser feel inside the app, and only there", () => {
  // Keyed off the class pwa.js sets, and off standalone display (the TWA and
  // the installed PWA both match it); an ordinary tab matches neither.
  assert.match(sharedCss, /@media \(display-mode: standalone\) \{\s*html, body \{ overscroll-behavior-y: none; \}\s*\}/);
  assert.match(sharedCss, /html\.pt-android-app, html\.pt-android-app body \{ overscroll-behavior-y: none; \}/);
  // Selection and the long-press sheet are off on the page's chrome only;
  // nothing here touches content such as plates, codes or messages.
  const chrome = sharedCss.slice(sharedCss.indexOf("html.pt-android-app button"), sharedCss.indexOf("-webkit-touch-callout: none;"));
  assert.match(chrome, /html\.pt-android-app button,/);
  assert.match(chrome, /html\.pt-android-app \.pt-bottom-nav,/);
  assert.doesNotMatch(chrome, /\bp\b|\bli\b|\.pt-ref-code|\.pt-plate|body \{/);
  // Every rule in that block is scoped to the app class.
  for (const selector of chrome.split(",").map((s) => s.trim()).filter(Boolean)) {
    assert.ok(selector.startsWith("html.pt-android-app"), selector);
  }
});
