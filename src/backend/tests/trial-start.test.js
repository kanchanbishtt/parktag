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
  PREMIUM_TRIAL_DISPLAY,
  PREMIUM_TRIAL_LABEL,
  PREMIUM_TRIAL_MONTHS,
  premiumTrialLengthDays,
  premiumTrialEndsAt,
  isInPremiumTrial,
  documentEntitlement,
  DOCS_PER_PREMIUM_TAG,
  DOCS_PER_SUBSCRIBED_TAG
} from "../lib/core/vault.js";
import { callEntitlement } from "../lib/core/call-access.js";
import { DEMO_TAG_FIELDS } from "../lib/core/marketing-stock.js";
import { addMonths } from "../lib/core/calendar.js";

// Twelve calendar months is 365 days or 366 depending on where the year
// falls, so the window's length is measured off the same helper the
// entitlement uses rather than written down as a number here.
const TRIAL_DAYS = premiumTrialLengthDays();

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
    const tag = stockTag(TRIAL_DAYS + 200, { activatedAt: ago(0) });

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
    const justInside = stockTag(500, { activatedAt: ago(TRIAL_DAYS - 3) });
    const justOutside = stockTag(500, { activatedAt: ago(TRIAL_DAYS + 3) });

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
    const shelved = stockTag(TRIAL_DAYS * 3);
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
      premiumSince: ago(TRIAL_DAYS + 5),
      createdAt: ago(TRIAL_DAYS + 5)
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
    assert.equal(isInPremiumTrial(stockTag(TRIAL_DAYS + 10)), false);
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

// How LONG the complimentary window runs.
//
// Every premium tag includes this at no extra charge, and it is now a full
// year rather than the 90 days it launched with. These tests exist because the
// length has already moved twice, and each move left something behind claiming
// the old one — copy on the dashboard, a hard-coded word in the markup, and
// fixtures whose "expired" case quietly became an in-trial case.
describe("the complimentary window is one calendar year", () => {
  const at = (y, m, d) => Date.UTC(y, m, d, 10, 0, 0);
  const on = (ms) => new Date(ms).toISOString().slice(0, 10);
  const activated = (ms) => ({ premium: true, premiumSince: new Date(ms).toISOString() });

  test("it is twelve months, not a count of days", () => {
    assert.equal(PREMIUM_TRIAL_MONTHS, 12);
  });

  // Calendar months rather than 365 days is the whole point: a year of days
  // ends a day early whenever the window crosses a leap February, so the
  // product would quietly be giving less than the year it advertises.
  test("the end date lands on the same day of the same month, a year on", () => {
    for (const [y, m, d] of [[2026, 2, 15], [2026, 0, 1], [2027, 11, 31]]) {
      const start = at(y, m, d);
      assert.equal(on(premiumTrialEndsAt(activated(start), start)), on(addMonths(start, 12)));
      assert.equal(new Date(premiumTrialEndsAt(activated(start), start)).getUTCFullYear(), y + 1);
    }
  });

  // 29 February has no anniversary. Clamping back to the 28th is the behaviour
  // a person expects, and the one that never grants a day nobody was promised.
  test("a leap day activation clamps to 28 February", () => {
    const start = at(2028, 1, 29);
    assert.equal(on(premiumTrialEndsAt(activated(start), start)), "2029-02-28");
  });

  // The boundary, from both sides, measured off the tag's own start rather
  // than a day count so a leap year cannot move it.
  test("it holds to the last moment and not past it", () => {
    const start = at(2026, 5, 10);
    const tag = activated(start);
    const endsAt = premiumTrialEndsAt(tag, start);

    assert.equal(isInPremiumTrial(tag, endsAt - 1000), true, "expired early");
    assert.equal(isInPremiumTrial(tag, endsAt), false, "outlasted its period");
    assert.equal(isInPremiumTrial(tag, endsAt + 1000), false, "outlasted its period");
  });

  // The old window has to be comfortably inside the new one, which is the
  // customer-visible half of this change: tags that had run out get the rest
  // of the year back.
  test("a tag three months past activation is still covered", () => {
    const start = at(2026, 0, 10);
    assert.equal(isInPremiumTrial(activated(start), start + 91 * DAY), true);
    assert.equal(documentEntitlement(activated(start), start + 91 * DAY).maxDocs, DOCS_PER_SUBSCRIBED_TAG);
    // ...and masked calls, which read the same window.
    assert.equal(callEntitlement(activated(start), start + 91 * DAY).masking, true);
  });

  // Copy is derived from the number above, so no screen can advertise a length
  // the code does not grant.
  test("what the screens are told matches what is granted", () => {
    assert.equal(PREMIUM_TRIAL_LABEL, "1 Year");
    assert.deepEqual(PREMIUM_TRIAL_DISPLAY, { value: "1", unit: "YEAR", label: "1 Year" });
  });

  // A non-premium tag is entitled to none of it, whatever the window length.
  test("an E-Tag gets no window at all", () => {
    assert.equal(premiumTrialEndsAt({ premium: false }, Date.now()), null);
    assert.equal(isInPremiumTrial({ premium: false }), false);
  });
});
