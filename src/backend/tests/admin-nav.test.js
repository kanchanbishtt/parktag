// Every admin page carries its own copy of the sidebar, so a page added without a link in the others is
// reachable only by typing its URL (Promo Codes and Reviews were exactly that). This reads the page files and
// needs no database.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/pages/admin");
// index.html is the sign-in page and sticker-print.html is a print sheet: neither has the sidebar.
const NO_SIDEBAR = new Set(["index.html", "sticker-print.html"]);
const pages = fs.readdirSync(dir).filter((f) => f.endsWith(".html") && !NO_SIDEBAR.has(f));
const routes = pages.map((f) => `/admin/${f.replace(/\.html$/, "")}`);

const navLinks = (html) =>
  [...html.matchAll(/<a class="pt-admin-nav-item( is-active)?" href="([^"]+)"/g)].map((m) => ({ href: m[2], active: Boolean(m[1]) }));

test("every admin page links to every other admin page in its sidebar", () => {
  assert.ok(routes.includes("/admin/promo-codes") && routes.includes("/admin/api-tokens"), "expected pages are present");
  for (const f of pages) {
    const hrefs = navLinks(fs.readFileSync(path.join(dir, f), "utf8")).map((l) => l.href);
    for (const route of routes) assert.ok(hrefs.includes(route), `${f} has no sidebar link to ${route}`);
  }
});

test("each admin page marks only itself as the active sidebar item", () => {
  for (const f of pages) {
    const active = navLinks(fs.readFileSync(path.join(dir, f), "utf8")).filter((l) => l.active).map((l) => l.href);
    assert.deepEqual(active, [`/admin/${f.replace(/\.html$/, "")}`], f);
  }
});
