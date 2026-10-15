// The /verify page's "Seed demo data" button reaches the seed route.
//
// POST /api/demo/seed refuses any request without the server's DEMO_SEED_SECRET
// (routes/system/demo.js), but the page posted an empty body, so the button
// could only ever answer "Forbidden". The admin page's own seed code was bound
// to a button that page does not have, and its sign-in hint pointed at it.
//
// The real verify.js runs here in jsdom against the real verify.html, with
// fetch answered locally.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

const read = (path) => readFile(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
const html = await read("pages/scanner/verify.html");
const verifyJs = await read("scripts/scanner/verify.js");
const adminJs = await read("scripts/admin/index.js");

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const windows = [];
after(() => windows.forEach((w) => w.close()));

async function openVerifyPage() {
  const virtualConsole = new VirtualConsole();
  const pageErrors = [];
  virtualConsole.on("jsdomError", (error) => pageErrors.push(error.message));
  // The page's own <script> tags are not run: the inline view switch is not
  // under test, and verify.js is loaded below.
  const dom = new JSDOM(html, { url: "http://127.0.0.1:3000/verify", runScripts: "outside-only", virtualConsole });
  const w = dom.window;
  windows.push(w);
  w.posts = [];
  w.fetch = async (url, options = {}) => {
    if (options.method === "POST") w.posts.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  // verify.js is a module with top-level await; jsdom runs classic scripts,
  // so it is wrapped in an async function, which keeps its names local too.
  await w.eval(`(async () => { ${verifyJs} })()`);
  await tick();
  return { w, pageErrors };
}

test("the seed button sends the secret the server requires", async () => {
  const { w, pageErrors } = await openVerifyPage();

  w.document.getElementById("seed-secret").value = "dev-seed-secret";
  w.document.getElementById("seed-button").click();
  await tick();

  assert.deepEqual(pageErrors, []);
  assert.equal(w.posts.length, 1);
  assert.equal(w.posts[0].url, "/api/demo/seed");
  assert.deepEqual(w.posts[0].body, { secret: "dev-seed-secret" });
});

test("with no secret entered, the button asks for it instead of posting", async () => {
  const { w, pageErrors } = await openVerifyPage();

  w.document.getElementById("seed-secret").value = "   ";
  w.document.getElementById("seed-button").click();
  await tick();

  assert.deepEqual(pageErrors, []);
  assert.equal(w.posts.length, 0, "a request without the secret can only be refused");
  assert.match(w.document.getElementById("seed-output").textContent, /DEMO_SEED_SECRET/);
});

test("the admin page no longer points at a seed button it does not have", () => {
  assert.doesNotMatch(adminJs, /admin-seed-button|seedAdminDemo|Seed demo setup/);
  assert.doesNotMatch(adminJs, /admin-ready-card|setReadyState/);
  assert.match(adminJs, /seed demo data on \/verify first/);
});
