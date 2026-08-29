// Call outcomes: what happened on the call, and what the dashboard does with it.
//
// The owner asked for the callback to appear only when a call went unanswered,
// and for real durations in the activity log. Both need something we have never
// received: Exotel's status callback has never been configured, so every call
// in production sits with no outcome at all.
//
// This suite therefore does two jobs. It pins the normalisation, and it drives
// realistic Exotel payloads through the live webhook so the whole chain is
// proven BEFORE the dashboard config change — the day that URL is set, this is
// the evidence it will work rather than a hope.
import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, createTestOwner } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import {
  normalizeCallOutcome,
  parseCallDuration,
  wasAnswered,
  shouldOfferCallback
} from "../lib/core/call-outcome.js";

let app;
let collections;
let owner;
let cookie;

const SCANNER = "+919000006610";

test.before(async () => {
  ({ app, collections } = await startTestApp());
  await collections.owners.deleteMany({});
  await collections.contactRequests.deleteMany({});

  owner = await createTestOwner(collections, {
    email: "outcome@example.invalid",
    displayName: "Outcome QA"
  });
  await collections.owners.updateOne(
    { _id: owner._id },
    { $set: { mobile: "+919000006600", mobileVerified: true } }
  );
  cookie = await createSession(app, {
    id: String(owner._id), role: "owner", email: "outcome@example.invalid"
  });
});

test.beforeEach(async () => {
  await collections.contactRequests.deleteMany({});
});

test.after(async () => {
  await collections.owners.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await stopTestApp(app);
});

test("reading Exotel's vocabulary", async (t) => {
  await t.test("talk time means they spoke, whatever the status word says", () => {
    // Exotel marks a call `completed` when its FLOW finished, which happens
    // whether or not anyone answered. Believing that label over a zero
    // conversation would hide the callback from the person who needs it most.
    assert.equal(normalizeCallOutcome({ status: "completed", duration: 42 }), "answered");
    assert.equal(normalizeCallOutcome({ status: "completed", duration: 0 }), "missed");
    assert.equal(normalizeCallOutcome({ status: "completed", duration: "0" }), "missed");
  });

  await t.test("spelling variants land on the same verdict", () => {
    for (const s of ["no-answer", "no_answer", "No-Answer", "NOANSWER", "busy", "canceled", "cancelled"]) {
      assert.equal(normalizeCallOutcome({ status: s }), "missed", `${s} should be missed`);
    }
    for (const s of ["completed", "Completed", "connected", "answered"]) {
      assert.equal(normalizeCallOutcome({ status: s }), "answered", `${s} should be answered`);
    }
    for (const s of ["failed", "FAILED", "error", "unreachable"]) {
      assert.equal(normalizeCallOutcome({ status: s }), "failed", `${s} should be failed`);
    }
  });

  await t.test("unknown stays unknown rather than guessing", () => {
    // The entire existing backlog looks like this. Inventing a verdict here is
    // what would retire the callback button on every one of them.
    assert.equal(normalizeCallOutcome({}), null);
    assert.equal(normalizeCallOutcome({ status: "" }), null);
    assert.equal(normalizeCallOutcome({ status: "connecting" }), null);
    assert.equal(normalizeCallOutcome({ status: null, duration: null }), null);
  });

  await t.test("a reported zero is not the same as no report at all", () => {
    assert.equal(parseCallDuration(0), 0);
    assert.equal(parseCallDuration("0"), 0);
    assert.equal(parseCallDuration(null), null);
    assert.equal(parseCallDuration(""), null);
    assert.equal(parseCallDuration(undefined), null);
    assert.equal(parseCallDuration("nonsense"), null);
    assert.equal(parseCallDuration(-5), null);
  });

  await t.test("callback is withheld only on positive evidence of a conversation", () => {
    assert.equal(shouldOfferCallback({ phone: SCANNER, callOutcome: "answered" }), false);
    assert.equal(shouldOfferCallback({ phone: SCANNER, callOutcome: "missed" }), true);
    assert.equal(shouldOfferCallback({ phone: SCANNER, callOutcome: "failed" }), true);
    assert.equal(shouldOfferCallback({ phone: SCANNER, callOutcome: null }), true,
      "unknown must keep the button, or the whole backlog loses it");
    assert.equal(shouldOfferCallback({ phone: null, callOutcome: "missed" }), false,
      "nobody to dial");
    assert.equal(wasAnswered({ callOutcome: null }), false);
  });
});

// ── The chain that is currently dark ──────────────────────────────────────
// Everything below posts to the real webhook the Exotel dashboard would call.

async function seedCall(callSid) {
  const doc = {
    _id: new ObjectId(),
    tagId: new ObjectId(),
    token: "outcome-tok",
    ownerId: owner._id,
    phone: SCANNER,
    action: "call",
    status: "connecting",
    providerRequestId: callSid,
    createdAt: new Date().toISOString()
  };
  await collections.contactRequests.insertOne(doc);
  return doc;
}

function postStatus(payload) {
  return app.inject({
    method: "POST",
    url: "/api/provider/exotel/webhook",
    headers: { "content-type": "application/json" },
    payload
  });
}

