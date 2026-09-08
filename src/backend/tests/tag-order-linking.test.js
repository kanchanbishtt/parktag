// Joining a physical sticker to the order that paid for it, without anybody
// typing a serial.
//
// ── The problem this solves ────────────────────────────────────────────────
//
// Measured on production: `mintedTagId` was set on 0 of 36 orders. Not one
// sticker could be traced to a reason for leaving. Five activated tags belonged
// to real people with no record at all.
//
// The obvious fix was a form with a box for the sticker serial. It is the wrong
// fix: the serial is printed under the adhesive, so reading it means peeling a
// sticker you are about to hand somebody.
//
// ── Why the phone is the join ──────────────────────────────────────────────
//
// The tag already learns its owner at activation, and the order already
// captures a delivery phone. So the link derives itself and nobody types
// anything. Verified against production before this was written: tag
// PT-01-004004 (Kanchan) already matched order PT-260730-00004 on phone alone,
// and all 20 owners carry a number.
//
// ── The rule that shapes everything here ───────────────────────────────────
//
// A WRONG LINK IS WORSE THAN NO LINK.
//
// An unlinked tag shows up on the reconciliation report and somebody looks at
// it. A tag linked to the wrong person's order is a quiet lie in the ledger
// that nothing will ever flag. Every ambiguity below therefore resolves to
// "link nothing".

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { linkTagToOrder } from "../lib/core/order-linking.js";
import { startTestApp, stopTestApp } from "./helpers.js";

let app;
let collections;

const PHONE = "9812345678";

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.shopOrders.deleteMany({ orderNumber: /^PT-QA-/ }).catch(() => {});
  await collections.tags.deleteMany({ batchLabel: "qa-link" }).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  // Keyed on the order number, not the product: these tests seed real SKUs now
  // so that pack capacity is exercised, so productId is no longer a marker.
  await collections.shopOrders.deleteMany({ orderNumber: /^PT-QA-/ });
  await collections.tags.deleteMany({ batchLabel: "qa-link" });
});

