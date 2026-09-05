// Telling a buyer their membership went through.
//
// Nothing did, before this. activateMembership extended the tag, logged a line
// for us and returned; the only acknowledgement the buyer got was a dialog in
// the tab they had paid in. The Razorpay webhook — the path that exists
// PRECISELY because that tab may be gone — has no browser to show a dialog to,
// so the buyers most in need of a confirmation were the ones certain not to get
// one.
//
// Two properties matter more than the happy path, and both are asserted here
// without a network or a database: it must fire exactly ONCE per payment
// (Razorpay retries its webhook until it gets a 2xx, and the browser callback
// races it every time), and a buyer it cannot reach must be logged rather than
// passed over — the same rule order-confirmation-reachability.test.js pins for
// the shop.

// Before the module is imported: a developer .env points at the LIVE Meta
// account, and the send below would message whoever really owns the number in
// the fixture. Blanked here so that branch is unreachable, and asserted in the
// suite rather than assumed.
process.env.META_WHATSAPP_ACCESS_TOKEN = "";
process.env.META_WHATSAPP_PHONE_NUMBER_ID = "";

import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { activateMembership } from "../lib/core/membership-fulfilment.js";
import { isMetaWhatsappConfigured } from "../lib/integrations/meta.js";

const UNREACHABLE_ENV = {
  runtimeMode: "development",
  metaWhatsappPhoneNumberId: "",
  metaWhatsappAccessToken: ""
};

const ORDER = {
  orderId: "order_QxMEMBER001",
  ownerId: "owner-1",
  tagId: "tag-1",
  planId: "m12",
  months: 12,
  amount: 24900,
  status: "created"
};

function stubLog() {
  const errors = [];
  const infos = [];
  return {
    errors,
    infos,
    error: (obj, msg) => errors.push({ obj, msg }),
    info: (obj, msg) => infos.push({ obj, msg })
  };
}

// Only the calls activateMembership makes. `claimed` decides whether this
// caller wins the created → paid flip, which is the whole concurrency story.
function stubCollections({ owner = null, claimed = true, tag = { _id: "tag-1" } } = {}) {
  const ownerLookups = [];
  return {
    ownerLookups,
    membershipOrders: {
      async updateOne() { return { modifiedCount: claimed ? 1 : 0 }; },
      async findOne() { return { ...ORDER, status: "paid", currentPeriodEnd: "2027-09-05T00:00:00.000Z" }; }
    },
    tags: {
      async findOne() { return tag; },
      async updateOne() { return { modifiedCount: 1 }; }
    },
    owners: {
      async findOne(filter) { ownerLookups.push(filter); return owner; }
    }
  };
}

describe("confirming a paid membership", () => {
  beforeEach(() => {
    // The fixture's safety rests on this being false. If a stray environment
    // ever made it true, the send would fire at a real handset.
    assert.equal(
      isMetaWhatsappConfigured(UNREACHABLE_ENV),
      false,
      "the test environment would send a real WhatsApp message"
    );
  });

  // The reason the notification lives inside the firstTime branch rather than
  // hanging off the return value at a call site. Razorpay retries until it gets
  // a 2xx; a buyer must not be messaged once per delivery attempt.
  test("a second activation of the same order notifies nobody", async () => {
    const collections = stubCollections({
      claimed: false,
      owner: { _id: "owner-1", mobile: "9812345678" }
    });

    const outcome = await activateMembership(collections, {
      env: UNREACHABLE_ENV,
      order: ORDER,
      paymentId: "pay_1",
      log: stubLog()
    });

    assert.equal(outcome.firstTime, false);
    assert.deepEqual(
      collections.ownerLookups,
      [],
      "looked an owner up for an order somebody else had already claimed"
    );
  });

  // A buyer with an e-mail and no mobile is REACHED now, not reported. That is
  // the whole point of the second channel: this case used to be the silent
  // hole — the WhatsApp path had nothing to send to, logged "undeliverable",
  // and returned, on a membership already paid for.
  test("an e-mail with no mobile is reached, not reported undeliverable", async () => {
    const log = stubLog();
    const collections = stubCollections({ owner: { _id: "owner-1", email: "qa@example.invalid" } });

    await activateMembership(collections, {
      env: { ...UNREACHABLE_ENV, metaWhatsappPhoneNumberId: "x", metaWhatsappAccessToken: "y" },
      order: ORDER,
      paymentId: "pay_1",
      log
    });

    assert.ok(
      !log.errors.some(e => e.obj.event === "membership-confirmation-undeliverable"),
      "an owner with a working e-mail address was written off as unreachable"
    );
  });

  test("a buyer with NEITHER a mobile nor an e-mail is reported", async () => {
    const log = stubLog();
    const collections = stubCollections({ owner: { _id: "owner-1" } });

    await activateMembership(collections, {
      env: { ...UNREACHABLE_ENV, metaWhatsappPhoneNumberId: "x", metaWhatsappAccessToken: "y" },
      order: ORDER,
      paymentId: "pay_1",
      log
    });

    const reported = log.errors.find(e => e.obj.event === "membership-confirmation-undeliverable");
    assert.ok(reported, "a buyer went untold and nothing was logged");
    assert.equal(reported.obj.orderId, ORDER.orderId);
    assert.equal(reported.obj.hasPhone, false);
    assert.equal(reported.obj.hasEmail, false);
    assert.equal(reported.obj.hasEndDate, true);
  });

  // The money is captured and the subscription is already extended by the time
  // the notification runs. An unapproved template or a number that is not on
  // WhatsApp must never propagate into a caller that has already succeeded.
  // Nothing configured and no e-mail: nobody was told, and that IS worth
  // reporting — the same rule sendOrderConfirmation follows. It used to return
  // silently, which is how a buyer goes untold with nothing in the logs to say
  // so. The subscription is still extended either way; the money is real.
  test("with no channel at all it is reported, and still never a throw", async () => {
    const log = stubLog();
    const outcome = await activateMembership(collections0(), {
      env: UNREACHABLE_ENV,
      order: ORDER,
      paymentId: "pay_1",
      log
    });

    assert.equal(outcome.firstTime, true);
    assert.ok(outcome.currentPeriodEnd, "the subscription was still extended");
    assert.ok(
      log.errors.some(e => e.obj.event === "membership-confirmation-undeliverable"),
      "nobody could be told and nothing was logged"
    );
  });

  test("a missing logger is not a crash", async () => {
    await activateMembership(collections0(), { env: UNREACHABLE_ENV, order: ORDER, paymentId: "p" });
    await activateMembership(collections0(), { env: UNREACHABLE_ENV, order: ORDER, paymentId: "p", log: {} });
  });

  // env is threaded from the route down through activateMembership. A caller
  // that forgets it must lose the notification, not the purchase.
  test("a caller that passes no env still activates the membership", async () => {
    const outcome = await activateMembership(collections0(), { order: ORDER, paymentId: "p", log: stubLog() });
    assert.equal(outcome.firstTime, true);
    assert.ok(outcome.currentPeriodEnd);
  });
});

