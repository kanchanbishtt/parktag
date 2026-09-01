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
  test("script-src allows the GA4 and Meta loaders", async () => {
    const response = await app.inject({ method: "GET", url: "/owner-login" });
    const csp = directives(response.headers["content-security-policy"] || "");

    assert.match(csp["script-src"], /https:\/\/www\.googletagmanager\.com/, "gtag.js must be loadable");
    assert.match(csp["script-src"], /https:\/\/connect\.facebook\.net/, "fbevents.js must be loadable");
  });

  test("connect-src allows both trackers to report", async () => {
    const response = await app.inject({ method: "GET", url: "/owner-login" });
    const csp = directives(response.headers["content-security-policy"] || "");

    // Subtler than the loaders: allow the script but block the POST and the
    // scripts run happily while every event is dropped.
    assert.match(csp["connect-src"], /google-analytics\.com/);
    assert.match(csp["connect-src"], /facebook\.com/);
  });

  test("img-src allows beacon-style hits", async () => {
    const response = await app.inject({ method: "GET", url: "/owner-login" });
    const csp = directives(response.headers["content-security-policy"] || "");

    assert.match(csp["img-src"], /google-analytics\.com/);
    assert.match(csp["img-src"], /facebook\.com/);
  });

  test("it is still a real policy, not a wildcard", async () => {
    // Widening for analytics must not become widening for everything. If a
    // later fix reaches for `*`, this is the thing that objects.
    const response = await app.inject({ method: "GET", url: "/owner-login" });
    const csp = directives(response.headers["content-security-policy"] || "");

    assert.equal(csp["default-src"], "'self'");
    assert.equal(csp["object-src"], "'none'");
    assert.doesNotMatch(csp["script-src"], /(^| )\*( |$)/, "script-src must not be a wildcard");
    assert.doesNotMatch(csp["connect-src"], /(^| )\*( |$)/, "connect-src must not be a wildcard");
  });
});