async function seedOrder(overrides = {}) {
  const orderNumber = `PT-QA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const doc = {
    orderNumber,
    orderId: `order_${orderNumber}`,
    productId: "qa-link",
    productName: "QA Link Pack",
    status: "paid",
    amount: 29900,
    guest: true,
    ownerId: null,
    shippingAddress: { fullName: "QA Buyer", phone: PHONE, city: "Noida" },
    createdAt: new Date().toISOString(),
    ...overrides
  };
  await collections.shopOrders.insertOne(doc);
  return doc;
}

async function seedTag(overrides = {}) {
  const _id = new ObjectId();
  await collections.tags.insertOne({
    _id,
    // Every real tag carries one, and `tags` has a unique index on it. Seeding
    // two without meant both wrote token: null and the second was refused.
    token: `qa-link-${_id}`,
    batchLabel: "qa-link",
    batchNumber: "01",
    serialNumber: 3057,
    status: "active",
    purchaseStatus: "none",
    ...overrides
  });
  return _id;
}

const linked = (tagId) => collections.tags.findOne({ _id: tagId });
const orderFor = (orderNumber) => collections.shopOrders.findOne({ orderNumber });

describe("an activated sticker finds the order that paid for it", () => {
  test("a paid order on the same number is linked", async () => {
    const order = await seedOrder();
    const tagId = await seedTag();

    const got = await linkTagToOrder(collections, { tagId, phone: PHONE });

    assert.equal(got.linked, true);
    assert.equal(got.orderNumber, order.orderNumber);

    const tag = await linked(tagId);
    assert.equal(tag.assignedOrderNumber, order.orderNumber);
    assert.ok(tag.assignedAt);
    // The tag's own record of having been bought. Every activated tag on
    // production still read "none", including the ones somebody had paid for.
    assert.equal(tag.purchaseStatus, "paid");

    // Both directions, so the question is answerable from either end.
    assert.deepEqual((await orderFor(order.orderNumber)).assignedTagIds.map(String), [String(tagId)]);
  });

  // Stored formats differ by signup path, the same trap resolveReferral's
  // self-referral check documents. A raw string compare would fail to link the
  // very buyer the order belongs to.
  test("the same number in another format still matches", async () => {
    const order = await seedOrder({ shippingAddress: { fullName: "QA", phone: "+919812345678" } });
    const tagId = await seedTag();

    const got = await linkTagToOrder(collections, { tagId, phone: "9812345678" });
    assert.equal(got.linked, true);
    assert.equal(got.orderNumber, order.orderNumber);
  });

  // The main case this exists for. A handover sale has no address at all, so
  // the phone is the ONLY thing connecting the buyer to the order.
  test("a handover order with no address links on the phone alone", async () => {
    const order = await seedOrder({
      fulfilment: "handover",
      deliveredInPerson: true,
      shippingAddress: { fullName: "QA", phone: PHONE, line1: "", city: "", pincode: "" }
    });
    const tagId = await seedTag();

    assert.equal((await linkTagToOrder(collections, { tagId, phone: PHONE })).orderNumber, order.orderNumber);
  });

  // The OLDEST order with room left is filled first, which is the opposite of
  // what it should be for one order and the right answer across several.
  //
  // Somebody with an August Pack of 2 and a September Pack of 1 has three
  // stickers to activate in no particular order. Filling the oldest with room
  // means all three land somewhere; taking the newest first would fill
  // September, then August, and strand whichever sticker came last.
  test("the oldest order with a free slot is filled first", async () => {
    const older = await seedOrder({ productId: "pt-car-1", createdAt: "2026-08-01T00:00:00.000Z" });
    await seedOrder({ productId: "pt-car-1", createdAt: "2026-09-08T00:00:00.000Z" });
    const tagId = await seedTag();

    assert.equal((await linkTagToOrder(collections, { tagId, phone: PHONE })).orderNumber, older.orderNumber);
  });

  test("a COD order counts too", async () => {
    const order = await seedOrder({ status: "cod" });
    const tagId = await seedTag();
    assert.equal((await linkTagToOrder(collections, { tagId, phone: PHONE })).orderNumber, order.orderNumber);
  });
});

describe("it refuses to guess", () => {
  // A wrong link is worse than no link: an unlinked tag reaches the
  // reconciliation report, a mislinked one is a quiet lie nothing will flag.
  test("an abandoned checkout is not an order", async () => {
    await seedOrder({ status: "created" });
    const tagId = await seedTag();

    const got = await linkTagToOrder(collections, { tagId, phone: PHONE });
    assert.equal(got.linked, false);
    assert.equal((await linked(tagId)).assignedOrderNumber, undefined);
  });

  test("nobody else's order is taken", async () => {
    await seedOrder({ shippingAddress: { fullName: "Someone Else", phone: "9999900000" } });
    const tagId = await seedTag();

    assert.equal((await linkTagToOrder(collections, { tagId, phone: PHONE })).linked, false);
  });

  // A Pack of 1 holds exactly one sticker. A second activation on the same
  // phone must not attach itself to an order that is already accounted for.
  test("a Pack of 1 holds one sticker and no more", async () => {
    const order = await seedOrder({ productId: "pt-car-1" });
    const first = await seedTag();
    const second = await seedTag({ serialNumber: 3058 });

    assert.equal((await linkTagToOrder(collections, { tagId: first, phone: PHONE })).linked, true);
    assert.equal((await linkTagToOrder(collections, { tagId: second, phone: PHONE })).linked, false);

    assert.equal((await linked(second)).assignedOrderNumber, undefined);
    assert.deepEqual(
      (await orderFor(order.orderNumber)).assignedTagIds.map(String),
      [String(first)]
    );
  });

  // The case that matters, and the one the first version of this module got
  // wrong. A Pack of 2 goes on two different vehicles and is activated twice on
  // the same phone. Holding only the first sticker would silently drop the
  // second, which is half of every multi-pack ParkTag sells.
  test("a Pack of 2 holds both stickers", async () => {
    const order = await seedOrder({ productId: "pt-car-2" });
    const first = await seedTag();
    const second = await seedTag({ serialNumber: 3058 });

    assert.equal((await linkTagToOrder(collections, { tagId: first, phone: PHONE })).linked, true);
    assert.equal((await linkTagToOrder(collections, { tagId: second, phone: PHONE })).linked, true);

    assert.equal((await linked(first)).assignedOrderNumber, order.orderNumber);
    assert.equal((await linked(second)).assignedOrderNumber, order.orderNumber);
    assert.equal((await orderFor(order.orderNumber)).assignedTagIds.length, 2);
  });

  test("a Pack of 2 stops at two", async () => {
    await seedOrder({ productId: "pt-car-2" });
    const ids = [await seedTag(), await seedTag({ serialNumber: 3058 }), await seedTag({ serialNumber: 3059 })];

    const results = [];
    for (const tagId of ids) results.push((await linkTagToOrder(collections, { tagId, phone: PHONE })).linked);

    assert.deepEqual(results, [true, true, false]);
  });

  // Three stickers across two orders, activated in whatever order they come off
  // the sheet. Every one has to land somewhere, which is why the oldest order
  // with room is filled first rather than the newest.
  test("stickers spread across several orders until every slot is used", async () => {
    const older = await seedOrder({ productId: "pt-car-2", createdAt: "2026-08-01T00:00:00.000Z" });
    const newer = await seedOrder({ productId: "pt-car-1", createdAt: "2026-09-08T00:00:00.000Z" });
    const ids = [await seedTag(), await seedTag({ serialNumber: 3058 }), await seedTag({ serialNumber: 3059 })];

    for (const tagId of ids) {
      assert.equal((await linkTagToOrder(collections, { tagId, phone: PHONE })).linked, true);
    }

    assert.equal((await orderFor(older.orderNumber)).assignedTagIds.length, 2);
    assert.equal((await orderFor(newer.orderNumber)).assignedTagIds.length, 1);
  });

  // An unknown or legacy SKU must not be read as unlimited capacity, or a
  // stranger's sticker could attach itself to somebody else's order.
  test("an unrecognised product holds one sticker, not any number", async () => {
    await seedOrder({ productId: "qa-link" });
    const first = await seedTag();
    const second = await seedTag({ serialNumber: 3058 });

    assert.equal((await linkTagToOrder(collections, { tagId: first, phone: PHONE })).linked, true);
    assert.equal((await linkTagToOrder(collections, { tagId: second, phone: PHONE })).linked, false);
  });

  // Re-registering a sticker after a deactivation must not move it onto a
  // different order and rewrite history.
  test("a tag that already names an order keeps it", async () => {
    await seedOrder();
    const tagId = await seedTag({ assignedOrderNumber: "PT-EXISTING" });

    assert.equal((await linkTagToOrder(collections, { tagId, phone: PHONE })).linked, false);
    assert.equal((await linked(tagId)).assignedOrderNumber, "PT-EXISTING");
  });

  test("no phone means no link", async () => {
    await seedOrder();
    const tagId = await seedTag();

    for (const missing of [null, "", "   ", "12"]) {
      assert.equal((await linkTagToOrder(collections, { tagId, phone: missing })).linked, false);
    }
  });

  test("no matching order at all is not an error", async () => {
    const tagId = await seedTag();
    const got = await linkTagToOrder(collections, { tagId, phone: PHONE });
    assert.equal(got.linked, false);
    assert.equal(got.reason, "no-order");
  });
});

describe("it never costs somebody their activation", () => {
  // This runs inside the request a customer is waiting on, immediately after
  // they have activated the sticker they just bought. Bookkeeping failing must
  // never turn that into a failed activation.
  test("a broken database is swallowed, not thrown", async () => {
    const broken = {
      shopOrders: {
        find() { throw new Error("Mongo is down"); },
        findOne() { throw new Error("Mongo is down"); },
        updateOne() { throw new Error("Mongo is down"); }
      },
      tags: {
        findOne() { throw new Error("Mongo is down"); },
        updateOne() { throw new Error("Mongo is down"); }
      }
    };

    const got = await linkTagToOrder(broken, { tagId: new ObjectId(), phone: PHONE });
    assert.equal(got.linked, false);
  });

  test("a missing tag is not an error", async () => {
    await seedOrder();
    const got = await linkTagToOrder(collections, { tagId: new ObjectId(), phone: PHONE });
    assert.equal(got.linked, false);
  });
});