function collections0() {
  return stubCollections({ owner: { _id: "owner-1", mobile: "9812345678" } });
}

// The name on the message.
//
// A membership needs an activated tag, an activated tag came from an order, and
// an order asked for a name to put on the parcel — so a buyer who never filled
// in the dashboard greeting almost always still has a real name on file. It
// just had to be fetched: resolveOwnerName takes the address as its second
// source and this caller was passing none, so every confirmation opened
// "Hi there" while the name sat one indexed read away.
describe("who the membership confirmation greets", () => {
  const CONFIGURED = {
    runtimeMode: "development",
    metaWhatsappPhoneNumberId: "PNID",
    metaWhatsappAccessToken: "token"
  };

  const realFetch = global.fetch;

  async function greeting({ owner, address, addressesMissing = false, addressThrows = false }) {
    let body = null;
    global.fetch = async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200, async json() { return { messages: [{ id: "w" }] }; }, async text() { return "{}"; } };
    };

    const collections = stubCollections({ owner });
    if (addressThrows) {
      collections.addresses = { async findOne() { throw new Error("mongo is down"); } };
    } else if (!addressesMissing) {
      collections.addresses = { async findOne() { return address; } };
    }

    try {
      await activateMembership(collections, {
        env: CONFIGURED,
        order: { ...ORDER, orderId: `order_${Math.random()}` },
        paymentId: "pay_1",
        log: stubLog()
      });
    } finally {
      global.fetch = realFetch;
    }

    return body && body.template.components.find(c => c.type === "body").parameters[0].text;
  }

  test("an owner with no name is greeted by the one on their parcel", async () => {
    const name = await greeting({
      owner: { _id: "owner-1", mobile: "9812345678" },
      address: { fullName: "Asha Verma" }
    });
    assert.equal(name, "Asha");
  });

  test("a name they told us themselves still wins", async () => {
    const name = await greeting({
      owner: { _id: "owner-1", mobile: "9812345678", displayName: "Kanchan Bisht" },
      address: { fullName: "K B" }
    });
    assert.equal(name, "Kanchan");
  });

  test("no address on file is still 'there', never blank", async () => {
    const name = await greeting({ owner: { _id: "owner-1", mobile: "9812345678" }, address: null });
    assert.equal(name, "there");
  });

  // The lookup is a convenience on a message that confirms money already taken.
  // Neither a missing collection nor a database fault may cost the buyer their
  // confirmation.
  test("a missing addresses collection does not stop the confirmation", async () => {
    const name = await greeting({ owner: { _id: "owner-1", mobile: "9812345678" }, addressesMissing: true });
    assert.equal(name, "there");
  });

  test("a throwing address lookup does not stop the confirmation", async () => {
    const name = await greeting({ owner: { _id: "owner-1", mobile: "9812345678" }, addressThrows: true });
    assert.equal(name, "there");
  });
});
