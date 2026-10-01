// The owner being told, once, at the moment an E-Tag's free trial ends.
//
// The lock itself is tested in free-contact-allowance.test.js, and what a
// later scanner sets off is in locked-tag-nudge.test.js. This file holds down
// the message in between: it goes when the LAST free contact is spent and not
// before, once per tag however many contacts land together, and the tag
// records whether it actually went.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

// register-call refuses with 503 without a virtual number; nothing dials.
process.env.EXOTEL_CALLER_ID = "08000000000";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import { getEnv } from "../lib/env.js";
import { DOORHANGER_FREE_CONTACTS } from "../lib/core/call-access.js";
import { DEMO_TAG_FIELDS } from "../lib/core/marketing-stock.js";
import { notifyTrialEnded, settleTrialEndedNotices } from "../lib/core/trial-ended-notice.js";

const env = getEnv();
const MARK = `trialend-${Date.now()}`;
const PLATE = "UP07TS5432";
const LAST_FOUR = "5432";
const iso = (ms) => new Date(ms).toISOString();

let app;
let collections;
let counter = 0;

async function makeOwner(extra = {}) {
  counter += 1;
  const mobile = `+9192000${String(counter).padStart(5, "0")}`;
  await collections.owners.deleteMany({ mobile });
  const { insertedId } = await collections.owners.insertOne({
    role: "owner", displayName: "QA Trial Fixture", mobile, phone: mobile, testMarker: MARK, createdAt: iso(Date.now()), ...extra
  });
  return insertedId;
}

// A door hanger tag. Locked by default: both free contacts spent.
async function makeTag(ownerId, extra = {}) {
  const tag = {
    _id: new ObjectId(),
    token: `${MARK}-${crypto.randomBytes(24).toString("hex")}`,
    ownerId,
    premium: false,
    status: "active",
    plateNumber: PLATE,
    vehicleType: "car",
    freeContactAllowance: DOORHANGER_FREE_CONTACTS,
    freeContactsSpent: DOORHANGER_FREE_CONTACTS,
    freeContactUsed: true,
    createdAt: iso(Date.now()),
    testMarker: MARK,
    ...extra
  };
  await collections.tags.insertOne(tag);
  return tag;
}

const fresh = (tag) => collections.tags.findOne({ _id: tag._id });

// The delivery is passed in, so these run without a provider. `sent` records
// every time a message would have gone out.
function sender(result = true) {
  const sent = [];
  const send = async (_env, _collections, tag) => { sent.push(String(tag._id)); return result; };
  return { sent, send };
}

async function wipe() {
  await settleTrialEndedNotices();
  const tokens = (await collections.tags.find({ testMarker: MARK }, { projection: { token: 1 } }).toArray()).map((t) => t.token);
  for (const name of ["verificationSessions", "pendingCalls", "contactRequests"]) {
    await collections[name]?.deleteMany({ token: { $in: tokens } }).catch(() => {});
  }
  for (const name of ["owners", "tags"]) {
    await collections[name].deleteMany({ testMarker: MARK }).catch(() => {});
  }
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await collections.rateLimits.deleteMany({}).catch(() => {});
});
beforeEach(wipe);
after(async () => { await wipe(); await stopTestApp(app); });

describe("telling the owner the free trial has ended", () => {
  test("a tag that has just locked gets its owner told, and stamped", async () => {
    const tag = await makeTag(await makeOwner());
    const { sent, send } = sender();

    assert.deepEqual(await notifyTrialEnded(env, collections, tag, null, { send }), { status: "sent" });

    assert.deepEqual(sent, [String(tag._id)]);
    const notice = (await fresh(tag)).trialEndedNotice;
    assert.equal(notice.whatsapp, "sent");
    assert.equal(typeof notice.at, "string");
  });

  test("a tag with a free contact left is not told anything", async () => {
    const tag = await makeTag(await makeOwner(), { freeContactsSpent: 1, freeContactUsed: false });
    const { sent, send } = sender();

    assert.deepEqual(await notifyTrialEnded(env, collections, tag, null, { send }), { status: "not-due" });

    assert.equal(sent.length, 0);
    assert.equal("trialEndedNotice" in (await fresh(tag)), false);
  });

  test("a premium tag is never told: freeContactUsed means nothing there", async () => {
    const tag = await makeTag(await makeOwner(), { premium: true });
    const { sent, send } = sender();

    assert.deepEqual(await notifyTrialEnded(env, collections, tag, null, { send }), { status: "not-due" });
    assert.equal(sent.length, 0);
    assert.equal("trialEndedNotice" in (await fresh(tag)), false);
  });

  test("it is said once, however often it is asked", async () => {
    const tag = await makeTag(await makeOwner());
    const { sent, send } = sender();

    await notifyTrialEnded(env, collections, tag, null, { send });
    assert.deepEqual(await notifyTrialEnded(env, collections, tag, null, { send }), { status: "not-due" });
    assert.equal(sent.length, 1);
  });

  test("contacts landing together produce one message", async () => {
    const tag = await makeTag(await makeOwner());
    const { sent, send } = sender();

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => notifyTrialEnded(env, collections, tag, null, { send }))
    );

    assert.equal(outcomes.filter((o) => o.status === "sent").length, 1);
    assert.equal(sent.length, 1);
  });

  test("a delivery that fails is recorded as not sent, and not tried again", async () => {
    const tag = await makeTag(await makeOwner());
    const again = sender();

    assert.deepEqual(await notifyTrialEnded(env, collections, tag, null, { send: sender(false).send }), { status: "unavailable" });
    assert.equal((await fresh(tag)).trialEndedNotice.whatsapp, "not-sent");

    assert.deepEqual(await notifyTrialEnded(env, collections, tag, null, { send: again.send }), { status: "not-due" });
    assert.equal(again.sent.length, 0);
  });

  test("a delivery that throws is absorbed the same way", async () => {
    const tag = await makeTag(await makeOwner());
    const send = async () => { throw new Error("provider down"); };

    assert.deepEqual(await notifyTrialEnded(env, collections, tag, null, { send }), { status: "unavailable" });
    assert.equal((await fresh(tag)).trialEndedNotice.whatsapp, "not-sent");
  });

  test("with the real delivery, a test run reaches nobody and says so", async () => {
    // No Meta credentials in a test run, and external-guard would refuse the
    // send if there were. This is also what happens in production until the
    // template is approved: nothing is sent, and the tag says so.
    const tag = await makeTag(await makeOwner());

    assert.deepEqual(await notifyTrialEnded(env, collections, tag, null), { status: "unavailable" });
    assert.equal((await fresh(tag)).trialEndedNotice.whatsapp, "not-sent");
  });

  test("a recycled sticker forgets it was ever said", () => {
    assert.ok(DEMO_TAG_FIELDS.includes("trialEndedNotice"));
  });
});

