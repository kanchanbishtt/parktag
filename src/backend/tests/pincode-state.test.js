// A pincode from another state is refused before payment (PT-260927-00037:
// a New Delhi buyer typed a Kerala code). Pure: no database, no network.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { pincodeStateMismatch, validateAddress } from "../lib/core/address.js";

const ADDRESS = {
  fullName: "Anu Test", phone: "9812300001", line1: "112, SFS Flats, Ashok Vihar",
  city: "New Delhi", state: "Delhi", pincode: "110052"
};

describe("pincode and state", () => {
  test("a Delhi pincode in Delhi passes", () => {
    assert.equal(validateAddress(ADDRESS).ok, true);
  });

  test("a Kerala pincode on a Delhi address is refused without echoing the number", () => {
    const r = validateAddress({ ...ADDRESS, pincode: "681112" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Kerala/);
    assert.doesNotMatch(r.error, /681112/);
  });

  test("a prefix that spans a border accepts either state", () => {
    assert.equal(pincodeStateMismatch("248001", "Uttarakhand"), null);
    assert.equal(pincodeStateMismatch("244001", "Uttar Pradesh"), null);
    assert.equal(pincodeStateMismatch("403001", "Goa"), null);
    assert.equal(pincodeStateMismatch("160017", "Chandigarh"), null);
  });

  test("state spelling variants are matched", () => {
    assert.equal(pincodeStateMismatch("110052", "NCT of Delhi"), null);
    assert.equal(pincodeStateMismatch("744101", "Andaman & Nicobar Islands"), null);
  });

  test("an unknown prefix or an unnamed state is not judged", () => {
    assert.equal(pincodeStateMismatch("990001", "Delhi"), null);
    assert.equal(pincodeStateMismatch("110052", "Somewhere Else"), null);
  });

  test("a clear mismatch names the right state", () => {
    assert.deepEqual(pincodeStateMismatch("560001", "Uttar Pradesh"), ["Karnataka"]);
  });
});
