// QA, 2026-10-03: no wrong or invalid delivery address is taken, anywhere.
//
// Every route that accepts an address is driven with valid, invalid and
// unservable pincodes: guest create-order (online and Cash on Delivery), the
// guest COD code send, the COD address check, the owner's address save and
// the signed-in place-cod. Delhivery is configured with a fake base URL and
// its pincode answer is stubbed per test, so "unservable" is a real refusal
// from the courier's data, not an outage. The external guard turns the one
// courier booking a COD order attempts into a recorded shipmentError, so
// nothing is ever booked.
//
// What this found, and now pins:
//   - an 11-digit phone and a 7-digit pincode were cut to length and accepted;
//   - a state not on the list ("Mars") skipped the pincode check and shipped;
//   - signed-in place-cod never asked whether the courier collects cash at
//     the saved pincode (the address save only asks whether it delivers).

process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";
process.env.META_CAPI_ACCESS_TOKEN = "";
process.env.META_WHATSAPP_PHONE_NUMBER_ID = "";
process.env.META_WHATSAPP_ACCESS_TOKEN = "";
process.env.OLA_MAPS_API_KEY = "";
process.env.DELHIVERY_API_KEY = "qa-key";
process.env.DELHIVERY_PICKUP_LOCATION = "ParkTag";
process.env.DELHIVERY_BASE_URL = "https://delhivery.invalid";

import test, { before, after, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { startTestApp, stopTestApp, uniqueAddress, createTestOwner, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import { createOtpHash } from "../lib/auth/security.js";
import { normalizeIdentifier, OTP_PURPOSE_COD_VERIFY } from "../lib/auth/otp.js";
import { validateAddress, INDIAN_STATES } from "../lib/core/address.js";

let app, collections;

const ADDRESS = {
  fullName: "QA Tester", phone: "9812300001", line1: "12B, MG Road", line2: "", landmark: "",
  city: "New Delhi", state: "Delhi", pincode: "110052"
};
const CODE = "424242";

// Delhivery's pincode answer for the next requests.
const realFetch = globalThis.fetch;
function courierSays(answer) {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/c/api/pin-codes/")) {
      if (answer === "outage") throw new Error("ECONNRESET");
      const codes = answer === "unknown-pincode" ? [] : [{ postal_code: { pre_paid: answer.prepaid ? "Y" : "N", cash: answer.cod ? "Y" : "N" } }];
      return new Response(JSON.stringify({ delivery_codes: codes }), { status: 200 });
    }
    return realFetch(url, init);
  };
}
const SERVED = { prepaid: true, cod: true };
const PREPAID_ONLY = { prepaid: true, cod: false };

const post = (url, payload, extra = {}) => app.inject({ method: "POST", url, remoteAddress: uniqueAddress(), payload, ...extra });
const createOrder = (address, more = {}) => post("/api/shop/guest/create-order", { productId: "pt-car-1", address, ...more });

async function proveCodPhone(phone = ADDRESS.phone) {
  await collections.otpTokens.insertOne({
    identifier: normalizeIdentifier(phone), purpose: OTP_PURPOSE_COD_VERIFY, codeHash: await createOtpHash(CODE),
    used: false, attempts: 0, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString()
  });
  const res = await post("/api/shop/guest/cod-otp/verify", { phone, otp: CODE });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().codToken;
}

