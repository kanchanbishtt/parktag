// One price for everybody: a website offer is quoted and charged the same to a
// new visitor and a signed-in customer.
//
// The landing page reads its offer off /api/shop/public-catalogue and says
// "Duo Pack · 2 tags · ₹399". Its button goes to /shop, which sends a
// signed-in owner to the dashboard shop. That shop had its own price list and
// its order routes never applied the code, so the same tap charged ₹499 online
// and ₹548 on Cash on Delivery. The public pages had been aligned with the
// offer more than once; the dashboard was the copy nobody updated.
//
// Website offers are now promo codes with "Auto-apply on the website" on
// (autoApply). These tests hold every route, signed in and signed out, to the
// figure the catalogue quotes, for LAUNCH100 and for any other offer, and
// check that a typed code works the same way in the dashboard as on /direct.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSession } from "../lib/auth/session.js";
import { getRazorpay } from "../lib/integrations/payments.js";
import { settleAfterReply } from "../lib/core/after-reply.js";
import { promoLimitError } from "../lib/auth/token-limits.js";
import { createPasswordHash } from "../lib/auth/security.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier,
  TEST_ORIGIN
} from "./helpers.js";

// Placeholder keys, and the client they build has its order call replaced
// below: nothing here reaches Razorpay. Set after helpers.js has swept the
// ambient credentials (imports run first), the same way shop-verify-payment does.
const KEY_ID = "rzp_test_ci_placeholder";
const KEY_SECRET = "ci_placeholder_secret";
process.env.RAZORPAY_KEY_ID = KEY_ID;
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
// Not in helpers.js's sweep; a paid order reports to Mixpanel.
delete process.env.MIXPANEL_TOKEN;

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-launch-offer@parktag-test.invalid");
const PHONE = "+919812345678";
const ADDRESS = {
  fullName: "Launch Offer QA", phone: PHONE, line1: "1 Test St",
  city: "Delhi", state: "Delhi", pincode: "110001"
};
const GUEST_ADDRESS = { ...ADDRESS, phone: "9812345678", line2: "", landmark: "" };

// The rows commerce-defaults.js creates (LAUNCH100), and the extra codes these
// tests add. Any of them already in this database is put back afterwards.
const CODES = ["LAUNCH100", "SOLOQA50", "FRIENDQA150", "HANDQA100"];
const LAUNCH100 = {
  code: "LAUNCH100", discountMode: "flat", discountPaise: 10000, shippingFeePaise: 0,
  productIds: ["pt-car-2"], singleUse: false, boundPhone: null, maxUses: null,
  usedCount: 0, usedByOrders: [], expiresAt: null, fulfilment: "ship", autoApply: true, active: true,
  createdAt: new Date().toISOString()
};

let app;
let collections;
let ownerId;
let cookie;
const ADMIN_EMAIL = assertUndeliverableIdentifier("qa-offer-admin@parktag-test.invalid");
const ADMIN_PASSWORD = "offer-qa-Password-1";
let previousRows = [];
let minted = 0;

before(async () => {
  ({ app, collections } = await startTestApp());
  previousRows = await collections.promoCodes.find({ code: { $in: CODES } }).toArray();

  // Same key pair, so the same cached client the routes use.
  getRazorpay({ razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET }).orders.create =
    async ({ amount, currency }) => ({ id: `order_offer_qa_${++minted}`, amount, currency: currency || "INR" });
});

after(async () => {
  await settleAfterReply();
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await collections.admins.deleteMany({ email: ADMIN_EMAIL }).catch(() => {});
  await collections.promoCodes.deleteMany({ code: { $in: CODES } });
  if (previousRows.length) await collections.promoCodes.insertMany(previousRows);
  await stopTestApp(app);
});

beforeEach(async () => {
  await settleAfterReply();
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await collections.promoCodes.deleteMany({ code: { $in: CODES } });
  await collections.promoCodes.insertOne({ ...LAUNCH100 });

  const owner = await createTestOwner(collections, {
    email: OWNER_EMAIL,
    // Pre-trusted, so place-cod never asks for an OTP and nothing is sent.
    codVerifiedPhone: PHONE
  });
  ownerId = owner._id;
  cookie = await createSession(app, {
    id: String(ownerId), role: "owner", email: owner.email, displayName: owner.displayName
  });
  await collections.addresses.insertOne({ ownerId, ...ADDRESS });
});

