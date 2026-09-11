// A booked waybill is a label. A pickup request is what makes a rider come.
//
// ── Why this suite exists ──────────────────────────────────────────────────
//
// createShipment has always produced a waybill and nothing has ever asked
// Delhivery to collect the parcel. Order PT-260804-00006 died exactly that way:
// label printed on 4 August, no pickup ever requested, parcel never moved. The
// first real customer order, PT-260908-00013 from Thrissur, was sitting in the
// same state when this was written.
//
// ── What is pinned below ───────────────────────────────────────────────────
//
//   1. ONE pickup per warehouse per day, however many orders arrive. Delhivery
//      dispatches a rider to a location on a date; asking three times because
//      three people bought a sticker is either rejected as a duplicate or turns
//      into three van visits. The dedupe is a unique index and a claim-first
//      insert, copied from message-log.js, because a read-then-write check
//      races two orders paid in the same second.
//   2. A pickup failure NEVER fails the order. By the time it runs the money is
//      captured and the label exists; a courier API having a bad minute must
//      not turn into a failed checkout.
//   3. The test guard bites. The suite once booked 39 real billable shipments,
//      and a pickup request is the same class of call.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { requestPickup, nextPickupDate } from "../lib/integrations/delhivery.js";
import { ensurePickupRequested } from "../lib/core/shipping.js";
import { ensureCoreIndexes } from "../lib/db/repositories.js";
import { startTestApp, stopTestApp } from "./helpers.js";

// Configured, and deliberately real-looking: the hazard this file guards is
// that these values are genuine on the machine running the suite.
const ENV = {
  mongoCollectionPrefix: "test_",
  delhiveryApiKey: "a-real-looking-key",
  delhiveryPickupLocation: "ParkTag",
  delhiveryBaseUrl: "https://track.delhivery.com",
  delhiveryPickupTime: "10:00:00"
};

// The same environment with the test-run signal removed, so the guard lets the
// call through and the mocked fetch below can observe it. Nothing here reaches
// the network: every test that gets past the guard replaces globalThis.fetch.
const LIVE = { ...ENV, mongoCollectionPrefix: "prod_" };

let app;
let collections;

before(async () => {
  ({ app, collections } = await startTestApp());
  // startTestApp does not build indexes, and the whole dedupe guarantee below
  // IS the unique index. Without this the suite would pass against a database
  // that happily allows two pickups for the same day.
  await ensureCoreIndexes(collections, null);
});

after(async () => {
  await collections.pickupRequests.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.pickupRequests.deleteMany({});
});

