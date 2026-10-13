// Buying a membership names the premium tag it goes on.
//
// create-order refused an owner holding more than one tag ("Choose which tag
// this membership is for") and the page only ever sent { planId }, with no way
// to choose: an owner with two vehicles could not buy a membership at all. It
// also counted free E-Tags as candidates, so an E-Tag-only owner was charged
// for time that gives an E-Tag nothing (call-access.js and vault.js decide an
// E-Tag's access before they look at any subscription).
//
// Now only premium tags count, the screen lists them, and an owner with
// several picks one; the page sends it as tagId.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

import { createSession } from "../lib/auth/session.js";
import { getRazorpay } from "../lib/integrations/payments.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";

// Placeholder keys, and the client they build has its order call replaced
// below: nothing here reaches Razorpay.
const KEY_ID = "rzp_test_ci_placeholder";
const KEY_SECRET = "ci_placeholder_secret";
process.env.RAZORPAY_KEY_ID = KEY_ID;
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
delete process.env.MIXPANEL_TOKEN;

const MARK = "qa-mem-choice";
let app;
let collections;
let owner;
let cookie;
let minted = 0;

before(async () => {
  ({ app, collections } = await startTestApp());
  getRazorpay({ razorpayKeyId: KEY_ID, razorpayKeySecret: KEY_SECRET }).orders.create =
    async ({ amount, currency }) => ({ id: `order_mem_choice_${++minted}`, amount, currency: currency || "INR" });
});

after(async () => {
  await collections.tags.deleteMany({ token: { $regex: `^${MARK}` } }).catch(() => {});
  await collections.membershipOrders.deleteMany({ orderId: { $regex: "^order_mem_choice_" } }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.tags.deleteMany({ token: { $regex: `^${MARK}` } });
  await collections.membershipOrders.deleteMany({ orderId: { $regex: "^order_mem_choice_" } });
  await purgeLoginCollections(collections);
  owner = await createTestOwner(collections, { email: `${MARK}@parktag-test.invalid` });
  cookie = await createSession(app, { id: String(owner._id), role: "owner", email: owner.email });
});

let serial = 0;
async function addTag(plateNumber, { premium = true, ownerId = owner._id, ...rest } = {}) {
  const { insertedId } = await collections.tags.insertOne({
    ownerId, plateNumber, vehicleType: "car", status: "active", premium,
    token: `${MARK}-${++serial}`, activatedAt: new Date().toISOString(),
    createdAt: new Date(Date.now() + serial).toISOString(), ...rest
  });
  return String(insertedId);
}

const createOrder = (body) => app.inject({
  method: "POST", url: "/api/owner/membership/create-order", remoteAddress: uniqueAddress(),
  cookies: { wavetag_session: cookie }, headers: { origin: TEST_ORIGIN }, payload: body
});

const storedTagOf = async (res) =>
  String((await collections.membershipOrders.findOne({ orderId: res.json().orderId })).tagId);

describe("the membership screen lists the vehicles a membership can go on", () => {
  test("premium tags only, each with its own cover", async () => {
    const first = await addTag("DL01QA1111");
    await addTag("DL01QA2222", { premium: false });
    const paidUntil = new Date(Date.now() + 400 * 86400000).toISOString();
    const second = await addTag("DL01QA3333", { subscription: { status: "active", currentPeriodEnd: paidUntil } });

    const res = await app.inject({ method: "GET", url: "/api/owner/membership", cookies: { wavetag_session: cookie } });
    assert.equal(res.statusCode, 200, res.body);
    const tags = res.json().tags;

    assert.deepEqual(tags.map((t) => t.tagId), [first, second], "an E-Tag was offered a membership");
    assert.equal(tags[0].plateNumber, "DL01QA1111");
    assert.equal(tags[0].trial, true, "a new premium tag is inside its included year");
    assert.ok(tags[0].coveredUntil);
    assert.equal(tags[1].trial, false, "a paid period is not called a trial");
  });
});

describe("create-order", () => {
  test("two premium tags and no choice: refused, with the two to choose from", async () => {
    const a = await addTag("DL01QA1111");
    const b = await addTag("DL01QA2222");
    await addTag("DL01QA3333", { premium: false });

    const res = await createOrder({ planId: "m12" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, "CHOOSE_TAG");
    assert.deepEqual(res.json().choices.map((c) => c.tagId), [a, b]);
  });

  test("two premium tags and a choice: the order goes on the chosen one", async () => {
    await addTag("DL01QA1111");
    const b = await addTag("DL01QA2222");

    const res = await createOrder({ planId: "m12", tagId: b });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await storedTagOf(res), b);
  });

  test("one premium tag beside an E-Tag: no question, it goes on the premium one", async () => {
    await addTag("DL01QA1111", { premium: false });
    const premium = await addTag("DL01QA2222");

    const res = await createOrder({ planId: "m1" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await storedTagOf(res), premium);
  });

  test("E-Tags only: refused rather than charged for nothing", async () => {
    const etag = await addTag("DL01QA1111", { premium: false });

    const plain = await createOrder({ planId: "m1" });
    assert.equal(plain.statusCode, 400);
    assert.equal(plain.json().code, "NO_PREMIUM_TAG");

    const named = await createOrder({ planId: "m1", tagId: etag });
    assert.equal(named.statusCode, 400);
    assert.equal(named.json().code, "NOT_PREMIUM");
    assert.equal(await collections.membershipOrders.countDocuments({ ownerId: owner._id }), 0);
  });

  test("another account's tag cannot be chosen", async () => {
    await addTag("DL01QA1111");
    const stranger = await createTestOwner(collections, { email: `${MARK}-other@parktag-test.invalid` });
    const theirs = await addTag("DL01QA9999", { ownerId: stranger._id });

    const res = await createOrder({ planId: "m1", tagId: theirs });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /not on your account/);
  });
});

// ── The real page, in jsdom ──────────────────────────────────────────────────

const read = (path) => fs.readFileSync(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const windows = [];
after(() => windows.forEach((w) => w.close()));

const PLANS = [
  { id: "m1", label: "1 Month", months: 1, priceInr: 49, perMonthInr: 49, perMonthExact: true, savingPercent: 0 },
  { id: "m12", label: "12 Months", months: 12, priceInr: 249, perMonthInr: 21, perMonthExact: false, savingPercent: 58, popular: true }
];

async function openPage(tags) {
  const html = read("pages/owner/membership.html").replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://x.test/owner-membership", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  windows.push(w);
  w.burstConfetti = () => {};
  w.clearConfetti = () => {};
  w.ptLoadRazorpay = async () => false;
  w.sent = [];
  w.fetch = async (url, options = {}) => {
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (String(url).endsWith("/api/owner/membership")) {
      return json({
        ok: true,
        trial: { value: 1, unit: "Year", headline: "1 year Premium included", note: "From activation." },
        plans: PLANS, features: [], alwaysIncluded: [], checkoutEnabled: true,
        subscription: null, tags
      });
    }
    w.sent.push({ url: String(url), body: JSON.parse(options.body || "{}") });
    return { ok: false, status: 400, json: async () => ({ ok: false, error: "stop here" }) };
  };
  const src = read("scripts/owner/membership.js").replace(/^import .*$/gm, "");
  w.eval(`(async () => { ${src.replace(/^load\(\);$/m, "await load();")} })()`);
  await tick();
  return w;
}

const tag = (tagId, plateNumber, coveredUntil = null) => ({ tagId, plateNumber, vehicleLabel: "Car", coveredUntil, trial: Boolean(coveredUntil) });
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));

