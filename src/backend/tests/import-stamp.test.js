// M13: stamping the import specifiers inside a script with the asset version.
// The rewrite has to be exact: a module reached both with and without ?v= would
// load twice in the browser, so these pin down what is stamped, what is left
// alone, and that stamping twice changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stampScriptImports } from "../lib/core/import-stamp.js";
import { isQuietUrl, isPublicStaticPath, pathnameOf } from "../lib/core/request-policy.js";
import { AccessLogController } from "../app.js";

const V = "0123456789ab";
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsRoot = path.resolve(here, "../../frontend/scripts");

test("relative, parent-relative and /scripts/ specifiers gain the version", () => {
  const source = [
    'import { a } from "./a.js";',
    "import { b } from '../b.js';",
    'import c from "/scripts/vendor/c.js";',
    'export * from "./d.js";',
    'export { e } from "./e.js";',
    'import "./side-effect.js";',
    'const m = await import("/scripts/vendor/number-flow.js");',
    'const n = import( "./lazy.js" );',
    'import{BROWSER as _}from"./esm-env.js";'
  ].join("\n");

  const out = stampScriptImports(source, V);
  for (const spec of [
    "./a.js", "../b.js", "/scripts/vendor/c.js", "./d.js", "./e.js",
    "./side-effect.js", "/scripts/vendor/number-flow.js", "./lazy.js", "./esm-env.js"
  ]) {
    assert.ok(out.includes(`${spec}?v=${V}`), `${spec} was not stamped`);
  }
  assert.equal((out.match(/\?v=/g) || []).length, 9);
});

test("external URLs, bare specifiers and non-js files are left alone", () => {
  const source = [
    'import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js");',
    'import x from "some-package";',
    'import styles from "./data.json";',
    'fetch("/scripts/data.js");',
    'const s = "./not-an-import.js";'
  ].join("\n");
  assert.equal(stampScriptImports(source, V), source);
});

test("a specifier that already carries a query is not stamped again", () => {
  const source = 'import { a } from "./a.js?v=other";\nimport("/scripts/b.js?x=1");';
  assert.equal(stampScriptImports(source, V), source);
});

test("stamping is idempotent: no double stamping", () => {
  const source = 'import { a } from "./a.js";\nimport("/scripts/vendor/b.js");';
  const once = stampScriptImports(source, V);
  assert.equal(stampScriptImports(once, V), once);
  assert.ok(!/\?v=[^"']*\?v=/.test(once));
});

test("the version token is substituted, and no version means no change", () => {
  assert.equal(stampScriptImports('load("/x.js?v=__ASSET_VERSION__")', V), `load("/x.js?v=${V}")`);
  const source = 'import { a } from "./a.js";';
  assert.equal(stampScriptImports(source, ""), source);
});

async function listScripts(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listScripts(full)));
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

test("across the real frontend: every internal import is stamped and resolves to a file", async () => {
  const importRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])((?:\.{1,2}\/|\/scripts\/)[^"'?#\r\n]*\.js(?:\?[^"']*)?)\1/g;
  let checked = 0;

  for (const file of await listScripts(scriptsRoot)) {
    const out = stampScriptImports(await fs.readFile(file, "utf8"), V);
    for (const [, , spec] of out.matchAll(importRe)) {
      assert.ok(spec.endsWith(`?v=${V}`), `${path.relative(scriptsRoot, file)}: ${spec} is not stamped exactly once`);
      const bare = spec.split("?")[0];
      const target = bare.startsWith("/scripts/")
        ? path.join(scriptsRoot, bare.slice("/scripts/".length))
        : path.resolve(path.dirname(file), bare);
      await fs.access(target);
      checked += 1;
    }
  }
  assert.ok(checked >= 10, `only ${checked} imports found, is the frontend where the test expects?`);
});

// ── request-policy ───────────────────────────────────────────────────────────

test("quiet urls: assets and the health check, not the API", () => {
  for (const url of ["/images/a.webp", "/styles/x.css?v=1", "/scripts/get.js", "/fonts/f.woff2", "/api/health"]) {
    assert.equal(isQuietUrl(url), true, url);
  }
  for (const url of ["/api/owner/dashboard", "/api/healthcheck", "/get", "/imagesx/a", "/"]) {
    assert.equal(isQuietUrl(url), false, url);
  }
  assert.equal(pathnameOf("/a/b?x=1#y"), "/a/b");
});

test("the static root never serves pages/", () => {
  for (const denied of [
    "/pages/admin/overview.html", "/pages", "/PAGES/x.html", "/%70ages/x.html",
    "/pages/../pages/x.html", "/scripts/../pages/x.html", "/pages//x.html", "/x/../pages/y.html", "/%zz"
  ]) {
    assert.equal(isPublicStaticPath(denied), false, denied);
  }
  for (const allowed of ["/styles/styles.css", "/scripts/get.js", "/images/pages.webp", "/fonts/a.woff2", "/pt/pages/x"]) {
    assert.equal(isPublicStaticPath(allowed), true, allowed);
  }
});

test("access log: assets and health are quiet, API and failures are not", () => {
  const lines = [];
  const request = (url) => ({ url, log: { info: (_o, msg) => lines.push(msg), error: (_o, msg) => lines.push(msg) } });
  const reply = (statusCode) => ({ statusCode, elapsedTime: 1, log: { info: (_o, msg) => lines.push(msg), error: (_o, msg) => lines.push(msg) } });
  const controller = new AccessLogController();

  controller.incomingRequest(request("/styles/x.css"), reply(200));
  controller.requestCompleted(null, request("/styles/x.css"), reply(200));
  controller.incomingRequest(request("/api/health"), reply(200));
  assert.deepEqual(lines, []);

  controller.incomingRequest(request("/api/owner/dashboard"), reply(200));
  controller.requestCompleted(null, request("/api/owner/dashboard"), reply(200));
  assert.deepEqual(lines, ["incoming request", "request completed"]);

  lines.length = 0;
  controller.requestCompleted(null, request("/scripts/missing.js"), reply(404));
  controller.requestCompleted(new Error("boom"), request("/api/health"), reply(500));
  assert.equal(lines.length, 2, "a failing asset or health request is still logged");
});
