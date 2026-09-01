// The analytics bundle is rendered from a template rather than served static, so
// the GA4 / Pixel IDs can differ per environment. Three things have to hold for
// that to be worth doing, and each fails silently rather than loudly:
//
//   1. Every placeholder is substituted. A missed one ships the literal string
//      "__GA4_MEASUREMENT_ID__" as a measurement ID — truthy, so the script sails
//      past its own not-configured guard, initialises against a nonsense property
//      and reports every event into a void. Nothing throws. The first symptom is
//      an empty GA4 property a fortnight into a campaign.
//
//   2. With the IDs unset the bundle is inert. This is the state dev and staging
//      run in, and it is the only thing keeping test traffic from being counted
//      as real conversions and fed to Meta as optimisation signal.
//
//   3. The two scanner-surface events never carry a Pixel name. The scan pages
//      are used by strangers standing at someone else's vehicle; sending Meta a
//      record of that is the one thing a privacy product cannot do.
//
// Deliberately no database and no buildApp(): this is string rendering, and
// making it reachable without Mongo is why renderAnalyticsBundle exists at all.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderAnalyticsBundle, ANALYTICS_PLACEHOLDERS } from "../lib/analytics.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const assetPath = path.join(currentDir, "../assets/analytics.js");

const source = await fs.readFile(assetPath, "utf8");

describe("analytics bundle", () => {
  test("the asset contains every placeholder the renderer knows how to fill", () => {
    // Catches a rename on either side. Without this, a placeholder renamed in
    // the asset but not in analytics.js just stops being substituted, which is
    // failure mode 1 above.
    for (const placeholder of Object.keys(ANALYTICS_PLACEHOLDERS)) {
      assert.ok(
        source.includes(placeholder),
        `${placeholder} is no longer present in assets/analytics.js`
      );
    }
  });

  test("substitutes configured IDs and leaves no placeholder behind", () => {
    const rendered = renderAnalyticsBundle(source, {
      ga4MeasurementId: "G-TEST123",
      metaPixelId: "1234567890"
    });

    assert.match(rendered, /var GA4_ID = "G-TEST123";/);
    assert.match(rendered, /var PIXEL_ID = "1234567890";/);
    assert.doesNotMatch(rendered, /__GA4_MEASUREMENT_ID__|__META_PIXEL_ID__/);
  });

  test("renders an inert bundle when nothing is configured", () => {
    // Both the "env has empty strings" and the "env is missing the keys
    // entirely" shapes, because a fresh deploy produces the second one.
    for (const env of [{ ga4MeasurementId: "", metaPixelId: "" }, {}]) {
      const rendered = renderAnalyticsBundle(source, env);

      assert.match(rendered, /var GA4_ID = "";/);
      assert.match(rendered, /var PIXEL_ID = "";/);
      assert.doesNotMatch(rendered, /__GA4_MEASUREMENT_ID__|__META_PIXEL_ID__/);
    }
  });

  test("never gives the Meta Pixel a scanner-surface event", () => {
    // Pinned here as well as enforced by the data-surface flag at runtime: an
    // edit that gives either event a Pixel name has to fail something.
    assert.match(source, /scan_received:\s*\{\s*ga:\s*"scan_received",\s*pixel:\s*null\s*\}/);
    assert.match(source, /contact_action:\s*\{\s*ga:\s*"contact_action",\s*pixel:\s*null\s*\}/);
  });

  test("the PII allow-list admits no identifier fields", () => {
    // The allow-list is what stops a future call site posting a phone number,
    // a plate or a tag token to Google and Meta. If one of these ever appears
    // in it, that protection is gone and nothing else would notice.
    const allowList = source.slice(source.indexOf("var ALLOWED"), source.indexOf("function sanitize"));

    for (const banned of ["phone", "email", "token", "plate", "mobile", "name", "address"]) {
      assert.doesNotMatch(
        allowList,
        new RegExp(`\\b${banned}\\b`),
        `"${banned}" must never be an allowed analytics parameter`
      );
    }
  });
});