test("an unanswered call, end to end", async () => {
  const call = await seedCall("EXO-SID-MISSED");

  const response = await postStatus({
    CallSid: "EXO-SID-MISSED",
    CallStatus: "no-answer",
    ConversationDuration: "0"
  });
  assert.equal(response.statusCode, 200);

  const stored = await collections.contactRequests.findOne({ _id: call._id });
  assert.equal(stored.callOutcome, "missed");
  assert.equal(stored.callDuration, 0);
  assert.equal(stored.callResult, "no-answer", "the raw provider word is kept too");

  const dash = await app.inject({
    method: "GET", url: "/api/owner/dashboard",
    headers: { cookie: `wavetag_session=${cookie}` }
  });
  const row = dash.json().requests.find((r) => r.id === String(call._id));
  assert.equal(row.callOutcome, "missed", "the dashboard must see the verdict");
  assert.equal(shouldOfferCallback(row), true, "and must still offer the callback");
});

test("an answered call, end to end", async () => {
  const call = await seedCall("EXO-SID-ANSWERED");

  const response = await postStatus({
    CallSid: "EXO-SID-ANSWERED",
    CallStatus: "completed",
    ConversationDuration: "72"
  });
  assert.equal(response.statusCode, 200);

  const stored = await collections.contactRequests.findOne({ _id: call._id });
  assert.equal(stored.callOutcome, "answered");
  assert.equal(stored.callDuration, 72);

  const dash = await app.inject({
    method: "GET", url: "/api/owner/dashboard",
    headers: { cookie: `wavetag_session=${cookie}` }
  });
  const row = dash.json().requests.find((r) => r.id === String(call._id));
  assert.equal(row.callOutcome, "answered");
  assert.equal(row.callDuration, 72, "duration must reach the activity log");
  assert.equal(shouldOfferCallback(row), false,
    "a conversation that happened needs no callback");
});

test("a `completed` call nobody actually answered is still missed", async () => {
  // The trap this whole normalisation exists for.
  const call = await seedCall("EXO-SID-HOLLOW");

  await postStatus({
    CallSid: "EXO-SID-HOLLOW",
    CallStatus: "completed",
    ConversationDuration: "0",
    DialCallDuration: "18"
  });

  const stored = await collections.contactRequests.findOne({ _id: call._id });
  assert.equal(stored.callOutcome, "missed",
    "18 seconds of ringing is not a conversation");
  assert.equal(shouldOfferCallback(stored), true);
});

test("a mid-call event does not erase a verdict already reached", async () => {
  const call = await seedCall("EXO-SID-SEQUENCE");

  await postStatus({
    CallSid: "EXO-SID-SEQUENCE",
    CallStatus: "completed",
    ConversationDuration: "31"
  });
  // A later, vaguer event — the sort of thing a retry or a second flow step
  // sends. It must not downgrade the call to "we don't know".
  await postStatus({ CallSid: "EXO-SID-SEQUENCE", EventType: "provider_update" });

  const stored = await collections.contactRequests.findOne({ _id: call._id });
  assert.equal(stored.callOutcome, "answered", "the settled outcome must survive");
  assert.equal(stored.callDuration, 31);
});

test("today's data is untouched and keeps its callback", async () => {
  // Nothing has ever reported an outcome, so every existing row is null. The
  // gate must be invisible until Exotel is actually wired.
  const call = await seedCall("EXO-SID-NEVER-REPORTED");

  const stored = await collections.contactRequests.findOne({ _id: call._id });
  assert.equal(stored.callOutcome, undefined, "no webhook, no verdict");
  assert.equal(shouldOfferCallback(stored), true,
    "the backlog must keep the button it has today");
});

test("the page reads the verdict, not Exotel's wording", async () => {
  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });

  // The not-answered gate moved out of this page and into the shared rule when
  // callback became premium-only, so it is asserted where it now lives —
  // callback-eligibility.js, which is also covered directly by
  // callback-eligibility.test.js ("missed and unknown outcomes both stay
  // callable"). Same rule, same reason: Exotel's status callback has never been
  // configured, so callOutcome is null on every call in the database and
  // gating on `=== "missed"` would hide the button from all of them.
  const rule = await app.inject({
    method: "GET", url: "/scripts/owner/callback-eligibility.js"
  });
  assert.equal(rule.statusCode, 200, "the shared rule must be served");
  assert.match(rule.body, /callOutcome === "answered"/,
    "the gate must be NOT-answered, never is-missed");
  assert.doesNotMatch(rule.body, /callOutcome === "missed"/,
    "gating on is-missed would hide the button from every call in the database");

  assert.match(js.body, /function formatCallDuration/,
    "durations must be rendered as a person would say them");
  assert.match(js.body, /if \(isCall && r\.callOutcome\)/,
    "the badge must branch on the normalised verdict");

  // Targets the old EXPRESSION, not the words. A looser regex here matched the
  // comment that explains why the old expression was wrong, and failed a file
  // that was already correct.
  assert.doesNotMatch(js.body, /r\.callResult === "connected" \? "Connected"/,
    'the old badge tested for "connected", which Exotel never sends');
});
