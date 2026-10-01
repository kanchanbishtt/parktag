// Door hanger E-Tags promise two free contacts instead of one.
//
// The allowance is a stamp on the tag (freeContactAllowance) and the spend is a
// counter (freeContactsSpent); freeContactUsed still means "locked" and is what
// every gate reads. These tests drive the real register-call route and Exotel's
// two webhooks, so they pin the thing the hanger actually promises: the first
// call leaves a two-call tag reachable, the second locks it, and an ordinary
// E-Tag still locks after one.
//
// And what a "call" is (owner's rule, 1 Oct 2026): one in which the scanner and
// the owner were CONNECTED for at least a second. Being handed the number, a
// call nobody answered, and a call Exotel reports no talk time for all cost
// nothing.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import { settleTrialEndedNotices } from "../lib/core/trial-ended-notice.js";
import {
  callEntitlement,
  freeContactAllowance,
  freeContactsLeft,
  DOORHANGER_FREE_CONTACTS,
  MIN_ANSWERED_CALL_SECONDS
} from "../lib/core/call-access.js";

// register-call refuses with 503 without a virtual number; nothing dials.
process.env.EXOTEL_CALLER_ID = "08000000000";

const PLATE = "DL09QA4412";
const RIGHT = "4412";

let app;
let collections;
let counter = 0;
const tokens = [];
const ownerIds = [];
const phones = [];

function nextPhone() {
  counter += 1;
  const phone = `9100${String(counter).padStart(6, "0")}`;
  phones.push(`+91${phone}`);
  return phone;
}

async function createTag(extra = {}) {
  counter += 1;
  const token = `qaallow${String(counter).padStart(3, "0")}${"a1b2c3d4".repeat(6)}`;
  const ownerPhone = `+9191000${String(counter).padStart(5, "0")}`;
  await collections.owners.deleteMany({ mobile: ownerPhone });
  const { insertedId: ownerId } = await collections.owners.insertOne({
    displayName: "QA Allowance Fixture",
    mobile: ownerPhone,
    phone: ownerPhone,
    role: "owner",
    createdAt: new Date().toISOString()
  });
  ownerIds.push(ownerId);
  await collections.tags.insertOne({
    token,
    ownerId,
    status: "active",
    premium: false,
    plateNumber: PLATE,
    vehicleLabel: "QA Fixture Car",
    vehicleType: "car",
    freeContactUsed: false,
    createdAt: new Date().toISOString(),
    ...extra
  });
  tokens.push(token);
  return token;
}