const get = (url, withCookie = false) => app.inject({
  method: "GET", url, remoteAddress: uniqueAddress(),
  ...(withCookie ? { cookies: { wavetag_session: cookie } } : {})
});

const post = (url, payload, sessionCookie = cookie) => app.inject({
  method: "POST", url, remoteAddress: uniqueAddress(),
  ...(sessionCookie ? { cookies: { wavetag_session: sessionCookie } } : {}),
  headers: { origin: "http://localhost" },
  payload
});

const guestOrder = (body) => post("/api/shop/guest/create-order", { address: GUEST_ADDRESS, ...body }, null);

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

// What the landing page, /shop and /get read.
async function catalogue() {
  const res = await get("/api/shop/public-catalogue");
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

async function addCode(row) {
  await collections.promoCodes.insertOne({
    singleUse: false, boundPhone: null, maxUses: null, usedCount: 0, usedByOrders: [],
    expiresAt: null, fulfilment: "ship", active: true, createdAt: new Date().toISOString(), ...row
  });
}

describe("every page reads the same offers", () => {
  test("the dashboard's price list carries the catalogue's offers, read the same way", async () => {
    const pub = await catalogue();
    assert.equal(pub.launchOffer?.offerPaise, 39900, "LAUNCH100 is a website offer but the landing page would show none");
    assert.deepEqual(pub.offers["pt-car-2"], pub.launchOffer);

    const pricing = await get("/api/shop/pricing", true);
    assert.equal(pricing.statusCode, 200, pricing.body);
    assert.deepEqual(pricing.json().offers, pub.offers, "the dashboard and the landing page quote different offers");
    assert.deepEqual(pricing.json().launchOffer, pub.launchOffer);
  });

  test("a code without the switch is not shown or applied to anyone", async () => {
    await collections.promoCodes.updateOne({ code: "LAUNCH100" }, { $set: { autoApply: false } });
    const pub = await catalogue();
    assert.deepEqual(pub.offers, {});
    assert.equal(pub.launchOffer, null);

    const owner = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car" });
    assert.equal(owner.json().amount, 49900);
    const guest = await guestOrder({ productId: "pt-car-2" });
    assert.equal(guest.json().amount, 49900);
  });
});

describe("a signed-in customer is charged what a new visitor is", () => {
  test("Duo Pack online: owner and guest both pay the offer price, and the owner's payment verifies", async () => {
    const { launchOffer } = await catalogue();

    const created = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car" });
    assert.equal(created.statusCode, 200, created.body);
    const { orderId, amount } = created.json();
    assert.equal(amount, launchOffer.offerPaise, "the dashboard charged a different price from the one the landing page advertised");
    assert.equal(created.json().promoCode, "LAUNCH100");

    const order = await collections.shopOrders.findOne({ orderId });
    assert.equal(order.promoCode, "LAUNCH100");
    assert.equal(order.mrpPaise, launchOffer.mrpPaise);
    assert.equal(order.promoDiscountPaise, launchOffer.discountPaise);

    // verify-payment re-prices from the stored code; a discounted order it does
    // not recognise is refused as a mismatch after the buyer has paid.
    const paymentId = "pay_offer_qa_1";
    const verified = await post("/api/shop/verify-payment", {
      razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId)
    });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json().ok, true, verified.body);

    // A signed-out visitor on /shop or /get, which no longer send the code.
    const guest = await guestOrder({ productId: "pt-car-2" });
    assert.equal(guest.statusCode, 200, guest.body);
    assert.equal(guest.json().amount, launchOffer.offerPaise, "a signed-out visitor was charged differently");
  });

  test("Duo Pack on Cash on Delivery: offer price plus the fee, as on guest COD", async () => {
    const { launchOffer, codSurchargePaise } = await catalogue();
    const placed = await post("/api/shop/place-cod", { productId: "pt-car-2", variant: "Car" });
    assert.equal(placed.statusCode, 200, placed.body);
    assert.equal(placed.json().amount, launchOffer.offerPaise + codSurchargePaise);

    const order = await collections.shopOrders.findOne({ orderNumber: placed.json().orderNumber });
    assert.equal(order.amount, launchOffer.offerPaise + codSurchargePaise);
    assert.equal(order.promoCode, "LAUNCH100");
    const pricing = (await get("/api/shop/pricing", true)).json();
    assert.equal(order.amount - pricing.flashDiscountPaise, launchOffer.offerPaise, "the flash offer does not land on the offer price");
  });

  test("a pack no offer covers stays at its catalogue price", async () => {
    const created = await post("/api/shop/create-order", { productId: "pt-car-1", variant: "Car" });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().amount, 29900);
    assert.equal((await collections.shopOrders.findOne({ orderId: created.json().orderId })).promoCode, null);
  });

  test("an unpaid order from before the offer is not handed back at the old price", async () => {
    await collections.shopOrders.insertOne({
      orderId: "order_offer_qa_stale", orderNumber: "PT-261007-09999", paymentMethod: "online",
      ownerId, productId: "pt-car-2", productName: "ParkTag Car Tag (Pack of 2)", variant: "Car",
      amount: 49900, currency: "INR", status: "created", shippingAddress: ADDRESS,
      replaceTagId: null, createdAt: new Date().toISOString()
    });
    const created = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car" });
    assert.equal(created.statusCode, 200, created.body);
    assert.notEqual(created.json().orderId, "order_offer_qa_stale");
    assert.equal(created.json().amount, 39900);
  });

  test("/direct still sells at list price, as it was designed to", async () => {
    const res = await guestOrder({ productId: "pt-car-2", listPrice: true });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().amount, 49900);
  });
});

