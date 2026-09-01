// One tag, one subscription.
//
// There used to be two fields — `callSubscription`, read only by call-access.js,
// and `documentSubscription`, read only by vault.js — and nothing compared them.
// Stamping one and not the other produced a half-paid tag: masked calls back but
// the vault still at three documents, or the vault restored while calls stayed
// off. It was latent only because nothing sold a subscription yet, and
// grandfather-call-subscriptions.js, which stamped callSubscription alone, would
// have half-rescued every legacy tag the day it ran.
//
// These tests are the guarantee that the two can never drift apart again. They
// assert the CALL and DOCUMENT answers together in every case, so a future
// change that restores one without the other fails here rather than in
// somebody's account.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { callEntitlement, hasActiveCallSubscription } from "../lib/core/call-access.js";
import {
  documentEntitlement,
  hasActiveDocumentSubscription,
  premiumTrialEndsAt,
  isInPremiumTrial,
  PREMIUM_TRIAL_DAYS,
  DOCS_PER_ETAG,
  DOCS_PER_PREMIUM_TAG,
  DOCS_PER_SUBSCRIBED_TAG
} from "../lib/core/vault.js";
import { hasActiveSubscription } from "../lib/core/subscription.js";

const DAY = 24 * 60 * 60 * 1000;
const ago = (n) => new Date(Date.now() - n * DAY).toISOString();
const ahead = (n) => new Date(Date.now() + n * DAY).toISOString();

// Past its complimentary window, so the ONLY thing that can restore anything is
// the subscription under test.
const LAPSED = { premium: true, activatedAt: ago(PREMIUM_TRIAL_DAYS + 10) };

// Asserts the whole product at once. Every test goes through this rather than
// checking calls or documents alone — checking one is how the split survived
// unnoticed in the first place.
function entitledTo(tag, { calls, docs }, message) {
  assert.equal(callEntitlement(tag).masking, calls, `${message}: masked calls`);
  assert.equal(documentEntitlement(tag).maxDocs, docs, `${message}: document slots`);
}

describe("a subscription buys the whole tag, under any of its field names", () => {
  for (const field of ["subscription", "callSubscription", "documentSubscription"]) {
    test(`${field} restores calls AND storage together`, () => {
      const tag = { ...LAPSED, [field]: { status: "active", currentPeriodEnd: ahead(30) } };
      entitledTo(tag, { calls: true, docs: DOCS_PER_SUBSCRIBED_TAG }, `paid via ${field}`);
    });
  }

  test("with no subscription a lapsed tag keeps neither", () => {
    entitledTo(LAPSED, { calls: false, docs: DOCS_PER_PREMIUM_TAG }, "lapsed");
  });
});

describe("a grandfathered tag is rescued whole", () => {
  // Both shapes: what the script writes now, and what an earlier run of it left
  // behind. A tag stamped before the fix must not stay half rescued.
  const grandfathered = { status: "active", currentPeriodEnd: null, source: "grandfathered" };

  test("the shape the script writes today", () => {
    entitledTo({ ...LAPSED, subscription: grandfathered },
      { calls: true, docs: DOCS_PER_SUBSCRIBED_TAG }, "grandfathered");
  });

  test("the legacy shape an earlier run left behind", () => {
    entitledTo({ ...LAPSED, callSubscription: grandfathered },
      { calls: true, docs: DOCS_PER_SUBSCRIBED_TAG }, "grandfathered (legacy field)");
  });
});

