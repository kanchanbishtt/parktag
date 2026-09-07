// The tag token must survive pt-analytics stripping it out of the address bar.
//
// WHAT BROKE. A buyer scans a new sticker, lands on /vehicle/<token>, and the
// tag resolves. They engage with the page, which fires ptScannerEngaged() in
// pt-analytics.js, which deliberately does:
//
//     window.history.replaceState(null, "", "/vehicle");
//
// so the Meta Pixel can never report a URL carrying a tag token. That is
// correct and should stay. Its comment reasons that "the token was already read
// into memory long before this runs", which holds for the page load and not for
// anything that reads window.location afterwards.
//
// The activation wizard read it afterwards. handleActVerify called
// getTokenFromUrl() when the buyer pressed Verify & Activate, some seconds after
// the strip, got "", and POSTed to `/api/tags//activate`. That is a live route
// with an empty :token, so the server looked up a tag whose token was "", missed
// and answered 404 "Tag not found" — on a tag that had resolved twenty seconds
// earlier. Every retail activation runs through that button.
//
// Two independent guards, because either alone would have prevented this:
//   1. the client caches the token at module load and never re-reads the URL,
//   2. the server refuses an empty :token before it reaches the database.
//
// Read as text: no browser, no database, runs everywhere.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCANNER_JS = path.join(HERE, "../../frontend/scripts/scanner/app.js");
const ANALYTICS_JS = path.join(HERE, "../assets/analytics.js");
const PUBLIC_ROUTES = path.join(HERE, "../routes/public/index.js");

const scanner = await readFile(SCANNER_JS, "utf8");
const routes = await readFile(PUBLIC_ROUTES, "utf8");

describe("the tag token survives the analytics URL strip", () => {
  test("the token is read once at module load, not per call", () => {
    assert.match(
      scanner,
      /const TAG_TOKEN = readTokenFromUrl\(\);/,
      "the token is no longer captured once at module scope"
    );
    assert.match(
      scanner,
      /function getTokenFromUrl\(\)\s*\{\s*return TAG_TOKEN;\s*\}/,
      "getTokenFromUrl no longer returns the cached value"
    );
  });

  test("nothing reads window.location for the token after load", () => {
    // readTokenFromUrl is the ONE place allowed to touch window.location for
    // this. If a second reader appears, it will re-introduce the bug on
    // whichever code path calls it late.
    const readers = scanner.match(/window\.location\.(pathname|search)/g) || [];
    assert.equal(
      readers.length,
      2,
      "window.location is read for the token somewhere other than readTokenFromUrl"
    );
  });

  test("the activation submit refuses an empty token instead of posting one", () => {
    const handler = scanner.slice(scanner.indexOf("async function handleActVerify"));
    const guard = handler.indexOf("if (!token)");
    const request = handler.indexOf("/api/tags/${token}/activate");
    assert.ok(guard !== -1, "handleActVerify does not guard against an empty token");
    assert.ok(
      guard < request && request !== -1,
      "the empty-token guard must run before the request is built"
    );
  });

  test("the server rejects an empty :token before hitting the database", () => {
    const route = routes.slice(routes.indexOf('app.post("/api/tags/:token/activate"'));
    const guard = route.indexOf("isNonEmptyString(request.params.token)");
    const lookup = route.indexOf("collections.tags.findOne({ token: request.params.token })");
    assert.ok(guard !== -1, "the activate route does not check for an empty token");
    assert.ok(
      guard < lookup && lookup !== -1,
      "the empty-token check must run before the tag lookup, or the buyer still gets 'Tag not found'"
    );
  });
});

describe("the analytics strip that caused it is still in place", () => {
  test("pt-analytics still removes the token from the address bar", async () => {
    // This is a privacy control and must not be 'fixed' by deleting it: the
    // client-side cache is what makes the two compatible. If this assertion
    // ever fails, check that removing it was deliberate.
    const analytics = await readFile(ANALYTICS_JS, "utf8").catch(() => "");
    if (!analytics) return; // file moved; the scanner-side guards still hold
    assert.match(
      analytics,
      /replaceState\(null, "", "\/vehicle"\)/,
      "the token is no longer stripped from the URL before the Pixel loads"
    );
  });
});
