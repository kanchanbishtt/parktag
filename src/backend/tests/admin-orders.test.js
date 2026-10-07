// The admin Orders page: every order as stored, with the amount, how it was
// paid, the delivery address and where the parcel is. The numbers and words
// here come from the same helpers the checkout, the courier booking and the
// Activations page use, and one test places a real COD order through the
// checkout to prove the page shows what the checkout wrote.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

// place-cod never calls Razorpay, and the developer .env holds live keys.
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, createTestOwner, assertUndeliverableIdentifier, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { createSession } from "../lib/auth/session.js";
import { COD_SURCHARGE_PAISE } from "../routes/shop/index.js";
import { orderBreakdown, breakdownText } from "../lib/core/order-breakdown.js";

const ADMIN_EMAIL = "admin-orders-page@parktag.test";
const PASSWORD = "test-password-123";
const MARK = `ord${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;

let app;
let collections;
let adminCookie;
let seq = 0;

function authed(method, url, payload) {
  return app.inject({
    method, url, remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, cookie: adminCookie },
    ...(payload ? { payload } : {})
  });
}

async function insertOrder(overrides = {}) {
  seq += 1;
  const doc = {
    orderNumber: `${MARK}-${String(seq).padStart(3, "0")}`,
    orderId: `order_${MARK}_${seq}`,
    productId: "pt-car-1",
    productName: "ParkTag Car Tag (Pack of 1)",
    quantity: 1,
    amount: 29900,
    mrpPaise: 29900,
    currency: "INR",
    status: "paid",
    paymentMethod: "online",
    paymentId: `pay_${MARK}_${seq}`,
    paidAt: new Date(Date.now() - seq * DAY).toISOString(),
    guest: true,
    ownerId: null,
    channel: "shop",
    shippingAddress: {
      fullName: `Buyer ${MARK} ${seq}`, phone: `98${String(seq).padStart(8, "0")}`,
      line1: `${seq} Test Street`, line2: "Flat 4B", landmark: "Near the park", city: "Noida", state: "Uttar Pradesh", pincode: "201301"
    },
    testMarker: MARK,
    createdAt: new Date(Date.now() - seq * DAY).toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.shopOrders.insertOne(doc);
  return { ...doc, _id: insertedId };
}

async function list(query = "") {
  const response = await authed("GET", `/api/admin/orders${query}`);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
const find = (body, order) => body.orders.find((o) => o.orderNumber === order.orderNumber);

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.admins.insertOne({
    email: ADMIN_EMAIL, role: "admin", passwordHash: await createPasswordHash(PASSWORD), createdAt: new Date().toISOString()
  });
  const login = await app.inject({
    method: "POST", url: "/api/auth/admin/login", remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN }, payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200);
  adminCookie = login.headers["set-cookie"];
});

after(async () => {
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await collections.shopOrders.deleteMany({ "shippingAddress.fullName": `Checkout ${MARK}` });
  await collections.owners.deleteMany({ email: `orders-${MARK}@parktag-test.invalid` });
  await collections.addresses.deleteMany({ fullName: `Checkout ${MARK}` }).catch(() => {});
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("the orders endpoint and page are admin-only", async () => {
  const anon = await app.inject({ method: "GET", url: "/api/admin/orders", remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN } });
  assert.ok([401, 403].includes(anon.statusCode));
  const page = await app.inject({ method: "GET", url: "/admin/orders", remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN } });
  assert.equal(page.statusCode, 302);
});

test("a paid online order shows its amount, breakdown, address and payment mode exactly as stored", async () => {
  const order = await insertOrder({
    productId: "pt-car-2", productName: "ParkTag Car Tag (Pack of 2)", amount: 39900, mrpPaise: 49900,
    promoCode: "LAUNCH100", promoDiscountPaise: 10000, waybill: "59470510000954",
    trackingCache: { status: "In Transit", fetchedAt: new Date().toISOString() },
    attribution: { utm_source: "instagram", utm_medium: "paid", utm_campaign: "launch" }
  });
  const row = find(await list(), order);
  assert.ok(row, "a paid order is a sale");
  assert.equal(row.amountPaise, 39900);
  assert.equal(row.paymentMode, "online");
  assert.equal(row.paymentId, order.paymentId);
  assert.equal(row.priceBreakdown, breakdownText(orderBreakdown(order)), "the same breakdown the buyer and Razorpay see");
  assert.match(row.priceBreakdown, /LAUNCH100/);
  assert.deepEqual(
    { ...row.address, email: undefined },
    { fullName: order.shippingAddress.fullName, phone: order.shippingAddress.phone, email: undefined, line1: `${seq} Test Street`, line2: "Flat 4B", landmark: "Near the park", city: "Noida", state: "Uttar Pradesh", pincode: "201301", line: `${seq} Test Street, Flat 4B, Near the park, Noida, Uttar Pradesh, 201301` }
  );
  assert.equal(row.delivery.state, "shipped");
  assert.equal(row.courierStatus, "In Transit");
  assert.equal(row.waybill, "59470510000954");
  assert.match(row.trackingUrl, /59470510000954/);
  assert.deepEqual(row.stickers, { capacity: 2, linked: 0, mintedTagId: null, replaceTagId: null });
  assert.deepEqual(row.attribution, { source: "instagram", medium: "paid", campaign: "launch" });
  assert.equal(row.product.quantity, 1);
  assert.equal(row.guest, true);
});

test("COD, COD paid later, delivered, handed over and abandoned read as they are", async () => {
  const cod = await insertOrder({ status: "cod", paymentMethod: "cod", paymentId: undefined, paidAt: undefined, amount: 29900 + COD_SURCHARGE_PAISE, codSurchargePaise: COD_SURCHARGE_PAISE });
  const prepaid = await insertOrder({ status: "paid", paymentMethod: "cod", amount: 29900 + COD_SURCHARGE_PAISE, prepayAmount: 29900, codSurchargePaise: COD_SURCHARGE_PAISE, deliveredAt: new Date().toISOString(), waybill: "59470510000999" });
  const handover = await insertOrder({ channel: "whatsapp", manualEntry: true, deliveredInPerson: true, paymentMethod: "upi", paymentId: undefined, paymentRef: "gpay-ref-1" });
  const abandoned = await insertOrder({ status: "created", paymentId: undefined, paidAt: undefined });

  const sales = await list();
  const rCod = find(sales, cod);
  assert.equal(rCod.paymentMode, "cod");
  assert.equal(rCod.amountPaise, 29900 + COD_SURCHARGE_PAISE, "what the courier collects, fee included");
  assert.equal(rCod.codSurchargePaise, COD_SURCHARGE_PAISE);
  assert.equal(rCod.delivery.state, "not_shipped");

  const rPre = find(sales, prepaid);
  assert.equal(rPre.paymentMode, "cod_prepaid");
  assert.equal(rPre.amountPaise, 29900, "what was actually paid online");
  assert.equal(rPre.listedPaise, 29900 + COD_SURCHARGE_PAISE);
  assert.equal(rPre.delivery.state, "delivered");

  const rHand = find(sales, handover);
  assert.equal(rHand.delivery.state, "handed_over");
  assert.equal(rHand.paymentMode, "manual", "a hand sale is not 'online'");
  assert.equal(rHand.paymentMethod, "upi");
  assert.equal(rHand.paymentRef, "gpay-ref-1");
  assert.equal(rHand.manualEntry, true);
  assert.equal(rHand.channel, "whatsapp");

  assert.equal(find(sales, abandoned), undefined, "an unpaid checkout is not a sale");
  const ab = await list("?view=abandoned");
  const rAb = find(ab, abandoned);
  assert.ok(rAb, "it is in the abandoned view");
  assert.equal(rAb.status, "created");
  assert.equal(rAb.paymentMode, "online");
  assert.equal(find(await list("?view=all"), abandoned)?.status, "created");
  assert.equal(ab.counts.sales + ab.counts.abandoned + ab.counts.ours <= ab.counts.all, true);
});

test("our own test orders are a separate view, never in sales; deleted orders are nowhere", async () => {
  const ours = await insertOrder({ internal: true });
  const internalChannel = await insertOrder({ channel: "internal", amount: 0 });
  const deleted = await insertOrder({ deletedAt: new Date().toISOString() });

  const sales = await list();
  assert.equal(find(sales, ours), undefined);
  assert.equal(find(sales, internalChannel), undefined);
  assert.equal(find(sales, deleted), undefined);
  const mine = await list("?view=ours");
  assert.ok(find(mine, ours) && find(mine, internalChannel));
  assert.equal(find(mine, ours).internal, true);
  assert.equal(find(await list("?view=all"), deleted), undefined, "deleted is gone from every view");
});

test("search finds an order by number, buyer phone, pincode, waybill and payment id", async () => {
  const order = await insertOrder({
    shippingAddress: { fullName: `Needle ${MARK}`, phone: "9123456780", line1: "7 Lane", city: "Pune", state: "Maharashtra", pincode: "411045" },
    waybill: `AWB${MARK}`, paymentId: `pay_needle_${MARK}`
  });
  for (const q of [order.orderNumber, "9123456780", "+91 91234 56780", "411045", `AWB${MARK}`, `pay_needle_${MARK}`, `Needle ${MARK}`]) {
    const body = await list(`?q=${encodeURIComponent(q)}`);
    assert.ok(find(body, order), `search "${q}" must find the order`);
    assert.equal(body.counts.matching >= 1, true);
  }
  assert.equal(find(await list(`?q=${encodeURIComponent("nothing-" + MARK)}`), order), undefined);
});

test("newest first, 50 a page, with page counts", async () => {
  const body = await list("?view=all");
  assert.equal(body.pageSize, 50);
  assert.ok(body.pages >= 1 && body.page === 1);
  const times = body.orders.map((o) => Date.parse(o.createdAt || "") || 0);
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], "newest first");
  const past = await list("?view=all&page=9999");
  assert.equal(past.orders.length, 0);
});

test("an order placed through the real checkout shows the amount, address and COD mode the checkout wrote", async () => {
  const email = assertUndeliverableIdentifier(`orders-${MARK}@parktag-test.invalid`);
  const phone = "+919812340099";
  // Pre-trusted, so place-cod asks for no OTP and dispatches nothing.
  const owner = await createTestOwner(collections, { email, codVerifiedPhone: phone });
  const cookie = await createSession(app, { id: String(owner._id), role: "owner", email: owner.email, displayName: owner.displayName });
  await collections.addresses.insertOne({
    ownerId: owner._id, fullName: `Checkout ${MARK}`, phone, line1: "32/11 Wave One", line2: "Tower B", city: "Noida", state: "Uttar Pradesh", pincode: "201301"
  });

  const placed = await app.inject({
    method: "POST", url: "/api/shop/place-cod", remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN }, cookies: { wavetag_session: cookie }, payload: { productId: "pt-car-1" }
  });
  assert.equal(placed.statusCode, 200, placed.body);
  const orderNumber = placed.json().orderNumber || placed.json().order?.orderNumber;
  assert.ok(orderNumber, `the checkout returned no order number: ${placed.body}`);

  const stored = await collections.shopOrders.findOne({ orderNumber });
  assert.ok(stored, "the order is in MongoDB");
  const row = (await list(`?q=${encodeURIComponent(orderNumber)}`)).orders.find((o) => o.orderNumber === orderNumber);
  assert.ok(row, "and on the admin page");
  assert.equal(row.paymentMode, "cod");
  assert.equal(row.amountPaise, stored.amount, "the amount is the one the courier was told to collect");
  assert.equal(row.amountPaise, 29900 + COD_SURCHARGE_PAISE);
  assert.equal(row.address.fullName, `Checkout ${MARK}`);
  assert.equal(row.address.phone, stored.shippingAddress.phone);
  assert.equal(row.address.line, "32/11 Wave One, Tower B, Noida, Uttar Pradesh, 201301");
  assert.equal(row.owner?.id, String(owner._id));
  // The breakdown is whatever the shared helper can itemise honestly for this
  // order (a signed-in COD order stores no fee field, so it may be none);
  // the page never does its own arithmetic.
  assert.equal(row.priceBreakdown, breakdownText(orderBreakdown(stored)) || null);
  await collections.shopOrders.deleteOne({ _id: stored._id });
});
