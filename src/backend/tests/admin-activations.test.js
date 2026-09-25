// The admin Activations page: who bought and has not activated (the reminder
// queue), what counts as activated, and the record of who was reminded.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { stickerSerialFor } from "../lib/core/tag-issuance.js";

const ADMIN_EMAIL = "admin-activations-page@parktag.test";
const PASSWORD = "test-password-123";
const MARK = `actq${Date.now()}`;
const BATCH = "actq-test-batch";
const DAY = 24 * 60 * 60 * 1000;

let app;
let collections;
let adminCookie;
let tokenSeq = 0;
let serialSeq = 990001;

function authed(method, url, payload) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, cookie: adminCookie },
    ...(payload ? { payload } : {})
  });
}

async function insertOwner(overrides = {}) {
  const { insertedId } = await collections.owners.insertOne({
    displayName: `Owner ${MARK}`,
    email: `${MARK}-${tokenSeq++}@parktag.test`,
    role: "owner",
    testMarker: MARK,
    createdAt: new Date().toISOString(),
    ...overrides
  });
  return insertedId;
}

async function insertTag(overrides = {}) {
  const doc = {
    token: `${MARK}t${String(tokenSeq++).padStart(4, "0")}${"0".repeat(12)}`,
    serialNumber: serialSeq++,
    batchNumber: BATCH,
    ownerId: null,
    status: "unclaimed",
    premium: true,
    testMarker: MARK,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

let orderSeq = 0;
async function insertOrder(overrides = {}) {
  const doc = {
    orderNumber: `${MARK}-${String(++orderSeq).padStart(3, "0")}`,
    status: "paid",
    paymentMethod: "online",
    productId: "pt-car-1",
    productName: "ParkTag Car Tag (Pack of 1)",
    shippingAddress: { fullName: `Buyer ${orderSeq}`, phone: `98${String(orderSeq).padStart(8, "0")}` },
    testMarker: MARK,
    createdAt: new Date(Date.now() - (30 - orderSeq) * DAY).toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.shopOrders.insertOne(doc);
  return { ...doc, _id: insertedId };
}

async function queue() {
  const response = await authed("GET", "/api/admin/activations");
  assert.equal(response.statusCode, 200);
  const body = response.json();
  return { ...body, mine: body.unactivated.filter((o) => String(o.orderNumber || "").startsWith(MARK)) };
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);

  await collections.admins.insertOne({
    email: ADMIN_EMAIL,
    role: "admin",
    passwordHash: await createPasswordHash(PASSWORD),
    createdAt: new Date().toISOString()
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/admin/login",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN },
    payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200, "admin fixture must be able to sign in");
  adminCookie = login.headers["set-cookie"];
});

after(async () => {
  await collections.tags.deleteMany({ testMarker: MARK });
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await collections.owners.deleteMany({ testMarker: MARK });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("every activations endpoint is admin-only", async () => {
  const anon = (method, url, payload) => app.inject({
    method, url, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN }, ...(payload ? { payload } : {})
  });
  for (const [method, url, payload] of [
    ["GET", "/api/admin/activations"],
    ["GET", "/api/admin/activations/recent"],
    ["POST", `/api/admin/activations/${new ObjectId()}/reminder`, { channel: "call" }]
  ]) {
    const response = await anon(method, url, payload);
    assert.ok([401, 403].includes(response.statusCode), `${method} ${url} must refuse, got ${response.statusCode}`);
  }
});

test("unsold premium stock is counted as stock, not as activated", async () => {
  // The headline numbers live on the overview; the Activations list agrees.
  const counts = async () => {
    const [summary, list] = await Promise.all([
      authed("GET", "/api/admin/overview/summary"),
      authed("GET", "/api/admin/activations/recent?type=premium")
    ]);
    const s = summary.json().summary;
    return { ...s.activations, premiumUnsold: s.stock.premiumUnsold, listed: list.json().total };
  };
  const before = await counts();

  await insertTag({ premium: true, ownerId: null, status: "unclaimed" });
  const afterStock = await counts();
  assert.equal(afterStock.premiumActivated, before.premiumActivated, "stock with no owner is not an activation");
  assert.equal(afterStock.listed, before.listed, "and is not listed as one");
  assert.equal(afterStock.premiumUnsold, before.premiumUnsold + 1);

  const owner = await insertOwner();
  await insertTag({ premium: true, ownerId: owner, status: "active" });
  const afterOwned = await counts();
  assert.equal(afterOwned.premiumActivated, before.premiumActivated + 1);
  assert.equal(afterOwned.premiumLive, before.premiumLive + 1);
  assert.equal(afterOwned.listed, before.listed + 1);
});

test("the reminder queue holds real, unactivated sales and nothing else", async () => {
  const waiting = await insertOrder();
  const cod = await insertOrder({ status: "cod", paymentMethod: "cod" });
  const abandoned = await insertOrder({ status: "created" });
  const testOrder = await insertOrder({ internal: true });
  const internalChannel = await insertOrder({ channel: "internal" });
  const deleted = await insertOrder({ deletedAt: new Date().toISOString() });

  // Activated through order linking: the one sticker is on the order.
  const linkedTag = await insertTag({ premium: false, ownerId: await insertOwner(), status: "active" });
  const linked = await insertOrder({ assignedTagIds: [linkedTag._id] });

  // A Pack of 2 with one sticker live stays, and says so.
  const partTag = await insertTag({ premium: false, ownerId: await insertOwner(), status: "active" });
  const partial = await insertOrder({ productId: "pt-car-2", assignedTagIds: [partTag._id] });

  // Owner already holds a live premium tag.
  const liveOwner = await insertOwner();
  await insertTag({ premium: true, ownerId: liveOwner, status: "active" });
  const ownerLive = await insertOrder({ ownerId: liveOwner });

  // Replace target upgraded away.
  const upgraded = await insertTag({ premium: true, ownerId: await insertOwner(), status: "active" });
  const replaced = await insertOrder({ replaceTagId: String(upgraded._id) });

  const { mine } = await queue();
  const numbers = mine.map((o) => o.orderNumber);

  assert.ok(numbers.includes(waiting.orderNumber), "a paid, unactivated order is in the queue");
  assert.ok(numbers.includes(cod.orderNumber), "a placed COD order is in the queue");
  for (const [order, why] of [
    [abandoned, "an abandoned checkout"],
    [testOrder, "an internal test order"],
    [internalChannel, "an internal-channel order"],
    [deleted, "a deleted order"],
    [linked, "an order whose sticker is activated"],
    [ownerLive, "an order from an owner with a live premium tag"],
    [replaced, "an order whose replace-target was upgraded"]
  ]) {
    assert.ok(!numbers.includes(order.orderNumber), `${why} must not be in the queue`);
  }

  const part = mine.find((o) => o.orderNumber === partial.orderNumber);
  assert.ok(part, "a pack with a sticker still waiting stays in the queue");
  assert.equal(part.stickers, 2);
  assert.equal(part.activatedStickers, 1);

  const placed = mine.map((o) => o.placedAt);
  assert.deepEqual(placed, [...placed].sort(), "waiting longest first");
});

test("a guest buyer's name comes from the checkout address", async () => {
  const order = await insertOrder({ shippingAddress: { fullName: "Guest Buyer Name", phone: "9811122233" } });
  const row = (await queue()).mine.find((o) => o.orderNumber === order.orderNumber);
  assert.equal(row.ownerName, "Guest Buyer Name");
  assert.equal(row.ownerMobile, "9811122233");
});

test("delivery state is read from the order, never guessed", async () => {
  const cases = [
    [{ deliveredInPerson: true, fulfilment: "handover" }, "handed_over"],
    [{ waybill: "AWB1", deliveredAt: new Date(Date.now() - 3 * DAY).toISOString() }, "delivered"],
    [{ waybill: "AWB2", trackingCache: { status: "In Transit", fetchedAt: new Date().toISOString() } }, "shipped"],
    [{ shipmentError: "Pincode not serviceable" }, "shipment_failed"],
    [{}, "not_shipped"]
  ];
  const orders = [];
  for (const [fields] of cases) orders.push(await insertOrder(fields));

  const { mine } = await queue();
  cases.forEach(([, expected], i) => {
    const row = mine.find((o) => o.orderNumber === orders[i].orderNumber);
    assert.equal(row.delivery.state, expected);
  });
  const shipped = mine.find((o) => o.orderNumber === orders[2].orderNumber);
  assert.equal(shipped.delivery.courierStatus, "In Transit");
  const failed = mine.find((o) => o.orderNumber === orders[3].orderNumber);
  assert.equal(failed.delivery.error, "Pincode not serviceable", "the booking error is shown in Details");
});

test("a reminder is recorded on the order and shown next time", async () => {
  const order = await insertOrder();

  const bad = await authed("POST", `/api/admin/activations/${order._id}/reminder`, { channel: "sms" });
  assert.equal(bad.statusCode, 400);
  const badId = await authed("POST", "/api/admin/activations/not-an-id/reminder", { channel: "call" });
  assert.equal(badId.statusCode, 400);
  const missing = await authed("POST", `/api/admin/activations/${new ObjectId()}/reminder`, { channel: "call" });
  assert.equal(missing.statusCode, 404);

  const ok = await authed("POST", `/api/admin/activations/${order._id}/reminder`, { channel: "whatsapp" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().lastReminder.channel, "whatsapp");
  assert.equal(ok.json().lastReminder.by, ADMIN_EMAIL);

  const row = (await queue()).mine.find((o) => o.orderNumber === order.orderNumber);
  assert.equal(row.reminderCount, 1);
  assert.equal(row.lastReminder.channel, "whatsapp");
  assert.equal(row.lastReminder.by, ADMIN_EMAIL);
  assert.equal(row.reminders.length, 1, "the history behind the count is sent for Details");
  assert.equal(row.reminders[0].channel, "whatsapp");

  // Only real sales can be marked; a test order is not in the queue at all.
  const testOrder = await insertOrder({ internal: true });
  const refused = await authed("POST", `/api/admin/activations/${testOrder._id}/reminder`, { channel: "call" });
  assert.equal(refused.statusCode, 404);
});

test("reminder history is capped at the last 20", async () => {
  const order = await insertOrder();
  for (let i = 0; i < 23; i++) {
    const r = await authed("POST", `/api/admin/activations/${order._id}/reminder`, { channel: i % 2 ? "call" : "whatsapp" });
    assert.equal(r.statusCode, 200);
  }
  const stored = await collections.shopOrders.findOne({ _id: order._id });
  assert.equal(stored.activationReminders.length, 20);
  assert.equal(stored.lastActivationReminder.channel, "whatsapp");
});

test("recent activations: one list, filtered by type, searched on the server", async () => {
  const owner = await insertOwner({ displayName: `Searchable ${MARK}`, mobile: "+919900011122" });
  const premium = await insertTag({ premium: true, ownerId: owner, status: "active", plateNumber: "MH12QA7777" });
  const etag = await insertTag({ premium: false, ownerId: owner, status: "active", plateNumber: "MH12QA8888", activatedAt: new Date().toISOString() });
  const stock = await insertTag({ premium: true, ownerId: null });

  const serialsOf = async (query) => {
    const response = await authed("GET", `/api/admin/activations/recent${query}`);
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.activations.length <= body.pageSize);
    assert.ok(!JSON.stringify(body).includes(MARK + "t"), "no token in the response");
    return body.activations.map((a) => a.serial);
  };

  const all = await serialsOf(`?q=${encodeURIComponent(MARK)}`);
  assert.ok(all.includes(stickerSerialFor(premium)) && all.includes(stickerSerialFor(etag)));
  assert.ok(!all.includes(stickerSerialFor(stock)), "unsold stock is not an activation");

  const onlyPremium = await serialsOf(`?type=premium&q=${encodeURIComponent(MARK)}`);
  assert.ok(onlyPremium.includes(stickerSerialFor(premium)) && !onlyPremium.includes(stickerSerialFor(etag)));
  const onlyEtag = await serialsOf(`?type=etag&q=${encodeURIComponent(MARK)}`);
  assert.ok(onlyEtag.includes(stickerSerialFor(etag)) && !onlyEtag.includes(stickerSerialFor(premium)));

  assert.ok((await serialsOf("?q=MH12QA7777")).includes(stickerSerialFor(premium)), "by plate");
  assert.ok((await serialsOf("?q=mh12 qa 7777")).includes(stickerSerialFor(premium)), "by plate with spaces");
  assert.ok((await serialsOf("?q=9900011122")).includes(stickerSerialFor(etag)), "by owner phone");
  assert.ok(
    (await serialsOf(`?q=${encodeURIComponent(stickerSerialFor(premium))}`)).includes(stickerSerialFor(premium)),
    "by sticker serial"
  );

  const invalidBatch = await authed("GET", "/api/admin/activations/recent?batch=abc");
  assert.equal(invalidBatch.statusCode, 400);
  const regexy = await authed("GET", `/api/admin/activations/recent?q=${encodeURIComponent("a(")}`);
  assert.equal(regexy.statusCode, 200);
});
