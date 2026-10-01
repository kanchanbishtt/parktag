// Door hanger E-Tags promise two free contacts instead of one.
//
// The allowance is a stamp on the tag (freeContactAllowance) and the spend is a
// counter (freeContactsSpent); freeContactUsed still means "locked" and is what
// every gate reads. These tests drive the real register-call route, so they pin
// the thing the hanger actually promises: the first contact leaves a
// two-contact tag reachable, the second locks it, and an ordinary E-Tag still
// locks after one.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import {
  callEntitlement,
  freeContactAllowance,
  freeContactsLeft,
  DOORHANGER_FREE_CONTACTS
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

async function registerCall(token) {
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
    payload: { phone: nextPhone(), grant: verify.json().grant }
  });
}

// The free contact is no longer spent by dialling — see call-access.js and
// webhooks/exotel.js. It is spent once Exotel reports the bridge actually
// held for at least MIN_ANSWERED_CALL_SECONDS, so these fixtures drive the
// real webhook, the same one Exotel's dashboard calls, rather than asserting
// on register-call's response alone.
async function answerCall(token) {
  counter += 1;
  const callSid = `QA-ANSWERED-${counter}`;
  const contactRequest = await collections.contactRequests.findOne(
    { token, action: "call" },
    { sort: { createdAt: -1 } }
  );
  assert.ok(contactRequest, "fixture must have a call contactRequest to answer");
  const response = await app.inject({
    method: "POST",
    url: "/api/provider/exotel/webhook",
    headers: { "content-type": "application/json" },
    payload: {
      CustomField: String(contactRequest._id),
      CallSid: callSid,
      CallStatus: "completed",
      ConversationDuration: "3"
    }
  });
  assert.equal(response.statusCode, 200, "fixture webhook post should succeed");
}

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

    assert.equal((await registerCall(token)).statusCode, 200);
    let tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactsSpent ?? 0, 0, "dialling alone must not spend it");
    await answerCall(token);
    tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactsSpent, 1);
    assert.equal(tag.freeContactUsed, false);
    assert.equal(callEntitlement(tag).masking, true);

    assert.equal((await registerCall(token)).statusCode, 200);
    await answerCall(token);
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

    assert.equal((await registerCall(token)).statusCode, 200);
    let tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactUsed, false, "still just a ring until the bridge answers");

    await answerCall(token);
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

    assert.equal((await registerCall(token)).statusCode, 200);
    await answerCall(token);
    const tag = await collections.tags.findOne({ token });
    assert.equal(tag.freeContactUsed, true);
  });
});
