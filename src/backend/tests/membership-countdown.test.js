// The membership countdown on the profile card.
//
// WHY THIS IS A TEST AND NOT A CODE REVIEW NOTE.
//
// The card prints a date and a number of days an owner will hold us to, beside
// a button that sells them more of the same. Two things have to hold, and
// neither is visible by reading the card:
//
//   1. The countdown must agree with ENTITLEMENT. Days-left and "are the masked
//      calls still working" are read from the same three fields; if they ever
//      disagree the screen is either selling cover somebody already has or
//      hiding a lapse. So the countdown is pinned against isInPremiumTrial and
//      premiumTrialEndsAt rather than against hand-written dates.
//
//   2. A bar is drawn only where the window is known end to end. The free year
//      has a start and a fixed length; a paid period stores only its END, so
//      there is no honest denominator for one, and a bar against a guessed
//      start would be a decoration wearing the costume of information.
//
// Arithmetic against the real helpers, so it needs no browser. The last suite
// exercises the route, because the browser is deliberately handed the computed
// entitlement rather than the raw dates.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { membershipCountdown } from "../lib/core/membership-fulfilment.js";
import { isInPremiumTrial, premiumTrialEndsAt, premiumTrialStartsAt } from "../lib/core/vault.js";
import { hasActiveSubscription } from "../lib/core/subscription.js";
import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress
} from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (days) => new Date(NOW - days * DAY).toISOString();
const ahead = (days) => new Date(NOW + days * DAY).toISOString();
const premium = (extra) => Object.assign({ premium: true }, extra);

describe("what the card counts down", () => {
  test("an E-Tag has nothing to count, and is not reported as expired", () => {
    // null, not { daysLeft: 0 }. A tag that never had cover has not lost any,
    // and a zero would put an expiry on a free tag.
    assert.equal(membershipCountdown({ premium: false, activatedAt: ago(10) }, NOW), null);
    assert.equal(membershipCountdown(null, NOW), null);
    assert.equal(membershipCountdown({}, NOW), null);
  });

  test("a tag activated today has the whole free year ahead of it", () => {
    const m = membershipCountdown(premium({ activatedAt: ago(0) }), NOW);
    assert.equal(m.state, "trial");
    assert.equal(m.daysLeft, 365);
    assert.equal(m.elapsedDays, 0);
    assert.equal(m.totalDays, 365);
  });

  test("the bar and the number describe the same window", () => {
    const m = membershipCountdown(premium({ activatedAt: ago(300) }), NOW);
    assert.equal(m.state, "trial");
    assert.equal(m.daysLeft, 65);
    assert.equal(m.elapsedDays, 300);
    assert.equal(m.elapsedDays + m.daysLeft, m.totalDays, "the bar and the countdown disagree");
  });

  // Rounding down would tell somebody with eleven hours of cover that they have
  // none, on a card whose whole job is to say when it runs out.
  test("the last part-day still reads as a day", () => {
    const m = membershipCountdown(premium({ activatedAt: new Date(NOW - 364.6 * DAY).toISOString() }), NOW);
    assert.equal(m.state, "trial");
    assert.equal(m.daysLeft, 1);
  });

  test("an expired free year is lapsed, not zero-days-left", () => {
    const m = membershipCountdown(premium({ activatedAt: ago(500) }), NOW);
    assert.equal(m.state, "lapsed");
    assert.equal(m.endsAt, null);
    assert.equal(m.totalDays, null, "a bar was drawn for cover that has run out");
  });
});