describe("a new website offer reaches every page and route at once", () => {
  test("switching one on for the Pack of 1 (₹50 per pack) prices it the same everywhere, at any quantity", async () => {
    await addCode({ code: "SOLOQA50", discountMode: "per_unit", discountPaise: 5000, productIds: ["pt-car-1"], autoApply: true });

    const pub = await catalogue();
    const solo = pub.offers["pt-car-1"];
    assert.ok(solo, "the new offer is missing from the catalogue");
    assert.equal(solo.offerPaise, 24900);
    assert.equal(solo.payableByQuantity[2], 3 * 29900 - 3 * 5000, "the per-quantity price does not follow a per-pack offer");
    assert.deepEqual((await get("/api/shop/pricing", true)).json().offers["pt-car-1"], solo);

    const owner = await post("/api/shop/create-order", { productId: "pt-car-1", variant: "Car" });
    assert.equal(owner.json().amount, 24900);
    assert.equal(owner.json().promoCode, "SOLOQA50");

    const guest = await guestOrder({ productId: "pt-car-1", quantity: 3 });
    assert.equal(guest.statusCode, 200, guest.body);
    assert.equal(guest.json().amount, solo.payableByQuantity[2], "/get's quantity price and the charge disagree");
  });

  test("two offers on one pack: the bigger saving wins, for everybody", async () => {
    await addCode({ code: "SOLOQA50", discountPaise: 15000, productIds: ["pt-car-2"], autoApply: true });
    const pub = await catalogue();
    assert.equal(pub.offers["pt-car-2"].code, "SOLOQA50");
    assert.equal(pub.offers["pt-car-2"].offerPaise, 34900);
    assert.equal((await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car" })).json().amount, 34900);
    assert.equal((await guestOrder({ productId: "pt-car-2" })).json().amount, 34900);
  });

  test("revoking an offer takes it off every page and route", async () => {
    await collections.promoCodes.updateOne({ code: "LAUNCH100" }, { $set: { active: false } });
    const pub = await catalogue();
    assert.equal(pub.launchOffer, null);
    assert.equal((await get("/api/shop/pricing", true)).json().launchOffer, null);
    assert.equal((await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car" })).json().amount, 49900);
    assert.equal((await guestOrder({ productId: "pt-car-2" })).json().amount, 49900);
  });
});

describe("a typed code works in the dashboard as it does on /direct", () => {
  test("a valid code replaces the website offer for that order, online and on COD", async () => {
    await addCode({ code: "FRIENDQA150", discountPaise: 15000, productIds: ["pt-car-2"] });

    const check = await post("/api/shop/promo/check", { code: "friendqa150", productId: "pt-car-2", context: "dashboard" });
    assert.equal(check.json().ok, true, check.body);
    assert.equal(check.json().payablePaise, 34900);

    const created = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car", promo: "friendqa150" });
    assert.equal(created.json().amount, 34900);
    assert.equal(created.json().promoCode, "FRIENDQA150");

    const { codSurchargePaise } = await catalogue();
    const placed = await post("/api/shop/place-cod", { productId: "pt-car-2", variant: "Car", promo: "FRIENDQA150" });
    assert.equal(placed.json().amount, 34900 + codSurchargePaise);
  });

  test("a code that does not apply falls back to the website offer and says why", async () => {
    const created = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car", promo: "NOPEQA99" });
    assert.equal(created.json().amount, 39900);
    assert.equal(created.json().promoCode, "LAUNCH100");
    assert.equal(created.json().promoRefused, "unknown");
  });

  test("a hand-over code is refused in the dashboard, which ships every order", async () => {
    await addCode({ code: "HANDQA100", discountPaise: 10000, fulfilment: "handover" });
    const check = await post("/api/shop/promo/check", { code: "HANDQA100", productId: "pt-car-2", context: "dashboard" });
    assert.equal(check.json().ok, false);
    assert.equal(check.json().reason, "handover-only");

    const created = await post("/api/shop/create-order", { productId: "pt-car-2", variant: "Car", promo: "HANDQA100" });
    assert.equal(created.json().amount, 39900);
    assert.equal(created.json().promoRefused, "handover-only");
  });
});

describe("the admin switch has guardrails", () => {
  // A real admin sign-in, the way admin-api-tokens.test.js signs in.
  async function adminCookie() {
    await collections.admins.deleteMany({ email: ADMIN_EMAIL });
    await collections.admins.insertOne({
      email: ADMIN_EMAIL, role: "admin", passwordHash: await createPasswordHash(ADMIN_PASSWORD), createdAt: new Date().toISOString()
    });
    const login = await app.inject({
      method: "POST", url: "/api/auth/admin/login", remoteAddress: uniqueAddress(),
      headers: { origin: TEST_ORIGIN }, payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    assert.equal(login.statusCode, 200, "admin fixture must be able to sign in");
    return login.headers["set-cookie"];
  }

  test("a website offer cannot be single-use, phone-bound or a hand-over code", async () => {
    const cookieHeader = await adminCookie();
    const create = (body) => app.inject({
      method: "POST", url: "/api/admin/promo-codes", remoteAddress: uniqueAddress(),
      headers: { origin: TEST_ORIGIN, cookie: cookieHeader }, payload: body
    });
    const base = { code: "SOLOQA50", discountMode: "flat", discountPaise: 5000, autoApply: true };
    for (const extra of [{ singleUse: true }, { boundPhone: "+919812345678" }, { fulfilment: "handover" }]) {
      const res = await create({ ...base, ...extra });
      assert.equal(res.statusCode, 400, `${JSON.stringify(extra)} was accepted: ${res.body}`);
    }
    const ok = await create(base);
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal((await catalogue()).offers["pt-car-1"]?.code, "SOLOQA50", "a code switched on in the panel did not reach the catalogue");
  });

  test("an API token cannot switch a code on for the whole site", () => {
    const token = { session: { via: "api-token" } };
    const doc = { discountMode: "flat", discountPaise: 5000, maxUses: 10, expiresAt: "2030-01-01T00:00:00Z", autoApply: true };
    assert.match(promoLimitError(token, doc) || "", /admin panel/);
    assert.equal(promoLimitError(token, { ...doc, autoApply: false }), null);
  });
});

describe("the pages show the server's offers", () => {
  // Coarse, like checkout-pricing's page checks: there is no DOM harness here.
  // What these catch is a page going back to its own numbers or its own code.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (p) => readFile(path.join(here, "../../frontend/scripts", p), "utf8");

  test("the dashboard shop reads the offers and prints no hard-coded card price", async () => {
    const page = await read("owner/welcome-shop.js");
    assert.ok(page.includes("_shopPricing.offers"), "the dashboard shop no longer reads the website offers");
    assert.doesNotMatch(page, /₹\$\{p\.(price|orig)\}/, "a card prints PRODUCTS' own price instead of the server's");
  });

  test("/shop and /get read the offers and leave applying them to the server", async () => {
    for (const name of ["shop.js", "get.js"]) {
      const page = await read(name);
      assert.ok(page.includes("payload.offers"), `${name} no longer reads the website offers`);
      assert.doesNotMatch(page, /promo:\s*(_launchOffer|offer)/, `${name} sends the offer code itself again`);
    }
  });

  test("/direct asks for list price", async () => {
    assert.match(await read("direct.js"), /listPrice: true/);
  });
});
