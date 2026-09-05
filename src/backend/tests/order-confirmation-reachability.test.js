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

// Both channels, and neither able to silence the other.
//
// The confirmation used to send the e-mail and RETURN, reaching WhatsApp only
// for a buyer who had no address on file. Two things changed: it now attempts
// both, and it attempts them at the same time rather than one after the other.
//
// The ordering is not what these pin — a stopwatch in a test suite measures the
// machine it runs on. What they pin is the property parallelising had to
// preserve: each channel absorbs its own failure, so a dead provider costs its
// own message and nothing else. That is exactly what the old early-return could
// not express, and it is the shape a future edit is most likely to undo.
//
// `global.fetch` is stubbed rather than the environment blanked: these need the
// WhatsApp branch to actually run, which the module-level blanking above is
// specifically designed to prevent.
describe("both channels are tried, independently", () => {
  const WHATSAPP_ENV = {
    runtimeMode: "development",
    metaWhatsappPhoneNumberId: "PNID",
    metaWhatsappAccessToken: "token",
    appBaseUrl: "https://www.parktag.me",
    delhiveryBaseUrl: "https://track.delhivery.com"
  };

  const realFetch = global.fetch;
  let sends;

  function stubFetch({ fails }) {
    sends = [];
    global.fetch = async (url, opts) => {
      sends.push(JSON.parse(opts.body));
      return {
        ok: !fails,
        status: fails ? 400 : 200,
        async json() {
          return fails ? { error: { message: "provider is down" } } : { messages: [{ id: "wamid.T" }] };
        },
        async text() { return "{}"; }
      };
    };
  }

  test("an owner with an e-mail is ALSO messaged on WhatsApp", async () => {
    stubFetch({ fails: false });
    try {
      const log = stubLog();
      await sendOrderConfirmation(
        WHATSAPP_ENV,
        stubCollections({ _id: "abc", email: "qa@example.invalid", displayName: "QA Tester" }),
        "abc",
        DETAILS,
        log
      );

      assert.equal(sends.length, 1, "having an e-mail suppressed the WhatsApp");
      assert.equal(sends[0].template.name, "parktag_order_update_v2");
      assert.deepEqual(log.errors, []);
    } finally {
      global.fetch = realFetch;
    }
  });

  test("a dead WhatsApp provider does not make a delivered e-mail count as unreachable", async () => {
    stubFetch({ fails: true });
    try {
      const log = stubLog();
      await sendOrderConfirmation(
        WHATSAPP_ENV,
        stubCollections({ _id: "abc", email: "qa@example.invalid" }),
        "abc",
        DETAILS,
        log
      );

      assert.ok(
        log.errors.some(e => /WhatsApp failed/.test(e.msg || "")),
        "the WhatsApp failure went unlogged"
      );
      assert.ok(
        !log.errors.some(e => e.obj?.event === "order-confirmation-undeliverable"),
        "reported undeliverable even though the e-mail was delivered"
      );
    } finally {
      global.fetch = realFetch;
    }
  });

  test("a guest is still messaged when only WhatsApp is possible", async () => {
    stubFetch({ fails: false });
    try {
      const log = stubLog();
      await sendOrderConfirmation(WHATSAPP_ENV, stubCollections(), null, DETAILS, log);

      assert.equal(sends.length, 1);
      assert.deepEqual(log.errors, [], "a reachable guest was reported unreachable");
    } finally {
      global.fetch = realFetch;
    }
  });

  test("when BOTH channels fail the buyer is still reported unreachable", async () => {
    stubFetch({ fails: true });
    try {
      const log = stubLog();
      // No e-mail on the owner and a dead provider: nothing got through.
      await sendOrderConfirmation(WHATSAPP_ENV, stubCollections({ _id: "abc" }), "abc", DETAILS, log);

      assert.ok(
        log.errors.some(e => e.obj?.event === "order-confirmation-undeliverable"),
        "both channels failed and nobody was told"
      );
    } finally {
      global.fetch = realFetch;
    }
  });
});

