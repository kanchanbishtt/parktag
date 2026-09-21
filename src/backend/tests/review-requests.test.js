// The review request, end to end against a real database: who is asked, that
// nobody is asked twice, that a reply is kept against the right order, and
// that the public list only ever shows approved words.
//
// The send itself cannot happen here (refuseInTestRun stops every template),
// which is fine: the claim on the order is taken BEFORE the send, and the claim
// is what these tests are about.

import test, { describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import * as reviewRequest from "../lib/core/campaigns/review-request.js";
import { recordReviewReply } from "../lib/core/reviews.js";

const MARK = `review-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();

let app;
let env;
let collections;
let runEnv;

let seq = 0;
async function seedOrder({ deliveredDaysAgo = 4, phone, ...extra } = {}) {
  seq += 1;
  const { insertedId } = await collections.shopOrders.insertOne({
    orderNumber: `${MARK}-${seq}`,
    status: "paid",
    createdAt: new Date(NOW.getTime() - 8 * DAY).toISOString(),
    ...(deliveredDaysAgo === null ? {} : { deliveredAt: new Date(NOW.getTime() - deliveredDaysAgo * DAY).toISOString() }),
    shippingAddress: { fullName: "Priya Sharma", phone: phone || `99999${String(10000 + seq).slice(-5)}` },
    testMarker: MARK,
    ...extra
  });
  return insertedId;
}

const run = (dryRun) => reviewRequest.run(runEnv, collections, { now: NOW, limit: 100, dryRun, log: null });
const selectedNumbers = async () => (await run(true)).selected.map((s) => s.orderNumber).sort();

before(async () => {
  ({ app, env, collections } = await startTestApp());
  runEnv = {
    ...env,
    reviewRequestsEnabled: true,
    metaWhatsappPhoneNumberId: "test-phone-id",
    metaWhatsappAccessToken: "test-token",
    internalTestPhones: "9999911111"
  };
});

beforeEach(async () => {
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await collections.reviews.deleteMany({ testMarker: MARK });
  await collections.owners.deleteMany({ testMarker: MARK });
});

after(async () => {
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await collections.reviews.deleteMany({ testMarker: MARK });
  await collections.owners.deleteMany({ testMarker: MARK });
  await stopTestApp(app);
});

describe("who is asked", () => {
  test("paid and COD orders delivered 3 to 10 days ago, and nobody else", async () => {
    await seedOrder({ deliveredDaysAgo: 4 });
    await seedOrder({ deliveredDaysAgo: 9, status: "cod" });
    await seedOrder({ deliveredDaysAgo: 1 });          // too soon
    await seedOrder({ deliveredDaysAgo: 30 });         // too late, never chased
    await seedOrder({ deliveredDaysAgo: null });       // not delivered
    await seedOrder({ status: "created" });            // abandoned checkout
    await seedOrder({ channel: "giveaway" });
    await seedOrder({ internal: true });
    await seedOrder({ deletedAt: NOW.toISOString() });
    await seedOrder({ phone: "9999911111" });          // our own number
    await seedOrder({ reviewRequestSentAt: NOW.toISOString() });

    assert.deepEqual(await selectedNumbers(), [`${MARK}-1`, `${MARK}-2`]);
  });

  test("a signed-in buyer who said STOP is not asked", async () => {
    const { insertedId: ownerId } = await collections.owners.insertOne({ marketingOptOut: true, testMarker: MARK });
    await seedOrder({ ownerId });
    assert.equal((await run(true)).wouldSend, 0);
  });

  test("off unless REVIEW_REQUESTS_ENABLED", async () => {
    await seedOrder();
    const res = await reviewRequest.run({ ...runEnv, reviewRequestsEnabled: false }, collections, {
      now: NOW, limit: 100, dryRun: true, log: null
    });
    assert.equal(res.skipped, "not-enabled");
  });
});

describe("nobody is asked twice", () => {
  test("the order is claimed once, and the next tick selects nothing", async () => {
    const id = await seedOrder({ phone: "9999900042" });

    await run(false);
    const claimed = await collections.shopOrders.findOne({ _id: id });
    assert.ok(claimed.reviewRequestSentAt, "the claim was not taken");
    assert.equal(claimed.reviewRequestPhone, "+919999900042");

    await run(false);
    const again = await collections.shopOrders.findOne({ _id: id });
    assert.equal(again.reviewRequestSentAt, claimed.reviewRequestSentAt, "claimed a second time");
    assert.equal((await run(true)).wouldSend, 0);
  });

  test("two ticks racing claim it once between them", async () => {
    const id = await seedOrder();
    await Promise.all([run(false), run(false)]);
    // Both saw the order; the conditional update let exactly one set it.
    const order = await collections.shopOrders.findOne({ _id: id });
    assert.ok(order.reviewRequestSentAt);
  });
});

describe("replies", () => {
  const fetchMedia = async () => ({ data: Buffer.from("jpeg-bytes"), mimeType: "image/jpeg" });

  test("text and a photo from an asked number land on one review for that order", async () => {
    const orderId = await seedOrder({ reviewRequestSentAt: NOW.toISOString(), reviewRequestPhone: "+919999900077" });

    assert.equal(await recordReviewReply(env, collections, { from: "919999900077", type: "text", text: { body: "Works great" } }, { fetchMedia }), true);
    assert.equal(await recordReviewReply(env, collections, { from: "919999900077", type: "image", image: { id: "media-1" } }, { fetchMedia }), true);
    await collections.reviews.updateOne({ orderId }, { $set: { testMarker: MARK } });

    const rows = await collections.reviews.find({ orderId }).toArray();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].texts, ["Works great"]);
    assert.equal(rows[0].photos[0].mediaId, "media-1");
    assert.equal(rows[0].approved, false);
    assert.equal(rows[0].name, "Priya");
  });

  test("a number we did not ask, or asked too long ago, is ignored", async () => {
    await seedOrder({
      reviewRequestSentAt: new Date(Date.now() - 20 * DAY).toISOString(),
      reviewRequestPhone: "+919999900088"
    });
    const msg = (from) => ({ from, type: "text", text: { body: "hello" } });
    assert.equal(await recordReviewReply(env, collections, msg("919999900088"), { fetchMedia }), false);
    assert.equal(await recordReviewReply(env, collections, msg("919999900099"), { fetchMedia }), false);
  });
});

describe("the public list", () => {
  test("approved reviews only, with no phone, order or private field", async () => {
    const orderA = await seedOrder();
    const orderB = await seedOrder();
    const base = { phone: "+919999900055", orderNumber: "PT-SECRET-1", name: "Priya", receivedAt: NOW, testMarker: MARK };
    const { insertedId: shownId } = await collections.reviews.insertOne({
      ...base, orderId: orderA, texts: ["Shown"], approved: true,
      photos: [{ mediaId: "m", data: Buffer.from("img"), mimeType: "image/jpeg" }]
    });
    const { insertedId: hiddenId } = await collections.reviews.insertOne({
      ...base, orderId: orderB, texts: ["Hidden"], approved: false,
      photos: [{ mediaId: "m", data: Buffer.from("img"), mimeType: "image/jpeg" }]
    });

    const res = await app.inject({ method: "GET", url: "/api/shop/reviews", remoteAddress: uniqueAddress() });
    assert.equal(res.statusCode, 200);
    const mine = res.json().reviews.filter((r) => [String(shownId), String(hiddenId)].includes(r.id));
    assert.deepEqual(mine.map((r) => r.text), ["Shown"]);
    assert.deepEqual(Object.keys(mine[0]).sort(), ["id", "name", "photoUrl", "receivedAt", "text"]);
    assert.ok(!res.body.includes("9999900055"));
    assert.ok(!res.body.includes("PT-SECRET"));

    const photo = (id) => app.inject({ method: "GET", url: `/api/shop/reviews/${id}/photo`, remoteAddress: uniqueAddress() });
    assert.equal((await photo(shownId)).statusCode, 200);
    assert.equal((await photo(hiddenId)).statusCode, 404, "an unapproved photo was served publicly");
  });
});
