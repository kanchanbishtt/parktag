// What the recall bar on /get is allowed to claim.
//
// The bar remembers a guest's order number on their device, because a guest
// has no account to look it up in. It was shown whenever /track-order
// recognised the order, always with the same sentence — "Your ParkTag order is
// on its way" — and the rows live for 60 days while delivery takes a few. So
// for about eight weeks after the sticker arrived it went on saying the order
// was travelling, and the page it linked to said "Delivered". The response
// already carried the status; the bar simply never read it.
//
// Tested as rules rather than through a browser: these are decisions about
// what is TRUE to say, and none of them need a DOM.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  HEADLINE_CONFIRMED,
  HEADLINE_DELIVERED,
  HEADLINE_ON_ITS_WAY,
  RECALL_DELIVERED_MS,
  RECALL_STALE_MS,
  headlineFor,
  isDeliveredStatus,
  missIsStale,
  recallDecision
} from "../../frontend/scripts/get-recall.js";

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);
const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();

describe("what the bar says", () => {
  test("an order that has not shipped is 'confirmed', not 'on its way'", () => {
    // These three are OUR synthesised statuses, and none of them mean moving.
    for (const status of ["processing", "cod_confirmed", "booking_failed"]) {
      assert.equal(headlineFor(status), HEADLINE_CONFIRMED, `wrong headline for ${status}`);
    }
  });

  test("a booked or in-transit order is 'on its way'", () => {
    for (const status of ["booked", "In Transit", "Dispatched", "Out for delivery"]) {
      assert.equal(headlineFor(status), HEADLINE_ON_ITS_WAY, `wrong headline for ${status}`);
    }
  });

  test("a delivered order says so", () => {
    assert.equal(headlineFor("Delivered"), HEADLINE_DELIVERED);
  });

  test("an unknown courier status falls back to 'on its way' rather than nothing", () => {
    // A status we have never seen still means the courier has it.
    assert.equal(headlineFor("Reached destination hub"), HEADLINE_ON_ITS_WAY);
  });

  test("a missing status does not produce an empty bar", () => {
    for (const status of [undefined, null, ""]) {
      assert.ok(headlineFor(status).length > 0);
    }
  });
});

describe("'delivered' must not match 'undelivered'", () => {
  test("only an exact delivered status counts", () => {
    assert.equal(isDeliveredStatus("Delivered"), true);
    assert.equal(isDeliveredStatus("delivered"), true);
    assert.equal(isDeliveredStatus("  DELIVERED  "), true);
  });

  test("a failed delivery attempt is not a delivery", () => {
    // The trap: /delivered/i matches every one of these, which would announce
    // a failed attempt — or a parcel on its way back to us — as an arrival.
    for (const status of ["Undelivered", "UNDELIVERED", "Not Delivered", "RTO Undelivered"]) {
      assert.equal(isDeliveredStatus(status), false, `${status} was read as delivered`);
    }
    assert.notEqual(headlineFor("Undelivered"), HEADLINE_DELIVERED);
  });
});

describe("when the bar should be there at all", () => {
  test("an order in transit is always shown", () => {
    const decision = recallDecision({ shippingStatus: "In Transit", orderedAt: iso(NOW - 30 * DAY) }, NOW);
    assert.equal(decision.show, true);
    assert.equal(decision.headline, HEADLINE_ON_ITS_WAY);
  });

  test("a just-delivered order is still shown — that is when it is wanted", () => {
    const decision = recallDecision(
      { shippingStatus: "Delivered", statusDateTime: iso(NOW - 2 * DAY) },
      NOW
    );
    assert.equal(decision.show, true);
    assert.equal(decision.headline, HEADLINE_DELIVERED);
  });

  test("a delivery older than the window is dropped", () => {
    // This is the bug: before, this case rendered "is on its way" for the rest
    // of the row's 60-day life.
    const decision = recallDecision(
      { shippingStatus: "Delivered", statusDateTime: iso(NOW - (RECALL_DELIVERED_MS + DAY)) },
      NOW
    );
    assert.equal(decision.show, false, "an old delivery is still occupying the bar");
  });

  test("the window is measured from delivery, not from the order date", () => {
    // Ordered long ago, delivered yesterday: still worth showing.
    const decision = recallDecision(
      {
        shippingStatus: "Delivered",
        orderedAt: iso(NOW - 40 * DAY),
        statusDateTime: iso(NOW - DAY)
      },
      NOW
    );
    assert.equal(decision.show, true, "a recent delivery was judged by its order date");
  });

  test("with no delivery date it falls back to the order date", () => {
    const stale = recallDecision(
      { shippingStatus: "Delivered", orderedAt: iso(NOW - 40 * DAY) },
      NOW
    );
    assert.equal(stale.show, false);

    const fresh = recallDecision(
      { shippingStatus: "Delivered", orderedAt: iso(NOW - DAY) },
      NOW
    );
    assert.equal(fresh.show, true);
  });

  test("an undated delivery is shown rather than hidden", () => {
    // "was delivered" is still true, which is the property that matters; the
    // row expires on its own. Hiding would cost the buyer their tracking link
    // on the strength of a missing field.
    const decision = recallDecision({ shippingStatus: "Delivered" }, NOW);
    assert.equal(decision.show, true);
    assert.equal(decision.headline, HEADLINE_DELIVERED);
  });

  test("an unparseable date is treated as no date, not as 1970", () => {
    const decision = recallDecision(
      { shippingStatus: "Delivered", statusDateTime: "not a date" },
      NOW
    );
    assert.equal(decision.show, true, "a junk timestamp hid a delivered order");
  });

  test("no order means no bar", () => {
    assert.equal(recallDecision(null, NOW).show, false);
    assert.equal(recallDecision(undefined, NOW).show, false);
  });
});

describe("giving up on an order that was never paid for", () => {
  test("a fresh miss is retried — the webhook may simply be late", () => {
    // Deleting here would throw away the buyer's only copy of the number at
    // the exact moment it matters most.
    assert.equal(missIsStale({ n: "PT1", t: NOW - 60e3 }, NOW), false);
    assert.equal(missIsStale({ n: "PT1", t: NOW - RECALL_STALE_MS + 60e3 }, NOW), false);
  });

  test("a miss past the window is an abandoned checkout", () => {
    assert.equal(missIsStale({ n: "PT1", t: NOW - (RECALL_STALE_MS + 60e3) }, NOW), true);
  });

  test("a row with no timestamp is not kept forever", () => {
    assert.equal(missIsStale({ n: "PT1" }, NOW), true);
    assert.equal(missIsStale({}, NOW), true);
    assert.equal(missIsStale(null, NOW), true);
  });
});
