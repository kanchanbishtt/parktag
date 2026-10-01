// Keeping our own testing out of our own revenue.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// Six orders sat in the shop ledger totalling Rs 2,443. Exactly one was a
// customer. The other five were Girish and Kanchan placing COD orders to their
// own Noida address to test the checkout, and COD takes no money up front, so
// the ledger reported Rs 2,144 that does not exist and never will. Three of
// them booked real Delhivery waybills too.
//
// Nobody did anything wrong. A test order through production is genuinely
// indistinguishable from a customer order, which is exactly why noticing has to
// be the system's job rather than somebody's memory. The five were only caught
// because Girish remembered there had been four customers.
//
// ── Why a phone list, and not discipline ───────────────────────────────────
//
// The alternative is a rule that test orders get flagged afterwards, and that
// rule is the thing that already failed. A short list of our own numbers costs
// nothing to maintain and needs nobody to remember anything at the moment of
// testing, which is precisely the moment nobody is thinking about bookkeeping.
//
// ── What it does NOT do ────────────────────────────────────────────────────
//
// It marks, it never blocks. A flagged order still books a courier, still mints
// a tag, still behaves exactly like a real one, because the whole point of
// testing through production is that the test is real. Only the counting
// changes.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  isInternalPhone,
  internalPhoneList,
  isInternalIp,
  markInternalDevice,
  INTERNAL_DEVICE_COOKIE
} from "../lib/core/internal-orders.js";

const ENV = { internalTestPhones: "9876500854, 9876500645" };

describe("recognising our own numbers", () => {
  test("a listed number is internal", () => {
    assert.equal(isInternalPhone(ENV, "9876500854"), true);
    assert.equal(isInternalPhone(ENV, "9876500645"), true);
  });

  test("a customer's number is not", () => {
    assert.equal(isInternalPhone(ENV, "9812345678"), false);
  });

  // Stored formats differ by signup path, the same trap resolveReferral's
  // self-referral check documents. Comparing raw strings would let a test order
  // placed from a "+91" form land straight back in the revenue figure.
  test("the same number in any format is still ours", () => {
    for (const written of ["+919876500854", "919876500854", "0 98765 00854", "98765-00854"]) {
      assert.equal(isInternalPhone(ENV, written), true, `${written} should be recognised`);
    }
  });

  // Fails OPEN, deliberately. An unset list means every order counts, which
  // over-reports our own testing. Guessing which numbers are internal would
  // under-report real revenue, and a customer's sale silently vanishing from
  // the books is far worse than a test order appearing in them.
  test("no list configured means nothing is internal", () => {
    for (const env of [{}, { internalTestPhones: "" }, { internalTestPhones: "   " }]) {
      assert.equal(isInternalPhone(env, "9876500854"), false);
    }
  });

  test("a missing phone is not internal", () => {
    for (const missing of [null, undefined, "", "abc"]) {
      assert.equal(isInternalPhone(ENV, missing), false);
    }
  });

  test("the list tolerates the spacing a human types", () => {
    const parsed = internalPhoneList({ internalTestPhones: " 9876500854 ,, 9876500645 , " });
    assert.equal(parsed.length, 2);
  });

  // A list of our own mobile numbers is not something to hardcode into a public
  // repository, and it changes when somebody joins or leaves.
  test("it reads from configuration, not a constant", () => {
    assert.equal(isInternalPhone({ internalTestPhones: "9999900000" }, "9999900000"), true);
    assert.equal(isInternalPhone({ internalTestPhones: "9999900000" }, "9876500854"), false);
  });
});

// The ledger half is above. The same morning of testing also wrote two
// purchases into GA4 and the Pixel and a 135-click session into Clarity, which
// the phone list could do nothing about: those are fed by the browser.
describe("recognising our own network", () => {
  const NET = { internalIps: "203.0.113.7, 198.51.100.9" };

  test("a listed address is internal, a neighbour is not", () => {
    assert.equal(isInternalIp(NET, "203.0.113.7"), true);
    assert.equal(isInternalIp(NET, "198.51.100.9"), true);
    assert.equal(isInternalIp(NET, "203.0.113.8"), false);
    assert.equal(isInternalIp(NET, "203.0.113.70"), false, "an exact match, not a prefix");
  });

  test("the IPv4-mapped form a dual-stack socket reports is the same address", () => {
    assert.equal(isInternalIp(NET, "::ffff:203.0.113.7"), true);
  });

  // Fails open for the same reason the phone list does: measuring our own
  // clicks is an annoyance, silently not measuring customers is an outage.
  test("no list, or no address, means the visit is measured", () => {
    for (const env of [{}, { internalIps: "" }, { internalIps: " , " }, null]) {
      assert.equal(isInternalIp(env, "203.0.113.7"), false);
    }
    for (const missing of [null, undefined, ""]) {
      assert.equal(isInternalIp(NET, missing), false);
    }
  });
});

describe("remembering that a browser is ours", () => {
  function replyOn(hostname, protocol = "https") {
    const cookies = [];
    return { cookies, request: { hostname, protocol }, setCookie: (name, value, options) => cookies.push({ name, value, options }) };
  }

  test("an order to one of our numbers marks the device for a year, on both sites", () => {
    const reply = replyOn("app.parktag.me");
    markInternalDevice(reply, ENV, "+919876500854");

    assert.deepEqual(reply.cookies, [{
      name: INTERNAL_DEVICE_COOKIE,
      value: "1",
      options: { path: "/", maxAge: 31536000, sameSite: "lax", secure: true, domain: "parktag.me" }
    }]);
    // analytics.js has to read it, so it must not be httpOnly.
    assert.equal(reply.cookies[0].options.httpOnly, undefined);
  });

  test("a customer's order sets nothing", () => {
    const reply = replyOn("app.parktag.me");
    markInternalDevice(reply, ENV, "9812345678");
    assert.deepEqual(reply.cookies, []);
  });

  test("off the production domain the cookie stays host-only", () => {
    const reply = replyOn("localhost", "http");
    markInternalDevice(reply, ENV, "9876500854");
    assert.equal(reply.cookies[0].options.domain, undefined);
    assert.equal(reply.cookies[0].options.secure, false);

    const lookalike = replyOn("notparktag.me");
    markInternalDevice(lookalike, ENV, "9876500854");
    assert.equal(lookalike.cookies[0].options.domain, undefined);
  });
});
