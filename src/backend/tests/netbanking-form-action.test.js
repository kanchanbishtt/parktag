// Razorpay netbanking showed a blank page where the bank's login should be.
//
// Cards, UPI and wallets complete inside Razorpay's iframe. Netbanking hands
// the window to the bank by posting a form through api.razorpay.com, and the
// page's Content Security Policy had `form-action 'self' facebook.com`, which
// refuses exactly that navigation. The policy has to let the checkout pages
// post to Razorpay, and must keep refusing everything else.
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp } from "./helpers.js";

let app;
before(async () => { ({ app } = await startTestApp()); });
after(async () => { await stopTestApp(app); });

const formAction = async (url) => {
  const csp = (await app.inject({ method: "GET", url })).headers["content-security-policy"] || "";
  const directive = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("form-action "));
  assert.ok(directive, `no form-action on ${url}: ${csp}`);
  return directive.slice("form-action ".length).split(/\s+/);
};

describe("netbanking can leave for the bank", () => {
  for (const page of ["/get", "/shop", "/direct"]) {
    test(`${page} may post a form to Razorpay`, async () => {
      const allowed = await formAction(page);
      assert.ok(allowed.includes("https://api.razorpay.com"), `api.razorpay.com missing from ${allowed}`);
      assert.ok(allowed.includes("https://*.razorpay.com"), `*.razorpay.com missing from ${allowed}`);
    });
  }

  test("and to nothing else new", async () => {
    const allowed = await formAction("/get");
    assert.deepEqual(allowed.sort(), ["'self'", "https://*.razorpay.com", "https://api.razorpay.com", "https://www.facebook.com"]);
  });
});
