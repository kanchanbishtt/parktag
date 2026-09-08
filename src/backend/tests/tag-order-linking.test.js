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
  await collections.shopOrders.deleteMany({ productId: "qa-link" }).catch(() => {});
  await collections.tags.deleteMany({ batchLabel: "qa-link" }).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.shopOrders.deleteMany({ productId: "qa-link" });
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
    assert.equal(String((await orderFor(order.orderNumber)).assignedTagId), String(tagId));
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

  // Somebody buying a second tag a month later gets the newer order, not the
  // one they already have a sticker for.
  test("the most recent unlinked order wins", async () => {
    await seedOrder({ createdAt: "2026-08-01T00:00:00.000Z" });
    const newer = await seedOrder({ createdAt: "2026-09-08T00:00:00.000Z" });
    const tagId = await seedTag();

    assert.equal((await linkTagToOrder(collections, { tagId, phone: PHONE })).orderNumber, newer.orderNumber);
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

  // Two stickers from a Pack of 2 must not both claim the same order.
  test("an order already holding a tag is not taken again", async () => {
    const order = await seedOrder();
    const first = await seedTag();
    const second = await seedTag({ serialNumber: 3058 });

    assert.equal((await linkTagToOrder(collections, { tagId: first, phone: PHONE })).linked, true);
    assert.equal((await linkTagToOrder(collections, { tagId: second, phone: PHONE })).linked, false);

    assert.equal((await linked(second)).assignedOrderNumber, undefined);
    assert.equal(String((await orderFor(order.orderNumber)).assignedTagId), String(first));
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