describe("what counts as live", () => {
  const cases = [
    ["an absent end date is open-ended", { status: "active" }, true],
    ["an explicit null end date is open-ended", { status: "active", currentPeriodEnd: null }, true],
    ["a future end date is live", { status: "active", currentPeriodEnd: ahead(1) }, true],
    ["a blank end date is NOT open-ended", { status: "active", currentPeriodEnd: "" }, false],
    ["an unparseable end date reads as expired", { status: "active", currentPeriodEnd: "tomorrow" }, false],
    ["a past end date is expired", { status: "active", currentPeriodEnd: ago(1) }, false],
    ["a cancelled subscription is not live", { status: "cancelled", currentPeriodEnd: ahead(30) }, false],
    ["status is compared exactly, not loosely", { status: "ACTIVE", currentPeriodEnd: ahead(30) }, false],
    ["a missing status is not live", { currentPeriodEnd: ahead(30) }, false]
  ];

  for (const [name, sub, expected] of cases) {
    test(name, () => {
      const tag = { ...LAPSED, subscription: sub };
      assert.equal(hasActiveSubscription(tag), expected);
      // The two legacy readers are thin wrappers now, but they are still what
      // the rest of the codebase calls. Pin that they answer identically.
      assert.equal(hasActiveCallSubscription(tag), expected, "call reader disagreed");
      assert.equal(hasActiveDocumentSubscription(tag), expected, "document reader disagreed");
    });
  }

  test("junk never grants more than a real subscription would", () => {
    // The direction that matters: a malformed field must fail CLOSED.
    for (const sub of [{}, { status: "" }, { status: "active", currentPeriodEnd: {} }]) {
      entitledTo({ ...LAPSED, subscription: sub },
        { calls: false, docs: DOCS_PER_PREMIUM_TAG }, `junk ${JSON.stringify(sub)}`);
    }
  });
});

describe("a subscription cannot upgrade an E-Tag", () => {
  test("premium is checked first, so the field buys nothing", () => {
    // Not a bug to fix — an E-Tag is not a premium tag and a subscription on one
    // is bad data. Pinned so it stays a deliberate answer rather than becoming
    // an accidental back door into the paid tier.
    const tag = {
      premium: false,
      freeContactUsed: true,
      subscription: { status: "active", currentPeriodEnd: ahead(30) }
    };
    entitledTo(tag, { calls: false, docs: DOCS_PER_ETAG }, "subscribed E-Tag");
  });

  test("an unspent E-Tag still gets its one free contact", () => {
    entitledTo({ premium: false }, { calls: true, docs: DOCS_PER_ETAG }, "fresh E-Tag");
  });
});

describe("a start date in the future cannot mint an endless window", () => {
  test("a wildly future date is no trial at all", () => {
    // The window is start + 90 days, so a date a year out would grant a year.
    // Refused outright, the same answer an unparseable date already gets.
    for (const tag of [
      { premium: true, activatedAt: ahead(365) },
      { premium: true, premiumSince: ahead(365) },
      { premium: true, createdAt: ahead(365) },
      { premium: true, activatedAt: ahead(1) }
    ]) {
      assert.equal(premiumTrialEndsAt(tag), null, `granted a trial from ${JSON.stringify(tag)}`);
      entitledTo(tag, { calls: false, docs: DOCS_PER_PREMIUM_TAG }, "future-dated");
    }
  });

  test("a minute of clock drift does not deny a fresh activation", () => {
    // These dates are written by the app from its own clock and read back by any
    // instance. Small drift must read as "now", not as corrupt — otherwise a
    // customer loses the window they just activated.
    const now = Date.now();
    const tag = { premium: true, activatedAt: new Date(now + 60 * 1000).toISOString() };

    assert.equal(isInPremiumTrial(tag, now), true, "drift denied a live activation");
    entitledTo(tag, { calls: true, docs: DOCS_PER_SUBSCRIBED_TAG }, "slight drift");
  });

  test("the grace clamps to now rather than extending the window", () => {
    // The point of clamping instead of accepting: a drifted date must not buy
    // even a minute more than 90 days, or the grace becomes a way to extend.
    const now = Date.now();
    const drifted = { premium: true, activatedAt: new Date(now + 60 * 1000).toISOString() };
    const exact = { premium: true, activatedAt: new Date(now).toISOString() };

    assert.equal(premiumTrialEndsAt(drifted, now), premiumTrialEndsAt(exact, now),
      "the grace period lengthened the trial");
  });
});
