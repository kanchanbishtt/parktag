// The Content-Security-Policy has to permit the analytics the app actually
// ships. This is pinned because the failure mode is invisible from the server:
//
// The bundle is served correctly, the measurement IDs are right, ptTrack()
// runs and reports success — and the browser silently refuses to fetch
// gtag.js and fbevents.js, or drops their beacons at the network boundary.
// Nothing errors. GA4 and Events Manager simply stay empty, and the only
// evidence is a console warning on a visitor's machine that nobody is reading.
//
// That is exactly what happened: the policy predated the analytics work, said
// "no analytics" in its own comment, and blocked every event for as long as it
// took someone to notice an empty dashboard.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp } from "./helpers.js";

let app;

before(async () => {
  ({ app } = await startTestApp());
});

after(async () => {
  await stopTestApp(app);
});

// Split "a; b; c" into { a: "...", b: "..." } for readable assertions.
function directives(header) {
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values.join(" ")];
    })
  );
}

describe("CSP permits the analytics the app ships", () => {
  async function cspFor(url) {
    const response = await app.inject({ method: "GET", url });
    return Object.fromEntries(
      String(response.headers["content-security-policy"] || "")
        .split(";")
        .map((part) => {
          const [name, ...values] = part.trim().split(/\s+/);
          return [name, values.join(" ")];
        })
    );
  }

  test("ordinary pages allow both loaders", async () => {
    const csp = await cspFor("/hub");

    assert.match(csp["script-src"], /https:\/\/www\.googletagmanager\.com/, "gtag.js must be loadable");
    assert.match(csp["script-src"], /https:\/\/connect\.facebook\.net/, "fbevents.js must be loadable");
  });

  test("connect-src allows both trackers to report", async () => {
    // Subtler than the loaders: allow the script but block the POST and the
    // scripts run happily while every event is dropped.
    const csp = await cspFor("/hub");

    assert.match(csp["connect-src"], /google-analytics\.com/);
    assert.match(csp["connect-src"], /facebook\.com/);
  });

  test("img-src allows beacon-style hits", async () => {
    const csp = await cspFor("/hub");

    assert.match(csp["img-src"], /google-analytics\.com/);
    assert.match(csp["img-src"], /facebook\.com/);
  });

  test("credential pages allow both trackers", async () => {
    // The deliberate asymmetry, pinned so neither half drifts.
    //
    // GA4 must load: every marketing CTA lands on /owner-login, and without a
    // page view here the login-wall drop-off cannot be measured at all.
    //
    // The Pixel must not: this is a page where people type OTPs and passwords,
    // a third-party script here can read the form, and the page view already
    // gives us everything the measurement needs.
    for (const url of ["/owner-login", "/register-owner"]) {
      const csp = await cspFor(url);

      // Meta sees what GA4 sees. What keeps this safe on a page with a
      // password box is Events Manager's "Track events automatically without
      // code" staying OFF — see the note on STRICT_SCRIPT_SOURCES in app.js.
      assert.match(csp["script-src"], /https:\/\/www\.googletagmanager\.com/, `${url} must allow GA4`);
      assert.match(csp["script-src"], /https:\/\/connect\.facebook\.net/, `${url} must allow the Pixel`);
    }
  });

  test("the checkout page allows both trackers", async () => {
    // /owner-welcome is where view_item, begin_checkout, purchase and sign_up
    // all fire — the whole commerce funnel. It gets its own tightened script-src
    // (NO_INLINE_SCRIPT_PAGES), which originally allowed Razorpay and nothing
    // else, leaving the most valuable page in the app unable to load either
    // tracker. A policy that blocks the purchase conversion is worse than no
    // Pixel at all, because it looks configured.
    const response = await app.inject({ method: "GET", url: "/owner-welcome" });

    // Signed out this redirects; follow the policy on whatever it serves.
    const header = response.headers["content-security-policy"];
    if (!header) return; // no CSP on a redirect body — nothing to assert

    const csp = Object.fromEntries(
      String(header).split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values.join(" ")];
      })
    );

    assert.match(csp["script-src"], /https:\/\/www\.googletagmanager\.com/, "checkout must allow GA4");
    assert.match(csp["script-src"], /https:\/\/connect\.facebook\.net/, "checkout must allow the Pixel");
    assert.match(csp["script-src"], /checkout\.razorpay\.com/, "and must not have lost Razorpay");
  });

  test("it is still a real policy, not a wildcard", async () => {
    // Widening for analytics must not become widening for everything. If a
    // later fix reaches for `*`, this is the thing that objects.
    const csp = await cspFor("/hub");

    assert.equal(csp["default-src"], "'self'");
    assert.equal(csp["object-src"], "'none'");
    assert.doesNotMatch(csp["script-src"], /(^| )\*( |$)/, "script-src must not be a wildcard");
    assert.doesNotMatch(csp["connect-src"], /(^| )\*( |$)/, "connect-src must not be a wildcard");
  });
});
