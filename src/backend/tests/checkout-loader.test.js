// checkout-loader.js runs in the browser with no module system, so it is
// exercised the same way analytics-host-guard.test.js exercises analytics.js:
// read the source, hand it a fake document/window, run it as a function.
//
// setTimeout/clearTimeout are injected so the real 12s hang-timeout and 1.2s
// retry delay in the source do not make every run of this file slow — the
// fake fires on the next tick regardless of the requested delay, which still
// exercises the real cancel-on-settle race (clearTimeout is the real one).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("../../frontend/scripts/checkout-loader.js", import.meta.url), "utf8");

function fakeElement() {
  const el = {
    children: [],
    style: {},
    attributes: {},
    appendChild(child) { el.children.push(child); return child; },
    setAttribute(name, value) { el.attributes[name] = value; },
    getAttribute(name) { return el.attributes[name] ?? null; },
    hasAttribute(name) { return name in el.attributes; },
    removeChild(child) { el.children = el.children.filter((c) => c !== child); },
    get parentNode() { return el._parent || null; }
  };
  Object.defineProperty(el, "style", { value: new Proxy({}, { set: () => true, get: () => "" }), writable: false });
  return el;
}

// Drives one load: `outcome` is "load" (succeeds immediately), "error-error"
// (both the first attempt and the retry fail) or "error-load" (the first
// attempt fails, the retry succeeds).
function run({
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  warmRazorpay = false,
  outcome = "load",
  sessionStore = {}
} = {}) {
  const appended = []; // every <script> the loader injected, in order
  const body = fakeElement();
  const reported = [];
  const tracked = [];

  const scriptTag = fakeElement();
  scriptTag.attributes["data-address-step"] = "/scripts/owner/address-step.js?v=abc123";
  if (warmRazorpay) scriptTag.attributes["data-warm-razorpay"] = "";

  let injectCount = 0;
  const doc = {
    currentScript: scriptTag,
    readyState: "complete",
    head: { appendChild(script) { appended.push(script); fireScriptOutcome(script); } },
    body,
    getElementById(id) { return body.children.find((c) => c.attributes?.id === id || c.id === id) || null; },
    createElement(tag) {
      if (tag === "script") {
        const s = { tagName: "script", remove() {} };
        return s;
      }
      const el = fakeElement();
      el.appendChild = function (child) { el.children.push(child); child._parent = el; return child; };
      return el;
    }
  };

  function fireScriptOutcome(script) {
    injectCount += 1;
    const succeeds = outcome === "load" || (outcome === "error-load" && injectCount === 2);
    queueMicrotask(() => {
      if (succeeds) {
        win.Razorpay = win.Razorpay || function () {};
        if (!win.ptCollectAddress || win.ptCollectAddress.lazy) {
          win.ptCollectAddress = () => "collected";
        }
        script.onload();
      } else {
        script.onerror();
      }
    });
  }

  const win = {
    document: doc,
    navigator: { userAgent },
    location: { href: "https://app.parktag.me/get" },
    addEventListener() {},
    ptReportError(message, context) { reported.push({ message, context }); },
    ptTrack(name, props) { tracked.push({ name, props }); }
  };
  win.window = win;

  const sessionStorage = {
    getItem: (k) => (k in sessionStore ? sessionStore[k] : null),
    setItem: (k, v) => { sessionStore[k] = v; }
  };

  const fakeSetTimeout = (fn) => setTimeout(fn, 0);
  const fakeClearTimeout = (id) => clearTimeout(id);

  const fn = new Function(
    "document", "navigator", "window", "sessionStorage", "setTimeout", "clearTimeout",
    SOURCE
  );
  fn(doc, win.navigator, win, sessionStorage, fakeSetTimeout, fakeClearTimeout);

  return { win, body, reported, tracked, sessionStore };
}

test("a successful load resolves to the real address sheet, with no fallback banner", async () => {
  const { win, body } = run({ outcome: "load" });
  const result = await win.ptCollectAddress({ sku: "pt-car-1" });
  assert.equal(result, "collected");
  assert.equal(body.children.find((c) => c.id === "pt-checkout-fallback"), undefined);
});

test("two failed attempts resolve false and show the WhatsApp fallback", async () => {
  const { win, body, reported, tracked } = run({ outcome: "error-error" });
  const result = await win.ptCollectAddress({ sku: "pt-car-1" });
  assert.equal(result, false, "the existing false-means-dismissed contract is unchanged");

  const banner = body.children.find((c) => c.id === "pt-checkout-fallback");
  assert.ok(banner, "a fallback banner was appended to the body");
  assert.equal(banner.attributes.role, "alert");

  const waLink = banner.children.find((c) => c.href && c.href.includes("wa.me"));
  assert.ok(waLink, "the banner carries a WhatsApp link");
  assert.match(waLink.href, /^https:\/\/wa\.me\/918791638854\?text=/);

  assert.equal(reported.length, 1);
  assert.equal(reported[0].context, "checkout-loader");
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].name, "checkout_load_failed");
});

test("a failure after one retry still succeeds on the second attempt", async () => {
  const { win, body } = run({ outcome: "error-load" });
  const result = await win.ptCollectAddress({ sku: "pt-car-1" });
  assert.equal(result, "collected");
  assert.equal(body.children.find((c) => c.id === "pt-checkout-fallback"), undefined);
});

test("a second fallback banner is not stacked on top of the first", async () => {
  const { win, body } = run({ outcome: "error-error" });
  await win.ptCollectAddress({});
  await win.ptCollectAddress({});
  const banners = body.children.filter((c) => c.id === "pt-checkout-fallback");
  assert.equal(banners.length, 1);
});

test("a Meta in-app browser sees the open-in-browser hint as soon as the script runs", () => {
  // Not gated behind a checkout tap: warm() below usually replaces the stub
  // with the real address-step.js before anyone taps buy, so the hint has to
  // fire on arrival to be seen at all on anything but the fastest taps.
  const { body, sessionStore } = run({
    userAgent: "Mozilla/5.0 (Linux; Android 10; SM-A505F) AppleWebKit/537.36 FBAN/FB4A FBAV/400.0",
    outcome: "load"
  });

  assert.equal(body.children.filter((c) => c.attributes?.role === "status").length, 1);
  assert.equal(sessionStore.pt_meta_hint_shown, "1");
});

test("a second page load in the same session does not stack a second hint", () => {
  const sessionStore = { pt_meta_hint_shown: "1" };
  const { body } = run({
    userAgent: "Mozilla/5.0 (Linux; Android 10; SM-A505F) AppleWebKit/537.36 FBAN/FB4A FBAV/400.0",
    outcome: "load",
    sessionStore
  });
  assert.equal(body.children.filter((c) => c.attributes?.role === "status").length, 0);
});

test("a normal browser never sees the Meta in-app hint", () => {
  const { body } = run({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" });
  assert.equal(body.children.filter((c) => c.attributes?.role === "status").length, 0);
});