// Who the message greets.
//
// Sign-in asks for a phone number or an e-mail and never for a name, so most
// owners have no displayName at all — and the OTP and Firebase paths used to
// write the identifier itself into that field, which is why it cannot simply be
// read. resolveOwnerName has always taken a delivery address as its second
// source for exactly this reason, and this caller was not passing one: the name
// the buyer had typed for the courier, on this very order, sat one field away
// from the phone number that WAS being passed.
//
// The negatives matter as much as the greeting. The name field is free text on
// a public form, and a Meta template cannot be edited after it is sent.
describe("the name on the message", () => {
  const WHATSAPP_ENV = {
    runtimeMode: "development",
    metaWhatsappPhoneNumberId: "PNID",
    metaWhatsappAccessToken: "token",
    appBaseUrl: "https://www.parktag.me",
    delhiveryBaseUrl: "https://track.delhivery.com"
  };

  const realFetch = global.fetch;

  async function greeting(owner, deliveryName) {
    let body = null;
    global.fetch = async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200, async json() { return { messages: [{ id: "w" }] }; }, async text() { return "{}"; } };
    };
    try {
      await sendOrderConfirmation(
        WHATSAPP_ENV,
        stubCollections(owner),
        owner ? "abc" : null,
        { ...DETAILS, deliveryName },
        stubLog()
      );
    } finally {
      global.fetch = realFetch;
    }
    return body.template.components.find(c => c.type === "body").parameters[0].text;
  }

  test("a guest is greeted by the name they gave the courier", async () => {
    assert.equal(await greeting(null, "Kanchan Bisht"), "Kanchan");
  });

  test("an owner with no name is greeted by the one on the parcel", async () => {
    assert.equal(await greeting({ _id: "abc", mobile: "+919812345678" }, "Asha Verma"), "Asha");
  });

  test("a name they told us themselves still wins over the courier's", async () => {
    assert.equal(
      await greeting({ _id: "abc", displayName: "Kanchan Bisht", mobile: "+919812345678" }, "K B"),
      "Kanchan"
    );
  });

  // Legacy accounts carry the identifier in displayName. Reading it raw is what
  // produced "Hi 9876500123" in a message nobody can retract.
  test("a phone number stored as a displayName is skipped, not greeted", async () => {
    assert.equal(
      await greeting({ _id: "abc", displayName: "9812345678", mobile: "+919812345678" }, "Asha Verma"),
      "Asha"
    );
  });

  test("a phone number typed into the NAME field is refused", async () => {
    assert.equal(await greeting({ _id: "abc", mobile: "+919812345678" }, "9812345678"), "there");
  });

  test("an e-mail typed into the name field is refused", async () => {
    assert.equal(await greeting({ _id: "abc", mobile: "+919812345678" }, "billing@example.invalid"), "there");
  });

  test("with no name anywhere it is still 'there', never blank", async () => {
    // A blank would be an empty template parameter, which Meta rejects
    // outright — the message would not be sent at all.
    assert.equal(await greeting({ _id: "abc", mobile: "+919812345678" }, null), "there");
  });
});

// The "Track order" button.
//
// The tracking link is a button on the template rather than a line in the body,
// and it points at ParkTag's own /track-order rather than straight at the
// courier. The courier's link only exists once Delhivery has accepted the
// parcel — which is AFTER most confirmations are sent — so the body-link
// version carried a dead link or a placeholder on exactly the message that
// mattered most. /track-order answers before a waybill exists and shows the
// live scan history after.
//
// What these pin is the parameter: Meta appends it to the URL approved with the
// template, so it must be the order NUMBER. Sending a whole link there would
// produce a URL with a link glued onto its query string, and nothing would
// fail — the message sends, the button is simply broken for the person who
// taps it.
describe("the track order button", () => {
  const WHATSAPP_ENV = {
    runtimeMode: "development",
    metaWhatsappPhoneNumberId: "PNID",
    metaWhatsappAccessToken: "token",
    appBaseUrl: "https://www.parktag.me",
    delhiveryBaseUrl: "https://track.delhivery.com"
  };

  const realFetch = global.fetch;

  async function sent(details) {
    let body = null;
    global.fetch = async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200, async json() { return { messages: [{ id: "w" }] }; }, async text() { return "{}"; } };
    };
    try {
      await sendOrderConfirmation(WHATSAPP_ENV, stubCollections(), null, { ...DETAILS, ...details }, stubLog());
    } finally {
      global.fetch = realFetch;
    }
    return body;
  }

  test("every confirmation carries the button", async () => {
    const body = await sent({});
    const button = body.template.components.find(c => c.type === "button");
    assert.ok(button, "no button was attached");
    assert.equal(button.sub_type, "url");
    assert.equal(button.index, "0");
  });

  test("its parameter is the order number, not a link", async () => {
    const body = await sent({ orderNumber: "PT-260905-00042" });
    const button = body.template.components.find(c => c.type === "button");
    assert.equal(button.parameters[0].text, "PT-260905-00042");
    assert.ok(
      !/^https?:/i.test(button.parameters[0].text),
      "a whole URL was passed where Meta expects only the suffix"
    );
  });

  // The case the body-link version could not serve: nothing has shipped, so
  // there is no courier URL in existence, and the button must still work.
  test("it is present before a waybill exists", async () => {
    const body = await sent({ waybill: null, cod: true });
    const button = body.template.components.find(c => c.type === "button");
    assert.ok(button, "the pre-shipment confirmation lost its button");
    assert.equal(button.parameters[0].text, DETAILS.orderNumber);
  });

  // Meta rejects an empty template parameter outright, and a button parameter
  // is no different — the whole message fails to send, behind a payment that
  // already succeeded.
  test("the parameter is never blank", async () => {
    const body = await sent({});
    const button = body.template.components.find(c => c.type === "button");
    assert.ok(button.parameters[0].text.length > 0);
  });

  test("the body no longer carries a link of its own", async () => {
    const body = await sent({});
    const params = body.template.components.find(c => c.type === "body").parameters;
    assert.equal(params.length, 3, "the body should be name, order number and status");
    assert.ok(
      !params.some(p => /^https?:/i.test(p.text)),
      "a link is still being sent in the body as well as the button"
    );
  });
});
