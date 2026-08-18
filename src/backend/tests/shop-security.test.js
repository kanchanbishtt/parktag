// Context Shop, findings HIGH #1 and HIGH #2.
//
// #1 — /api/shop/cod-otp/send minted an ordinary `auth` code, i.e. a working
// sign-in credential, and sent it to the delivery phone. That number is typed
// into the address form by whoever is checking out, so the endpoint was a way
// to have ParkTag send a login-capable code — worded as a sign-in code, from
// the real sender — to any number the caller chose. Read that code back over
// the phone to a "support" caller and the account is gone. Both directions were
// reproduced before the fix: a login code authorised a COD order, and a
// shop-issued code returned 200 with a session cookie at /api/auth/verify-otp.
//
// #2 — getShopProduct did a bare SHOP_PRODUCTS[productId], which reaches
// Object.prototype. "constructor", "__proto__", "toString" and "valueOf" all
// returned something truthy, passed the caller's "Unknown product" check, and
// produced a product with no `amount` — so place-cod wrote a real order for NaN
// rupees. Delhivery is unconfigured locally but configured in production, where
// that books a shipment with a broken cash-collection figure.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

// Disarm the live WhatsApp channel for THIS process, before anything reads the
// environment. sendOtp's mobile branch calls the Meta API whenever these two are
// set, and a developer .env does set them — so exercising the real send routes
// below would message whoever owns the test number. With them gone, sendOtp
// takes its dev console fallback and dispatches nothing. getEnv() re-reads
// process.env on every call, so deleting them here is enough; each test file is
// its own process, so no other suite is affected. Asserted, never assumed:
// every test that calls a send route re-checks isMetaWhatsappConfigured first
// and fails rather than sending.
delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
delete process.env.META_WHATSAPP_ACCESS_TOKEN;

import { createSession } from "../lib/auth/session.js";
import { createOtpHash } from "../lib/auth/security.js";
import { getEnv } from "../lib/env.js";
import { isMetaWhatsappConfigured } from "../lib/integrations/meta.js";
import { getShopProduct, SHOP_PRODUCTS } from "../lib/integrations/payments.js";
import {
  OTP_PURPOSE_AUTH,
  OTP_PURPOSE_COD_VERIFY,
  OTP_PURPOSE_LINK_MOBILE
} from "../lib/auth/otp.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-shop-sec@parktag-test.invalid");
// Never sent to. Every OTP below is written straight into the collection, so no
// WhatsApp message is dispatched — the Meta API is live in a developer env.
const PHONE = "+919812345678";
const CODE = "424242";

let app;
let collections;
let ownerId;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.shopOrders.deleteMany({}).catch(() => {});
  await collections.addresses.deleteMany({}).catch(() => {});

  const owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  ownerId = owner._id;
  cookie = await createSession(app, {
    id: String(ownerId), role: "owner", email: owner.email, displayName: owner.displayName
  });
  await collections.addresses.insertOne({
    ownerId, fullName: "Shop QA", phone: PHONE, line1: "1 Test St",
    city: "Delhi", state: "Delhi", pincode: "110001"
  });
});

