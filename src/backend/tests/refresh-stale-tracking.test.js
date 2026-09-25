// Refreshing courier status for the Activations page. Delhivery is never
// reached: fetch is replaced, and the env points at example.invalid.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { refreshStaleTracking, TRACKING_TTL_MS } from "../lib/core/order-tracking.js";

const MARK = `trk${Date.now()}`;
// Not a test_ prefix on purpose: the helper refuses a disposable run, which is
// asserted separately below. Only the stubbed fetch sees this env.
const ENV = {
  mongoCollectionPrefix: "prod_",
  delhiveryApiKey: "key",
  delhiveryPickupLocation: "ParkTag",
  delhiveryBaseUrl: "https://example.invalid"
};

let app;
let collections;
const realFetch = globalThis.fetch;
let calls = [];

function stubDelhivery(statusByWaybill, { hang = [] } = {}) {
  calls = [];
  globalThis.fetch = async (url) => {
    const waybill = new URL(url).searchParams.get("waybill");
    calls.push(waybill);
    if (hang.includes(waybill)) return new Promise(() => {});
    const status = statusByWaybill[waybill];
    const body = status
      ? { ShipmentData: [{ Shipment: { Status: { Status: status, StatusDateTime: "2026-09-20T10:00:00" }, Scans: [] } }] }
      : { ShipmentData: [] };
    return new Response(JSON.stringify(body));
  };
}

let seq = 0;
async function insertOrder(fields = {}) {
  const doc = {
    orderNumber: `${MARK}-${++seq}`,
    status: "paid",
    testMarker: MARK,
    createdAt: new Date().toISOString(),
    ...fields
  };
  const { insertedId } = await collections.shopOrders.insertOne(doc);
  return { ...doc, _id: insertedId };
}
const stale = (minutesAgo) => ({
  status: "In Transit",
  fetchedAt: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()
});

before(async () => {
  ({ app, collections } = await startTestApp());
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
after(async () => {
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await stopTestApp(app);
});

test("only stale, shipped, undelivered orders are checked, and Delivered is stamped", async () => {
  const due = await insertOrder({ waybill: `${MARK}A`, trackingCache: stale(60) });
  const neverChecked = await insertOrder({ waybill: `${MARK}B` });
  const fresh = await insertOrder({ waybill: `${MARK}C`, trackingCache: stale(1) });
  const delivered = await insertOrder({ waybill: `${MARK}D`, deliveredAt: new Date().toISOString() });
  const noWaybill = await insertOrder({});

  stubDelhivery({ [`${MARK}A`]: "Delivered", [`${MARK}B`]: "In Transit" });
  const result = await refreshStaleTracking(collections, ENV, [due, neverChecked, fresh, delivered, noWaybill]);

  assert.equal(result.configured, true);
  assert.equal(result.checked, 2);
  assert.deepEqual(calls.sort(), [`${MARK}A`, `${MARK}B`].sort(), "fresh, delivered and unshipped orders are not looked up");
  // A went In Transit → Delivered; B had no status and now has one. Both moved.
  assert.equal(result.changed, 2);

  const a = await collections.shopOrders.findOne({ _id: due._id });
  assert.ok(a.deliveredAt, "Delivered is stamped on the order");
  assert.equal(a.trackingCache.status, "Delivered");
  const b = await collections.shopOrders.findOne({ _id: neverChecked._id });
  assert.equal(b.trackingCache.status, "In Transit");
  assert.equal(b.deliveredAt, undefined);
});

test("an unchanged status is not counted as a change", async () => {
  const order = await insertOrder({ waybill: `${MARK}E`, trackingCache: stale(60) });
  stubDelhivery({ [`${MARK}E`]: "In Transit" });
  const result = await refreshStaleTracking(collections, ENV, [order]);
  assert.equal(result.checked, 1);
  assert.equal(result.changed, 0);
});

test("the batch is capped, stalest first", async () => {
  const orders = [];
  for (let i = 0; i < 5; i++) {
    orders.push(await insertOrder({ waybill: `${MARK}L${i}`, trackingCache: stale(30 + i * 10) }));
  }
  stubDelhivery({});
  const result = await refreshStaleTracking(collections, ENV, orders, { limit: 2 });
  assert.equal(result.checked, 2);
  assert.deepEqual(calls.sort(), [`${MARK}L4`, `${MARK}L3`].sort(), "the two checked longest ago go first");
});

test("a hung courier call times out instead of holding the page", async () => {
  const order = await insertOrder({ waybill: `${MARK}H`, trackingCache: stale(60) });
  stubDelhivery({}, { hang: [`${MARK}H`] });
  const started = Date.now();
  const result = await refreshStaleTracking(collections, ENV, [order], { timeoutMs: 200 });
  assert.ok(Date.now() - started < 2000, "returns promptly");
  assert.equal(result.checked, 1);
  assert.equal(result.changed, 0);
});

test("nothing is looked up without Delhivery keys, or in a test run", async () => {
  const order = await insertOrder({ waybill: `${MARK}N`, trackingCache: stale(60) });
  stubDelhivery({ [`${MARK}N`]: "Delivered" });

  const unconfigured = await refreshStaleTracking(collections, { ...ENV, delhiveryApiKey: "" }, [order]);
  assert.deepEqual(unconfigured, { configured: false, checked: 0, changed: 0 });

  const testRun = await refreshStaleTracking(collections, { ...ENV, mongoCollectionPrefix: "test_" }, [order]);
  assert.deepEqual(testRun, { configured: false, checked: 0, changed: 0 });

  assert.equal(calls.length, 0, "Delhivery was never called");
});

test("the refresh endpoint is admin-only and never reaches Delhivery in a test run", async () => {
  const anon = await app.inject({
    method: "POST",
    url: "/api/admin/activations/refresh-tracking",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN }
  });
  assert.ok([401, 403].includes(anon.statusCode), `expected 401/403, got ${anon.statusCode}`);

  const email = `${MARK}-admin@parktag.test`;
  await collections.admins.insertOne({
    email, role: "admin", passwordHash: await createPasswordHash("test-password-123"), createdAt: new Date().toISOString()
  });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/admin/login",
      remoteAddress: uniqueAddress(),
      headers: { origin: TEST_ORIGIN },
      payload: { email, password: "test-password-123" }
    });
    assert.equal(login.statusCode, 200);

    // An order the refresh would pick up if it were allowed to.
    await insertOrder({
      waybill: `${MARK}R`,
      trackingCache: stale(60),
      shippingAddress: { fullName: "Refresh Buyer", phone: "9800012345" }
    });
    stubDelhivery({ [`${MARK}R`]: "Delivered" });
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/activations/refresh-tracking",
      remoteAddress: uniqueAddress(),
      headers: { origin: TEST_ORIGIN, cookie: login.headers["set-cookie"] }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().configured, false, "a test run reports the courier as not configured");
    assert.equal(calls.length, 0, "and makes no call");
    assert.ok(TRACKING_TTL_MS > 0);
  } finally {
    await collections.admins.deleteMany({ email });
    await purgeLoginCollections(collections);
  }
});
