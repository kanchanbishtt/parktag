// Abandoned checkouts go to Slack through an n8n webhook, once each.
//
// Pinned below: the payload carries the buyer's details, a young checkout is
// left alone, our own tests and phone-less rows are skipped, an order is
// reported once however many ticks run, and a dead webhook retries on the next
// tick instead of losing the order.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { run } from "../lib/core/campaigns/abandoned-cart-notify.js";
import { startTestApp, stopTestApp } from "./helpers.js";

const ENV = { abandonedNotifyWebhookUrl: "https://n8n.example/webhook/abandoned" };
const NOW = new Date("2026-10-13T12:00:00.000Z");
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
const PREFIX = "PT-TESTABANDON-";

let app;
let collections;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.shopOrders.deleteMany({ orderNumber: { $regex: `^${PREFIX}` } }).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.shopOrders.deleteMany({ orderNumber: { $regex: `^${PREFIX}` } });
});

function order(n, over = {}) {
  return {
    orderNumber: `${PREFIX}${n}`,
    orderId: `order_test${n}`,
    status: "created",
    paymentMethod: "online",
    ownerId: null,
    guest: true,
    channel: "direct",
    productId: "pt-car-2",
    productName: "ParkTag Car Tag (Pack of 2)",
    quantity: 1,
    addOns: [],
    amount: 39900,
    mrpPaise: 49900,
    promoCode: "LAUNCH100",
    promoDiscountPaise: 10000,
    shippingFeePaise: 0,
    internal: false,
    attribution: { source: "meta", medium: "paid", campaign: "sales_india", content: "reel2" },
    shippingAddress: {
      fullName: "Test Buyer",
      phone: "9000000001",
      line1: "12 Test Street",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411060"
    },
    createdAt: ago(90),
    ...over
  };
}

async function withWebhook(handler, fn) {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return handler();
  };
  try {
    return { result: await fn(), bodies };
  } finally {
    globalThis.fetch = original;
  }
}

const ok = () => new Response("ok");
const ctx = (extra = {}) => ({ now: NOW, limit: 200, dryRun: false, log: null, ...extra });

describe("abandoned cart to Slack", () => {
  test("posts the buyer's details, the order and the ad it came from", async () => {
    await collections.shopOrders.insertOne(order(1));
    const { result, bodies } = await withWebhook(ok, () => run(ENV, collections, ctx()));

    assert.equal(result.notified, 1);
    const b = bodies[0];
    assert.equal(b.event, "abandoned_cart");
    assert.equal(b.orderNumber, `${PREFIX}1`);
    assert.equal(b.buyer.name, "Test Buyer");
    assert.equal(b.buyer.phone, "9000000001");
    assert.equal(b.address.city, "Pune");
    assert.equal(b.address.pincode, "411060");
    assert.equal(b.amountRupees, 399);
    assert.equal(b.promoCode, "LAUNCH100");
    assert.equal(b.attribution.campaign, "sales_india");
    assert.equal(b.minutesSinceStarted, 90);
    assert.equal(b.marketingConsent, false);
  });

  test("leaves a checkout alone until it has been quiet for 30 minutes", async () => {
    await collections.shopOrders.insertOne(order(2, { createdAt: ago(10) }));
    const { bodies } = await withWebhook(ok, () => run(ENV, collections, ctx()));
    assert.equal(bodies.length, 0);
  });

  test("skips our own tests, phone-less rows and paid orders", async () => {
    await collections.shopOrders.insertMany([
      order(3, { internal: true }),
      order(4, { shippingAddress: { fullName: "No Phone" } }),
      order(5, { status: "paid" })
    ]);
    const { bodies } = await withWebhook(ok, () => run(ENV, collections, ctx()));
    assert.equal(bodies.length, 0);
  });

  // The scheduler ticks every 15 minutes; the order must be reported once.
  test("a second tick does not repeat an order", async () => {
    await collections.shopOrders.insertOne(order(6));
    await withWebhook(ok, () => run(ENV, collections, ctx()));
    const { bodies } = await withWebhook(ok, () => run(ENV, collections, ctx()));
    assert.equal(bodies.length, 0);
  });

  test("a dead webhook releases the order so the next tick retries it", async () => {
    await collections.shopOrders.insertOne(order(7));
    const first = await withWebhook(
      () => new Response("down", { status: 500 }),
      () => run(ENV, collections, ctx())
    );
    assert.equal(first.result.failed, 1);

    const retry = await withWebhook(ok, () => run(ENV, collections, ctx()));
    assert.equal(retry.result.notified, 1);
  });

  test("dry run and an unset webhook post nothing", async () => {
    await collections.shopOrders.insertOne(order(8));
    const dry = await withWebhook(ok, () => run(ENV, collections, ctx({ dryRun: true })));
    assert.equal(dry.bodies.length, 0);

    const off = await withWebhook(ok, () => run({}, collections, ctx()));
    assert.equal(off.result.skipped, "not-configured");
    assert.equal(off.bodies.length, 0);
  });
});
