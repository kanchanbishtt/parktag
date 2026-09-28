import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { fetchWithTimeout } from "../lib/core/fetch-timeout.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("rejects with a timeout instead of waiting on a hung server", async () => {
  const server = await listen(() => {
    // never answers
  });
  try {
    const started = Date.now();
    await assert.rejects(
      fetchWithTimeout(`http://127.0.0.1:${server.address().port}/`, {}, 100),
      (error) => error.name === "TimeoutError"
    );
    assert.ok(Date.now() - started < 2000);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("a fast response passes through untouched", async () => {
  const server = await listen((req, res) => res.end("ok"));
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${server.address().port}/`, {}, 1000);
    assert.equal(await res.text(), "ok");
  } finally {
    server.close();
  }
});

test("the deadline also covers a body that stalls after the headers", async () => {
  const server = await listen((req, res) => {
    res.writeHead(200);
    res.write("partial");
  });
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${server.address().port}/`, {}, 150);
    await assert.rejects(res.text());
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("a caller-supplied signal still aborts the request", async () => {
  const server = await listen(() => {});
  try {
    const controller = new AbortController();
    const pending = fetchWithTimeout(
      `http://127.0.0.1:${server.address().port}/`,
      { signal: controller.signal },
      5000
    );
    controller.abort();
    await assert.rejects(pending, (error) => error.name === "AbortError");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("passes the options through and honours a stubbed global fetch", async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return new Response("stub");
  };
  const res = await fetchWithTimeout("https://example.invalid/x", { method: "POST", headers: { a: "b" } }, 1000);
  assert.equal(await res.text(), "stub");
  assert.equal(seen.url, "https://example.invalid/x");
  assert.equal(seen.options.method, "POST");
  assert.deepEqual(seen.options.headers, { a: "b" });
  assert.ok(seen.options.signal instanceof AbortSignal);
});
