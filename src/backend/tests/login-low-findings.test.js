// Tests for the LOW findings from the login-page QA pass.
//
//   #7  ?error= put attacker-supplied text on the real sign-in page
//   #8  script-src / script-src-attr allowed 'unsafe-inline' everywhere
//   #9  no CSRF defence beyond SameSite on the credential endpoints
//   #10 the session cookie's Secure flag came from a config flag alone
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  clearLoginLock,
  uniqueAddress
} from "./helpers.js";

const PASSWORD = "QA-low-findings-password-7b2e";
const OWNER_EMAIL = "qa-low-findings@parktag-test.invalid";

let app;
let collections;

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await createTestOwner(collections, { email: OWNER_EMAIL, password: PASSWORD });
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

function get(url, headers = {}) {
  return app.inject({ method: "GET", url, headers, remoteAddress: uniqueAddress() });
}

describe("finding #7 — the login page renders only its own messages", () => {
  test("the served script does not echo the error parameter", async () => {
    // The reflection happens in the browser, so the regression is asserted
    // against the script that is actually served: it must not interpolate the
    // raw ?error= value into the message it displays.
    const response = await get("/scripts/owner/login.js");
    assert.equal(response.statusCode, 200, "login.js is not being served");

    assert.ok(
      !/\$\{urlError\}/.test(response.body),
      "login.js interpolates the raw ?error= value into the page — anyone can " +
        "put their own text on the genuine sign-in page"
    );
    assert.match(
      response.body,
      /messages\[urlError\]\s*\|\|/,
      "the known-message lookup is gone; unknown error keys may be rendered raw"
    );
  });
});

describe("finding #8 — the credential pages refuse inline script", () => {
  const strictPages = [
    "/owner-login",
    "/owner-verify",
    "/register-owner",
    "/forgot-password",
    "/reset-password"
  ];

  for (const page of strictPages) {
    test(`${page} allows no inline script`, async () => {
      const response = await get(page);
      const csp = response.headers["content-security-policy"] || "";

      const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
      assert.ok(scriptSrc, `${page} sends no script-src at all: ${csp}`);
      assert.ok(
        !scriptSrc.includes("'unsafe-inline'"),
        `${page} still allows inline script: ${scriptSrc}`
      );
      assert.match(
        csp,
        /script-src-attr 'none'/,
        `${page} still permits inline event handler attributes`
      );
    });

    test(`${page} has no inline <script> to be broken by that`, async () => {
      // The header above is only safe to send while the markup genuinely has no
      // inline script. If someone adds one back, the page silently stops
      // working in the browser — so assert the two stay in step.
      const response = await get(page);
      assert.ok(
        !/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/i.test(response.body),
        `${page} contains an inline <script>, which its own CSP now blocks`
      );
    });
  }

  test("pages that need inline handlers keep the permissive policy", async () => {
    // /owner-welcome and /admin build markup containing onclick="...". Tighten
    // them and the pages break, so the strict list must not quietly grow to
    // cover everything that is merely uncacheable.
    for (const page of ["/owner-welcome", "/admin"]) {
      const response = await get(page);
      const csp = response.headers["content-security-policy"] || "";
      assert.ok(
        csp.includes("'unsafe-inline'"),
        `${page} was given the strict policy, but it generates inline handlers`
      );
    }
  });

  test("tightening keeps the rest of the policy intact", async () => {
    // The strict header is derived from the app-wide one. If that derivation
    // drops directives, these pages quietly lose protections the others keep.
    const strict = (await get("/owner-login")).headers["content-security-policy"] || "";

    for (const directive of ["default-src", "object-src", "base-uri", "form-action", "frame-ancestors"]) {
      assert.ok(
        strict.includes(directive),
        `${directive} was lost while tightening the script directives: ${strict}`
      );
    }
  });
});

describe("finding #9 — credential endpoints reject cross-site posts", () => {
  function login(headers) {
    return app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: uniqueAddress(),
      headers,
      payload: { email: OWNER_EMAIL, password: PASSWORD }
    });
  }

  test("a post from another origin is refused", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await login({ origin: "https://evil.example.com" });

    assert.equal(
      response.statusCode,
      403,
      "a cross-origin sign-in was accepted — a victim can be signed in as the attacker"
    );
    assert.equal(
      response.headers["set-cookie"],
      undefined,
      "a rejected cross-origin post still issued a session cookie"
    );
  });

  test("a cross-site Referer is refused when Origin is absent", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await login({ referer: "https://evil.example.com/attack.html" });

    assert.equal(response.statusCode, 403);
  });

  test("the site's own origin is accepted", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await login({
      origin: "http://localhost:80",
      host: "localhost:80"
    });

    assert.notEqual(
      response.statusCode,
      403,
      "the app rejected a sign-in from its own page"
    );
    assert.equal(response.statusCode, 200, `sign-in failed: ${response.body}`);
  });

  test("a non-browser caller with no Origin or Referer still works", async () => {
    // curl, the verify scripts, server-to-server. These are not requests an
    // attacker can make a victim's browser send, and blocking them would break
    // the operational scripts while stopping nothing.
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await login({});

    assert.equal(response.statusCode, 200, `sign-in failed: ${response.body}`);
  });

  test("a malformed Origin is refused rather than parsed loosely", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await login({ origin: "not a url" });

    assert.equal(response.statusCode, 403);
  });

  test("the provider webhooks are not caught by the check", async () => {
    // Exotel and Meta post from their own origins by design. A blanket origin
    // check would reject every callback, silently breaking masked calling.
    const response = await app.inject({
      method: "POST",
      url: "/api/provider/exotel/webhook",
      remoteAddress: uniqueAddress(),
      headers: { origin: "https://exotel.example.com" },
      payload: {}
    });

    assert.notEqual(
      response.statusCode,
      403,
      "the CSRF origin check is rejecting provider webhooks"
    );
  });
});

describe("finding #10 — Secure is set from the connection, not just a flag", () => {
  test("a session issued over HTTPS is marked Secure", async () => {
    // RUNTIME_MODE is not production here, which is exactly the case that used
    // to drop the flag on a live deployment configured slightly wrong.
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: uniqueAddress(),
      headers: { "x-forwarded-proto": "https" },
      payload: { email: OWNER_EMAIL, password: PASSWORD }
    });

    assert.equal(response.statusCode, 200, `sign-in failed: ${response.body}`);
    const cookie = response.cookies.find((c) => c.name === "wavetag_session");
    assert.ok(cookie, "no session cookie was issued");
    assert.equal(
      cookie.secure,
      true,
      "a cookie issued over HTTPS is not marked Secure — it will travel over " +
        "plain HTTP if anything can force a downgrade"
    );
  });

  test("plain HTTP development still gets a usable cookie", async () => {
    await clearLoginLock(collections, OWNER_EMAIL);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: uniqueAddress(),
      payload: { email: OWNER_EMAIL, password: PASSWORD }
    });

    assert.equal(response.statusCode, 200);
    const cookie = response.cookies.find((c) => c.name === "wavetag_session");
    assert.ok(cookie, "no session cookie was issued");
    assert.ok(!cookie.secure, "a Secure cookie over plain HTTP would never be sent back");
  });
});
