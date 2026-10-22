// The daily Amazon pickup sweep. Delhivery One books the Amazon waybills but
// never asks for a rider; this job does, once a day, through the same
// one-per-warehouse-per-day claim website orders use.
//
// Pinned below: it waits for the evening sweep, it asks once however many ticks
// run, a refused request is retried and reported once, and a dead webhook never
// blocks the pickup.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { run } from "../lib/core/campaigns/amazon-pickup.js";
import { ensureCoreIndexes } from "../lib/db/repositories.js";
import { resetAmazonTokenCache } from "../lib/integrations/amazon-sp.js";
import { startTestApp, stopTestApp } from "./helpers.js";

// "prod_" so the test guard lets the mocked fetch through. Nothing reaches the
// network: every case replaces globalThis.fetch.
const LIVE = {
  mongoCollectionPrefix: "prod_",
  delhiveryApiKey: "a-real-looking-key",
  delhiveryPickupLocation: "EDIT TREE B2C",
  delhiveryBaseUrl: "https://track.delhivery.com",
  delhiveryPickupTime: "10:00:00",
  pickupNotifyWebhookUrl: "https://n8n.example/webhook/pickup"
};

// 21:30 IST on 12 Oct 2026, and 15:00 IST the same day.
const EVENING = new Date("2026-10-12T21:30:00+05:30");
const AFTERNOON = new Date("2026-10-12T15:00:00+05:30");

let app;
let collections;

before(async () => {
  ({ app, collections } = await startTestApp());
  await ensureCoreIndexes(collections, null);
});

after(async () => {
  await collections.pickupRequests.deleteMany({}).catch(() => {});
  await collections.counters.deleteOne({ _id: "amazon-pickup-failure-notice" }).catch(() => {});
  await collections.amazonOrders.deleteMany({}).catch(() => {});
  await collections.counters.deleteMany({ _id: { $in: ["amazon-orders-cursor", "amazon-orders-failure-notice"] } }).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.pickupRequests.deleteMany({});
  await collections.counters.deleteOne({ _id: "amazon-pickup-failure-notice" });
  await collections.amazonOrders.deleteMany({});
  await collections.counters.deleteMany({ _id: { $in: ["amazon-orders-cursor", "amazon-orders-failure-notice"] } });
  resetAmazonTokenCache();
});

