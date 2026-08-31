// Call masking used to be permanent for a premium tag. It now runs for 45 days
// from purchase and then needs a subscription, mirroring the document vault.
//
// These are unit tests over the entitlement alone. That is deliberate: three
// routes and the owner dashboard all branch on `callEntitlement().masking`, so
// pinning the rule here is what stops them drifting apart. The routes are
// covered separately by contact-routing and callback-premium-only.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  callEntitlement,
  hasActiveCallSubscription,
  callBlockedCode,
  callBlockedMessage,
  CALL_TIER_ETAG_FREE,
  CALL_TIER_ETAG_USED,
  CALL_TIER_TRIAL,
  CALL_TIER_SUBSCRIBED,
  CALL_TIER_LAPSED
} from "../lib/core/call-access.js";
import { PREMIUM_TRIAL_DAYS } from "../lib/core/vault.js";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

describe("call masking entitlement", () => {
  test("an unused E-Tag may be contacted once", () => {
    const e = callEntitlement({ premium: false });
    assert.equal(e.tier, CALL_TIER_ETAG_FREE);
    assert.equal(e.masking, true);
    assert.equal(e.premium, false);
  });

  test("a spent E-Tag is blocked", () => {
    const e = callEntitlement({ premium: false, freeContactUsed: true });
    assert.equal(e.tier, CALL_TIER_ETAG_USED);
    assert.equal(e.masking, false);
  });

  test("a missing or malformed tag is treated as a spent-free E-Tag, not as premium", () => {
    // Nothing about an absent tag should hand out a paid service.
    for (const tag of [null, undefined]) {
      const e = callEntitlement(tag);
      assert.equal(e.premium, false);
      assert.equal(e.masking, true, "an absent tag reads as an unused E-Tag");
    }
  });

  test("a premium tag bought today is inside its included window", () => {
    const e = callEntitlement({ premium: true, premiumSince: daysAgo(0) });
    assert.equal(e.tier, CALL_TIER_TRIAL);
    assert.equal(e.masking, true);
    assert.ok(e.trialEndsAt, "the page needs a date to count down to");
  });

  test(`the window is ${PREMIUM_TRIAL_DAYS} days and closes`, () => {
    const inside = callEntitlement({ premium: true, premiumSince: daysAgo(PREMIUM_TRIAL_DAYS - 1) });
    const outside = callEntitlement({ premium: true, premiumSince: daysAgo(PREMIUM_TRIAL_DAYS + 1) });
    assert.equal(inside.masking, true);
    assert.equal(outside.masking, false);
    assert.equal(outside.tier, CALL_TIER_LAPSED);
  });

  test("a lapsed premium tag loses masking but stays premium", () => {
    // It is still a premium tag — the scanner still sees the vehicle and can
    // leave a message. Only the masked call is off.
    const e = callEntitlement({ premium: true, premiumSince: daysAgo(60) });
    assert.equal(e.masking, false);
    assert.equal(e.premium, true);
    assert.equal(e.subscribed, false);
  });

  test("a live subscription restores masking after the window", () => {
    const e = callEntitlement({
      premium: true,
      premiumSince: daysAgo(200),
      callSubscription: { status: "active", currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString() }
    });
    assert.equal(e.tier, CALL_TIER_SUBSCRIBED);
    assert.equal(e.masking, true);
    assert.equal(e.subscribed, true);
  });

  test("a subscriber is never labelled as being on a trial", () => {
    // Same access either way, but telling somebody who has paid that their
    // calls stop in a fortnight would be alarming and wrong.
    const e = callEntitlement({
      premium: true,
      premiumSince: daysAgo(1),
      callSubscription: { status: "active", currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString() }
    });
    assert.equal(e.tier, CALL_TIER_SUBSCRIBED);
    assert.equal(e.trialEndsAt, undefined);
  });

  test("a subscription cannot conjure premium out of an E-Tag", () => {
    // The tiers are a ladder, not independent switches.
    const e = callEntitlement({
      premium: false,
      freeContactUsed: true,
      callSubscription: { status: "active", currentPeriodEnd: new Date(Date.now() + DAY).toISOString() }
    });
    assert.equal(e.masking, false);
    assert.equal(e.premium, false);
  });

  test("an expired subscription falls back rather than lingering", () => {
    // The clock decides, not a downgrade job. A renewal that fails overnight
    // must not leave masking open until somebody notices.
    const e = callEntitlement({
      premium: true,
      premiumSince: daysAgo(200),
      callSubscription: { status: "active", currentPeriodEnd: new Date(Date.now() - 1000).toISOString() }
    });
    assert.equal(e.tier, CALL_TIER_LAPSED);
    assert.equal(e.masking, false);
  });

  test("anything other than a live subscription reads as not subscribed", () => {
    const cases = [
      undefined,
      null,
      {},
      { status: "cancelled", currentPeriodEnd: new Date(Date.now() + DAY).toISOString() },
      { status: "past_due", currentPeriodEnd: new Date(Date.now() + DAY).toISOString() },
      // Junk in the date must read as expired, never as unlimited.
      { status: "active", currentPeriodEnd: "whenever" },
      { status: "active", currentPeriodEnd: "" }
    ];
    for (const callSubscription of cases) {
      assert.equal(
        hasActiveCallSubscription({ premium: true, callSubscription }),
        false,
        `treated as subscribed: ${JSON.stringify(callSubscription)}`
      );
    }
  });

  test("a subscription with no end date is open-ended", () => {
    // What a comped tag looks like, and what the grandfathering script writes
    // onto every premium tag that predates this change.
    for (const currentPeriodEnd of [null, undefined]) {
      assert.equal(
        hasActiveCallSubscription({ premium: true, callSubscription: { status: "active", currentPeriodEnd } }),
        true
      );
    }
  });

  test("a grandfathered tag keeps masking however old it is", () => {
    const e = callEntitlement({
      premium: true,
      premiumSince: daysAgo(900),
      callSubscription: { status: "active", currentPeriodEnd: null, source: "grandfathered" }
    });
    assert.equal(e.masking, true);
    assert.equal(e.tier, CALL_TIER_SUBSCRIBED);
  });

  test("a premium tag with no dates at all gets no window rather than an endless one", () => {
    // A malformed tag must not mint free service. premiumTrialEndsAt returns
    // null when it cannot read a start date, which reads as lapsed.
    const e = callEntitlement({ premium: true });
    assert.equal(e.masking, false);
    assert.equal(e.tier, CALL_TIER_LAPSED);
  });

  test("createdAt stands in for premiumSince on admin-issued batches", () => {
    // Batch-issued premium tags have no premiumSince. Falling back keeps them
    // from reading as lapsed on day one.
    const e = callEntitlement({ premium: true, createdAt: daysAgo(1) });
    assert.equal(e.masking, true);
    assert.equal(e.tier, CALL_TIER_TRIAL);
  });
});