describe("the countdown cannot disagree with entitlement", () => {
  const cases = [
    ["activated today", premium({ activatedAt: ago(0) })],
    ["mid-year", premium({ activatedAt: ago(180) })],
    ["one day left", premium({ activatedAt: new Date(NOW - 364.6 * DAY).toISOString() })],
    ["long expired", premium({ activatedAt: ago(500) })],
    ["no dates at all", premium({})],
    ["unparseable date", premium({ activatedAt: "not-a-date" })],
    ["start dated into the future", premium({ activatedAt: ahead(400) })]
  ];

  for (const entry of cases) {
    const name = entry[0];
    const tag = entry[1];
    test(name + ": the card and entitlement agree", () => {
      const m = membershipCountdown(tag, NOW);
      const inTrial = isInPremiumTrial(tag, NOW);
      const subscribed = hasActiveSubscription(tag, NOW);

      // The invariant is about COVER, not about the word "trial". A tag inside
      // its free year that has also bought a longer period is correctly
      // reported as subscribed — call-access.js states the rule, and an earlier
      // draft of this test asserted the opposite. It passed only because no
      // case here combined the two, which is exactly how a false assertion
      // survives: it was never handed the input that disproves it.
      const claimsCover = m !== null && (m.state === "trial" || m.state === "subscribed" || m.state === "open");
      assert.equal(
        claimsCover,
        inTrial || subscribed,
        "the card claims " + (claimsCover ? "cover" : "no cover") + " but entitlement says otherwise"
      );

      if (m && m.state === "trial") {
        assert.equal(inTrial, true, "the card counts down a trial entitlement says has ended");
        assert.equal(
          m.endsAt,
          new Date(premiumTrialEndsAt(tag, NOW)).toISOString(),
          "the card counts down to a different instant than entitlement uses"
        );
      }
    });
  }

  // The case the assertion above used to get wrong, stated on its own so it
  // cannot quietly stop being covered.
  test("a live free year with longer paid cover reads as subscribed, not trial", () => {
    const tag = premium({
      activatedAt: ago(100),
      subscription: { status: "active", currentPeriodEnd: ahead(400) }
    });
    assert.equal(isInPremiumTrial(tag, NOW), true, "fixture no longer exercises an overlapping trial");
    const m = membershipCountdown(tag, NOW);
    assert.equal(m.state, "subscribed");
    assert.equal(m.daysLeft, 400, "the card counted the free year instead of the paid period");
  });

  // The shape of the bug that matters: a date far in the future must not mint
  // an unbounded free tier, on the card any more than in the vault.
  test("bad data yields no cover rather than endless cover", () => {
    const bad = [premium({ activatedAt: ahead(400) }), premium({ activatedAt: "" }), premium({})];
    for (const tag of bad) {
      assert.equal(premiumTrialStartsAt(tag, NOW), null);
      assert.equal(membershipCountdown(tag, NOW).state, "lapsed");
    }
  });
});

describe("a paid period is not called a trial, and gets no invented bar", () => {
  test("cover bought past the free year reads as premium, not trial", () => {
    const tag = premium({ activatedAt: ago(300), subscription: { status: "active", currentPeriodEnd: ahead(200) } });
    const m = membershipCountdown(tag, NOW);
    assert.equal(m.state, "subscribed");
    assert.equal(m.daysLeft, 200);
    // Only currentPeriodEnd is stored, so the window has no known start.
    assert.equal(m.totalDays, null, "a bar was drawn against a start that is not stored");
    assert.equal(m.elapsedDays, null);
  });

  test("a purchase that ends before the free year does not shorten it", () => {
    const tag = premium({ activatedAt: ago(10), subscription: { status: "active", currentPeriodEnd: ahead(30) } });
    const m = membershipCountdown(tag, NOW);
    assert.equal(m.state, "trial", "a shorter paid period displaced the longer free year");
    assert.equal(m.daysLeft, 355);
  });

  test("a comped tag has cover and no end date to count", () => {
    const m = membershipCountdown(premium({ activatedAt: ago(500), subscription: { status: "active" } }), NOW);
    assert.equal(m.state, "open");
    assert.equal(m.daysLeft, null);
    assert.equal(m.endsAt, null);
  });

  test("a subscription that has itself lapsed is lapsed", () => {
    const tag = premium({ activatedAt: ago(500), subscription: { status: "active", currentPeriodEnd: ago(5) } });
    assert.equal(membershipCountdown(tag, NOW).state, "lapsed");
  });
});

