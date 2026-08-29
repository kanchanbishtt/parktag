// Checkout audit, MEDIUM: the page that takes money had the app's weakest
// script policy.
//
// /owner-welcome ran on the app-wide CSP, which carries 'unsafe-inline' in
// script-src because several pages build their markup with inline scripts and
// onclick attributes. On the credential pages that was already fixed — they are
// served a tightened policy. Checkout was not, and it is the page where an
// injected <script> can read an address, swap a payment handler, or sit quietly
// on the confirmation screen.
//
// It could not simply join that list: its entire shop half was an inline
// <script> at the bottom of the file, and 'unsafe-inline' is what let it run at
// all. That block now lives in /scripts/owner/welcome-shop.js, byte for byte,
// so script-src can drop 'unsafe-inline' here.
//
// What is NOT fixed, and these tests pin down deliberately: script-src-attr
// still allows inline handlers, because ~50 controls on the page are wired with
// onclick. Converting them is a refactor of a live checkout, not a rider on a
// CSP change. The gap left is narrower — an injection has to land inside an
// attribute rather than anywhere in the document — but it is a real one.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-csp@parktag-test.invalid");

let app;
let collections;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  const owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  cookie = await createSession(app, {
    id: String(owner._id), role: "owner", email: owner.email, displayName: owner.displayName
  });
});

async function policyFor(url, { withCookie = true } = {}) {
  const response = await app.inject({
    method: "GET",
    url,
    remoteAddress: uniqueAddress(),
    ...(withCookie ? { cookies: { wavetag_session: cookie } } : {})
  });
  return { response, policy: String(response.headers["content-security-policy"] || "") };
}

// One directive out of the policy string, e.g. "script-src" → "'self' https://…".
function directive(policy, name) {
  const found = policy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return found === undefined ? null : found.slice(name.length).trim();
}

describe("the checkout page refuses inline script", () => {
  test("script-src no longer carries 'unsafe-inline'", async () => {
    const { response, policy } = await policyFor("/owner-welcome");

    assert.equal(response.statusCode, 200, "precondition: the page did not render");
    const scriptSrc = directive(policy, "script-src");
    assert.ok(scriptSrc, `no script-src at all in: ${policy}`);
    assert.ok(
      !scriptSrc.includes("'unsafe-inline'"),
      `an injected <script> would still run on the payment page: script-src ${scriptSrc}`
    );
  });

  test("Razorpay's checkout script is still allowed", async () => {
    // The whole point of a tightened list is that it is a list. Getting this
    // wrong does not weaken anything — it takes payments offline.
    const { policy } = await policyFor("/owner-welcome");

    assert.ok(
      directive(policy, "script-src").includes("https://checkout.razorpay.com"),
      "checkout.js is blocked — nobody can pay"
    );
  });

  test("the page's own scripts are still allowed", async () => {
    const { policy } = await policyFor("/owner-welcome");

    assert.ok(directive(policy, "script-src").includes("'self'"), "the page's own code is blocked");
  });
});

describe("what the checkout page still needs, and still has", () => {
  test("inline event handlers keep working", async () => {
    // ~50 controls are wired with onclick. script-src's 'unsafe-inline' does not
    // cover handler attributes — script-src-attr is a separate directive, and
    // tightening it here would take out the shop, the tabs and Buy Now.
    const { policy } = await policyFor("/owner-welcome");

    assert.equal(
      directive(policy, "script-src-attr"),
      "'unsafe-inline'",
      "the page's controls are dead"
    );
  });

  test("the inline <style> block keeps working", async () => {
    // The page opens with one. Stripping style-src would take the layout.
    const { policy } = await policyFor("/owner-welcome");

    assert.ok(
      directive(policy, "style-src").includes("'unsafe-inline'"),
      "the page would render unstyled"
    );
  });
});

describe("the tightening is scoped to this page", () => {
  test("a page that still needs inline script is untouched", async () => {
    // /owner-vehicle-detail is not on either list, so it must still be served
    // the permissive app-wide policy — otherwise this change quietly broke
    // pages it was never meant to reach.
    const { response, policy } = await policyFor("/owner-vehicle-detail");

    assert.equal(response.statusCode, 200);
    assert.ok(
      directive(policy, "script-src").includes("'unsafe-inline'"),
      "an unrelated page lost inline script"
    );
  });

  test("the credential pages keep the stricter policy, not this one", async () => {
    // They forbid handler attributes outright; checkout cannot yet.
    const { policy } = await policyFor("/owner-login", { withCookie: false });

    assert.equal(directive(policy, "script-src-attr"), "'none'");
    assert.ok(!directive(policy, "script-src").includes("'unsafe-inline'"));
  });
});

describe("the page keeps its scripts out of the markup", () => {
  // The policy above and the page have to stay in step: put an inline <script>
  // back into welcome.html and it is silently blocked in the browser, which
  // looks like a broken dashboard, not like a CSP problem. Cheaper to fail here.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const CHECKOUT_PAGE = path.join(here, "../../frontend/pages/owner/welcome.html");

  test("welcome.html has no inline <script> block", async () => {
    const page = await readFile(CHECKOUT_PAGE, "utf8");

    const inline = [...page.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/gi)];

    assert.equal(
      inline.length,
      0,
      `inline <script> is back in the checkout page and will be blocked: ${inline
        .map((m) => m[0])
        .join(", ")}`
    );
  });

  test("the extracted shop script is still loaded", async () => {
    const page = await readFile(CHECKOUT_PAGE, "utf8");

    assert.ok(
      page.includes("/scripts/owner/welcome-shop.js"),
      "the shop half of the page is not loaded at all"
    );
  });
});
