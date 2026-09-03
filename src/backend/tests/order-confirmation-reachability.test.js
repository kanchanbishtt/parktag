// Telling the buyer their order exists — and saying so when we cannot.
//
// A guest order has no account behind it and the /get form collects no e-mail,
// so the confirmation carrying the order number is a WhatsApp to the delivery
// phone. When Meta is not configured that message is never sent, and this
// function used to fall out of its own bottom in silence: the order was paid,
// the tag was minted, the parcel shipped, and nobody had told the buyer
// anything. If they had closed the tab during payment they had never seen the
// order number either, so they could not even look it up.
//
// Nothing about that looked wrong from the server. It surfaced as a support
// ticket, which is the same shape of silent loss the Razorpay webhook secret
// had. So the last branch is an ERROR naming the order and the reason.
//
// Deliberately NOT a database test. Every branch here is decided by the
// arguments, and the collections are reduced to the single lookup this makes —
// which keeps the case that matters (nobody is reachable) runnable on any
// machine, including one whose cluster is full.

// Before the module is imported: a developer .env points at the LIVE Meta
// account, and the WhatsApp branch below would message whoever really owns the
// number in the fixture. Blanked here so that branch is unreachable, and
// asserted in the suite rather than assumed.
process.env.META_WHATSAPP_ACCESS_TOKEN = "";
process.env.META_WHATSAPP_PHONE_NUMBER_ID = "";

import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { sendOrderConfirmation } from "../lib/core/order-fulfilment.js";
import { isMetaWhatsappConfigured } from "../lib/integrations/meta.js";

// Only the one call sendOrderConfirmation makes. `found` is what the owners
// lookup returns; `calls` records that it happened at all, which is how the
// guest case proves it does not bother asking.
function stubCollections(found = null) {
  const calls = [];
  return {
    calls,
    owners: {
      async findOne(filter) { calls.push(filter); return found; }
    }
  };
}

// pino's shape, reduced to the level this asserts on.
function stubLog() {
  const errors = [];
  return { errors, error: (obj, msg) => errors.push({ obj, msg }) };
}

const UNREACHABLE_ENV = {
  runtimeMode: "development",
  metaWhatsappPhoneNumberId: "",
  metaWhatsappAccessToken: "",
  delhiveryBaseUrl: "https://track.delhivery.com"
};

const DETAILS = {
  orderNumber: "PT-260903-00042",
  productName: "ParkTag Car Tag (Pack of 2)",
  amountPaise: 49900,
  cod: false,
  waybill: null,
  deliveryPhone: "9812345678"
};

describe("a paid order nobody can be told about", () => {
  beforeEach(() => {
    // The fixture's safety rests on this being false. If a stray environment
    // ever made it true, the WhatsApp branch would fire at a real handset.
    assert.equal(
      isMetaWhatsappConfigured(UNREACHABLE_ENV),
      false,
      "the test environment would send a real WhatsApp message"
    );
  });

  test("it is reported as an error rather than passed over", async () => {
    const log = stubLog();
    await sendOrderConfirmation(UNREACHABLE_ENV, stubCollections(), null, DETAILS, log);

    assert.equal(log.errors.length, 1, "a buyer went untold and nothing was logged");
    assert.match(log.errors[0].msg, /PAID order could not be confirmed/);
  });

  test("the log names the order, so it can be acted on", async () => {
    const log = stubLog();
    await sendOrderConfirmation(UNREACHABLE_ENV, stubCollections(), null, DETAILS, log);

    assert.equal(log.errors[0].obj.event, "order-confirmation-undeliverable");
    assert.equal(log.errors[0].obj.orderNumber, "PT-260903-00042");
  });

  // Which of the three reasons it was decides what the operator does next:
  // configure Meta, or chase an order that arrived without a phone number.
  test("...and why nobody was reached", async () => {
    const log = stubLog();
    await sendOrderConfirmation(UNREACHABLE_ENV, stubCollections(), null, DETAILS, log);

    assert.deepEqual(
      {
        guest: log.errors[0].obj.guest,
        hasEmail: log.errors[0].obj.hasEmail,
        hasDeliveryPhone: log.errors[0].obj.hasDeliveryPhone,
        whatsappConfigured: log.errors[0].obj.whatsappConfigured
      },
      { guest: true, hasEmail: false, hasDeliveryPhone: true, whatsappConfigured: false }
    );
  });

  // A guest order's ownerId is null. Looking an owner up by it can only ever
  // miss, and `{ _id: null }` is a query that reads as if it might match
  // something.
  test("a guest order does not look for an owner it cannot have", async () => {
    const collections = stubCollections();
    await sendOrderConfirmation(UNREACHABLE_ENV, collections, null, DETAILS, stubLog());

    assert.deepEqual(collections.calls, [], "queried owners for an order with no owner");
  });

  // The notification is the last thing fulfilment does and the least important:
  // the money is taken and the parcel is booked by this point. A throw here
  // must not propagate into a caller that has already succeeded.
  test("a missing logger is not a crash", async () => {
    await sendOrderConfirmation(UNREACHABLE_ENV, stubCollections(), null, DETAILS, undefined);
    await sendOrderConfirmation(UNREACHABLE_ENV, stubCollections(), null, DETAILS, {});
  });

  test("a broken owners lookup is swallowed, not thrown", async () => {
    const collections = { owners: { async findOne() { throw new Error("mongo is down"); } } };
    await sendOrderConfirmation(UNREACHABLE_ENV, collections, "someone", DETAILS, stubLog());
  });
});

describe("a buyer who can be reached", () => {
  // The owner path is unchanged, and the error must not fire behind a
  // confirmation that was actually sent. In development with no SMTP the e-mail
  // sender logs to the console and returns, which still counts as reached.
  test("an owner with an e-mail is not reported as unreachable", async () => {
    const log = stubLog();
    await sendOrderConfirmation(
      UNREACHABLE_ENV,
      stubCollections({ _id: "abc", email: "qa@example.invalid", displayName: "QA" }),
      "abc",
      DETAILS,
      log
    );

    assert.deepEqual(log.errors, []);
  });

  test("an owner order still looks the owner up", async () => {
    const collections = stubCollections({ _id: "abc", email: "qa@example.invalid" });
    await sendOrderConfirmation(UNREACHABLE_ENV, collections, "abc", DETAILS, stubLog());

    assert.deepEqual(collections.calls, [{ _id: "abc" }]);
  });

  // Not every silence is a fault worth logging: a COD order booked without a
  // phone number has nothing to send to, and that is still worth knowing, so it
  // is reported with hasDeliveryPhone false rather than not at all.
  test("no delivery phone is reported too, with the reason", async () => {
    const log = stubLog();
    await sendOrderConfirmation(
      UNREACHABLE_ENV,
      stubCollections(),
      null,
      { ...DETAILS, deliveryPhone: null },
      log
    );

    assert.equal(log.errors.length, 1);
    assert.equal(log.errors[0].obj.hasDeliveryPhone, false);
  });
});