before(async () => { ({ app, collections } = await startTestApp()); });
after(async () => {
  globalThis.fetch = realFetch;
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await collections.otpTokens.deleteMany({ identifier: normalizeIdentifier(ADDRESS.phone) }).catch(() => {});
  await collections.rateLimits.deleteMany({ _id: /^guest-cod/ }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});
beforeEach(async () => {
  courierSays(SERVED);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.rateLimits.deleteMany({ _id: /^guest-cod/ }).catch(() => {});
  await collections.otpTokens.deleteMany({ identifier: normalizeIdentifier(ADDRESS.phone) }).catch(() => {});
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("the validator refuses every wrong address", () => {
  const bad = [
    ["an 11-digit phone", { phone: "98123000012" }, /10-digit mobile/],
    ["a 9-digit phone", { phone: "981230000" }, /10-digit mobile/],
    ["a phone starting with 5", { phone: "5812300001" }, /10-digit mobile/],
    ["a phone with spaces", { phone: "98123 00001" }, /10-digit mobile/],
    ["a 7-digit pincode", { pincode: "1100529" }, /6-digit pincode/],
    ["a 5-digit pincode", { pincode: "11005" }, /6-digit pincode/],
    ["a pincode with a leading zero", { pincode: "011052" }, /6-digit pincode/],
    ["letters in the pincode", { pincode: "11OO52" }, /6-digit pincode/],
    ["a pincode from another state", { state: "Kerala" }, /in Delhi, not Kerala/],
    ["a state that is not on the list", { state: "Mars" }, /choose your state/],
    ["a state spelt as a code", { state: "DL" }, /choose your state/],
    ["no state", { state: "" }, /state/],
    ["a one-letter city", { city: "N" }, /city/],
    ["a street of three characters", { line1: "abc" }, /house|street/],
    ["a street of spaces only", { line1: "        " }, /house|street/],
    ["a one-letter name", { fullName: "Q" }, /full name/],
    ["no name", { fullName: "" }, /full name/]
  ];
  for (const [name, patch, reason] of bad) {
    test(`${name} is refused`, () => {
      const result = validateAddress({ ...ADDRESS, ...patch });
      assert.equal(result.ok, false);
      assert.match(result.error, reason);
    });
  }

  test("nothing at all is refused, not accepted by default", () => {
    assert.equal(validateAddress(undefined).ok, false);
    assert.equal(validateAddress({}).ok, false);
  });

  for (const [name, patch] of [
    ["the plain case", {}],
    ["Delhi spelt as NCT of Delhi", { state: "NCT of Delhi" }],
    ["a Bengaluru pincode in Karnataka", { pincode: "560001", state: "Karnataka" }],
    ["a border pincode in either state (Chandigarh 160017)", { pincode: "160017", state: "Punjab" }],
    ["a pincode sent as a number", { pincode: 110052 }],
    ["padding spaces around the fields", { phone: " 9812300001 ", pincode: " 110052 ", city: " New Delhi " }]
  ]) {
    test(`${name} is accepted, and normalised`, () => {
      const result = validateAddress({ ...ADDRESS, ...patch });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.address.phone, "9812300001");
      assert.match(result.address.pincode, /^\d{6}$/);
    });
  }

  test("the list the sheet offers is exactly the list the server knows", () => {
    const sheet = fs.readFileSync(new URL("../../frontend/scripts/owner/address-step.js", import.meta.url), "utf8");
    const listed = sheet.slice(sheet.indexOf("var STATES = ["), sheet.indexOf("];", sheet.indexOf("var STATES = [")));
    const states = [...listed.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(states, [...INDIAN_STATES]);
  });
});

describe("guest create-order", () => {
  test("a valid address at a served pincode is taken (Cash on Delivery)", async () => {
    const res = await createOrder(ADDRESS, { paymentMethod: "cod", codToken: await proveCodPhone() });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().paymentMethod, "cod");
  });

  for (const [name, patch, reason] of [
    ["an 11-digit phone", { phone: "98123000012" }, /10-digit mobile/],
    ["a 7-digit pincode", { pincode: "1100529" }, /6-digit pincode/],
    ["a state not on the list", { state: "Mars" }, /choose your state/],
    ["a pincode from another state", { state: "Kerala" }, /not Kerala/]
  ]) {
    test(`${name} is refused online, with nothing written`, async () => {
      const res = await createOrder({ ...ADDRESS, ...patch });
      assert.equal(res.statusCode, 400);
      assert.match(res.json().error, reason);
      assert.equal(await collections.shopOrders.countDocuments({}), 0);
    });
    test(`${name} is refused for Cash on Delivery, with nothing written`, async () => {
      const res = await createOrder({ ...ADDRESS, ...patch }, { paymentMethod: "cod", codToken: await proveCodPhone() });
      assert.equal(res.statusCode, 400);
      assert.match(res.json().error, reason);
      assert.equal(await collections.shopOrders.countDocuments({}), 0);
    });
  }

  test("a pincode the courier does not serve is refused online, before any payment", async () => {
    courierSays("unknown-pincode");
    const res = await createOrder(ADDRESS);
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /can't deliver to that pincode/);
    assert.equal(await collections.shopOrders.countDocuments({}), 0);
  });

  test("a pincode the courier does not serve is refused for Cash on Delivery", async () => {
    courierSays("unknown-pincode");
    const res = await createOrder(ADDRESS, { paymentMethod: "cod", codToken: await proveCodPhone() });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /not available at this pincode/);
    assert.equal(await collections.shopOrders.countDocuments({}), 0);
  });

  test("a prepaid-only pincode takes an online order but refuses Cash on Delivery", async () => {
    courierSays(PREPAID_ONLY);
    const cod = await createOrder(ADDRESS, { paymentMethod: "cod", codToken: await proveCodPhone() });
    assert.equal(cod.statusCode, 400);
    assert.match(cod.json().error, /not available at this pincode/);
    // Online gets past the pincode check (and on to Razorpay, which this run
    // has no keys for: that refusal names Razorpay, not the pincode).
    const online = await createOrder(ADDRESS);
    assert.doesNotMatch(online.json().error || "", /pincode/);
  });

  test("a courier outage fails open: the pincode cannot be judged, the order is taken", async () => {
    courierSays("outage");
    const res = await createOrder(ADDRESS, { paymentMethod: "cod", codToken: await proveCodPhone() });
    assert.equal(res.statusCode, 200, res.body);
  });
});

describe("the guest COD code send", () => {
  test("refuses a pincode the courier will not collect cash at, before any code is sent", async () => {
    courierSays(PREPAID_ONLY);
    const res = await post("/api/shop/guest/cod-otp/send", { phone: ADDRESS.phone, pincode: ADDRESS.pincode });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /not available at this pincode/);
    assert.equal(await collections.otpTokens.countDocuments({ identifier: normalizeIdentifier(ADDRESS.phone) }), 0);
  });

  for (const [name, pincode] of [["a 7-digit pincode", "1100529"], ["a 5-digit pincode", "11005"], ["a leading zero", "011052"]]) {
    test(`refuses ${name} outright`, async () => {
      const res = await post("/api/shop/guest/cod-otp/send", { phone: ADDRESS.phone, pincode });
      assert.equal(res.statusCode, 400);
      assert.match(res.json().error, /6-digit pincode/);
    });
  }
});