// A live, unused code for `identifier`, exactly as sendOtp would have written it
// for that purpose. Writing it directly is what keeps this suite from sending a
// real message.
async function plantCode(identifier, purpose) {
  await collections.otpTokens.insertOne({
    identifier,
    purpose,
    codeHash: await createOtpHash(CODE),
    used: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
}

function placeCod(payload) {
  return app.inject({
    method: "POST",
    url: "/api/shop/place-cod",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    payload
  });
}

describe("HIGH #1 — a COD code and a sign-in code are not interchangeable", () => {
  test("a sign-in code does not authorise a COD order", async () => {
    await plantCode(PHONE, OTP_PURPOSE_AUTH);

    const response = await placeCod({ productId: "pt-car-1", otp: CODE });

    assert.equal(
      response.statusCode,
      400,
      `a login code placed a COD order: ${response.statusCode} ${response.body}`
    );
    assert.equal(await collections.shopOrders.countDocuments({ ownerId }), 0);
  });

  test("a COD code does not sign anybody in", async () => {
    // The takeover direction, and the one that mattered: the attacker picks the
    // destination by typing it into their own delivery address.
    await plantCode(PHONE, OTP_PURPOSE_COD_VERIFY);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/verify-otp",
      remoteAddress: uniqueAddress(),
      payload: { identifier: PHONE, code: CODE }
    });

    assert.notEqual(response.statusCode, 200, `a COD code logged in: ${response.body}`);
    const session = response.cookies.find((c) => c.name === "wavetag_session" && c.value);
    assert.equal(session, undefined, "a COD code was exchanged for a session cookie");
    assert.equal(
      await collections.owners.countDocuments({ mobile: PHONE }),
      0,
      "a COD code created an account for that number"
    );
  });

  test("a link-mobile code does not sign anybody in either", async () => {
    // /api/owner/mobile/send-otp takes the number straight from the request
    // body, so it was the most direct version of the same problem.
    await plantCode(PHONE, OTP_PURPOSE_LINK_MOBILE);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/verify-otp",
      remoteAddress: uniqueAddress(),
      payload: { identifier: PHONE, code: CODE }
    });

    assert.notEqual(response.statusCode, 200);
    assert.equal(response.cookies.find((c) => c.name === "wavetag_session" && c.value), undefined);
  });

  test("a link-mobile code does not authorise a COD order", async () => {
    // The two non-auth purposes must not collapse into each other either.
    await plantCode(PHONE, OTP_PURPOSE_LINK_MOBILE);

    const response = await placeCod({ productId: "pt-car-1", otp: CODE });

    assert.equal(response.statusCode, 400, `a link-mobile code placed an order: ${response.body}`);
    assert.equal(await collections.shopOrders.countDocuments({ ownerId }), 0);
  });

  test("the right code still places the order", async () => {
    // Otherwise the four refusals above could be a broken COD flow rather than
    // a scoped one.
    await plantCode(PHONE, OTP_PURPOSE_COD_VERIFY);

    const response = await placeCod({ productId: "pt-car-1", otp: CODE });

    assert.equal(response.statusCode, 200, `COD checkout is broken: ${response.body}`);
    assert.equal(response.json().ok, true);
    assert.equal(await collections.shopOrders.countDocuments({ ownerId, status: "cod" }), 1);

    // And the number is remembered, so the next order is not re-challenged.
    const owner = await collections.owners.findOne({ _id: ownerId });
    assert.equal(owner.codVerifiedPhone, PHONE);
  });

  test("sign-in codes are untouched", async () => {
    // The scoping must not have narrowed the login path itself.
    await plantCode(PHONE, OTP_PURPOSE_AUTH);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/verify-otp",
      remoteAddress: uniqueAddress(),
      payload: { identifier: PHONE, code: CODE }
    });

    assert.equal(response.statusCode, 200, `ordinary OTP sign-in broke: ${response.body}`);
    assert.ok(response.cookies.find((c) => c.name === "wavetag_session" && c.value));
  });
});

