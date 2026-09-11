// The renewal sequence. The one campaign that carries revenue.
//
// It is also the one whose query is easiest to get silently wrong, in either
// direction, and both directions are expensive:
//
//   too narrow  nobody is told their premium is ending, which is the exact
//               silence this campaign exists to end. Costs renewals, and looks
//               like nothing at all in the logs.
//   too wide    every premium customer is told their year ends this week.
//               On WhatsApp, with no recall.
//
// So the assertions are about the WINDOW, not the message. Day 335 is in, day
// 334 and day 336 are out, and a paying subscriber is never told their trial is
// ending at all.
//
// Driven in dry-run mode: the selection is the risky part, and running it inert
// means the suite can never reach Meta or a mail server.

import test, { describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { assertDisposableDatabase } from "./helpers.js";
import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import * as trialEnding from "../lib/core/campaigns/trial-ending.js";
import { addMonths } from "../lib/core/calendar.js";
import { PREMIUM_TRIAL_MONTHS } from "../lib/core/vault.js";

assertDisposableDatabase();

const env = getEnv();
let collections;
const MARK = `trial-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;

const DRY_ENV = {
  ...env,
  appBaseUrl: "https://app.parktag.me",
  metaWhatsappPhoneNumberId: "test-phone-id",
  metaWhatsappAccessToken: "test-token"
};

const NOW = new Date("2026-09-08T09:00:00.000Z");

// A tag whose complimentary year ends exactly `daysOut` from NOW.
//
// Derived by running the real arithmetic backwards rather than by subtracting
// 365 days: the trial is defined in MONTHS, and a fixture built on a fixed day
// count drifts against it and lands a day either side of the window it meant
// to test.
async function seedTag(daysOut, extra = {}) {
  const activatedAt = new Date(addMonths(NOW.getTime() + daysOut * DAY, -PREMIUM_TRIAL_MONTHS)).toISOString();
  const { insertedId } = await collections.tags.insertOne({
    token: `${MARK}-${Math.random().toString(36).slice(2, 10)}`,
    premium: true,
    status: "active",
    vehicleLabel: "Honda City",
    activatedAt,
    testMarker: MARK,
    ...extra
  });
  return insertedId;
}

async function seedOwner(extra = {}) {
  const { insertedId } = await collections.owners.insertOne({
    email: `${MARK}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    role: "owner",
    displayName: "Test Owner",
    testMarker: MARK,
    ...extra
  });
  return insertedId;
}

const run = () =>
  trialEnding.run(DRY_ENV, collections, { now: NOW, limit: 100, dryRun: true, log: null });

before(async () => {
  collections = await getCollections(env);
});

beforeEach(async () => {
  for (const c of ["tags", "owners"]) await collections[c].deleteMany({ testMarker: MARK });
});

after(async () => {
  for (const c of ["tags", "owners"]) await collections[c].deleteMany({ testMarker: MARK });
  await closeMongoConnection();
});

describe("the window catches each stage exactly once", () => {
  for (const days of [30, 7, 1]) {
    test(`a trial ending in ${days} days is selected`, async () => {
      const ownerId = await seedOwner();
      await seedTag(days, { ownerId });

      const res = await run();
      assert.equal(res.wouldSend, 1, `the ${days}-day notice did not select anybody`);
      assert.equal(res.selected[0].stage, `t${days}`);
    });
  }

  test("a tag one day either side of a stage is not selected", async () => {
    // The containment assertion. Each stage is a ONE-DAY window; if this ever
    // passes with 29 or 31 days out, the window has widened and the same
    // customer is told every day for a month.
    const ownerId = await seedOwner();
    await seedTag(29.5, { ownerId });
    await seedTag(31.5, { ownerId });
    await seedTag(15, { ownerId });

    const res = await run();
    assert.equal(res.wouldSend, 0, `days out ${JSON.stringify(res.selected)} matched a stage they should not`);
  });

  test("a trial ending in six months is not chased", async () => {
    const ownerId = await seedOwner();
    await seedTag(180, { ownerId });
    assert.equal((await run()).wouldSend, 0);
  });

  test("an expired trial is not chased either", async () => {
    // Past its end date. That customer needs the lapsed notice, not a warning
    // about something that already happened.
    const ownerId = await seedOwner();
    await seedTag(-5, { ownerId });
    assert.equal((await run()).wouldSend, 0);
  });
});

describe("who is left out, and why", () => {
  test("a paying subscriber is never told their trial is ending", async () => {
    // Both wrong and alarming: they have already renewed.
    const ownerId = await seedOwner();
    await seedTag(30, {
      ownerId,
      subscription: { status: "active", currentPeriodEnd: new Date(NOW.getTime() + 400 * DAY).toISOString() }
    });

    assert.equal((await run()).wouldSend, 0, "a paying customer was told their premium is running out");
  });

  test("a non-premium tag has no trial to end", async () => {
    const ownerId = await seedOwner();
    await seedTag(30, { ownerId, premium: false });
    assert.equal((await run()).wouldSend, 0);
  });

  test("a deleted tag is left alone", async () => {
    const ownerId = await seedOwner();
    await seedTag(30, { ownerId, deletedAt: new Date().toISOString() });
    assert.equal((await run()).wouldSend, 0);
  });

  test("a marketing opt-out does NOT silence this", async () => {
    // The distinction the whole consent model turns on. "Stop sending me
    // offers" is not "stop telling me the service I paid for is ending".
    const ownerId = await seedOwner({ marketingOptOut: true });
    await seedTag(30, { ownerId });

    assert.equal((await run()).wouldSend, 1, "an opt-out silenced a service notice");
  });

  test("a hard stop does silence it", async () => {
    const ownerId = await seedOwner({ messagingHardStop: true });
    await seedTag(30, { ownerId });
    assert.equal((await run()).wouldSend, 0);
  });

  test("an ownerless tag is skipped rather than crashed on", async () => {
    await seedTag(30);
    assert.equal((await run()).wouldSend, 0);
  });
});
