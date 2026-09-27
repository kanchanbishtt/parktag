// Response compression negotiated from Accept-Encoding.
//
// The server prefers zstd, then brotli, then gzip, and must fall back to a
// plain body for any client that did not ask for an encoding. The fallback is
// the part that matters most: a mobile HTTP client or older browser that is
// sent an encoding it cannot decode sees garbage, not a slow page.
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { startTestApp, stopTestApp } from "./helpers.js";

let app;

test.before(async () => {
  ({ app } = await startTestApp());
});

test.after(async () => {
  await stopTestApp(app);
});

const STYLESHEET = "/styles/styles.css";

function get(url, acceptEncoding) {
  const headers = acceptEncoding === undefined ? {} : { "accept-encoding": acceptEncoding };
  return app.inject({ method: "GET", url, headers });
}

test("a client that sends no Accept-Encoding gets a plain body", async () => {
  const r = await get(STYLESHEET);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-encoding"], undefined);
});

test("identity is honoured as a request for no compression", async () => {
  const r = await get(STYLESHEET, "identity");
  assert.equal(r.headers["content-encoding"], undefined);
});

test("gzip-only clients get gzip, and the body round-trips", async () => {
  const plain = await get(STYLESHEET);
  const r = await get(STYLESHEET, "gzip");
  assert.equal(r.headers["content-encoding"], "gzip");
  assert.ok(r.rawPayload.length < plain.rawPayload.length);
  assert.equal(zlib.gunzipSync(r.rawPayload).toString(), plain.body);
});

test("brotli is preferred over gzip", async () => {
  const plain = await get(STYLESHEET);
  const r = await get(STYLESHEET, "gzip, br");
  assert.equal(r.headers["content-encoding"], "br");
  assert.equal(zlib.brotliDecompressSync(r.rawPayload).toString(), plain.body);
});

test("zstd is preferred when the client and runtime both support it", { skip: !zlib.zstdDecompressSync }, async () => {
  const plain = await get(STYLESHEET);
  const r = await get(STYLESHEET, "gzip, deflate, br, zstd");
  assert.equal(r.headers["content-encoding"], "zstd");
  assert.equal(zlib.zstdDecompressSync(r.rawPayload).toString(), plain.body);
});

test("compressed responses tell caches they vary by Accept-Encoding", async () => {
  const r = await get(STYLESHEET, "br");
  assert.match(String(r.headers.vary), /accept-encoding/i);
});

test("pages are stamped with the asset version before being compressed", async () => {
  const r = await get("/track-order", "br");
  assert.equal(r.headers["content-encoding"], "br");
  const html = zlib.brotliDecompressSync(r.rawPayload).toString();
  assert.doesNotMatch(html, /__ASSET_VERSION__/);
});
