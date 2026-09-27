// /api/shop/address-suggest proxies Ola Maps. It must never break the delivery
// sheet: no key, a short query or a failed lookup all answer 200 with an empty
// list, and a real answer is trimmed to { main, secondary, pincode }.
import test, { before, after, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app;
const realFetch = globalThis.fetch;
const get = (q) => app.inject({ method: "GET", url: `/api/shop/address-suggest?q=${encodeURIComponent(q)}&pin=201301`, remoteAddress: uniqueAddress() });

before(async () => { ({ app } = await startTestApp()); });
after(async () => { await stopTestApp(app); });
afterEach(() => { globalThis.fetch = realFetch; delete process.env.OLA_MAPS_API_KEY; });

describe("address suggestions", () => {
  test("no key configured: an empty list, not an error", async () => {
    const res = await get("Sector 18");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, suggestions: [] });
  });

  test("maps Ola predictions and biases the query with the PIN", async () => {
    process.env.OLA_MAPS_API_KEY = "k";
    let called;
    globalThis.fetch = async (url, init) => {
      called = { url: String(url), init };
      return { ok: true, json: async () => ({ predictions: [{
        description: "Wave Mall, Pocket J, Sector 18, Noida, Uttar Pradesh 201301",
        structured_formatting: { main_text: "Wave Mall", secondary_text: "Pocket J, Sector 18, Noida, Uttar Pradesh 201301" }
      }] }) };
    };
    const res = await get("Wave");
    assert.deepEqual(res.json().suggestions, [{ main: "Wave Mall", secondary: "Pocket J, Sector 18, Noida, Uttar Pradesh 201301", pincode: "201301" }]);
    assert.equal(new URL(called.url).searchParams.get("input"), "Wave 201301");
    assert.equal(called.init.headers.Origin, "https://app.parktag.me");
  });

  test("a failed lookup still answers with an empty list", async () => {
    process.env.OLA_MAPS_API_KEY = "k";
    globalThis.fetch = async () => { throw new Error("down"); };
    assert.deepEqual((await get("Sector 18")).json(), { ok: true, suggestions: [] });
  });
});

describe("COD address check", () => {
  const address = { fullName: "QA", phone: "9812300001", line1: "Wave Mall", city: "Noida", state: "Uttar Pradesh", pincode: "201301" };
  const check = (a = address) => app.inject({ method: "POST", url: "/api/shop/address-check", payload: { address: a }, remoteAddress: uniqueAddress() });

  test("a pincode from another state is refused without asking Ola", async () => {
    process.env.OLA_MAPS_API_KEY = "k";
    let asked = false;
    globalThis.fetch = async () => { asked = true; return { ok: true, json: async () => ({ result: { validated: true } }) }; };
    assert.deepEqual((await check({ ...address, pincode: "560001" })).json(), { ok: true, validated: false });
    assert.equal(asked, false);
  });

  test("no key: unknown, never a refusal", async () => {
    assert.deepEqual((await check()).json(), { ok: true, validated: null });
  });

  test("passes Ola's verdict through", async () => {
    process.env.OLA_MAPS_API_KEY = "k";
    let asked;
    globalThis.fetch = async (url) => { asked = String(url); return { ok: true, json: async () => ({ result: { validated: false } }) }; };
    assert.deepEqual((await check()).json(), { ok: true, validated: false });
    assert.equal(new URL(asked).searchParams.get("address"), "Wave Mall, Noida, Uttar Pradesh, 201301");
  });
});
