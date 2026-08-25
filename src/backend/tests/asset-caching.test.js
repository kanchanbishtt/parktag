// Caching the static assets without ever serving a stale one.
//
// Assets went out with `maxAge: 0` and no ETag, so every visit re-downloaded
// every stylesheet, script and image in full. A long max-age is the obvious
// fix and is unsafe on its own: `/styles/styles.css` keeps its name across
// deploys, so a cached copy would go on being served after the file changed.
//
// The scheme that makes it safe puts a content digest in the URL and only
// grants immutability when the digest on the request is the one this process
// computed. Almost every test here is about that one rule, because it is the
// only thing standing between a year-long cache and a year-old stylesheet.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";

import { startTestApp, stopTestApp } from "./helpers.js";
import { cacheControlFor, computeAssetVersion } from "../lib/core/asset-version.js";

let app;

const VERSION = "abc123def456";

test.before(async () => {
  ({ app } = await startTestApp());
});

test.after(async () => {
  await stopTestApp(app);
});

// ── the rule that makes a year-long cache safe ──────────────────────────────

test("only the current stamp earns immutability", () => {
  const immutable = cacheControlFor({
    pathname: "/styles/styles.css",
    requestedVersion: VERSION,
    assetVersion: VERSION
  });
  assert.match(immutable, /immutable/);
  assert.match(immutable, /max-age=31536000/);
});

test("a stamp from a previous deploy is refused immutability", () => {
  // The case this exists for: a page cached before the last deploy asks for the
  // asset it was built against. Serving that URL as immutable would pin the
  // visitor to the old file for a year.
  const control = cacheControlFor({
    pathname: "/styles/styles.css",
    requestedVersion: "stale-stamp",
    assetVersion: VERSION
  });
  assert.doesNotMatch(control, /immutable/);
  assert.match(control, /must-revalidate/);
});

test("an unsubstituted token is refused immutability", () => {
  // A page read straight off disk by the static handler never goes through the
  // substitution, so it still carries the literal. That literal never changes,
  // so caching it for a year would be permanent.
  const control = cacheControlFor({
    pathname: "/scripts/owner/welcome.js",
    requestedVersion: "__ASSET_VERSION__",
    assetVersion: VERSION
  });
  assert.doesNotMatch(control, /immutable/);
  assert.match(control, /must-revalidate/);
});

test("an unversioned request revalidates", () => {
  for (const requestedVersion of [null, undefined, ""]) {
    const control = cacheControlFor({
      pathname: "/styles/styles.css",
      requestedVersion,
      assetVersion: VERSION
    });
    assert.match(control, /must-revalidate/, `v=${requestedVersion} must revalidate`);
  }
});

test("a missing asset version cannot make anything immutable", () => {
  // If the digest could not be computed, nothing may claim to be current --
  // otherwise two empty values would compare equal and match everything.
  const control = cacheControlFor({
    pathname: "/styles/styles.css",
    requestedVersion: "",
    assetVersion: ""
  });
  assert.doesNotMatch(control, /immutable/);
});

test("images get a bounded window, not a year", () => {
  const control = cacheControlFor({
    pathname: "/images/verify-vehicle.webp",
    requestedVersion: null,
    assetVersion: VERSION
  });
  assert.match(control, /max-age=86400/);
  assert.doesNotMatch(control, /immutable/);
});

// ── the digest itself ───────────────────────────────────────────────────────

async function scratchTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pt-assets-"));
  await mkdir(path.join(root, "styles"), { recursive: true });
  await mkdir(path.join(root, "scripts", "owner"), { recursive: true });
  await writeFile(path.join(root, "styles", "styles.css"), "body{color:red}");
  await writeFile(path.join(root, "scripts", "owner", "welcome.js"), "export const a = 1;");
  return root;
}