// The tests above plant tokens directly, which pins the VERIFY side but says
// nothing about what the send routes actually mint — and the send side is the
// half that made this an account-takeover: it is what put a login-capable code
// on a stranger's handset. These drive the real endpoints end to end.
describe("HIGH #1 — the send routes mint scoped codes, not sign-in codes", () => {
  function refuseToSendForReal() {
    assert.equal(
      isMetaWhatsappConfigured(getEnv()),
      false,
      "refusing to run: the live WhatsApp channel is armed and this would message a real handset"
    );
  }

  // Replace the hash of the token the ROUTE just issued, leaving its purpose and
  // identifier exactly as the route wrote them. That is what makes the code
  // usable by a test without ever knowing what was generated.
  async function hijackIssuedCode(identifier) {
    const token = await collections.otpTokens.findOne(
      { identifier },
      { sort: { createdAt: -1 } }
    );
    assert.ok(token, `no code was issued for ${identifier}`);
    await collections.otpTokens.updateOne(
      { _id: token._id },
      { $set: { codeHash: await createOtpHash(CODE) } }
    );
    return token;
  }

  test("a code from cod-otp/send cannot sign in, but does place the order", async () => {
    refuseToSendForReal();

    const sent = await app.inject({
      method: "POST",
      url: "/api/shop/cod-otp/send",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie }
    });
    assert.equal(sent.statusCode, 200, `COD OTP send failed: ${sent.body}`);

    const token = await hijackIssuedCode(PHONE);
    assert.equal(
      token.purpose,
      OTP_PURPOSE_COD_VERIFY,
      "cod-otp/send issued a sign-in code — it is a login credential again"
    );

    // The takeover attempt, against a code this endpoint really produced.
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/verify-otp",
      remoteAddress: uniqueAddress(),
      payload: { identifier: PHONE, code: CODE }
    });
    assert.notEqual(login.statusCode, 200, "a code the shop sent logged straight in");
    assert.equal(login.cookies.find((c) => c.name === "wavetag_session" && c.value), undefined);

    // And it still does the job it was issued for.
    const order = await placeCod({ productId: "pt-car-1", otp: CODE });
    assert.equal(order.statusCode, 200, `the issued code did not work for COD: ${order.body}`);
  });

  test("a code from owner mobile/send-otp cannot sign in either", async () => {
    // The most direct form of the same problem: this route takes the number
    // straight from the request body, so the caller names the destination.
    refuseToSendForReal();

    const sent = await app.inject({
      method: "POST",
      url: "/api/owner/mobile/send-otp",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      headers: { origin: "http://localhost" },
      payload: { mobile: PHONE }
    });
    assert.equal(sent.statusCode, 200, `mobile OTP send failed: ${sent.body}`);

    const token = await hijackIssuedCode(PHONE);
    assert.equal(
      token.purpose,
      OTP_PURPOSE_LINK_MOBILE,
      "mobile/send-otp issued a sign-in code to a caller-supplied number"
    );

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/verify-otp",
      remoteAddress: uniqueAddress(),
      payload: { identifier: PHONE, code: CODE }
    });
    assert.notEqual(login.statusCode, 200, "a link-mobile code logged straight in");
    assert.equal(login.cookies.find((c) => c.name === "wavetag_session" && c.value), undefined);
  });

  test("the ordinary sign-in send still mints a sign-in code", async () => {
    // The control. If scoping had leaked into /api/auth/send-otp, logging in
    // would be broken for everybody and the tests above would not show it.
    refuseToSendForReal();
    const email = assertUndeliverableIdentifier("qa-shop-login@parktag-test.invalid");

    const sent = await app.inject({
      method: "POST",
      url: "/api/auth/send-otp",
      remoteAddress: uniqueAddress(),
      headers: { origin: "http://localhost" },
      payload: { identifier: email }
    });
    assert.equal(sent.statusCode, 200, `sign-in OTP send failed: ${sent.body}`);

    const token = await collections.otpTokens.findOne({ identifier: email });
    assert.ok(token, "no sign-in code was issued");
    assert.equal(token.purpose, OTP_PURPOSE_AUTH, "the sign-in path stopped minting sign-in codes");
  });
});

describe("HIGH #2 — only a real catalog id is a product", () => {
  // Every one of these passed the "Unknown product" check and produced an order
  // priced NaN.
  const notProducts = ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"];

  for (const id of notProducts) {
    test(`getShopProduct("${id}") is null`, () => {
      assert.equal(getShopProduct(id), null);
    });
  }

  test("a non-string id is refused", () => {
    // A JSON body can carry an array, and SHOP_PRODUCTS[["pt-car-1"]] coerces
    // to the string key and would match a real product.
    assert.equal(getShopProduct(["pt-car-1"]), null);
    assert.equal(getShopProduct({ toString: () => "pt-car-1" }), null);
    assert.equal(getShopProduct(null), null);
    assert.equal(getShopProduct(undefined), null);
  });

  test("real products still resolve, with their real price", () => {
    for (const [id, expected] of Object.entries(SHOP_PRODUCTS)) {
      const product = getShopProduct(id);
      assert.equal(product.id, id);
      assert.equal(product.amount, expected.amount);
      assert.equal(product.name, expected.name);
    }
  });

  for (const id of notProducts) {
    test(`place-cod refuses productId "${id}"`, async () => {
      await collections.owners.updateOne({ _id: ownerId }, { $set: { codVerifiedPhone: PHONE } });

      const response = await placeCod({ productId: id });

      assert.equal(
        response.statusCode,
        400,
        `"${id}" was accepted as a product: ${response.body}`
      );
      assert.equal(
        await collections.shopOrders.countDocuments({ ownerId }),
        0,
        `an order was created for "${id}"`
      );
    });
  }

  test("no order can be stored with a NaN amount", async () => {
    // The property that actually matters downstream: a NaN amount reaches
    // Delhivery as the cash-on-delivery figure in production.
    await collections.owners.updateOne({ _id: ownerId }, { $set: { codVerifiedPhone: PHONE } });

    for (const id of [...notProducts, "pt-car-1"]) {
      await placeCod({ productId: id });
    }

    const orders = await collections.shopOrders.find({ ownerId }).toArray();
    assert.equal(orders.length, 1, "only the real product should have produced an order");
    assert.ok(Number.isFinite(orders[0].amount), `order amount is not a number: ${orders[0].amount}`);
    assert.equal(orders[0].amount, 299 * 100 + 5000, "COD price is catalog + the ₹50 surcharge");
  });
});