// The owner's masking switch in the app is gated on `masking` — the same field
// the scanner gate reads, so the control is live exactly when a masked call is
// actually available. This suite walks the ladder an owner climbs, because the
// UI branches on it and getting a rung wrong either hands somebody a feature
// they have not got or hides one they have.
describe("the owner's masking switch follows the ladder", () => {
  test("an E-Tag with its free contact unspent may — on by default", () => {
    // The free masked contact is the owner's to use. The switch is live and
    // starts on; it is not withheld until they buy something.
    const e = callEntitlement({ premium: false });
    assert.equal(e.tier, CALL_TIER_ETAG_FREE);
    assert.equal(e.masking, true);
  });

  test("once the free contact is spent it takes a premium tag", () => {
    const e = callEntitlement({ premium: false, freeContactUsed: true });
    assert.equal(e.tier, CALL_TIER_ETAG_USED);
    assert.equal(e.masking, false);
    // The copy for this rung points at the sticker, not at a subscription.
    assert.match(callBlockedMessage(e), /official ParkTag sticker/);
  });

  test("a premium tag inside its 45 days may", () => {
    const e = callEntitlement({ premium: true, premiumSince: daysAgo(1) });
    assert.equal(e.tier, CALL_TIER_TRIAL);
    assert.equal(e.masking, true);
  });

  test("past 45 days it takes a subscription", () => {
    const e = callEntitlement({ premium: true, premiumSince: daysAgo(60) });
    assert.equal(e.tier, CALL_TIER_LAPSED);
    assert.equal(e.masking, false);
  });

  test("a premium tag on a live subscription may", () => {
    const e = callEntitlement({
      premium: true,
      premiumSince: daysAgo(200),
      callSubscription: { status: "active", currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString() }
    });
    assert.equal(e.tier, CALL_TIER_SUBSCRIBED);
    assert.equal(e.masking, true);
  });

  test("every tier gives the switch an explicit answer", () => {
    // The page treats a missing field as "no control". Correct, but it would
    // silently hide a tier that forgot to declare itself, so every branch must
    // return a real boolean — including for junk input.
    const tags = [
      { premium: false },
      { premium: false, freeContactUsed: true },
      { premium: true, premiumSince: daysAgo(1) },
      { premium: true, premiumSince: daysAgo(60) },
      { premium: true, callSubscription: { status: "active", currentPeriodEnd: null } },
      { premium: true },
      {},
      null
    ];
    for (const tag of tags) {
      assert.equal(typeof callEntitlement(tag).masking, "boolean");
    }
  });

  test("the two locked rungs are told apart, because the ask differs", () => {
    // A spent E-Tag needs a sticker; a lapsed premium tag needs a
    // subscription. The UI copy branches on tier, so these must not collapse
    // into one another.
    const spent = callEntitlement({ premium: false, freeContactUsed: true });
    const lapsed = callEntitlement({ premium: true, premiumSince: daysAgo(60) });
    assert.equal(spent.masking, false);
    assert.equal(lapsed.masking, false);
    assert.notEqual(spent.tier, lapsed.tier);
  });
});

describe("what a blocked scanner is told", () => {
  test("the E-Tag code stays FREE_USED", () => {
    // The scanner page already branches on this string; renaming it would
    // silently change what a deployed page does with an unactivated sticker.
    const e = callEntitlement({ premium: false, freeContactUsed: true });
    assert.equal(callBlockedCode(e), "FREE_USED");
    assert.match(callBlockedMessage(e), /official ParkTag sticker/);
  });

  test("a lapsed tag says nothing to the scanner about money", () => {
    // The scanner cannot fix this and it is not their business that somebody
    // else's subscription has run out.
    const e = callEntitlement({ premium: true, premiumSince: daysAgo(60) });
    assert.equal(callBlockedCode(e), "CALL_SUBSCRIPTION_REQUIRED");
    const msg = callBlockedMessage(e);
    assert.doesNotMatch(msg, /subscri|pay|premium|upgrade/i);
    assert.match(msg, /leave a message/i);
  });
});
