// The report that notices what nobody wrote down.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Everything else in this feature is automatic: a sale goes through checkout, a
// sticker links itself on activation. This is the part that says when that did
// NOT happen, because the failure mode of an automatic system is silence.
//
// It is not hypothetical. On production, five activated tags belonged to real
// people with no order behind them at all: a giveaway to Abhishek Bhardwaj, the
// owner's own tag, and three more. Nothing anywhere flagged them. They were
// found by somebody happening to remember a name.
//
// ── The two directions of drift ────────────────────────────────────────────
//
//   1. A sticker somebody is USING with no record of why it left. Either it was
//      given away and never logged, or a sale went around the checkout.
//   2. An order somebody PAID FOR whose stickers are not all activated. Usually
//      just a parcel in transit, which is why the report says how old it is
//      rather than treating it as a fault.
//
// Nothing here writes. A report that repairs what it finds would hide the
// pattern that caused the drift, and the drift is the interesting part.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { reconcile } from "../lib/core/reconciliation.js";
import { startTestApp, stopTestApp } from "./helpers.js";

let app;
let collections;

const PHONE = "9812345678";

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.shopOrders.deleteMany({ orderNumber: /^PT-QA-/ }).catch(() => {});
  await collections.tags.deleteMany({ batchLabel: "qa-recon" }).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.shopOrders.deleteMany({ orderNumber: /^PT-QA-/ });
  await collections.tags.deleteMany({ batchLabel: "qa-recon" });
});

async function seedTag(overrides = {}) {
  const _id = new ObjectId();
  await collections.tags.insertOne({
    _id,
    token: `qa-recon-${_id}`,
    batchLabel: "qa-recon",
    batchNumber: "01",
    serialNumber: 3201,
    status: "active",
    activatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides
  });
  return _id;
}

async function seedOrder(overrides = {}) {
  const orderNumber = `PT-QA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await collections.shopOrders.insertOne({
    orderNumber,
    productId: "pt-car-1",
    productName: "ParkTag Car Tag (Pack of 1)",
    status: "paid",
    amount: 29900,
    shippingAddress: { fullName: "QA Buyer", phone: PHONE },
    createdAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides
  });
  return orderNumber;
}

const serialsIn = (rows) => rows.map((r) => r.serial);
const numbersIn = (rows) => rows.map((r) => r.orderNumber);

describe("stickers in use that nothing accounts for", () => {
  // The Abhishek case, exactly. A tag somebody activated and is relying on,
  // with no order anywhere.
  test("an activated tag with no order is reported", async () => {
    await seedTag();
    const got = await reconcile(collections);

    assert.deepEqual(serialsIn(got.unlinkedTags), ["PT-01-003201"]);
  });

  test("a linked tag is not reported", async () => {
    await seedTag({ assignedOrderNumber: "PT-QA-LINKED" });
    assert.deepEqual((await reconcile(collections)).unlinkedTags, []);
  });

  // Stock that has never been activated is not drift, it is inventory. There
  // are 2,996 printed unclaimed stickers, and listing them would bury the five
  // rows that matter.
  test("unclaimed stock is not drift", async () => {
    await seedTag({ status: "unclaimed", activatedAt: null });
    assert.deepEqual((await reconcile(collections)).unlinkedTags, []);
  });

  test("a soft-deleted tag is not reported", async () => {
    await seedTag({ deletedAt: new Date().toISOString() });
    assert.deepEqual((await reconcile(collections)).unlinkedTags, []);
  });

  // Whoever reads this needs to know which physical sticker it is and who has
  // it, or the report is a list of nothing anybody can act on.
  test("each row says which sticker and who holds it", async () => {
    const ownerId = new ObjectId();
    await collections.owners.insertOne({ _id: ownerId, displayName: "Abhishek Bhardwaj", mobile: PHONE });
    await seedTag({ ownerId });

    try {
      const [row] = (await reconcile(collections)).unlinkedTags;
      assert.equal(row.serial, "PT-01-003201");
      assert.equal(row.ownerName, "Abhishek Bhardwaj");
      assert.ok(row.activatedAt);
    } finally {
      await collections.owners.deleteOne({ _id: ownerId });
    }
  });

  // Tags issued before serials existed have none. Reporting them as "undefined"
  // would be worse than saying plainly that there is no serial to quote.
  test("a tag with no serial still reports, without inventing one", async () => {
    await seedTag({ serialNumber: null, batchNumber: null });
    const [row] = (await reconcile(collections)).unlinkedTags;

    assert.equal(row.serial, null);
    assert.ok(row.tagId);
  });
});

describe("orders whose stickers are not all in use", () => {
  test("a paid order with nothing activated is reported", async () => {
    const orderNumber = await seedOrder();
    const got = await reconcile(collections);

    assert.deepEqual(numbersIn(got.unfilledOrders), [orderNumber]);
    assert.equal(got.unfilledOrders[0].filled, 0);
    assert.equal(got.unfilledOrders[0].capacity, 1);
  });

  // A Pack of 2 with one sticker on a car and the other still in the envelope
  // is half done, and that is worth seeing.
  test("a partly activated pack is reported with its count", async () => {
    const orderNumber = await seedOrder({ productId: "pt-car-2", assignedTagIds: [new ObjectId()] });
    const [row] = (await reconcile(collections)).unfilledOrders;

    assert.equal(row.orderNumber, orderNumber);
    assert.equal(row.filled, 1);
    assert.equal(row.capacity, 2);
  });

  test("a fully activated order is not reported", async () => {
    await seedOrder({ productId: "pt-car-2", assignedTagIds: [new ObjectId(), new ObjectId()] });
    assert.deepEqual((await reconcile(collections)).unfilledOrders, []);
  });

  test("an abandoned checkout is not an order", async () => {
    await seedOrder({ status: "created" });
    assert.deepEqual((await reconcile(collections)).unfilledOrders, []);
  });

  // Most of these are simply parcels in transit, so the report says how long it
  // has been rather than calling a two-day-old order a problem. Somebody
  // reading it needs to tell "posted yesterday" from "posted in July".
  test("each row says how long it has been waiting", async () => {
    await seedOrder({ createdAt: "2026-07-01T00:00:00.000Z" });
    const [row] = (await reconcile(collections)).unfilledOrders;

    assert.ok(row.daysWaiting >= 30, `expected a long wait, got ${row.daysWaiting}`);
  });

  // Oldest first: a July order nobody activated is a real question, a
  // yesterday one is the post.
  test("the longest wait comes first", async () => {
    const old = await seedOrder({ createdAt: "2026-07-01T00:00:00.000Z" });
    await seedOrder({ createdAt: "2026-09-08T00:00:00.000Z" });

    assert.equal((await reconcile(collections)).unfilledOrders[0].orderNumber, old);
  });
});

describe("it reports rather than repairs", () => {
  // A report that quietly fixed what it found would hide the pattern that
  // caused the drift, and the pattern is the interesting part.
  test("nothing is written back", async () => {
    const tagId = await seedTag();
    const orderNumber = await seedOrder();

    await reconcile(collections);

    assert.equal((await collections.tags.findOne({ _id: tagId })).assignedOrderNumber, undefined);
    assert.equal((await collections.shopOrders.findOne({ orderNumber })).assignedTagIds, undefined);
  });

  test("a clean database reports nothing at all", async () => {
    const got = await reconcile(collections);
    assert.deepEqual(got.unlinkedTags, []);
    assert.deepEqual(got.unfilledOrders, []);
  });
});
