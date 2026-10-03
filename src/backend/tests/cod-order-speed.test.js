// Placing a Cash on Delivery order answers the buyer as soon as the order is
// written. The courier booking, the promo burn, the WhatsApp confirmation and
// the Meta conversion run on after the reply (lib/core/after-reply.js). Before
// this the reply waited for all four, one after another: five seconds and more
// on /shop for a screen that says nothing those providers decide.
//
// No database here. The after-reply mechanics are exercised with fakes, and the
// wiring is read off the sources, the way checkout-speed.test.js reads /get.
// guest-cod.test.js covers the real route against Mongo.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { afterReply, settleAfterReply, pendingAfterReply } from "../lib/core/after-reply.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("work handed off after the reply", () => {
  test("the caller is not kept waiting for it", async () => {
    let done = false;
    const started = Date.now();
    afterReply(null, "slow provider", async () => { await sleep(150); done = true; });
    // Returning took no measurable time: the work has not even started yet.
    assert.ok(Date.now() - started < 50);
    assert.equal(done, false);
    assert.equal(pendingAfterReply(), 1);

    await settleAfterReply();
    assert.equal(done, true);
    assert.equal(pendingAfterReply(), 0);
  });

  test("it starts only once the handler has returned", async () => {
    const order = [];
    afterReply(null, "booking", async () => { order.push("booking"); });
    order.push("reply sent");
    await settleAfterReply();
    assert.deepEqual(order, ["reply sent", "booking"]);
  });

  test("a failure is logged against its label and goes no further", async () => {
    const logged = [];
    const log = { error: (fields, msg) => logged.push({ fields, msg }) };
    let unhandled = null;
    const onUnhandled = (err) => { unhandled = err; };
    process.on("unhandledRejection", onUnhandled);
    try {
      afterReply(log, "guest cod PT-1", async () => { throw new Error("courier down"); });
      await settleAfterReply();
      await sleep(10);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    assert.equal(unhandled, null);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].fields.label, "guest cod PT-1");
    assert.equal(logged[0].fields.err.message, "courier down");
    assert.equal(pendingAfterReply(), 0);
  });

  test("settling waits for work added while waiting", async () => {
    const seen = [];
    afterReply(null, "first", async () => {
      seen.push("first");
      afterReply(null, "second", async () => { await sleep(20); seen.push("second"); });
    });
    await settleAfterReply();
    assert.deepEqual(seen, ["first", "second"]);
  });
});

describe("the COD routes answer before the courier and the messages", () => {
  const shop = read("routes/shop/index.js");

  test("guest COD: the order is written, the reply goes, the rest follows", () => {
    const guest = shop.slice(shop.indexOf("async function placeGuestCodLocked"), shop.indexOf("export function registerShopRoutes"));
    const insert = guest.indexOf("await collections.shopOrders.insertOne(placed);");
    const handoff = guest.indexOf("afterReply(request.log, `guest cod ${placed.orderNumber}`");
    const respond = guest.indexOf("return guestCodResponse(placed);", insert);
    assert.ok(insert > 0 && handoff > insert && respond > handoff);
    const background = guest.slice(handoff, respond);
    for (const step of ["bookCodShipment(", "consumePromo(", "sendOrderConfirmation(", "sendPurchaseConversion("]) {
      assert.ok(background.includes(step), `${step} should run after the reply`);
      assert.ok(!guest.slice(0, handoff).includes(step), `${step} must not be awaited before it`);
    }
  });

  test("guest COD: the courier and the address check are asked before the lock, the order number beside the proof", () => {
    const outer = shop.slice(shop.indexOf("async function placeGuestCod("), shop.indexOf("async function placeGuestCodLocked"));
    assert.ok(outer.indexOf("checkPincodeServiceability(env, order.shippingAddress.pincode)") < outer.indexOf("const lockId"));
    assert.ok(outer.indexOf("addressValidates(addressLine(order.shippingAddress)") < outer.indexOf("const lockId"));
    const locked = shop.slice(shop.indexOf("async function placeGuestCodLocked"), shop.indexOf("export function registerShopRoutes"));
    assert.ok(locked.indexOf("const orderNumber = generateOrderNumber(collections);") < locked.indexOf("await consumeGuestCodProof("));
    assert.match(locked, /orderNumber: await orderNumber,/);
  });

  test("signed-in place-cod: the same hand-off", () => {
    const route = shop.slice(shop.indexOf('app.post("/api/shop/place-cod"'), shop.indexOf('app.post("/api/shop/cod-prepay-order"'));
    const insert = route.indexOf("await collections.shopOrders.insertOne({");
    const handoff = route.indexOf("afterReply(request.log, `place-cod ${orderNumber}`");
    assert.ok(insert > 0 && handoff > insert);
    assert.ok(!route.slice(0, handoff).includes("bookCodShipment("));
    assert.ok(route.slice(handoff).includes("bookCodShipment("));
    assert.ok(route.slice(handoff).includes("sendOrderConfirmation("));
  });

  test("a stopping server lets the hand-offs land before closing the database", () => {
    const server = read("server.js");
    assert.ok(server.indexOf("await app.close();") < server.indexOf("await settleAfterReply();"));
    assert.ok(server.indexOf("await settleAfterReply();") < server.indexOf("await closeMongoConnection();"));
    const helpers = read("tests/helpers.js");
    assert.ok(helpers.indexOf("await settleAfterReply();") < helpers.indexOf("await closeMongoConnection();"));
  });
});

describe("/shop has its bot-check token in hand at the tap", () => {
  const page = read("../frontend/scripts/shop.js");

  test("kept fresh from when the delivery step opens, for a pack that takes COD", () => {
    assert.match(page, /import \{ keepFreshToken \} from "\.\/fresh-captcha\.js";/);
    assert.match(page, /const captcha = cod \? keepFreshToken\(\(\) => getCaptchaToken\("guest_checkout"\)\) : null;/);
    assert.match(page, /await \(captcha \? captcha\.take\(\) : getCaptchaToken\("guest_checkout"\)\)/);
    // Backing out, and paying online, both stop the refreshing.
    assert.equal(page.match(/captcha\.stop\(\);/g).length, 2);
    // Opened before the sheet, so it is minting while the buyer types.
    assert.ok(page.indexOf("const captcha = cod ?") < page.indexOf("await window.ptCollectAddress("));
  });
});