// Swap fetch for the duration of one call and report what it saw.
async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  try {
    const result = await fn();
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

function okResponse(body = { success: true, pickup_id: 987654 }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("the pickup date", () => {
  // Delhivery is asked for the next day rather than today: a parcel booked at
  // 23:50 cannot be handed to a rider who came at 10:00 that morning.
  test("a weekday rolls to the next day", () => {
    // Tuesday 8 September 2026.
    assert.equal(nextPickupDate(new Date("2026-09-08T10:00:00+05:30")), "2026-09-09");
  });

  // The warehouse record lists working_days as all seven including SUN, so a
  // weekend skip would push every Saturday order back a day for nothing.
  test("Saturday goes to Sunday, because the warehouse works Sundays", () => {
    assert.equal(nextPickupDate(new Date("2026-09-12T10:00:00+05:30")), "2026-09-13");
  });

  test("Sunday goes to Monday", () => {
    assert.equal(nextPickupDate(new Date("2026-09-13T10:00:00+05:30")), "2026-09-14");
  });

  // The date is computed in IST, not in the container's timezone. Railway runs
  // UTC, so an order paid at 02:00 IST is still 20:30 the previous day in UTC,
  // and a naive date would request a rider for a day that has already gone.
  test("late-evening UTC is already tomorrow in IST", () => {
    // 20:00 UTC on the 8th is 01:30 IST on the 9th, so the next working day
    // is the 10th and not the 9th.
    assert.equal(nextPickupDate(new Date("2026-09-08T20:00:00Z")), "2026-09-10");
  });
});

describe("the test guard", () => {
  test("a pickup request is refused during a test run", async () => {
    await assert.rejects(
      () => requestPickup(ENV, { pickupDate: "2026-09-09", expectedPackageCount: 1 }),
      (err) => err.refusedByTestGuard === true
    );
  });

  test("nothing reaches the network when it is refused", async () => {
    const { calls } = await withFetch(
      () => okResponse(),
      () => requestPickup(ENV, { pickupDate: "2026-09-09", expectedPackageCount: 1 }).catch(() => null)
    );
    assert.equal(calls.length, 0, "a refused pickup still called out to Delhivery");
  });
});

describe("requesting a pickup", () => {
  test("it posts the location, date, time and count", async () => {
    const { result, calls } = await withFetch(
      () => okResponse(),
      () => requestPickup(LIVE, { pickupDate: "2026-09-09", expectedPackageCount: 3 })
    );

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/fm\/request\/new\//);
    assert.equal(calls[0].init.method, "POST");
    assert.match(calls[0].init.headers.Authorization, /^Token /);

    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.pickup_location, "ParkTag");
    assert.equal(sent.pickup_date, "2026-09-09");
    assert.equal(sent.pickup_time, "10:00:00");
    assert.equal(sent.expected_package_count, 3);

    assert.equal(result.pickupId, "987654");
  });

  test("an unconfigured account does not call out", async () => {
    const { result, calls } = await withFetch(
      () => okResponse(),
      () => requestPickup({ mongoCollectionPrefix: "prod_" }, { pickupDate: "2026-09-09", expectedPackageCount: 1 })
    );
    assert.equal(calls.length, 0);
    assert.equal(result.requested, false);
  });

  // Delhivery answers 200 with a failure body often enough that status alone
  // is not evidence of a dispatched rider.
  test("a 200 carrying a failure is an error, not a success", async () => {
    await assert.rejects(
      () =>
        withFetch(
          () => okResponse({ success: false, error: "pickup already exists" }),
          () => requestPickup(LIVE, { pickupDate: "2026-09-09", expectedPackageCount: 1 })
        ),
      /pickup already exists/
    );
  });

  // The documented 400 for this endpoint puts its whole explanation in
  // `pickup_location`, and it is the likeliest failure on a first deploy:
  // DELHIVERY_PICKUP_LOCATION must match a registered warehouse exactly.
  // A generic "request failed" here would send somebody reading raw JSON.
  test("an unregistered warehouse reports what is actually wrong", async () => {
    await assert.rejects(
      () =>
        withFetch(
          () =>
            new Response(
              JSON.stringify({
                pickup_location: "Invalid Pickup Location ClientWarehouse matching query does not exist."
              }),
              { status: 400, headers: { "content-type": "application/json" } }
            ),
          () => requestPickup(LIVE, { pickupDate: "2026-09-09", expectedPackageCount: 1 })
        ),
      /ClientWarehouse matching query does not exist/
    );
  });

  // Delhivery assigns the slot; the one asked for is only a request. Recording
  // the requested time would tell somebody to be there at the wrong hour.
  test("the slot Delhivery assigns wins over the one requested", async () => {
    const { result } = await withFetch(
      () =>
        okResponse({
          pickup_id: 118775,
          pickup_date: '2026-09-09',
          pickup_time: '16:30:00',
          expected_package_count: 1
        }),
      () => requestPickup(LIVE, { pickupDate: '2026-09-09', expectedPackageCount: 1 })
    );

    assert.equal(result.atTime, '16:30:00', 'the assigned slot was discarded');
    assert.equal(result.forDate, '2026-09-09');
  });
});

describe("one pickup per warehouse per day", () => {
  test("the first order of the day requests a pickup", async () => {
    const { result, calls } = await withFetch(
      () => okResponse(),
      () => ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-09" })
    );

    assert.equal(calls.length, 1);
    assert.equal(result.requested, true);
    assert.equal(await collections.pickupRequests.countDocuments({}), 1);
  });

  // The whole point. Three sales before lunch must not summon three vans.
  test("a second order the same day calls nothing", async () => {
    await withFetch(
      () => okResponse(),
      () => ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-09" })
    );

    const { result, calls } = await withFetch(
      () => okResponse(),
      () => ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-09" })
    );

    assert.equal(calls.length, 0, "a second order the same day called Delhivery again");
    assert.equal(result.requested, false);
    assert.equal(result.reason, "already-requested");
    assert.equal(await collections.pickupRequests.countDocuments({}), 1);
  });

  test("the next day is a different pickup", async () => {
    await withFetch(
      () => okResponse(),
      () => ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-09" })
    );
    const { calls } = await withFetch(
      () => okResponse(),
      () => ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-10" })
    );

    assert.equal(calls.length, 1);
    assert.equal(await collections.pickupRequests.countDocuments({}), 2);
  });

  // Two containers, two orders, the same second. The claim row is inserted
  // before the API call precisely so the database picks the winner.
  test("simultaneous orders produce exactly one request", async () => {
    const original = globalThis.fetch;
    let apiCalls = 0;
    globalThis.fetch = async () => {
      apiCalls += 1;
      return okResponse();
    };
    try {
      await Promise.all([
        ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-11" }),
        ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-11" }),
        ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-11" })
      ]);
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(apiCalls, 1, "a race produced more than one pickup request");
    assert.equal(await collections.pickupRequests.countDocuments({}), 1);
  });
});

describe("a pickup failure is survivable", () => {
  // The money is already captured and the label already exists by this point.
  test("it does not throw", async () => {
    const { result } = await withFetch(
      () => {
        throw new Error("Delhivery is down");
      },
      () => ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-09" })
    );

    assert.equal(result.requested, false);
    assert.match(result.error, /Delhivery is down/);
  });

  // A failed attempt must not leave a claim that blocks every later retry, or
  // one bad minute costs the whole day's dispatch.
  test("a failed attempt does not block a retry", async () => {
    await withFetch(
      () => {
        throw new Error("Delhivery is down");
      },
      () => ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-09" })
    );

    const { result, calls } = await withFetch(
      () => okResponse(),
      () => ensurePickupRequested(LIVE, collections, { pickupDate: "2026-09-09" })
    );

    assert.equal(calls.length, 1, "the retry never reached Delhivery");
    assert.equal(result.requested, true);
  });
});
