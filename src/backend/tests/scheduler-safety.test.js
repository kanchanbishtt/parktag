// A scheduler bug is the loudest kind of bug this app can have.
//
// Every other failure here affects one request and one person. A wrong date
// comparison in a campaign query matches every row in the collection and
// messages the entire customer base on one tick, over WhatsApp, where there is
// no recall and where the number that sends it is the same number that carries
// login codes and owner alerts.
//
// So the properties pinned here are the containment ones, not the happy path:
//
//   1. Only one instance runs a tick. Two racing instances would double every
//      claim attempt and halve the value of the lease.
//   2. A dry run selects recipients and sends NOTHING. This is the rehearsal
//      that is supposed to catch a bad query before customers do, so it has to
//      be genuinely inert.
//   3. The cart-reminder window is BOUNDED at both ends. An open-ended "older
//      than three hours" would re-match every abandoned order forever and
//      eventually outlive the dedupe row that stops the resend.

import test, { describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { assertDisposableDatabase } from "./helpers.js";
import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { runTick, takeLease } from "../lib/core/scheduler.js";
import * as cartReminder from "../lib/core/campaigns/cart-reminder.js";

assertDisposableDatabase();

const env = getEnv();
let collections;

const MARK = `sched-test-${Date.now()}`;

// Configured enough for the campaign to run, junk enough that a send would
// fail loudly rather than reach a real handset. Nothing in this file sends:
// every campaign call below is a dry run.
const DRY_ENV = {
  ...env,
  appBaseUrl: "https://app.parktag.me",
  metaWhatsappPhoneNumberId: "test-phone-id",
  metaWhatsappAccessToken: "test-token"
};

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

async function seedOrder(hours, extra = {}) {
  const order = {
    orderId: `${MARK}-${hours}h-${Math.random().toString(36).slice(2, 8)}`,
    orderNumber: `PT-TEST-${hours}`,
    status: "created",
    productName: "ParkTag Premium",
    ownerId: null,
    // An ISO STRING, matching what routes/shop/index.js actually writes. A Date
    // here would make this test pass against a query that finds nothing in
    // production, which is the exact bug the campaign's own comment warns about.
    createdAt: hoursAgo(hours),
    shippingAddress: { fullName: "Test Buyer", phone: "+919812345678" },
    testMarker: MARK,
    ...extra
  };
  await collections.shopOrders.insertOne(order);
  return order;
}

before(async () => {
  collections = await getCollections(env);
});

beforeEach(async () => {
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await collections.counters.deleteOne({ _id: "scheduler-lease" });
});

after(async () => {
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await collections.counters.deleteOne({ _id: "scheduler-lease" });
  await closeMongoConnection();
});

describe("only one instance ticks", () => {
  // Driven through takeLease rather than runTick on purpose.
  //
  // The first version of this raced two whole runTick calls and failed, because
  // an empty tick finishes and hands its lease back before the other one asks
  // for it. That is a stopwatch reading, not a concurrency property: it would
  // pass or fail on how fast the campaigns happened to be. These three cases
  // are the mechanism itself.

  test("three concurrent claims, exactly one winner", async () => {
    // Railway runs more than one replica, and they all boot at once on a
    // deploy. Without exclusivity every campaign query runs N times a tick.
    const now = new Date();
    const claims = await Promise.all([
      takeLease(collections, now),
      takeLease(collections, now),
      takeLease(collections, now)
    ]);

    assert.equal(claims.filter(Boolean).length, 1, "more than one instance holds the lease");
  });

  test("a live lease refuses the next caller", async () => {
    assert.equal(await takeLease(collections, new Date()), true);
    assert.equal(await takeLease(collections, new Date()), false, "a held lease was handed out twice");
  });

  test("an expired lease is reclaimed", async () => {
    // The other half. A lease that could not be reclaimed would mean one
    // crashed container stops every campaign forever.
    await takeLease(collections, new Date());
    await collections.counters.updateOne({ _id: "scheduler-lease" }, { $set: { expiresAt: new Date(0) } });

    assert.equal(await takeLease(collections, new Date()), true, "a dead instance locked the scheduler out");
  });

  test("a completed tick hands its lease back", async () => {
    // Held to its full ten minutes after a clean run, a lease would idle the
    // service for forty ticks after every deploy.
    assert.equal((await runTick(env, null)).ran, true);
    assert.equal((await runTick(env, null)).ran, true, "a completed tick kept its lease");
  });
});

describe("cart-reminder needs consent now that it is MARKETING", () => {
  test("an order with no consent is refused, not sent", async () => {
    // The template was reclassified UTILITY -> MARKETING at re-review. This
    // campaign shipped with no consent check because it was built against the
    // old classification, so this is the assertion that stops it going out
    // again if somebody restores the old behaviour.
    await seedOrder(4);

    const result = await cartReminder.run(DRY_ENV, collections, {
      now: new Date(), limit: 50, dryRun: true, log: null
    });

    assert.equal(result.wouldSend, 0, "a marketing message was selected with no consent on file");
    assert.equal(result.refusedForConsent, 1, "the refusal was not counted, so a silent zero hides it");
  });

  test("an order carrying consent is selected", async () => {
    await seedOrder(4, { marketingOptInAt: new Date().toISOString() });

    const result = await cartReminder.run(DRY_ENV, collections, {
      now: new Date(), limit: 50, dryRun: true, log: null
    });

    assert.equal(result.wouldSend, 1, "a consented buyer was refused");
  });
});

describe("a dry run is genuinely inert", () => {
  test("it selects the order and sends nothing", async () => {
    await seedOrder(4, { marketingOptInAt: new Date().toISOString() });

    const before = await collections.messages.countDocuments({ campaign: "cart-reminder" });

    const result = await cartReminder.run(DRY_ENV, collections, {
      now: new Date(),
      limit: 50,
      dryRun: true,
      log: null
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.wouldSend, 1, "the dry run did not find the abandoned order");
    assert.equal(result.sent, 0, "a dry run reported sends");

    const after = await collections.messages.countDocuments({ campaign: "cart-reminder" });
    assert.equal(after, before, "a dry run wrote to the message log");
  });
});

describe("the cart-reminder window is bounded at both ends", () => {
  test("too new is not selected", async () => {
    // Somebody one hour in may still be on the Razorpay sheet. Messaging them
    // mid-payment is the worst possible moment to say the payment failed.
    await seedOrder(1, { marketingOptInAt: new Date().toISOString() });

    const result = await cartReminder.run(DRY_ENV, collections, {
      now: new Date(), limit: 50, dryRun: true, log: null
    });

    assert.equal(result.wouldSend, 0, "an order still in checkout was selected");
  });

  test("too old is not selected", async () => {
    // THE containment property. If this ever passes with an order from last
    // week, the query has become open-ended and every abandoned order in
    // history is a candidate on every tick.
    await seedOrder(48, { marketingOptInAt: new Date().toISOString() });

    const result = await cartReminder.run(DRY_ENV, collections, {
      now: new Date(), limit: 50, dryRun: true, log: null
    });

    assert.equal(result.wouldSend, 0, "the window is open-ended, so old orders re-match forever");
  });

  test("a paid order is never chased", async () => {
    await seedOrder(4, { status: "paid", marketingOptInAt: new Date().toISOString() });

    const result = await cartReminder.run(DRY_ENV, collections, {
      now: new Date(), limit: 50, dryRun: true, log: null
    });

    assert.equal(result.wouldSend, 0, "a paying customer was told their payment failed");
  });

  test("an order with no phone number is skipped, not crashed on", async () => {
    await seedOrder(4, { shippingAddress: { fullName: "No Phone" }, marketingOptInAt: new Date().toISOString() });

    const result = await cartReminder.run(DRY_ENV, collections, {
      now: new Date(), limit: 50, dryRun: true, log: null
    });

    assert.equal(result.wouldSend, 0);
  });

  test("the campaign stands down when WhatsApp is not configured", async () => {
    await seedOrder(4);

    const result = await cartReminder.run(
      { ...DRY_ENV, metaWhatsappAccessToken: "", metaWhatsappPhoneNumberId: "" },
      collections,
      { now: new Date(), limit: 50, dryRun: true, log: null }
    );

    assert.equal(result.skipped, "not-configured");
    assert.equal(result.sent, 0);
  });
});