// Route Delhivery and the webhook separately so each can be made to fail.
async function withNetwork({ pickup, webhook = () => new Response("ok") }, fn) {
  const original = globalThis.fetch;
  const calls = { pickup: [], webhook: [] };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/fm/request/new/")) {
      calls.pickup.push(init);
      return pickup();
    }
    calls.webhook.push(JSON.parse(init.body));
    return webhook();
  };
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const accepted = () =>
  new Response(JSON.stringify({ success: true, pickup_id: 555 }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
const refused = () =>
  new Response(JSON.stringify({ success: false, error: "wallet empty" }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

const ctx = (now, extra = {}) => ({ now, dryRun: false, log: null, ...extra });

describe("amazon pickup sweep", () => {
  test("does nothing before the evening sweep", async () => {
    const { result, calls } = await withNetwork({ pickup: accepted }, () =>
      run(LIVE, collections, ctx(AFTERNOON))
    );
    assert.equal(result.skipped, "before-sweep");
    assert.equal(calls.pickup.length, 0);
  });

  test("asks for tomorrow's pickup and reports it", async () => {
    const { result, calls } = await withNetwork({ pickup: accepted }, () =>
      run(LIVE, collections, ctx(EVENING))
    );
    assert.equal(result.sent, 0);
    assert.equal(JSON.parse(calls.pickup[0].body).pickup_date, "2026-10-13");
    assert.equal(calls.webhook.length, 1);
    assert.equal(calls.webhook[0].outcome, "requested");
    assert.equal(calls.webhook[0].pickupId, "555");
  });

  // Ticks every 15 minutes: the second one must not book a second rider or
  // post to Slack again.
  test("a second tick the same evening is a no-op", async () => {
    await withNetwork({ pickup: accepted }, () => run(LIVE, collections, ctx(EVENING)));
    const { result, calls } = await withNetwork({ pickup: accepted }, () =>
      run(LIVE, collections, ctx(new Date(EVENING.getTime() + 15 * 60 * 1000)))
    );
    assert.equal(result.reason, "already-requested");
    assert.equal(calls.pickup.length, 0);
    assert.equal(calls.webhook.length, 0);
  });

  test("a refused request is retried next tick but reported once", async () => {
    const first = await withNetwork({ pickup: refused }, () => run(LIVE, collections, ctx(EVENING)));
    assert.equal(first.calls.webhook.length, 1);
    assert.equal(first.calls.webhook[0].outcome, "failed");
    assert.match(first.calls.webhook[0].error, /wallet empty/);

    const retry = await withNetwork({ pickup: refused }, () =>
      run(LIVE, collections, ctx(new Date(EVENING.getTime() + 15 * 60 * 1000)))
    );
    assert.equal(retry.calls.pickup.length, 1, "the failed claim was not released for a retry");
    assert.equal(retry.calls.webhook.length, 0, "the same failure was posted twice");
  });

  test("a dead webhook does not stop the pickup", async () => {
    const { result } = await withNetwork(
      { pickup: accepted, webhook: () => Promise.reject(new Error("n8n down")) },
      () => run(LIVE, collections, ctx(EVENING))
    );
    assert.equal(result.reason, "requested");
    assert.equal(await collections.pickupRequests.countDocuments({ status: "requested" }), 1);
  });

  test("dry run and an unconfigured account call nothing", async () => {
    const dry = await withNetwork({ pickup: accepted }, () =>
      run(LIVE, collections, ctx(EVENING, { dryRun: true }))
    );
    assert.equal(dry.result.dryRun, true);
    assert.equal(dry.calls.pickup.length, 0);

    const bare = await withNetwork({ pickup: accepted }, () =>
      run({ mongoCollectionPrefix: "prod_" }, collections, ctx(EVENING))
    );
    assert.equal(bare.result.skipped, "not-configured");
    assert.equal(bare.calls.pickup.length, 0);
  });
});

// With SP-API credentials the job stops guessing: it books a rider because an
// Amazon order arrived, and tells Slack about the order itself.
describe("amazon order feed", () => {
  const AMAZON = {
    ...LIVE,
    amazonLwaClientId: "client",
    amazonLwaClientSecret: "secret",
    amazonLwaRefreshToken: "refresh"
  };

  const amazonOrder = (id, status = "Unshipped") => ({
    AmazonOrderId: id,
    OrderStatus: status,
    PurchaseDate: "2026-10-12T05:00:00Z",
    OrderTotal: { Amount: "399.00", CurrencyCode: "INR" },
    NumberOfItemsUnshipped: 1,
    ShippingAddress: { City: "MALAPPURAM", StateOrRegion: "KERALA", PostalCode: "673641" }
  });

  async function withAmazon(orders, { pickup = accepted, amazon } = {}, fn) {
    const original = globalThis.fetch;
    const calls = { pickup: [], webhook: [], amazon: [] };
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("api.amazon.com/auth")) {
        return new Response(JSON.stringify({ access_token: "atz", expires_in: 3600 }));
      }
      if (u.includes("/orders/v0/orders")) {
        calls.amazon.push(u);
        return amazon ? amazon() : new Response(JSON.stringify({ payload: { Orders: orders } }));
      }
      if (u.includes("/fm/request/new/")) {
        calls.pickup.push(init);
        return pickup();
      }
      calls.webhook.push(JSON.parse(init.body));
      return new Response("ok");
    };
    try {
      return { result: await fn(), calls };
    } finally {
      globalThis.fetch = original;
    }
  }

  test("a new order is recorded, posted, and gets a pickup, even in the afternoon", async () => {
    const { calls } = await withAmazon([amazonOrder("403-1")], {}, () =>
      run(AMAZON, collections, ctx(AFTERNOON))
    );
    assert.match(calls.amazon[0], /FulfillmentChannels=MFN/);
    assert.equal(calls.pickup.length, 1);
    assert.equal(JSON.parse(calls.pickup[0].body).pickup_date, "2026-10-13");

    const received = calls.webhook.find((w) => w.event === "amazon_order");
    assert.equal(received.outcome, "received");
    assert.equal(received.amazonOrderId, "403-1");
    assert.equal(received.amountPaise, 39900);
    assert.equal(calls.webhook.find((w) => w.event === "amazon_pickup").outcome, "requested");

    const row = await collections.amazonOrders.findOne({ _id: "403-1" });
    assert.equal(row.pickupRequestedFor, "2026-10-13");
  });

  test("the same order on the next tick is not posted or booked twice", async () => {
    await withAmazon([amazonOrder("403-1")], {}, () => run(AMAZON, collections, ctx(AFTERNOON)));
    const { calls } = await withAmazon([amazonOrder("403-1")], {}, () =>
      run(AMAZON, collections, ctx(new Date(AFTERNOON.getTime() + 15 * 60 * 1000)))
    );
    assert.equal(calls.webhook.length, 0);
    assert.equal(calls.pickup.length, 0);
  });

  test("pending, cancelled and shipped orders book no rider", async () => {
    const { calls } = await withAmazon(
      [amazonOrder("403-P", "Pending"), amazonOrder("403-C", "Canceled"), amazonOrder("403-S", "Shipped")],
      {},
      () => run(AMAZON, collections, ctx(AFTERNOON))
    );
    assert.equal(calls.pickup.length, 0);
    // Shipped is still an order we received, so Slack hears about it.
    assert.deepEqual(calls.webhook.map((w) => w.amazonOrderId), ["403-S"]);
  });

  test("a refused pickup is retried on the next tick", async () => {
    await withAmazon([amazonOrder("403-1")], { pickup: refused }, () => run(AMAZON, collections, ctx(AFTERNOON)));
    assert.equal((await collections.amazonOrders.findOne({ _id: "403-1" })).pickupRequestedFor, null);

    const { calls } = await withAmazon([], {}, () =>
      run(AMAZON, collections, ctx(new Date(AFTERNOON.getTime() + 15 * 60 * 1000)))
    );
    assert.equal(calls.pickup.length, 1);
    assert.equal((await collections.amazonOrders.findOne({ _id: "403-1" })).pickupRequestedFor, "2026-10-13");
  });

  test("an Amazon outage is reported once and books nothing", async () => {
    const down = () => new Response(JSON.stringify({ errors: [{ message: "throttled" }] }), { status: 429 });
    const first = await withAmazon([], { amazon: down }, () => run(AMAZON, collections, ctx(AFTERNOON)));
    assert.equal(first.result.reason, "orders-unreadable");
    assert.equal(first.calls.webhook[0].outcome, "orders-unreadable");

    const again = await withAmazon([], { amazon: down }, () =>
      run(AMAZON, collections, ctx(new Date(AFTERNOON.getTime() + 15 * 60 * 1000)))
    );
    assert.equal(again.calls.webhook.length, 0);
    assert.equal(again.calls.pickup.length, 0);
  });
});
