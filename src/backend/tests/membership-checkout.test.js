// Buying a membership.
//
// The unit under test is "what does a payment actually buy", which is the part
// that cannot be checked by looking at the screen. Two things decide it: the
// period arithmetic in membership-fulfilment.js, and the claim that stops one
// payment being activated twice.
//
// Both failure directions are silent. Extend from the wrong base and the buyer
// loses up to 90 days they had free; let two callers through and one payment
// buys double the time. Neither shows up anywhere except in a date nobody looks
// at until it is wrong.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  addMonths,
  membershipPeriodStart
} from "../lib/core/membership-fulfilment.js";
import { getMembershipPlan, membershipPlanPaise } from "../lib/core/membership-plans.js";
import { PREMIUM_TRIAL_DAYS } from "../lib/core/vault.js";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

describe("what a plan costs", () => {
  test("the browser names a plan; the server decides the amount", () => {
    assert.equal(membershipPlanPaise(getMembershipPlan("m6")), 14900);
    assert.equal(membershipPlanPaise(getMembershipPlan("m1")), 4900);
    assert.equal(membershipPlanPaise(getMembershipPlan("m12")), 24900);
  });

  // getShopProduct needed an own-property guard because a bare object index
  // reached "constructor" and "__proto__" and returned something truthy with no
  // amount on it — and the NaN that followed wrote a real order. This looks up
  // in an array, which cannot be reached that way, but the behaviour is worth
  // pinning rather than left as a property of the implementation.
  test("prototype keys are not plans", () => {
    for (const key of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      assert.equal(getMembershipPlan(key), null, `${key} resolved to a plan`);
    }
  });

  test("a non-string plan id is not a plan", () => {
    for (const value of [null, undefined, 7, {}, ["m6"], true]) {
      assert.equal(getMembershipPlan(value), null);
    }
  });
});

describe("adding months to a date", () => {
  // Whole calendar months, not 30-day blocks: 30-day arithmetic drifts five
  // days a year, so an annual renewal lands on a visibly different date each
  // time and reads as a billing bug.
  test("the day of the month is kept", () => {
    const start = Date.UTC(2026, 0, 15);
    assert.equal(iso(addMonths(start, 1)), iso(Date.UTC(2026, 1, 15)));
    assert.equal(iso(addMonths(start, 6)), iso(Date.UTC(2026, 6, 15)));
    assert.equal(iso(addMonths(start, 12)), iso(Date.UTC(2027, 0, 15)));
  });

  // The one that bites. new Date(2026-01-31).setMonth(+1) is the 3rd of March,
  // because February has no 31st and Date rolls forward — so a month's plan
  // bought on the 31st would silently grant three extra days.
  test("the 31st plus a month is the end of February, not the 3rd of March", () => {
    assert.equal(iso(addMonths(Date.UTC(2026, 0, 31), 1)), iso(Date.UTC(2026, 1, 28)));
    // 2028 is a leap year.
    assert.equal(iso(addMonths(Date.UTC(2028, 0, 31), 1)), iso(Date.UTC(2028, 1, 29)));
  });

  test("a 31st into a 30-day month clamps to the 30th", () => {
    assert.equal(iso(addMonths(Date.UTC(2026, 2, 31), 1)), iso(Date.UTC(2026, 3, 30)));
  });

  test("the time of day survives", () => {
    const start = Date.UTC(2026, 4, 10, 13, 45, 30);
    assert.equal(iso(addMonths(start, 6)), iso(Date.UTC(2026, 10, 10, 13, 45, 30)));
  });
});

describe("where a bought period starts", () => {
  const now = Date.UTC(2026, 5, 1);

  test("with nothing running, from now", () => {
    assert.equal(membershipPeriodStart({ premium: false }, now), now);
  });

  // Renewing early must extend, not reset. Buying a second year in month eleven
  // is the ordinary case, and starting it today would throw away the rest.
  test("an active paid period is extended from its end", () => {
    const end = now + 40 * DAY;
    const tag = { premium: false, subscription: { status: "active", currentPeriodEnd: iso(end) } };

    assert.equal(membershipPeriodStart(tag, now), end);
  });

  // A premium tag carries 90 free days from activation. Charging from today
  // would sell the buyer days they already hold.
  test("an unexpired free trial is not charged over", () => {
    const activatedAt = iso(now - 10 * DAY);
    const tag = { premium: true, premiumSince: activatedAt };

    const start = membershipPeriodStart(tag, now);
    const expected = new Date(activatedAt).getTime() + PREMIUM_TRIAL_DAYS * DAY;

    assert.equal(start, expected);
    assert.ok(start > now, "the paid period started before the free trial ended");
  });

  // A lapsed subscription's end date is in the past. Starting there would
  // back-date the new period into the gap and hand over less than was paid for.
  test("a lapsed period does not back-date the new one", () => {
    const tag = {
      premium: false,
      subscription: { status: "active", currentPeriodEnd: iso(now - 30 * DAY) }
    };

    assert.equal(membershipPeriodStart(tag, now), now);
  });

  test("a cancelled subscription is not extended from", () => {
    const tag = {
      premium: false,
      subscription: { status: "cancelled", currentPeriodEnd: iso(now + 40 * DAY) }
    };

    assert.equal(membershipPeriodStart(tag, now), now);
  });

  // Both running at once: whichever ends later wins, or the buyer loses the
  // remainder of the other.
  test("trial and paid period together take the later end", () => {
    const paidEnd = now + 200 * DAY;
    const tag = {
      premium: true,
      premiumSince: iso(now - 10 * DAY),
      subscription: { status: "active", currentPeriodEnd: iso(paidEnd) }
    };

    assert.equal(membershipPeriodStart(tag, now), paidEnd);
  });

  // premiumTrialEndsAt refuses a start date far in the future rather than
  // granting an unbounded trial, so a mistyped field cannot push a paid period
  // years out. Checked here because this function is what would consume it.
  test("a nonsense trial start cannot push the period into the future", () => {
    const tag = { premium: true, premiumSince: iso(now + 900 * DAY) };

    assert.equal(membershipPeriodStart(tag, now), now);
  });

  test("an unparseable end date is ignored rather than trusted", () => {
    const tag = { premium: false, subscription: { status: "active", currentPeriodEnd: "soon" } };

    assert.equal(membershipPeriodStart(tag, now), now);
  });

  // The legacy field names subscription.js still reads. A tag stamped by the
  // grandfather script carries callSubscription and nothing else, and renewing
  // it must extend that rather than ignore it.
  test("a legacy callSubscription is extended from too", () => {
    const end = now + 50 * DAY;
    const tag = { premium: false, callSubscription: { status: "active", currentPeriodEnd: iso(end) } };

    assert.equal(membershipPeriodStart(tag, now), end);
  });
});
