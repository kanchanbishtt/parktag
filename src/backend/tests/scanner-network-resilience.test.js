// The scan page, on one bar of signal.
//
// Every request this page made was a bare `fetch` with no deadline. On a
// stalled connection that never settles, so the page kept a disabled button and
// a "Preparing your call…" label indefinitely — in a basement car park, which
// is where this page is used. The behaviour itself is covered by the unit tests
// in net-retry.test.js; what is locked in here is that the scan page actually
// goes through that module, and that nothing has quietly reintroduced a request
// that can hang forever or replay something it should not.
import test from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp } from "./helpers.js";

let app;

test.before(async () => {
  ({ app } = await startTestApp());
});

test.after(async () => {
  await stopTestApp(app);
});

async function scannerBundle() {
  const response = await app.inject({ method: "GET", url: "/scripts/scanner/app.js" });
  assert.equal(response.statusCode, 200, "the scanner bundle must be served");
  return response.body;
}

test("no request on the scan page can hang forever", async () => {
  // The regression that matters. A bare fetch has no deadline, so one stalled
  // request strands the scanner on a page that will never move again.
  const js = await scannerBundle();

  assert.doesNotMatch(js, /await\s+fetch\(/,
    "a bare fetch has no timeout — route it through requestJson instead");
  assert.match(js, /from "\.\.\/net-retry\.js"/,
    "the scan page must use the module that applies the deadline");
});

test("the module it depends on is actually served", async () => {
  const response = await app.inject({ method: "GET", url: "/scripts/net-retry.js" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /export async function requestJson/);
  // A module specifier is resolved by the browser without the page's version
  // stamp, so this file is fetched by its bare path and must exist there.
  assert.match(response.headers["content-type"] || "", /javascript/);
});

test("reads may be retried, writes may not", async () => {
  // A GET is free to repeat. The POSTs on this page are not: register-call and
  // /api/contact-requests both set freeContactUsed before their answer leaves
  // the server, so replaying one whose response was lost reports 402 "free
  // contact already used" for a contact that in fact succeeded. send-otp and
  // activate have their own duplicate effects.
  const js = await scannerBundle();

  assert.match(js, /const isRead = !options\.method \|\| options\.method === "GET"/,
    "the read/write split is what decides whether a repeat is allowed");
  assert.match(js, /retries = isRead \? 3 : 0/,
    "anything that is not a plain read must default to no retries");
});

test("a scanner is told it is slow before it is told it failed", async () => {
  const js = await scannerBundle();
  const slowNotices = js.match(/onSlow:/g) || [];
  assert.ok(slowNotices.length >= 4,
    `every request a scanner waits on should say something while it waits (found ${slowNotices.length})`);
});

test("the browser's own words never reach the scanner", async () => {
  // "Failed to fetch" was being rendered straight onto the page.
  const js = await scannerBundle();
  assert.match(js, /offlineMessage\(/, "network failures must be translated before display");
  assert.doesNotMatch(js, /"Network error\. Please try again\."/,
    "replaced by a message that distinguishes slow from disconnected");
});

test("a connection failure is not reported as a missing tag", async () => {
  // The page had one error card for two unrelated failures. Telling someone
  // whose signal dropped that the tag was not found sends them off inspecting a
  // sticker with nothing wrong with it.
  const page = await app.inject({ method: "GET", url: "/vehicle/abcdef123456" });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /id="error-title"/, "the title has to be changeable to say which failure it was");
  assert.match(page.body, /id="error-retry"/, "and a failed read is safe to offer again");

  const js = await scannerBundle();
  assert.match(js, /setText\("error-title", unreachable \? "No connection" : "Tag not found"\)/,
    "the two cases must not share one heading");
});

test("the retry offered on the error card is a read, not a write", async () => {
  // Offering to repeat anything with side effects would be the same duplicate
  // hazard by another route. It re-runs the tag lookup and nothing else.
  const js = await scannerBundle();
  assert.match(js, /retry\.onclick = \(\) => \{[\s\S]{0,200}loadScannerView\(\);/,
    "the button must re-run the lookup only");
});
