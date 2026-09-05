// What a phone number is, pinned against the two things that decide it: India's
// numbering plan, and what Meta's Cloud API does with what we hand it.
//
// This exists because three normalisers disagreed. The one in auth/otp.js
// decided account identity, the one in integrations/meta.js decided where a
// login code was delivered, and the one in integrations/exotel.js decided who
// got dialled — and all three read an eleven-digit 0XXXXXXXXXX, matched none of
// their cases, and returned it unchanged. Nothing failed loudly. The number was
// simply stored, looked up and sent in a form no provider could route.
//
// The cases below are the numbering plan itself rather than a list of inputs
// that happened to break: mobiles are ten digits beginning 6-9, the trunk 0 is
// a dialling instruction, 00 is the international prefix, and a + means the
// caller has already told us the country.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { toE164, toE164Digits, isIndianMobile10 } from "../lib/core/phone.js";

describe("an Indian mobile, however it was written", () => {
  // Every one of these is the SAME subscriber. That is the whole point: a
  // person who types the trunk zero and a person who does not must arrive at
  // one identity, or the one-number-one-account invariant is decided by
  // keyboard habit.
  const SAME = [
    "9812345678",
    "09812345678",
    "+919812345678",
    "919812345678",
    "00919812345678",
    "+91 98123 45678",
    "+91-98123-45678",
    "(0) 98123 45678",
    "  9812345678  ",
    "98123 45678",
    "+91 (98123) 45678"
  ];

  for (const written of SAME) {
    test(`${JSON.stringify(written)} -> +919812345678`, () => {
      assert.equal(toE164(written), "+919812345678");
    });
  }

  test("they all collapse to exactly one identity", () => {
    const distinct = new Set(SAME.map(toE164));
    assert.equal(distinct.size, 1, `got ${[...distinct].join(", ")}`);
  });
});

describe("the trunk zero is only stripped when it is a trunk zero", () => {
  // The 0 is a dialling instruction inside India. It is also a plausible first
  // digit of a foreign number written without its +, so it is removed only when
  // what remains is a real Indian mobile.
  test("0 + a valid mobile is the trunk prefix", () => {
    assert.equal(toE164("09876543210"), "+919876543210");
  });

  test("0 + something that is not a mobile is left alone, not guessed at", () => {
    // 0 followed by ten digits starting 1 is not an Indian mobile. Deleting the
    // zero would invent a number rather than read one.
    assert.equal(toE164("01234567890"), null);
  });

  test("a landline-shaped number is refused rather than mangled", () => {
    assert.equal(toE164("01123456789"), null);
  });

  // Trunk 0 followed by the COUNTRY code is not a dialling form anywhere: in
  // India 0 precedes the ten-digit national number, and the international
  // prefix is 00. Read as E.164 it is malformed too, since no country calling
  // code begins with 0. Two readings, both wrong, and choosing between them
  // would be the same guess that produced the bug this module exists to fix.
  test("0 followed by the country code is refused, not guessed at", () => {
    assert.equal(toE164("0919812345678"), null);
  });
});

describe("the mobile range is respected", () => {
  for (const first of ["6", "7", "8", "9"]) {
    test(`${first}XXXXXXXXX is a mobile`, () => {
      assert.equal(toE164(`${first}812345678`), `+91${first}812345678`);
    });
  }
  for (const first of ["0", "1", "2", "3", "4", "5"]) {
    test(`${first}XXXXXXXXX is not a mobile and is refused`, () => {
      assert.equal(toE164(`${first}812345678`), null);
    });
  }
});

describe("numbers that are not Indian", () => {
  // A + means the caller has already said which country. Nothing is inferred,
  // and nothing is rewritten.
  test("a US number in E.164 survives untouched", () => {
    assert.equal(toE164("+14155551234"), "+14155551234");
  });

  test("a UK number in E.164 survives untouched", () => {
    assert.equal(toE164("+442071838750"), "+442071838750");
  });

  test("00 is the same instruction as +", () => {
    assert.equal(toE164("0014155551234"), "+14155551234");
  });

  test("formatting inside an international number is stripped, not the number", () => {
    assert.equal(toE164("+1 (415) 555-1234"), "+14155551234");
  });

  // The guard that stops India claiming a foreign number: twelve digits
  // beginning 91 is only Indian if the remaining ten are a mobile.
  test("a twelve-digit number starting 91 that is not an Indian mobile is refused", () => {
    assert.equal(toE164("911234567890"), null);
  });
});

describe("input that is not a phone number at all", () => {
  // These arrive straight off a JSON body, where a caller can send anything.
  const JUNK = [null, undefined, "", "   ", "abcdefghij", "@", "+", "++", "12345", "9".repeat(20), {}, [], 0, NaN];
  for (const value of JUNK) {
    test(`${JSON.stringify(value) ?? String(value)} -> null`, () => {
      assert.equal(toE164(value), null);
    });
  }

  test("an object does not throw", () => {
    assert.doesNotThrow(() => toE164({ toString: () => "9812345678" }));
  });

  test("a number primitive is read, not rejected for its type", () => {
    assert.equal(toE164(9812345678), "+919812345678");
  });
});

describe("the digits-only form", () => {
  // Kept for the rare consumer that wants no +. NOT what the WhatsApp sender
  // uses — see the note in phone.js about Meta prepending a country code to
  // anything lacking a +.
  test("drops the plus and nothing else", () => {
    assert.equal(toE164Digits("09812345678"), "919812345678");
  });

  test("null in, null out", () => {
    assert.equal(toE164Digits("nonsense"), null);
  });
});

describe("isIndianMobile10", () => {
  test("accepts the range", () => {
    assert.ok(isIndianMobile10("9812345678"));
    assert.ok(isIndianMobile10("6012345678"));
  });
  test("rejects outside it", () => {
    assert.ok(!isIndianMobile10("5812345678"));
    assert.ok(!isIndianMobile10("981234567"));
    assert.ok(!isIndianMobile10("98123456789"));
    assert.ok(!isIndianMobile10(""));
    assert.ok(!isIndianMobile10(null));
  });
});

describe("idempotence", () => {
  // Normalising a normalised number must not change it. Values round-trip
  // through storage and back into senders, so a function that drifts on the
  // second pass corrupts data slowly rather than all at once.
  const INPUTS = ["9812345678", "09812345678", "+919812345678", "+14155551234", "00919812345678"];
  for (const input of INPUTS) {
    test(`${JSON.stringify(input)} is stable`, () => {
      const once = toE164(input);
      assert.equal(toE164(once), once);
    });
  }
});