describe("the COD address check", () => {
  test("a pincode from another state is a definite mismatch", async () => {
    const res = await post("/api/shop/address-check", { address: { ...ADDRESS, state: "Kerala" } });
    assert.deepEqual(res.json(), { ok: true, validated: false });
  });
  test("an address the validator refuses is 'unknown', never 'fine'", async () => {
    const res = await post("/api/shop/address-check", { address: { ...ADDRESS, pincode: "1100529" } });
    assert.deepEqual(res.json(), { ok: true, validated: null });
  });
});

describe("the owner's saved address and signed-in Cash on Delivery", () => {
  let cookie, ownerId;
  before(async () => {
    const owner = await createTestOwner(collections, { email: `address-qa-${Date.now()}@example.invalid`, mobile: ADDRESS.phone, codVerifiedPhone: normalizeIdentifier(ADDRESS.phone) });
    ownerId = owner._id;
    cookie = await createSession(app, { id: String(ownerId), role: "owner", email: owner.email, displayName: "QA" });
  });
  const asOwner = (url, payload) => post(url, payload, { cookies: { wavetag_session: cookie }, headers: { origin: TEST_ORIGIN } });
  beforeEach(() => collections.addresses.deleteMany({ ownerId }));

  test("a valid address at a served pincode is saved", async () => {
    const res = await asOwner("/api/owner/address", ADDRESS);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((await collections.addresses.findOne({ ownerId })).pincode, ADDRESS.pincode);
  });

  for (const [name, patch, reason] of [
    ["an 11-digit phone", { phone: "98123000012" }, /10-digit mobile/],
    ["a 7-digit pincode", { pincode: "1100529" }, /6-digit pincode/],
    ["a state not on the list", { state: "Mars" }, /choose your state/],
    ["a pincode from another state", { state: "Kerala" }, /not Kerala/]
  ]) {
    test(`${name} is not saved`, async () => {
      const res = await asOwner("/api/owner/address", { ...ADDRESS, ...patch });
      assert.equal(res.statusCode, 400);
      assert.match(res.json().error, reason);
      assert.equal(await collections.addresses.findOne({ ownerId }), null);
    });
  }

  test("a pincode the courier does not serve is not saved", async () => {
    courierSays("unknown-pincode");
    const res = await asOwner("/api/owner/address", ADDRESS);
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /can't currently deliver to that pincode/);
    assert.equal(await collections.addresses.findOne({ ownerId }), null);
  });

  test("signed-in Cash on Delivery refuses a prepaid-only pincode, with nothing written", async () => {
    await collections.addresses.insertOne({ ownerId, ...ADDRESS, createdAt: new Date().toISOString() });
    courierSays(PREPAID_ONLY);
    const res = await asOwner("/api/shop/place-cod", { productId: "pt-car-2" });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /not available at this pincode/);
    assert.equal(await collections.shopOrders.countDocuments({ ownerId }), 0);
  });

  test("signed-in Cash on Delivery at a served pincode is placed", async () => {
    await collections.addresses.insertOne({ ownerId, ...ADDRESS, createdAt: new Date().toISOString() });
    const res = await asOwner("/api/shop/place-cod", { productId: "pt-car-2" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().ok, true);
  });
});
