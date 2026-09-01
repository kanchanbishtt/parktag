// The optional things an owner tells us about themselves.
//
// Everything here is optional, and that decides the shape of the rules: a blank
// value is a valid answer meaning "cleared", never an error. Somebody who filled
// this in once has to be able to empty it again, and a form that refuses to
// accept "" is a form you cannot back out of.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  GENDERS,
  GENDER_LABELS,
  MIN_AGE_YEARS,
  MAX_AGE_YEARS,
  cleanGender,
  cleanDateOfBirth,
  ageFromDateOfBirth,
  shapeProfileDetails
} from "../lib/core/profile-details.js";

// A fixed clock. Age arithmetic that drifts with the day the suite runs is a
// test that passes until somebody's birthday.
const NOW = Date.UTC(2026, 8, 1); // 2026-09-01

describe("gender", () => {
  test("every offered value is accepted", () => {
    for (const g of GENDERS) assert.equal(cleanGender(g), g);
  });

  test("every value has a label, and every label has a value", () => {
    // The API and the form must not disagree about what "other" means.
    assert.deepEqual(Object.keys(GENDER_LABELS).sort(), [...GENDERS].sort());
  });

  test("case and padding are normalised, not rejected", () => {
    assert.equal(cleanGender("  Female "), "female");
    assert.equal(cleanGender("PREFER_NOT_TO_SAY"), "prefer_not_to_say");
  });

  test("blank clears it", () => {
    for (const v of [null, undefined, "", "   "]) assert.equal(cleanGender(v), null);
  });

  test("anything outside the set is stored as nothing, not as junk", () => {
    // A closed set the form itself supplies, so a value outside it means a
    // broken client — and the answer to that is to keep nothing.
    for (const v of ["male; DROP TABLE", "man", 42, {}, []]) {
      assert.equal(cleanGender(v), null, `accepted ${JSON.stringify(v)}`);
    }
  });
});

describe("date of birth", () => {
  const ok = (v) => cleanDateOfBirth(v, NOW);

  test("a plain calendar date is kept exactly as typed", () => {
    // Kept as a STRING on purpose. A birthday has no time and no timezone;
    // storing it as an instant makes it midnight UTC, which is the day before
    // in some places, and an owner would watch their own birthday move.
    assert.deepEqual(ok("1990-04-12"), { ok: true, value: "1990-04-12" });
  });

  test("blank clears it", () => {
    for (const v of [null, undefined, "", "   "]) {
      assert.deepEqual(cleanDateOfBirth(v, NOW), { ok: true, value: null });
    }
  });

  test("a date that does not exist is refused", () => {
    // These pass the pattern. Date.parse rolls 30 February forward to 2 March
    // rather than complaining, so the only reliable test is the round trip.
    for (const v of ["2025-02-30", "2025-13-01", "2025-00-10", "2025-04-31"]) {
      assert.equal(ok(v).ok, false, `accepted ${v}`);
    }
  });

  test("something that is not a date at all is refused", () => {
    for (const v of ["12/04/1990", "1990", "yesterday", "1990-4-2", {}]) {
      assert.equal(ok(v).ok, false, `accepted ${JSON.stringify(v)}`);
    }
  });

  test("the future is refused", () => {
    assert.equal(ok("2027-01-01").ok, false);
    assert.match(ok("2027-01-01").error, /future/i);
  });

  test("implausible ages are refused at the door", () => {
    // Not a legal gate — nothing here blocks a purchase. It stops a mistyped
    // year being stored and rendered back as an age of 3 or 214.
    const tooYoung = new Date(NOW - (MIN_AGE_YEARS - 1) * 365.25 * 864e5).toISOString().slice(0, 10);
    const tooOld = new Date(NOW - (MAX_AGE_YEARS + 5) * 365.25 * 864e5).toISOString().slice(0, 10);
    assert.equal(ok(tooYoung).ok, false, "accepted somebody under " + MIN_AGE_YEARS);
    assert.equal(ok(tooOld).ok, false, "accepted somebody over " + MAX_AGE_YEARS);
  });

  test("a refusal always says what to do about it", () => {
    for (const v of ["2027-01-01", "2025-02-30", "nonsense"]) {
      const r = ok(v);
      assert.equal(r.ok, false);
      assert.ok(r.error && r.error.length > 8, `no usable message for ${v}`);
    }
  });
});

describe("age", () => {
  test("counted in whole years", () => {
    assert.equal(ageFromDateOfBirth("1990-04-12", NOW), 36);
  });

  test("the birthday itself counts, the day before does not", () => {
    // Off-by-one here is the difference between somebody being told they are 35
    // or 36 on the morning of their birthday.
    assert.equal(ageFromDateOfBirth("2000-09-01", NOW), 26, "on the day");
    assert.equal(ageFromDateOfBirth("2000-09-02", NOW), 25, "the day before");
    assert.equal(ageFromDateOfBirth("2000-08-31", NOW), 26, "the day after");
  });

  test("a leap-day birthday is handled", () => {
    assert.equal(ageFromDateOfBirth("2004-02-29", NOW), 22);
  });

  test("nothing in, nothing out", () => {
    for (const v of [null, undefined, "", "not a date", "1990"]) {
      assert.equal(ageFromDateOfBirth(v, NOW), null, `got a number from ${JSON.stringify(v)}`);
    }
  });
});

describe("what the page is sent", () => {
  test("age rides along derived, never stored", () => {
    // Storing it would be wrong from the owner's next birthday onwards, and
    // nothing would be there to correct it.
    const shaped = shapeProfileDetails({ gender: "female", dateOfBirth: "1990-04-12" }, NOW);
    assert.deepEqual(shaped, { gender: "female", dateOfBirth: "1990-04-12", age: 36 });
  });

  test("an age already on the record is ignored, not trusted", () => {
    const shaped = shapeProfileDetails({ dateOfBirth: "1990-04-12", age: 3 }, NOW);
    assert.equal(shaped.age, 36);
  });

  test("an owner who has told us nothing gets a full, empty shape", () => {
    // Every key present, so the sheet can bind to them without guarding each
    // one — and so a missing key means a bug rather than an empty profile.
    for (const owner of [{}, null, undefined]) {
      assert.deepEqual(shapeProfileDetails(owner, NOW),
        { gender: null, dateOfBirth: null, age: null });
    }
  });

  test("junk on the record is not handed to the page", () => {
    const shaped = shapeProfileDetails({ gender: "<script>", dateOfBirth: "whenever" }, NOW);
    assert.deepEqual(shaped, { gender: null, dateOfBirth: "whenever", age: null });
  });

  test("no login identifier is ever part of this shape", () => {
    // Email and mobile are what a person signs in with. They are shown on the
    // sheet read-only from the owner payload; they must not travel inside the
    // thing the details form posts back.
    const shaped = shapeProfileDetails(
      { gender: "male", dateOfBirth: "1990-04-12", email: "a@b.c", mobile: "+919000000001" },
      NOW
    );
    assert.deepEqual(Object.keys(shaped).sort(), ["age", "dateOfBirth", "gender"]);
  });
});
