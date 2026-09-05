// The bot check on /get.
//
// Guest checkout takes no sign-in and no OTP — that is the point of it — so
// before this the per-IP rate limit was the ONLY thing between a script and an
// unbounded supply of real Razorpay orders. A limit keyed on IP is worth
// exactly what the attacker's willingness to rotate one is worth, which is the
// same reasoning that already put reCAPTCHA on /api/auth/send-otp.
//
// What it protects is not mainly our order table. Every order minted here is a
// live checkout session in the Razorpay dashboard, and a supply of those is
// what card testing needs — stolen numbers validated against a real merchant,
// which costs that merchant in failed-payment ratios long before it costs
// anybody a parcel.
//
// These tests do NOT reach Google. verifyRecaptcha is a pure function of its
// env and token for the two cases that matter: unconfigured (feature off), and
// production with no token (reject). Both are asserted directly, because the
// third case — a real score — cannot be produced without a browser and a
// domain-registered key, and a test that pretended otherwise would be testing
// its own stub.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { verifyRecaptcha, isRecaptchaConfigured } from "../lib/integrations/recaptcha.js";

const CONFIGURED_PROD = {
  runtimeMode: "production",
  recaptchaSiteKey: "site-key",
  recaptchaSecret: "secret"
};

const UNCONFIGURED = { runtimeMode: "production", recaptchaSiteKey: "", recaptchaSecret: "" };

describe("the guest checkout bot gate", () => {
  // The feature is opt-in. A deploy that has never set the keys must keep
  // selling, or turning the check on becomes a deploy-ordering problem.
  test("unconfigured keys let the checkout through", async () => {
    assert.equal(isRecaptchaConfigured(UNCONFIGURED), false);
    const result = await verifyRecaptcha(UNCONFIGURED, "", { expectedAction: "guest_checkout" });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
  });

  // The case that matters: keys ARE set, and a caller supplies no token. That
  // is what a script hitting the JSON endpoint directly looks like — it never
  // ran the page, so it never got a token to send.
  test("in production a missing token is refused", async () => {
    const result = await verifyRecaptcha(CONFIGURED_PROD, undefined, {
      expectedAction: "guest_checkout"
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing-token");
  });

  test("a non-string token is refused rather than coerced", async () => {
    // Bodies arrive as JSON, so this can be an object, an array or a number.
    for (const token of [{}, [], 42, true, null]) {
      const result = await verifyRecaptcha(CONFIGURED_PROD, token, {
        expectedAction: "guest_checkout"
      });
      assert.equal(result.ok, false, `accepted ${JSON.stringify(token)}`);
    }
  });

  // Outside production a missing token passes, because a v3 site key is
  // registered per-domain and Google will not mint one for localhost. Without
  // this the whole checkout becomes untestable on a .env copied from
  // production — and the per-IP limit still applies either way.
  test("outside production a missing token passes, so /get stays testable", async () => {
    const result = await verifyRecaptcha(
      { ...CONFIGURED_PROD, runtimeMode: "development" },
      "",
      { expectedAction: "guest_checkout" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.reason, "missing-token-dev");
  });

  // It must never throw. This runs before an order is created, on a public
  // endpoint; an exception here would be a 500 on the storefront rather than a
  // refused bot.
  test("it never throws, whatever it is handed", async () => {
    for (const env of [UNCONFIGURED, CONFIGURED_PROD, {}, null]) {
      for (const token of ["", "x", null, {}]) {
        await assert.doesNotReject(() => verifyRecaptcha(env || {}, token, {}));
      }
    }
  });
});
