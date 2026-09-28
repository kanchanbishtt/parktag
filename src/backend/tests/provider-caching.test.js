// M5: read-through caches for answers that are the same for everyone, and the
// order list no longer waiting on the courier.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { createLoaderCache } from "../lib/core/loader-cache.js";
import { checkPincodeServiceability } from "../lib/integrations/delhivery.js";
import {
  cachedOrderTracking,
  refreshTrackingInBackground,
  TRACKING_TTL_MS
} from "../lib/core/order-tracking.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("loader cache: a stored answer is reused, an uncacheable one is not", async () => {
  const cached = createLoaderCache({ ttlMs: 1000, cacheable: (v) => v.ok });
  let calls = 0;
  const load = (result) => () => {
    calls += 1;
    return Promise.resolve(result);
  };

  await cached("a", load({ ok: true }));
  await cached("a", load({ ok: true }));
  assert.equal(calls, 1);

  await cached("b", load({ ok: false }));
  await cached("b", load({ ok: false }));
  assert.equal(calls, 3, "a failure must be asked again");
});

test("loader cache: concurrent misses share one load, and it expires", async () => {
  const cached = createLoaderCache({ ttlMs: 40 });
  let calls = 0;
  const load = async () => {
    calls += 1;
    await sleep(10);
    return { n: calls };
  };

  const [x, y] = await Promise.all([cached("k", load), cached("k", load)]);
  assert.equal(calls, 1);
  assert.equal(x, y);

  await sleep(60);
  await cached("k", load);
  assert.equal(calls, 2);
});

test("loader cache: disabled passes straight through, and a load error is not stored", async () => {
  const off = createLoaderCache({ ttlMs: 1000, enabled: false });
  let calls = 0;
  await off("k", async () => ++calls);
  await off("k", async () => ++calls);
  assert.equal(calls, 2);

  const on = createLoaderCache({ ttlMs: 1000 });
  await assert.rejects(on("k", async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await on("k", async () => "recovered"), "recovered");
});

const delhiveryEnv = (extra = {}) => ({
  delhiveryApiKey: "k",
  delhiveryPickupLocation: "loc",
  delhiveryBaseUrl: "https://delhivery.test",
  ...extra
});

function stubPincodeFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return responder(calls.length);
  };
  return calls;
}

const okPincode = () =>
  new Response(JSON.stringify({ delivery_codes: [{ postal_code: { pre_paid: "Y", cash: "N" } }] }), { status: 200 });

test("pincode serviceability: a good answer is cached in production only", async () => {
  const calls = stubPincodeFetch(okPincode);

  const prod = delhiveryEnv({ runtimeMode: "production" });
  const first = await checkPincodeServiceability(prod, "560001");
  const second = await checkPincodeServiceability(prod, "560001");
  assert.deepEqual(first, { serviceable: true, cod: false, prepaid: true });
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);

  await checkPincodeServiceability(prod, "110001");
  assert.equal(calls.length, 2, "another pincode is another lookup");

  const dev = delhiveryEnv({ runtimeMode: "dev" });
  await checkPincodeServiceability(dev, "560001");
  await checkPincodeServiceability(dev, "560001");
  assert.equal(calls.length, 4, "dev asks the courier every time");
});

test("pincode serviceability: an outage is not remembered", async () => {
  const calls = stubPincodeFetch((n) =>
    n === 1 ? new Response("upstream down", { status: 503 }) : okPincode()
  );
  const prod = delhiveryEnv({ runtimeMode: "production", delhiveryBaseUrl: "https://outage.test" });

  assert.equal((await checkPincodeServiceability(prod, "700001")).serviceable, null);
  assert.equal((await checkPincodeServiceability(prod, "700001")).serviceable, true);
  assert.equal(calls.length, 2);
});

test("order tracking: the request path reads the stored snapshot and refreshes stale ones in the background", async () => {
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(
      JSON.stringify({ ShipmentData: [{ Shipment: { Status: { Status: "In Transit" }, Scans: [] } }] }),
      { status: 200 }
    );
  };

  const now = Date.now();
  const fresh = { _id: "o1", waybill: "W1", trackingCache: { status: "Manifested", fetchedAt: new Date(now).toISOString() } };
  const stale = {
    _id: "o2",
    waybill: "W2",
    trackingCache: { status: "Manifested", fetchedAt: new Date(now - TRACKING_TTL_MS - 1000).toISOString() }
  };
  const missing = { _id: "o3", waybill: "W3" };
  const delivered = {
    _id: "o4",
    waybill: "W4",
    trackingCache: { status: "Delivered", fetchedAt: new Date(now - 5 * TRACKING_TTL_MS).toISOString() }
  };
  const unshipped = { _id: "o5" };

  const updates = [];
  const collections = { shopOrders: { updateOne: async (filter) => updates.push(filter._id) } };

  // The read is immediate and never touches the network.
  assert.equal(cachedOrderTracking(stale).status, "Manifested");
  assert.equal(cachedOrderTracking(missing), null);
  assert.equal(cachedOrderTracking(unshipped), null);

  const returned = refreshTrackingInBackground(
    collections, delhiveryEnv(), [fresh, stale, missing, delivered, unshipped], null, now
  );
  assert.equal(returned, undefined, "nothing for the caller to await");
  assert.deepEqual(updates, [], "the snapshots are not written before the caller has its answer");

  await sleep(50);
  assert.equal(fetched.length, 2);
  assert.ok(fetched.some((u) => u.includes("W2")) && fetched.some((u) => u.includes("W3")));
  assert.deepEqual(updates.sort(), ["o2", "o3"]);
});

test("order tracking: a failing refresh never throws into the caller", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const collections = { shopOrders: { updateOne: async () => {} } };
  assert.doesNotThrow(() =>
    refreshTrackingInBackground(collections, delhiveryEnv(), [{ _id: "o9", waybill: "W9" }], null)
  );
  await sleep(30);
});