describe("a connected call sets it off at the right contact", () => {
  let phoneCounter = 0;
  // Sent when the environment has a secret, ignored when it does not.
  const AUTH = `token=${encodeURIComponent(process.env.EXOTEL_WEBHOOK_SECRET || "")}`;

  // One whole call: scanned, registered, dialled, and reported by Exotel as a
  // conversation of `seconds`. A free call is only spent when they spoke.
  async function call(token, seconds = 20) {
    phoneCounter += 1;
    const phone = `92100${String(phoneCounter).padStart(5, "0")}`;
    const callSid = `${MARK}-sid-${phoneCounter}`;
    const address = uniqueAddress();
    const verify = await app.inject({ method: "POST", url: `/api/tags/${token}/verify`, remoteAddress: address, payload: { lastFour: LAST_FOUR } });
    assert.equal(verify.statusCode, 200, "fixture verify should succeed");
    const registered = await app.inject({
      method: "POST",
      url: `/api/tags/${token}/register-call`,
      remoteAddress: address,
      payload: { phone, grant: verify.json().grant }
    });
    if (registered.statusCode !== 200) return registered;

    await app.inject({ method: "GET", url: `/api/exotel/dial-whom?${AUTH}&CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${callSid}`, remoteAddress: uniqueAddress() });
    await app.inject({
      method: "POST",
      url: `/api/provider/exotel/webhook?${AUTH}`,
      remoteAddress: uniqueAddress(),
      payload: { CallSid: callSid, CallStatus: seconds > 0 ? "completed" : "no-answer", ConversationDuration: String(seconds) }
    });
    await collections.pendingCalls.deleteMany({ callerPhone: `+91${phone}` });
    return registered;
  }

  test("a call nobody answered ends no trial", async () => {
    const tag = await makeTag(await makeOwner(), { freeContactAllowance: undefined, freeContactsSpent: 0, freeContactUsed: false });

    assert.equal((await call(tag.token, 0)).statusCode, 200);
    await settleTrialEndedNotices();

    const after = await fresh(tag);
    assert.equal(after.freeContactUsed, false);
    assert.equal("trialEndedNotice" in after, false);
  });

  test("a door hanger tag: nothing after the first contact, the notice after the second", async () => {
    const tag = await makeTag(await makeOwner(), { freeContactsSpent: 0, freeContactUsed: false });

    assert.equal((await call(tag.token)).statusCode, 200);
    await settleTrialEndedNotices();
    assert.equal("trialEndedNotice" in (await fresh(tag)), false, "one contact left: the trial has not ended");

    assert.equal((await call(tag.token)).statusCode, 200);
    await settleTrialEndedNotices();
    const after = await fresh(tag);
    assert.equal(after.freeContactUsed, true);
    // Claimed, because the tag is now locked. "not-sent" rather than "sent"
    // only because a test run has no provider to send through.
    assert.equal(after.trialEndedNotice.whatsapp, "not-sent");
  });

  test("an ordinary E-Tag: the notice after its one contact", async () => {
    const tag = await makeTag(await makeOwner(), { freeContactAllowance: undefined, freeContactsSpent: 0, freeContactUsed: false });

    assert.equal((await call(tag.token)).statusCode, 200);
    await settleTrialEndedNotices();
    assert.equal((await fresh(tag)).trialEndedNotice.whatsapp, "not-sent");
  });
});
