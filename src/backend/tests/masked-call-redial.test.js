// Redialling a masked call that nobody picked up.
//
// A scan authorises one masked call. The authorisation used to be spent the
// moment Exotel asked who to dial, so the FIRST connect burned it whether or
// not anyone answered. On 8 Sep 2026 a real customer's tester hit exactly that:
// one scan, one unanswered call, then four redials that Exotel could not route
// because the server had nothing left to hand it. From the caller's side the
// number simply stops working, and from the owner's side a missed call from
// that number can never be returned.
//
// The authorisation is now retired by the OUTCOME rather than by the attempt.
// An unanswered call leaves it alive until it expires, so a redial reaches the
// same owner; a conversation retires it. What must not change is why the
// single use existed at all, so the newest scan still wins, the ten-minute
// expiry still applies, and a spent authorisation still routes nowhere.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app;
let collections;

const CALLER = "+919876500777";
const OWNER = "+919876500111";
const OTHER_OWNER = "+919876500222";

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.pendingCalls.deleteMany({ callerPhone: CALLER }).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.pendingCalls.deleteMany({ callerPhone: CALLER });
});

// Written straight to the collection: this file is about what happens between
// the dial and the status callback, not about how a scan gets registered.
async function authorise({ target = OWNER, token = "tag-one", minutesLeft = 10, createdAt = new Date() } = {}) {
  const { insertedId } = await collections.pendingCalls.insertOne({
    callerPhone: CALLER,
    targetPhone: target,
    token,
    consumed: false,
    createdAt,
    expiresAt: new Date(Date.now() + minutesLeft * 60 * 1000)
  });
  return insertedId;
}

// Sent when the environment has a secret, ignored when it does not: the
// webhook only demands one outside production, and CI runs without it.
const AUTH = `token=${encodeURIComponent(process.env.EXOTEL_WEBHOOK_SECRET || "")}`;

function dial(callSid = "sid-1") {
  return app.inject({
    method: "GET",
    url: `/api/exotel/dial-whom?${AUTH}&CallFrom=${encodeURIComponent(CALLER)}&CallSid=${callSid}`,
    remoteAddress: uniqueAddress()
  });
}

// Exotel's own status callback, as it arrives when a call ends.
function report({ callSid = "sid-1", status = "completed", duration = "0" } = {}) {
  return app.inject({
    method: "POST",
    url: `/api/provider/exotel/webhook?${AUTH}`,
    remoteAddress: uniqueAddress(),
    payload: { CallSid: callSid, CallStatus: status, DialCallDuration: duration }
  });
}

describe("an unanswered call can be redialled", () => {
  test("the first dial connects", async () => {
    await authorise();

    const response = await dial();

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, OWNER);
  });

  // The bug, stated as a test. Four of this caller's five real attempts failed
  // this way.
  test("a redial after nobody answered reaches the same owner", async () => {
    await authorise();

    assert.equal((await dial("sid-1")).body, OWNER);
    await report({ callSid: "sid-1", status: "no-answer", duration: "0" });

    assert.equal(
      (await dial("sid-2")).body,
      OWNER,
      "the authorisation was spent on a call nobody picked up"
    );
  });

  // Exotel labels a call `completed` when its FLOW finished, which happens even
  // when the far end never picked up. Zero talk time is the fact that matters.
  test("`completed` with no talk time still counts as unanswered", async () => {
    await authorise();

    await dial("sid-1");
    await report({ callSid: "sid-1", status: "completed", duration: "0" });

    assert.equal((await dial("sid-2")).body, OWNER);
  });

  test("a busy line can be redialled", async () => {
    await authorise();

    await dial("sid-1");
    await report({ callSid: "sid-1", status: "busy", duration: "0" });

    assert.equal((await dial("sid-2")).body, OWNER);
  });
});

describe("a conversation retires the authorisation", () => {
  test("after the two of them speak, the number routes nowhere", async () => {
    await authorise();

    await dial("sid-1");
    await report({ callSid: "sid-1", status: "completed", duration: "42" });

    assert.equal(
      (await dial("sid-2")).body,
      "",
      "the number still worked after a conversation had already happened"
    );
  });

  test("the row is marked consumed rather than deleted", async () => {
    await authorise();
    await dial("sid-1");
    await report({ callSid: "sid-1", status: "completed", duration: "42" });

    const row = await collections.pendingCalls.findOne({ callerPhone: CALLER });
    assert.equal(row.consumed, true);
    assert.ok(row.consumedAt, "nothing recorded when it was retired");
  });
});

describe("the protections the single use existed for are unchanged", () => {
  // Private Call, no answer, then Emergency. The next of kin must win, and must
  // keep winning on a redial rather than falling back to the phone that already
  // did not answer.
  test("the newest scan still wins, including on a redial", async () => {
    await authorise({ target: OWNER, token: "tag-one", createdAt: new Date(Date.now() - 60_000) });
    await authorise({ target: OTHER_OWNER, token: "tag-one-sos", createdAt: new Date() });

    assert.equal((await dial("sid-1")).body, OTHER_OWNER);
    await report({ callSid: "sid-1", status: "no-answer", duration: "0" });
    assert.equal((await dial("sid-2")).body, OTHER_OWNER, "the redial fell back to the older scan");
  });

  test("an expired authorisation routes nowhere, answered or not", async () => {
    await authorise({ minutesLeft: -1 });

    assert.equal((await dial()).body, "");
  });

  test("a caller with no authorisation at all routes nowhere", async () => {
    assert.equal((await dial()).body, "");
  });

  // The status callback carries a CallSid from a call this server never routed,
  // which must not retire somebody else's live authorisation.
  test("an unrelated call report retires nothing", async () => {
    await authorise();
    await dial("sid-1");

    await report({ callSid: "sid-unrelated", status: "completed", duration: "99" });

    assert.equal((await dial("sid-2")).body, OWNER, "an unrelated report spent this authorisation");
  });
});