async function registerCall(token, phone = nextPhone()) {
  const address = uniqueAddress();
  const verify = await app.inject({
    method: "POST",
    url: `/api/tags/${token}/verify`,
    remoteAddress: address,
    payload: { lastFour: RIGHT }
  });
  assert.equal(verify.statusCode, 200, "fixture verify should succeed");
  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/register-call`,
    remoteAddress: address,
    payload: { phone, grant: verify.json().grant }
  });
}

// Sent when the environment has a secret, ignored when it does not: the
// webhooks only demand one outside production, and CI runs without it.
const AUTH = `token=${encodeURIComponent(process.env.EXOTEL_WEBHOOK_SECRET || "")}`;
let sidCounter = 0;

// Exotel asking who this caller should be connected to. Returns the CallSid.
async function dial(phone) {
  sidCounter += 1;
  const callSid = `qaallow-sid-${sidCounter}`;
  const res = await app.inject({
    method: "GET",
    url: `/api/exotel/dial-whom?${AUTH}&CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${callSid}`,
    remoteAddress: uniqueAddress()
  });
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.body, "", "the call should have been routed to the owner");
  return callSid;
}

// Exotel's status callback when the call ends. `fields` is what it reports.
// The free contact is no longer spent by dialling — see call-access.js and
// webhooks/exotel.js. It is spent once Exotel reports the bridge actually
// held for at least MIN_ANSWERED_CALL_SECONDS, so driving the real webhook
// here (the same one Exotel's dashboard calls) exercises the real path rather
// than asserting on register-call's response alone.
async function report(callSid, fields) {
  const res = await app.inject({
    method: "POST",
    url: `/api/provider/exotel/webhook?${AUTH}`,
    remoteAddress: uniqueAddress(),
    payload: { CallSid: callSid, ...fields }
  });
  assert.equal(res.statusCode, 200);
  await settleTrialEndedNotices();
}

// One whole call: scanned, registered, dialled, and reported by Exotel.
async function call(token, fields) {
  const phone = nextPhone();
  const res = await registerCall(token, phone);
  if (res.statusCode !== 200) return res;
  await report(await dial(phone), fields);
  return res;
}

const CONNECTED = { CallStatus: "completed", ConversationDuration: "12" };
const NOT_ANSWERED = { CallStatus: "no-answer", ConversationDuration: "0" };
const spent = async (token) => (await collections.tags.findOne({ token })).freeContactsSpent || 0;

before(async () => {
  ({ app, collections } = await startTestApp());
  await collections.rateLimits.deleteMany({}).catch(() => {});
});

after(async () => {
  for (const token of tokens) {
    await collections.tags.deleteMany({ token });
    await collections.verificationSessions.deleteMany({ token });
    await collections.contactRequests.deleteMany({ token });
    await collections.pendingCalls.deleteMany({ token });
  }
  for (const callerPhone of phones) await collections.pendingCalls.deleteMany({ callerPhone });
  for (const _id of ownerIds) await collections.owners.deleteOne({ _id });
  await collections.rateLimits.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

describe("free contact allowance", () => {
  test("an unstamped E-Tag gets one; junk never reads as more", () => {
    assert.equal(freeContactAllowance({}), 1);
    assert.equal(freeContactAllowance({ freeContactAllowance: 2 }), 2);
    for (const junk of ["2", 0, -1, 1.5, 1e9, null, true]) {
      assert.equal(freeContactAllowance({ freeContactAllowance: junk }), 1, `junk ${JSON.stringify(junk)}`);
    }
  });

  test("contacts left counts down and is 0 once locked", () => {
    assert.equal(freeContactsLeft({ freeContactAllowance: 2 }), 2);
    assert.equal(freeContactsLeft({ freeContactAllowance: 2, freeContactsSpent: 1 }), 1);
    assert.equal(freeContactsLeft({ freeContactAllowance: 2, freeContactUsed: true }), 0);
  });

  test("a door hanger tag stays reachable after its first call and locks after its second", async () => {
    const token = await createTag({ freeContactAllowance: DOORHANGER_FREE_CONTACTS });
    const firstPhone = nextPhone();

    assert.equal((await registerCall(token, firstPhone)).statusCode, 200);
    let tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactsSpent ?? 0, 0, "dialling alone must not spend it");
    await report(await dial(firstPhone), CONNECTED);
    tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactsSpent, 1);
    assert.equal(tag.freeContactUsed, false);
    assert.equal(callEntitlement(tag).masking, true);

    assert.equal((await call(token, CONNECTED)).statusCode, 200);
    tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactsSpent, 2);
    assert.equal(tag.freeContactUsed, true);
    assert.ok(tag.freeContactUsedAt);
    assert.equal(callEntitlement(tag).masking, false);

    const third = await registerCall(token);
    assert.equal(third.statusCode, 402);
    assert.equal(third.json().code, "FREE_USED");
  });

  test("an ordinary E-Tag still locks after one ANSWERED call", async () => {
    const token = await createTag();
    const phone = nextPhone();

    assert.equal((await registerCall(token, phone)).statusCode, 200);
    let tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactUsed, false, "still just a ring until the bridge answers");

    await report(await dial(phone), CONNECTED);
    tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactUsed, true);

    const second = await registerCall(token);
    assert.equal(second.statusCode, 402);
  });

  test("dialling and ringing out spends nothing — only a bridge that actually holds does", async () => {
    const token = await createTag();

    assert.equal((await registerCall(token)).statusCode, 200);
    const contactRequest = await collections.contactRequests.findOne({ token, action: "call" });
    const response = await app.inject({
      method: "POST",
      url: "/api/provider/exotel/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        CustomField: String(contactRequest._id),
        CallSid: "QA-NO-ANSWER",
        CallStatus: "no-answer",
        ConversationDuration: "0"
      }
    });
    assert.equal(response.statusCode, 200);

    const tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactUsed, false, "a ring that nobody answered must not lock the tag");
    // Still reachable — the trial was never actually spent.
    assert.equal((await registerCall(token)).statusCode, 200);
  });

  test("a junk allowance on the tag locks after one answered call, not never", async () => {
    const token = await createTag({ freeContactAllowance: "999" });

    assert.equal((await call(token, CONNECTED)).statusCode, 200);
    const tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactUsed, true);
  });
});

describe("a free call is spent only when the call connects", () => {
  test("being handed the number costs nothing", async () => {
    const token = await createTag({ freeContactAllowance: DOORHANGER_FREE_CONTACTS });

    // Three scanners register and none of them ever dials.
    for (let i = 0; i < 3; i += 1) assert.equal((await registerCall(token)).statusCode, 200);

    assert.equal(await spent(token), 0);
    assert.equal((await collections.tags.findOne({ token })).freeContactUsed, false);
  });

  test("a call nobody answered costs nothing, however often it is tried", async () => {
    const token = await createTag({ freeContactAllowance: DOORHANGER_FREE_CONTACTS });

    for (const fields of [
      NOT_ANSWERED,
      { CallStatus: "busy", ConversationDuration: "0" },
      { CallStatus: "failed" },
      { CallStatus: "canceled", DialCallDuration: "0" }
    ]) {
      assert.equal((await call(token, fields)).statusCode, 200);
    }

    assert.equal(await spent(token), 0, "four attempts, none connected, both free calls still there");
    assert.equal((await registerCall(token)).statusCode, 200, "and the tag still takes a call");
  });

  test("MIN_ANSWERED_CALL_SECONDS of conversation is a call; less, or a status word alone, is not", async () => {
    const token = await createTag({ freeContactAllowance: DOORHANGER_FREE_CONTACTS });
    assert.equal(MIN_ANSWERED_CALL_SECONDS, 2);

    // Exotel says "completed" whenever its flow ran to the end, answered or
    // not, so without a talk time there is no evidence the two ever spoke.
    await call(token, { CallStatus: "completed" });
    assert.equal(await spent(token), 0, "no duration reported: not counted");

    // A ring that cut off just under the threshold is not a conversation either.
    await call(token, { CallStatus: "completed", ConversationDuration: String(MIN_ANSWERED_CALL_SECONDS - 1) });
    assert.equal(await spent(token), 0, `${MIN_ANSWERED_CALL_SECONDS - 1}s is a ring, not a call`);

    await call(token, { CallStatus: "completed", ConversationDuration: String(MIN_ANSWERED_CALL_SECONDS) });
    assert.equal(await spent(token), 1, `connected for ${MIN_ANSWERED_CALL_SECONDS}s: counted`);
  });

  test("an unanswered call can be redialled, and counts once it connects", async () => {
    const token = await createTag({ freeContactAllowance: DOORHANGER_FREE_CONTACTS });
    const phone = nextPhone();
    assert.equal((await registerCall(token, phone)).statusCode, 200);

    await report(await dial(phone), NOT_ANSWERED);
    assert.equal(await spent(token), 0);

    // Same scan, same authorisation, dialled again. This time they speak.
    await report(await dial(phone), CONNECTED);
    assert.equal(await spent(token), 1);
  });

  test("one conversation is one call, however many times Exotel reports it", async () => {
    const token = await createTag({ freeContactAllowance: DOORHANGER_FREE_CONTACTS });
    const phone = nextPhone();
    assert.equal((await registerCall(token, phone)).statusCode, 200);
    const callSid = await dial(phone);

    // An "answered" event with no duration yet, then the terminal report, then
    // the terminal report delivered a second time.
    await report(callSid, { CallStatus: "in-progress" });
    await report(callSid, CONNECTED);
    await report(callSid, CONNECTED);

    assert.equal(await spent(token), 1);
  });

  test("a report for a call this server never routed spends nothing", async () => {
    const token = await createTag({ freeContactAllowance: DOORHANGER_FREE_CONTACTS });
    assert.equal((await registerCall(token)).statusCode, 200);

    await report("a-sid-nobody-dialled", CONNECTED);
    assert.equal(await spent(token), 0);
  });

  test("an ordinary E-Tag keeps its one call through an unanswered attempt", async () => {
    const token = await createTag();

    assert.equal((await call(token, NOT_ANSWERED)).statusCode, 200);
    let tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactUsed, false);
    assert.equal(callEntitlement(tag).masking, true);

    assert.equal((await call(token, CONNECTED)).statusCode, 200);
    tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactUsed, true);
  });

  test("a premium tag's connected call spends nothing", async () => {
    const token = await createTag({ premium: true, activatedAt: new Date().toISOString(), freeContactAllowance: DOORHANGER_FREE_CONTACTS });

    assert.equal((await call(token, CONNECTED)).statusCode, 200);
    assert.equal(await spent(token), 0);
  });

  test("a tag upgraded to Premium before the call connects spends nothing", async () => {
    const token = await createTag({ freeContactAllowance: DOORHANGER_FREE_CONTACTS });
    const phone = nextPhone();
    assert.equal((await registerCall(token, phone)).statusCode, 200);
    const callSid = await dial(phone);

    await collections.tags.updateOne({ token }, { $set: { premium: true, activatedAt: new Date().toISOString() } });
    await report(callSid, CONNECTED);

    assert.equal(await spent(token), 0);
  });
});