test("the same tree always hashes to the same stamp", async () => {
  // Instances behind a load balancer must agree, or one would refuse to treat
  // the other's URLs as current and immutability would silently never happen.
  const root = await scratchTree();
  try {
    assert.equal(await computeAssetVersion(root), await computeAssetVersion(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changing a byte changes the stamp", async () => {
  const root = await scratchTree();
  try {
    const before = await computeAssetVersion(root);
    await writeFile(path.join(root, "styles", "styles.css"), "body{color:blue}");
    assert.notEqual(await computeAssetVersion(root), before,
      "a deploy that changes CSS must change every versioned URL");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renaming a file changes the stamp even when the bytes do not", async () => {
  const root = await scratchTree();
  try {
    const before = await computeAssetVersion(root);
    await rename(
      path.join(root, "scripts", "owner", "welcome.js"),
      path.join(root, "scripts", "owner", "welcome2.js")
    );
    assert.notEqual(await computeAssetVersion(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("images are not part of the stamp", async () => {
  // Folding them in would mean a new banner invalidated every script and
  // stylesheet as well, for no reason -- nothing references an image by stamp.
  const root = await scratchTree();
  try {
    const before = await computeAssetVersion(root);
    await mkdir(path.join(root, "images"), { recursive: true });
    await writeFile(path.join(root, "images", "banner-1.webp"), "not really a webp");
    assert.equal(await computeAssetVersion(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── end to end, through the real app ────────────────────────────────────────

async function pageVersion() {
  // Read the stamp the running app is actually using, off a page it renders.
  const page = await app.inject({ method: "GET", url: "/hub" });
  const found = page.body.match(/\/styles\/styles\.css\?v=([a-f0-9]+)/);
  assert.ok(found, "the hub page must carry a stamped stylesheet URL");
  return found[1];
}

test("no page ships an unsubstituted token", async () => {
  // A literal reaching the browser is not fatal -- it just never gets cached --
  // but it means a page was added without the substitution reaching it.
  for (const url of ["/hub", "/track-order", "/report-tag", "/owner-login", "/verify"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200, `${url} should render`);
    assert.ok(
      !response.body.includes("__ASSET_VERSION__"),
      `${url} still carries a literal __ASSET_VERSION__`
    );
    assert.match(response.body, /\?v=[a-f0-9]{12}/, `${url} should stamp its assets`);
  }
});

test("a stamped asset comes back immutable, a stale one does not", async () => {
  const version = await pageVersion();

  const current = await app.inject({ method: "GET", url: `/styles/styles.css?v=${version}` });
  assert.equal(current.statusCode, 200);
  assert.match(current.headers["cache-control"], /immutable/);

  const stale = await app.inject({ method: "GET", url: "/styles/styles.css?v=parktag-ui-10" });
  assert.equal(stale.statusCode, 200);
  assert.doesNotMatch(stale.headers["cache-control"], /immutable/,
    "a stamp from an older deploy must never be treated as current");
});

test("an unchanged asset answers a conditional request with an empty 304", async () => {
  const first = await app.inject({ method: "GET", url: "/styles/styles.css" });
  assert.equal(first.statusCode, 200);
  const etag = first.headers.etag;
  assert.ok(etag, "the file must ship a validator or there is nothing to revalidate against");

  const second = await app.inject({
    method: "GET",
    url: "/styles/styles.css",
    headers: { "if-none-match": etag }
  });
  assert.equal(second.statusCode, 304);
  assert.equal(second.body, "", "a 304 must not carry the file again");
  assert.ok(first.body.length > 1000, "and the 200 it replaces is the whole file");
});

test("pages themselves stay uncacheable", async () => {
  // The page holds the stamps. If the page can be cached, it goes on handing
  // out the previous deploy's URLs -- and those are cached for a year.
  for (const url of ["/hub", "/track-order", "/report-tag"]) {
    const response = await app.inject({ method: "GET", url });
    assert.match(response.headers["cache-control"] || "", /no-cache|no-store/,
      `${url} must not be cacheable`);
  }
});

test("the signed-in pages keep no-store, not merely no-cache", async () => {
  // no-cache permits the back/forward store; no-store is what keeps the
  // previous occupant's dashboard off a borrowed phone. Adding page caching
  // rules must not have softened that.
  for (const url of ["/owner-login", "/admin"]) {
    const response = await app.inject({ method: "GET", url });
    assert.match(response.headers["cache-control"] || "", /no-store/,
      `${url} must still send no-store`);
  }
});

test("a JSON response is left alone", async () => {
  const response = await app.inject({ method: "GET", url: "/api/shop/pricing" });
  assert.match(response.headers["content-type"], /application\/json/);
  assert.doesNotMatch(response.headers["cache-control"] || "", /no-cache/,
    "the HTML rules must not have leaked onto the API");
});

test("rewriting the page did not corrupt its length", async () => {
  // The stamp is substituted in onSend, which shortens the body. Fastify
  // recomputes content-length after the hook; this asserts it actually did,
  // because a stale length truncates the page in the browser.
  for (const url of ["/hub", "/owner-login", "/report-tag"]) {
    const response = await app.inject({ method: "GET", url });
    const declared = Number(response.headers["content-length"]);
    assert.equal(declared, Buffer.byteLength(response.body),
      `${url} declares a content-length that does not match its body`);
  }
});
