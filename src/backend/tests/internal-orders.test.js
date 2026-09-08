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

import { isInternalPhone, internalPhoneList } from "../lib/core/internal-orders.js";

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
