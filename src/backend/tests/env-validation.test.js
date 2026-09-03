// What the app refuses to boot without, in production.
//
// This list had no test at all, which is a strange gap for the one piece of
// code whose entire job is to stop a misconfigured deploy from serving traffic.
// Every entry on it is there because its absence caused, or would cause, a
// specific production failure — an endpoint accepting forged traffic, or a paid
// order silently never fulfilled — and nothing was checking that the list still
// contained them.

import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";

import { getEnv } from "../lib/env.js";

// A production environment with everything present. Individual tests knock one
// value out and assert the boot fails because of it.
const COMPLETE = {
  APP_ENV: "production",
  MONGODB_URI: "mongodb://127.0.0.1:27017/irrelevant",
  RAZORPAY_KEY_ID: "rzp_test_placeholder",
  RAZORPAY_KEY_SECRET: "placeholder_key_secret",
  RAZORPAY_WEBHOOK_SECRET: "placeholder_webhook_secret",
  EXOTEL_WEBHOOK_SECRET: "placeholder_exotel_secret",
  META_APP_SECRET: "placeholder_meta_secret",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "placeholder_verify_token"
};

const saved = new Map();

function setEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe("what production refuses to boot without", () => {
  // The guard has to be shown to pass on a complete environment, or every
  // assertion below could be passing for the wrong reason.
  test("a complete production environment boots", () => {
    setEnv(COMPLETE);
    assert.doesNotThrow(() => getEnv());
  });

  // The one this suite was written for. Without it the Razorpay webhook refuses
  // every callback, and fulfilment falls back to depending on the buyer's
  // browser surviving one more request after their money has left. That was the
  // live state of production until 2026-09-02, and nothing complained.
  test("RAZORPAY_WEBHOOK_SECRET is required", () => {
    setEnv({ ...COMPLETE, RAZORPAY_WEBHOOK_SECRET: undefined });

    assert.throws(() => getEnv(), /RAZORPAY_WEBHOOK_SECRET/);
  });

  // Each of these has its own reason for being on the list; what is tested here
  // is only that it is still on it.
  for (const name of [
    "MONGODB_URI",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "EXOTEL_WEBHOOK_SECRET",
    "META_APP_SECRET",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN"
  ]) {
    test(`${name} is required`, () => {
      setEnv({ ...COMPLETE, [name]: undefined });

      assert.throws(() => getEnv(), new RegExp(name));
    });
  }

  test("an empty string counts as missing, not as configured", () => {
    setEnv({ ...COMPLETE, RAZORPAY_WEBHOOK_SECRET: "" });

    assert.throws(() => getEnv(), /RAZORPAY_WEBHOOK_SECRET/);
  });

  test("every missing variable is named at once, not one per restart", () => {
    setEnv({
      ...COMPLETE,
      RAZORPAY_WEBHOOK_SECRET: undefined,
      EXOTEL_WEBHOOK_SECRET: undefined
    });

    assert.throws(() => getEnv(), (error) => {
      assert.match(error.message, /RAZORPAY_WEBHOOK_SECRET/);
      assert.match(error.message, /EXOTEL_WEBHOOK_SECRET/);
      return true;
    });
  });

  // Outside production the same gaps are tolerated: a developer without a
  // Razorpay account still needs the app to start, and the webhook route says
  // so in the log rather than refusing to come up.
  test("development tolerates what production will not", () => {
    setEnv({ ...COMPLETE, APP_ENV: "dev", RAZORPAY_WEBHOOK_SECRET: undefined });

    assert.doesNotThrow(() => getEnv());
  });

  // APP_ENV unset is development. If this ever defaulted to production, every
  // local `node src/backend/server.js` would start failing on secrets nobody
  // running it has.
  test("an unset APP_ENV is development, not production", () => {
    setEnv({ ...COMPLETE, APP_ENV: undefined, RAZORPAY_WEBHOOK_SECRET: undefined });

    assert.doesNotThrow(() => getEnv());
  });
});

// Credentials arrive by paste, and a paste can bring whitespace with it.
//
// This is not hypothetical. On 2026-09-03 the live shop checkout had been
// failing for five weeks with "Failed to create order. Please try again."
// RAZORPAY_KEY_ID was stored in the hosting dashboard as
// "rzp_live_TIoxjX0y25I6Uf\n" — the id, plus the newline the paste picked up.
//
// Nothing caught it, and nothing could have: a value with a trailing newline is
// still a non-empty string, so `if (!env.foo)` passes, the required-in-production
// check passes, and the app boots reporting itself healthy. The damage lands one
// hop away, as a 401 from Razorpay, surfacing to the buyer as a generic retry
// message that says nothing about a credential. Proven by probing the live key
// against Razorpay: without the newline HTTP 200, with it HTTP 401.
describe("surrounding whitespace on a credential", () => {
  test("a trailing newline on the key id is stripped", () => {
    setEnv({ ...COMPLETE, RAZORPAY_KEY_ID: "rzp_live_TIoxjX0y25I6Uf\n" });

    assert.equal(getEnv().razorpayKeyId, "rzp_live_TIoxjX0y25I6Uf");
  });

  // The secret is the other half of the same Basic auth header, pasted the same
  // way, and fails identically. Fixing only the id would have left the checkout
  // just as broken.
  test("the key secret is stripped too", () => {
    setEnv({ ...COMPLETE, RAZORPAY_KEY_SECRET: "  a_secret\r\n" });

    assert.equal(getEnv().razorpayKeySecret, "a_secret");
  });

  // Not a Razorpay special case. The trim runs over the whole env object so the
  // next credential added is covered without anyone remembering to add it here.
  test("it is not specific to the payment keys", () => {
    setEnv({ ...COMPLETE, MONGODB_URI: " mongodb://127.0.0.1:27017/irrelevant\n" });

    assert.equal(getEnv().mongoUri, "mongodb://127.0.0.1:27017/irrelevant");
  });

  // The trim has to run BEFORE validateEnv, or a variable set to nothing but
  // spaces counts as configured and production boots on a credential that is
  // empty in every way that matters.
  test("a whitespace-only value is missing, not configured", () => {
    setEnv({ ...COMPLETE, RAZORPAY_KEY_SECRET: "   " });

    assert.throws(() => getEnv(), /RAZORPAY_KEY_SECRET/);
  });
});