describe("the dashboard sends the entitlement, not the raw dates", () => {
  const EMAIL = "qa-countdown@parktag-test.invalid";
  let app;
  let collections;
  let owner;
  let cookie;

  before(async () => {
    const started = await startTestApp();
    app = started.app;
    collections = started.collections;
  });

  after(async () => {
    await collections.tags.deleteMany({ token: /^qa-countdown/ }).catch(() => {});
    await collections.owners.deleteMany({ email: EMAIL }).catch(() => {});
    await purgeLoginCollections(collections);
    await stopTestApp(app);
  });

  beforeEach(async () => {
    await collections.tags.deleteMany({ token: /^qa-countdown/ }).catch(() => {});
    await collections.owners.deleteMany({ email: EMAIL }).catch(() => {});
    owner = await createTestOwner(collections, { email: EMAIL });
    cookie = await createSession(app, { id: String(owner._id), role: "owner", email: owner.email });
  });

  function dashboard() {
    return app.inject({
      method: "GET",
      url: "/api/owner/dashboard",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie }
    });
  }

  test("a premium tag carries a countdown the page can render as-is", async () => {
    await collections.tags.insertOne({
      ownerId: owner._id, token: "qa-countdown-1", plateNumber: "QA01CD0001",
      vehicleType: "bike", status: "active", premium: true,
      activatedAt: ago(53), createdAt: ago(53), deletedAt: null
    });

    const body = (await dashboard()).json();
    const tag = body.tags.find((t) => t.token === "qa-countdown-1");
    assert.ok(tag, "the tag is missing from the payload");
    assert.equal(tag.membership.state, "trial");
    assert.equal(tag.membership.daysLeft, 312);
    assert.equal(tag.membership.elapsedDays, 53);
    assert.equal(tag.membership.totalDays, 365);
  });

  test("an E-Tag carries null, so the card keeps its offer instead of an expiry", async () => {
    await collections.tags.insertOne({
      ownerId: owner._id, token: "qa-countdown-2", plateNumber: "QA01CD0002",
      vehicleType: "car", status: "active", premium: false,
      activatedAt: ago(20), createdAt: ago(20), deletedAt: null
    });

    const body = (await dashboard()).json();
    const tag = body.tags.find((t) => t.token === "qa-countdown-2");
    assert.ok(tag);
    assert.equal(tag.membership, null);
  });
});

// A leap year is not a special case to be handled. It is the reason the window
// is MEASURED rather than assumed: totalDays is the real distance between the
// start and the end that addMonths produced, so a year containing 29 February
// is 366 and the bar is scaled against 366. A hard-coded 365 would finish the
// bar a day early on one year in four, and disagree with the date printed
// underneath it — on the one card whose job is to be exact about that date.
//
// Fixed instants throughout, never Date.now(), or these stop testing leap years
// the moment the calendar moves.
describe("a year means a calendar year, not 365 fixed days", () => {
  const at = (iso) => ({ premium: true, activatedAt: iso });
  const spanDays = (tag, now) =>
    Math.round((premiumTrialEndsAt(tag, now) - premiumTrialStartsAt(tag, now)) / DAY);

  test("a window that spans 29 February is 366 days", () => {
    // 2027-03-01 runs to 2028-03-01, crossing the leap day in February 2028.
    const tag = at("2027-03-01T00:00:00.000Z");
    const now = Date.parse("2027-03-01T00:00:01Z");
    const m = membershipCountdown(tag, now);
    assert.equal(spanDays(tag, now), 366, "the window itself is not 366 days");
    assert.equal(m.totalDays, 366, "the bar was measured against a fixed 365");
    assert.equal(m.daysLeft, 366);
  });

  test("an ordinary window is 365 days", () => {
    const tag = at("2026-03-01T00:00:00.000Z");
    const now = Date.parse("2026-03-01T00:00:01Z");
    const m = membershipCountdown(tag, now);
    assert.equal(m.totalDays, 365);
    assert.equal(m.daysLeft, 365);
  });

  // addMonths clamps rather than rolling into March, which is the behaviour a
  // person expects from "one year later" and the one that never grants a day
  // nobody was promised.
  test("activation on 29 February ends on 28 February, and is 365 days", () => {
    const tag = at("2028-02-29T06:00:00.000Z");
    const now = Date.parse("2028-02-29T06:00:01Z");
    const m = membershipCountdown(tag, now);
    assert.equal(new Date(m.endsAt).toISOString().slice(0, 10), "2029-02-28");
    assert.equal(m.totalDays, 365);
  });

  test("the bar still closes exactly inside a leap window", () => {
    const tag = at("2027-03-01T00:00:00.000Z");
    const start = Date.parse("2027-03-01T00:00:00Z");
    for (const day of [1, 100, 200, 365]) {
      const m = membershipCountdown(tag, start + day * DAY);
      assert.equal(m.totalDays, 366, "totalDays drifted at day " + day);
      assert.equal(
        m.elapsedDays + m.daysLeft,
        m.totalDays,
        "the bar does not close at day " + day
      );
      assert.equal(m.elapsedDays, day, "elapsed disagrees with the calendar at day " + day);
    }
  });
});