describe("the membership page", () => {
  test("two premium tags: a picker, and the chosen tag is sent", async () => {
    const soon = new Date(Date.now() + 20 * 86400000).toISOString();
    const later = new Date(Date.now() + 300 * 86400000).toISOString();
    const w = await openPage([tag("a1", "DL01QA1111", later), tag("b2", "DL01QA2222", soon)]);
    const doc = w.document;

    assert.equal(doc.getElementById("mbVehiclesWrap").hidden, false, "no picker for two vehicles");
    const rows = [...doc.querySelectorAll("#mbVehicles .mb-veh")];
    assert.deepEqual(rows.map((r) => r.querySelector(".mb-veh-plate").textContent), ["DL01QA1111", "DL01QA2222"]);
    assert.equal(rows[1].getAttribute("aria-checked"), "true", "the vehicle whose cover ends first is preselected");
    assert.match(doc.getElementById("mbNote").textContent, /^DL01QA2222: /, "the date shown is not tied to a vehicle");

    click(rows[0]);
    assert.equal(doc.querySelectorAll("#mbVehicles .mb-veh")[0].getAttribute("aria-checked"), "true");
    click(doc.getElementById("mbCta"));
    await tick();
    assert.deepEqual(w.sent[0].body, { planId: "m12", tagId: "a1" });
  });

  test("one premium tag: no picker, and that tag is sent", async () => {
    const w = await openPage([tag("only", "DL01QA1111")]);
    assert.equal(w.document.getElementById("mbVehiclesWrap").hidden, true);
    click(w.document.getElementById("mbCta"));
    await tick();
    assert.deepEqual(w.sent[0].body, { planId: "m12", tagId: "only" });
  });

  test("no premium tag: the button is off and the page says why", async () => {
    const w = await openPage([]);
    assert.equal(w.document.getElementById("mbCta").disabled, true);
    assert.match(w.document.getElementById("mbNote").textContent, /Membership is for premium tags/);
  });
});