describe("scanner retargeting", () => {
  test("the Pixel is not loaded when a scan page opens", () => {
    // The loader must live inside ptScannerEngaged and nowhere else on this
    // surface. If it ever moves to module scope, every scan becomes a tracked
    // page view for a stranger who has asked for nothing.
    const engagedFn = source.slice(source.indexOf("window.ptScannerEngaged"));
    const beforeEngaged = source.slice(0, source.indexOf("window.ptScannerEngaged"));

    // The one loader before this point is the guarded `if (pixelReady)` block,
    // and pixelReady is false on the scanner surface.
    assert.match(beforeEngaged, /if \(pixelReady\) \{/);
    assert.match(engagedFn, /connect\.facebook\.net/);
  });

  test("the token is stripped from the URL before the Pixel initialises", () => {
    // Ordering is the whole protection. fbq reports document.location with
    // every event, so a replaceState that ran AFTER init would still have
    // leaked the tag token on the first PageView.
    const fn = source.slice(source.indexOf("window.ptScannerEngaged"));
    const strip = fn.indexOf("replaceState");
    const load = fn.indexOf("connect.facebook.net");

    assert.ok(strip > -1, "the URL must be rewritten");
    assert.ok(load > -1, "the Pixel must be loaded here");
    assert.ok(strip < load, "replaceState must happen BEFORE the Pixel loads");
  });

  test("it fails closed when replaceState is missing OR throws", () => {
    // Two distinct ways the strip can fail, and the first one was originally
    // missed: an `if (replaceState) { ... }` inside a try returns only when the
    // call THROWS, and falls straight through when the API is simply absent —
    // skipping the strip and then loading the Pixel on a URL still carrying the
    // token. Both paths must return before the loader is reached.
    const fn = source.slice(source.indexOf("window.ptScannerEngaged"));
    const load = fn.indexOf("connect.facebook.net");

    // Absent: an explicit guard that returns, sitting above the loader.
    const guard = fn.search(/if \(!\(window\.history && typeof window\.history\.replaceState === "function"\)\) return;/);
    assert.ok(guard > -1, "a missing replaceState must return, not fall through");
    assert.ok(guard < load, "that guard must sit above the loader");

    // Throws: the catch returns too.
    const cat = fn.indexOf("catch");
    assert.ok(cat < load, "the catch must sit above the loader");
    assert.match(fn.slice(cat, load), /return;/);

    // And the strip itself is not wrapped in a condition that could skip it
    // silently — by this point it is guarded above, so it runs unconditionally.
    assert.match(fn, /try \{\s*\n\s*window\.history\.replaceState\(null, "", "\/vehicle"\);/);
  });

  test("it only fires on the scanner surface, once, and needs a pixel id", () => {
    const fn = source.slice(source.indexOf("window.ptScannerEngaged"), source.indexOf("})();"));
    assert.match(fn, /if \(scannerRetargetingDone\) return;/);
    assert.match(fn, /if \(surface !== "scanner"\) return;/);
    assert.match(fn, /if \(!PIXEL_ID\) return;/);
  });
});

describe("event id determinism", () => {
  test("an event with a transaction id derives its id from it", () => {
    // The browser and lib/integrations/meta-capi.js must produce the SAME
    // string for one purchase or Meta counts the conversion twice. A random id
    // here would make every server-side Purchase a phantom second sale.
    assert.match(source, /if \(params && params\.transaction_id\) return name \+ ":" \+ params\.transaction_id;/);
  });
});

describe("surface detection survives defer", () => {
  test("the surface is not read from document.currentScript alone", () => {
    // Every analytics tag is deferred so it cannot block first paint, and
    // currentScript is null for a deferred script. Reading the surface from it
    // alone would collapse every page to the "app" default — which on the scan
    // page means loading the Meta Pixel where it must never load. Silently: no
    // error, no warning, just a Pixel that should not be there.
    assert.match(source, /document\.querySelector\('script\[src\*="pt-analytics\.js"\]'\)/);
  });

  test("every page tag is deferred and declares a surface", async () => {
    const pagesDir = path.join(currentDir, "../../frontend/pages");
    const files = [];

    async function walk(dir) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".html")) files.push(full);
      }
    }
    await walk(pagesDir);

    let tagged = 0;
    for (const file of files) {
      const html = await fs.readFile(file, "utf8");
      const tag = html.match(/<script src="\/pt-analytics\.js"[^>]*>/);
      if (!tag) continue;
      tagged += 1;

      assert.match(tag[0], /data-surface="(app|scanner)"/, `${path.basename(file)} must declare a surface`);
      assert.match(tag[0], /\bdefer\b/, `${path.basename(file)} must defer the analytics bundle`);
    }

    assert.ok(tagged > 0, "expected at least one page to carry the analytics tag");
  });

  test("the scan page declares the scanner surface", async () => {
    // Named explicitly rather than left to the sweep above: this is the page
    // the whole privacy rule is about, so it gets an assertion that fails by
    // name if someone re-tags it.
    const html = await fs.readFile(path.join(currentDir, "../../frontend/pages/scanner/index.html"), "utf8");
    assert.match(html, /<script src="\/pt-analytics\.js" data-surface="scanner" defer><\/script>/);
  });
});
