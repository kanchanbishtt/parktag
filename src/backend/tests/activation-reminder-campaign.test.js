// The activation-reminder campaign: cohort selection and the dormant-until-live
// safety gate. No real database and no network — `collections` is a hand-rolled
// fake, so what is pinned is the logic that would otherwise only show up in
// production: selecting a delivered order whose buyer never activated, skipping
// one who did, and claiming NO dedupe row while the template switch is off (the
// mistake that would silently burn every order once, because sendOnce() never
// retries). The window math and the live send go through the shared scheduler +
// message-log, covered elsewhere and needing a mongod we do not have here.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import * as activationReminder from "../lib/core/campaigns/activation-reminder.js";
import { CAMPAIGNS } from "../lib/core/campaigns/index.js";

const META_ENV = {
  metaWhatsappPhoneNumberId: "pn-test",
  metaWhatsappAccessToken: "tok-test"
};

// A fake `collections` that serves one delivered order and lets each test say
// whether its buyer already has an active tag. `messages.insertOne` throws so
// any accidental sendOnce() claim fails the test loudly.
function fakeCollections({ orders = [], owner = null, activeTags = 0 } = {}) {
  let messagesTouched = false;
  return {
    _messagesTouched: () => messagesTouched,
    shopOrders: {
      find: () => ({ limit: () => ({ toArray: async () => orders }) })
    },
    owners: { findOne: async () => owner },
    tags: { countDocuments: async () => activeTags },
    messages: {
      insertOne: async () => {
        messagesTouched = true;
        throw new Error("sendOnce must not run while the campaign is dormant");
      }
    }
  };
}

const DELIVERED_ORDER = {
  _id: "order1",
  orderId: "ord_1",
  orderNumber: "PT-1",
  status: "paid",
  deliveredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  productName: "Car Tag (Pack of 2)",
  shippingAddress: { phone: "+91 98765 43210", fullName: "Asha Rao" }
};

describe("activation-reminder campaign", () => {
  test("has the expected id and is registered in the scheduler", () => {
    assert.equal(activationReminder.id, "activation-reminder");
    assert.ok(CAMPAIGNS.some((c) => c.id === "activation-reminder"), "not wired into CAMPAIGNS");
  });

  test("no-ops when WhatsApp is not configured (never touches the DB)", async () => {
    const result = await activationReminder.run({}, fakeCollections(), { now: new Date(), limit: 50 });
    assert.deepEqual(result, { sent: 0, skipped: "not-configured" });
  });

  test("selects a delivered order whose buyer never activated, but stays dormant (no send) while the switch is off", async () => {
    const collections = fakeCollections({ orders: [DELIVERED_ORDER], owner: null, activeTags: 0 });
    const result = await activationReminder.run(
      { ...META_ENV, activationRemindersEnabled: false },
      collections,
      { now: new Date(), limit: 50 }
    );
    assert.equal(result.selected, 1, "the un-activated delivered order should be selected");
    assert.equal(result.sent, 0, "nothing sends while the switch is off");
    assert.equal(collections._messagesTouched(), false, "no dedupe row may be claimed while dormant");
  });

  test("skips a buyer who already has an active tag", async () => {
    const collections = fakeCollections({
      orders: [DELIVERED_ORDER],
      owner: { _id: "owner1" },
      activeTags: 1
    });
    const result = await activationReminder.run(
      { ...META_ENV, activationRemindersEnabled: true },
      collections,
      { now: new Date(), limit: 50 }
    );
    assert.equal(result.alreadyActive, 1);
    assert.equal(result.selected, 0, "an activated buyer must not be selected");
    assert.equal(result.sent, 0);
  });

  test("dryRun selects but never sends, even with the switch on", async () => {
    const collections = fakeCollections({ orders: [DELIVERED_ORDER], owner: null, activeTags: 0 });
    const result = await activationReminder.run(
      { ...META_ENV, activationRemindersEnabled: true },
      collections,
      { now: new Date(), limit: 50, dryRun: true }
    );
    assert.equal(result.selected, 1);
    assert.equal(result.sent, 0);
    assert.equal(collections._messagesTouched(), false);
  });
});
