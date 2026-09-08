// A test run may not spend money or message the public.
//
// WHY THIS SUITE EXISTS.
//
// The Delhivery wallet reached MINUS Rs 660 in a week where nobody bought
// anything: 39 shipments, all 50gm, all "Shipment Manifested", none of them
// matching any order in the database. They were the test suite. Suites that
// reach fulfilPaidOrder or place-cod booked real, billable courier shipments
// and then deleted their own order rows in beforeEach, so the evidence only
// existed on a courier invoice.
//
// The same path sent WhatsApp. guest-checkout.test.js blanks the Razorpay keys
// and not the Meta ones, and its fixture address carries 9812345678 — a real
// Indian mobile belonging to a stranger — so every run sent them an order
// confirmation from the number that also carries ParkTag's login codes.
//
// helpers.js documents this hazard at length and offers
// assertUndeliverableIdentifier. The suite that caused it simply never called
// it. That is the point: per-test discipline had already been tried, and it
// failed silently for weeks. The guard is now a choke point, and this suite is
// what stops somebody removing it.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { isDisposableRun, refuseInTestRun } from "../lib/core/external-guard.js";
import { createShipment } from "../lib/integrations/delhivery.js";
import { sendMetaWhatsappOrderUpdate } from "../lib/integrations/meta.js";

// A fully configured environment, exactly as a developer's .env is. The whole
// hazard is that these values are REAL on the machine running the tests.
const LIVE_LOOKING = {
  mongoCollectionPrefix: "test_",
  delhiveryApiKey: "a-real-looking-key",
  delhiveryPickupLocation: "ParkTag",
  delhiveryBaseUrl: "https://track.delhivery.com",
  metaWhatsappPhoneNumberId: "123456789",
  metaWhatsappAccessToken: "a-real-looking-token"
};

describe("recognising a throwaway run", () => {
  test("test_ and ci_ prefixes are disposable", () => {
    for (const prefix of ["test_", "TEST_", "ci_", "ci-", "test-"]) {
      assert.equal(isDisposableRun({ mongoCollectionPrefix: prefix }), true, `${prefix} was not recognised`);
    }
  });

  test("real prefixes are not", () => {
    // dev_ is a developer's own data but it is REAL: the Delhivery key and the
    // Meta token beside it are live, and a shipment booked from a dev run costs
    // exactly as much as one booked from production.
    for (const prefix of ["dev_", "prod_", "", "staging_", "latest_"]) {
      assert.equal(
        isDisposableRun({ mongoCollectionPrefix: prefix }),
        false,
        `${JSON.stringify(prefix)} was treated as throwaway, which would disable the real integration`
      );
    }
    assert.equal(isDisposableRun(null), false);
    assert.equal(isDisposableRun({}), false);
  });
});

describe("the guard refuses the calls that cost", () => {
  test("booking a shipment throws rather than reaching Delhivery", async () => {
    // If this ever stops throwing, every run of the shop suites books parcels
    // a courier will try to collect.
    await assert.rejects(
      () =>
        createShipment(LIVE_LOOKING, {
          orderId: "order_guest_deadbeef",
          address: { fullName: "QA", phone: "9812345678", line1: "1", city: "Delhi", state: "Delhi", pincode: "110001" },
          productName: "ParkTag Car Tag",
          codAmountPaise: 0
        }),
      (err) => {
        assert.equal(err.refusedByTestGuard, true, "the call was attempted for real");
        assert.match(err.message, /Delhivery/);
        return true;
      }
    );
  });

  test("sending a template throws rather than reaching a handset", async () => {
    await assert.rejects(
      () =>
        sendMetaWhatsappOrderUpdate(LIVE_LOOKING, {
          to: "9812345678",
          name: "QA",
          orderNumber: "PT-QA-000001",
          status: "Confirmed and being packed"
        }),
      (err) => {
        assert.equal(err.refusedByTestGuard, true, "a real WhatsApp message was sent to the fixture number");
        return true;
      }
    );
  });

  test("a real run is left alone", () => {
    // The guard must not disable the integration in production. It refuses on
    // the prefix and on nothing else.
    assert.doesNotThrow(() => refuseInTestRun({ mongoCollectionPrefix: "prod_" }, "anything"));
    assert.doesNotThrow(() => refuseInTestRun({ mongoCollectionPrefix: "dev_" }, "anything"));
    assert.doesNotThrow(() => refuseInTestRun({}, "anything"));
  });
});

describe("the refusal behaves like an outage, not a crash", () => {
  test("it throws an Error the existing best-effort handlers already catch", () => {
    // Both call sites wrap these providers in try/catch and treat a failure as
    // "the provider is down": the shipment error is recorded on the order for
    // retry, and the notification senders log and carry on. So a throw here is
    // absorbed by paths that are already tested, which is why the guard throws
    // rather than faking a success. A fake success would leave a test asserting
    // against a shipment that does not exist.
    try {
      refuseInTestRun({ mongoCollectionPrefix: "test_" }, "Booking a Delhivery shipment");
      assert.fail("the guard did not refuse");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.match(err.message, /test run/);
      assert.match(err.message, /external-guard/, "the message does not say where to look");
    }
  });
});
