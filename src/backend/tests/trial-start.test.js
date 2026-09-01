// When the complimentary window opens.
//
// This is the shelf-life bug, pinned. An admin batch mints premium tags with
// `premium: true` and no premiumSince, so the window used to be measured from
// the print run: a batch printed in September and sold in December reached its
// buyer with the free period already spent, which reads as a tag that never
// worked rather than one that expired in a warehouse. The window now opens at
// activation, and these tests are the guarantee that it cannot drift back.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  PREMIUM_TRIAL_DAYS,
  premiumTrialEndsAt,
  isInPremiumTrial,
  documentEntitlement,
  DOCS_PER_PREMIUM_TAG,
  DOCS_PER_SUBSCRIBED_TAG
} from "../lib/core/vault.js";
import { callEntitlement } from "../lib/core/call-access.js";
import { DEMO_TAG_FIELDS } from "../lib/core/marketing-stock.js";

const DAY = 24 * 60 * 60 * 1000;
const ago = (n) => new Date(Date.now() - n * DAY).toISOString();

// A premium tag exactly as the admin batch generator writes it: the flag, a
// mint date, and nothing else. This shape is the whole reason the bug existed.
const stockTag = (mintedDaysAgo, extra = {}) => ({
  premium: true,
  createdAt: ago(mintedDaysAgo),
  ...extra
});

describe("a stock tag's window opens when it is activated", () => {
  test("a long-shelved tag activated today gets its full period", () => {
    // The case that was broken: minted well beyond the window, sold now.
    const tag = stockTag(PREMIUM_TRIAL_DAYS + 200, { activatedAt: ago(0) });

    assert.equal(isInPremiumTrial(tag), true,
      "a tag activated today is not in trial — the window is still dating from the print run");
    assert.equal(callEntitlement(tag).masking, true);
    assert.equal(documentEntitlement(tag).maxDocs, DOCS_PER_SUBSCRIBED_TAG);
  });

  test("shelf time is not charged to the customer", () => {
    // Two tags activated on the same day, printed months apart, must expire on
    // the same day. Asserted as equality rather than as "both in trial", so a
    // partial credit for shelf time would fail here too.
    const fresh = stockTag(1, { activatedAt: ago(10) });
    const shelved = stockTag(300, { activatedAt: ago(10) });

    assert.equal(premiumTrialEndsAt(fresh), premiumTrialEndsAt(shelved));
  });

  test("the window still closes, counted from activation", () => {
    const justInside = stockTag(500, { activatedAt: ago(PREMIUM_TRIAL_DAYS - 1) });
    const justOutside = stockTag(500, { activatedAt: ago(PREMIUM_TRIAL_DAYS + 1) });

    assert.equal(isInPremiumTrial(justInside), true, "expired a day early");
    assert.equal(isInPremiumTrial(justOutside), false, "activation reopened a closed window");
    assert.equal(documentEntitlement(justOutside).maxDocs, DOCS_PER_PREMIUM_TAG);
    assert.equal(callEntitlement(justOutside).masking, false);
  });

  test("an unactivated tag on the shelf burns nothing", () => {
    // It has no owner and cannot be scanned into a contact, so what matters is
    // only that sitting in stock does not consume the window it will be sold
    // with. Checked through the tag that is later activated, since an unowned
    // tag is never asked for an entitlement.
    const shelved = stockTag(PREMIUM_TRIAL_DAYS * 3);
    assert.equal(isInPremiumTrial(shelved), false, "an unsold tag should not read as mid-trial");

    const sold = { ...shelved, activatedAt: ago(0) };
    assert.equal(isInPremiumTrial(sold), true, "selling it did not open the window");
  });
});

describe("which date wins", () => {
  test("a shop purchase still dates from the purchase", () => {
    // createPremiumTagForVehicle mints an already-owned tag, so premiumSince IS
    // that customer's activation. It must keep precedence, otherwise this
    // change would quietly alter what a paying customer already has.
    const bought = {
      premium: true,
      premiumSince: ago(PREMIUM_TRIAL_DAYS + 5),
      createdAt: ago(PREMIUM_TRIAL_DAYS + 5)
    };
    assert.equal(isInPremiumTrial(bought), false);

    const recent = { premium: true, premiumSince: ago(1), createdAt: ago(1) };
    assert.equal(isInPremiumTrial(recent), true);
  });

  test("a tag activated before this shipped keeps the behaviour it had", () => {
    // No activatedAt, so it falls back to createdAt exactly as before. Nothing
    // already granted is withdrawn by the new ordering.
    const legacy = stockTag(10);
    assert.equal(isInPremiumTrial(legacy), true);
    assert.equal(isInPremiumTrial(stockTag(PREMIUM_TRIAL_DAYS + 10)), false);
  });

  test("a junk date is no trial rather than an endless one", () => {
    assert.equal(premiumTrialEndsAt({ premium: true, activatedAt: "not a date" }), null);
    assert.equal(premiumTrialEndsAt({ premium: true }), null);
    assert.equal(isInPremiumTrial({ premium: true, activatedAt: "" }), false);
  });

  test("an E-Tag has no premium window at all", () => {
    assert.equal(premiumTrialEndsAt({ premium: false, activatedAt: ago(0) }), null);
    assert.equal(premiumTrialEndsAt({ activatedAt: ago(0) }), null);
  });
});

describe("a demo sticker forgets when it was activated", () => {
  test("deactivating clears activatedAt", () => {
    // Otherwise the customer who buys a sticker off the demo shelf inherits
    // however much of the window the demo already spent — the same shelf bug,
    // one step further down the chain.
    assert.ok(DEMO_TAG_FIELDS.includes("activatedAt"),
      "a reset demo sticker would keep its old window");
  });
});
