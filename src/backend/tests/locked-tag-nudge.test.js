// A scanner at a tag whose free contacts are spent.
//
// The lock itself is tested in free-contact-allowance.test.js and is not
// loosened here. Locked means locked: no call, no alert, and no Emergency call.
// What this file holds down is what happens NEXT, which used to be nothing.
// A verified scan of a locked tag is counted; the owner is told, at most once
// a day, that somebody could not reach them; and the dashboard shows the count.
// The scanner is told none of that, because it would not always be true.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import { getEnv } from "../lib/env.js";
import { DOORHANGER_FREE_CONTACTS } from "../lib/core/call-access.js";
import { createContactAction } from "../lib/core/contact-actions.js";
import { settleTrialEndedNotices } from "../lib/core/trial-ended-notice.js";
import { DEMO_TAG_FIELDS } from "../lib/core/marketing-stock.js";
import {
  LOCKED_NUDGE_INTERVAL_MS,
  LOCKED_NUDGE_REASON,
  lockedNudgeReason,
  isLockedEtag,
  recordLockedAttempt
} from "../lib/core/locked-tag-nudge.js";

const env = getEnv();
const MARK = `locked-${Date.now()}`;
const HOUR = 60 * 60 * 1000;
// Any reason the alert route accepts; which one does not matter here.
const REASON = "lights";
const iso = (ms) => new Date(ms).toISOString();

let app;
let collections;

async function makeOwner(extra = {}) {
  const { insertedId } = await collections.owners.insertOne({ role: "owner", testMarker: MARK, createdAt: iso(Date.now()), ...extra });
  return insertedId;
}

// A door hanger tag that has spent both of its free contacts.
async function makeTag(ownerId, extra = {}) {
  const tag = {
    _id: new ObjectId(),
    token: `${MARK}-${crypto.randomBytes(6).toString("hex")}`,
    ownerId,
    premium: false,
    status: "active",
    plateNumber: "UP07TS5432",
    vehicleType: "car",
    freeContactAllowance: DOORHANGER_FREE_CONTACTS,
    freeContactsSpent: DOORHANGER_FREE_CONTACTS,
    freeContactUsed: true,
    freeContactUsedAt: iso(Date.now() - HOUR),
    createdAt: iso(Date.now() - 48 * HOUR),
    testMarker: MARK,
    ...extra
  };
  await collections.tags.insertOne(tag);
  return tag;
}

const fresh = (tag) => collections.tags.findOne({ _id: tag._id });

async function dashboardTag(tag, ownerId) {
  const cookie = await createSession(app, { id: String(ownerId), role: "owner", email: `${MARK}@example.com` });
  const res = await app.inject({
    method: "GET",
    url: "/api/owner/dashboard?qr=0",
    cookies: { wavetag_session: cookie },
    remoteAddress: uniqueAddress()
  });
  assert.equal(res.statusCode, 200);
  return res.json().tags.find((t) => t.id === String(tag._id));
}

async function wipe() {
  const tokens = (await collections.tags.find({ testMarker: MARK }, { projection: { token: 1 } }).toArray()).map((t) => t.token);
  // Sessions and call routes are written by the routes, keyed on the token.
  for (const name of ["verificationSessions", "pendingCalls", "contactRequests"]) {
    await collections[name]?.deleteMany({ token: { $in: tokens } }).catch(() => {});
  }
  for (const name of ["owners", "tags"]) {
    await collections[name].deleteMany({ testMarker: MARK }).catch(() => {});
  }
}

before(async () => { ({ app, collections } = await startTestApp()); });
beforeEach(wipe);
after(async () => { await wipe(); await stopTestApp(app); });

describe("which tags this is for", () => {
  test("an E-Tag that has used its free contacts, and nothing else", () => {
    assert.equal(isLockedEtag({ premium: false, freeContactUsed: true }), true);
    assert.equal(isLockedEtag({ premium: false, freeContactUsed: false }), false, "still has a contact: use the real buttons");
    assert.equal(isLockedEtag({ premium: true, activatedAt: iso(Date.now() - HOUR) }), false, "premium, in its year");
    // A lapsed premium tag is blocked too, but that is a renewal with its own
    // panel, not a first purchase.
    assert.equal(isLockedEtag({ premium: true, freeContactUsed: true, activatedAt: iso(Date.now() - 800 * 24 * HOUR) }), false);
    assert.equal(isLockedEtag(null), false);
  });
});

describe("telling the owner, at most once a day", () => {
  // The delivery is passed in, so these hold the claim and the cap without a
  // provider. `sent` records every time one would have gone out.
  function sender(result = true) {
    const sent = [];
    const send = async (_env, _collections, tag) => { sent.push(String(tag._id)); return result; };
    return { sent, send };
  }

  test("the first blocked scanner gets the owner told, and is counted", async () => {
    const tag = await makeTag(await makeOwner());
    const { sent, send } = sender();

    const outcome = await recordLockedAttempt(env, collections, tag, null, { send });

    assert.deepEqual(outcome, { status: "sent" });
    assert.equal(sent.length, 1);
    const after = await fresh(tag);
    assert.equal(after.blockedAttempts, 1);
    assert.ok(after.lastBlockedAt);
    assert.ok(after.lockedNudgeAt);
  });

  test("everyone after that, the same day, is counted but not sent", async () => {
    const tag = await makeTag(await makeOwner());
    const { sent, send } = sender();
    const now = Date.now();

    await recordLockedAttempt(env, collections, tag, null, { send, now });
    const second = await recordLockedAttempt(env, collections, tag, null, { send, now: now + HOUR });
    const third = await recordLockedAttempt(env, collections, tag, null, { send, now: now + 23 * HOUR });

    assert.equal(second.status, "already");
    assert.equal(third.status, "already");
    assert.equal(sent.length, 1, "one message, three people");
    assert.equal((await fresh(tag)).blockedAttempts, 3);
  });

  test("a day later the owner is told again", async () => {
    const tag = await makeTag(await makeOwner());
    const { sent, send } = sender();
    const now = Date.now();

    await recordLockedAttempt(env, collections, tag, null, { send, now });
    const next = await recordLockedAttempt(env, collections, tag, null, { send, now: now + LOCKED_NUDGE_INTERVAL_MS });

    assert.equal(next.status, "sent");
    assert.equal(sent.length, 2);
  });

  test("scanners arriving together produce one message", async () => {
    const tag = await makeTag(await makeOwner());
    const { sent, send } = sender();

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => recordLockedAttempt(env, collections, tag, null, { send }))
    );

    assert.equal(outcomes.filter((o) => o.status === "sent").length, 1);
    assert.equal(outcomes.filter((o) => o.status === "already").length, 5);
    assert.equal(sent.length, 1);
    assert.equal((await fresh(tag)).blockedAttempts, 6, "every one of them is still counted");
  });

  // An outage must not use up the day. If the stamp stayed, a failed send would
  // silence the tag for 24 hours having told nobody.
  test("a message that could not be delivered does not spend the day's one send", async () => {
    const tag = await makeTag(await makeOwner());
    const down = sender(false);
    const up = sender(true);

    const failed = await recordLockedAttempt(env, collections, tag, null, { send: down.send });
    assert.equal(failed.status, "unavailable");
    assert.equal((await fresh(tag)).lockedNudgeAt, null, "the claim is released");

    const retried = await recordLockedAttempt(env, collections, tag, null, { send: up.send });
    assert.equal(retried.status, "sent");
    assert.equal((await fresh(tag)).blockedAttempts, 2);
  });

  test("a sender that throws is an outage, not a crash", async () => {
    const tag = await makeTag(await makeOwner());
    const outcome = await recordLockedAttempt(env, collections, tag, null, {
      send: async () => { throw new Error("provider down"); }
    });
    assert.equal(outcome.status, "unavailable");
    assert.equal((await fresh(tag)).blockedAttempts, 1);
  });

  test("a failed send leaves an earlier stamp as it was", async () => {
    const earlier = iso(Date.now() - 30 * HOUR);
    const tag = await makeTag(await makeOwner(), { lockedNudgeAt: earlier });

    await recordLockedAttempt(env, collections, tag, null, { send: sender(false).send });

    assert.equal((await fresh(tag)).lockedNudgeAt, earlier);
  });
});

describe("who is actually messaged", () => {
  test("an owner with no number and no e-mail cannot be told", async () => {
    const tag = await makeTag(await makeOwner());
    assert.equal((await recordLockedAttempt(env, collections, tag, null)).status, "unavailable");
  });

  // "Stop everything" is a different intent from "no offers", and it holds here.
  test("an owner who has asked for no messages at all is not messaged", async () => {
    const tag = await makeTag(await makeOwner({ email: `${MARK}@example.com`, messagingHardStop: true }));
    assert.equal((await recordLockedAttempt(env, collections, tag, null)).status, "unavailable");
    assert.equal((await fresh(tag)).blockedAttempts, 1, "still counted for the dashboard");
  });

  test("a tag whose owner is gone does not throw", async () => {
    const tag = await makeTag(new ObjectId());
    assert.equal((await recordLockedAttempt(env, collections, tag, null)).status, "unavailable");
  });
});

describe("what the message says", () => {
  // It rides in {{2}} of the approved alert: "…and reported: {{2}}."
  test("it fits the approved template's variable", () => {
    assert.doesNotMatch(LOCKED_NUDGE_REASON, /[\n\t]| {4,}/, "Meta rejects newlines, tabs and runs of spaces in a variable");
    assert.doesNotMatch(LOCKED_NUDGE_REASON, /\.$/, "the template supplies the full stop");
    assert.ok(LOCKED_NUDGE_REASON.length < 400);
  });

  // WhatsApp never locks for any E-Tag (owner's decision, 1 Oct 2026), so the
  // message names only what actually switched off: the call and the
  // Emergency call. It never mentions WhatsApp at all — an E-Tag whose alert
  // still works needs no telling that it does.
  test("it speaks of the call only, and never names WhatsApp", () => {
    assert.match(LOCKED_NUDGE_REASON, /^they could not call you\. /);
    assert.match(LOCKED_NUDGE_REASON, /free calls are finished/);
    assert.match(LOCKED_NUDGE_REASON, /private calls and the emergency call are switched off/);
    assert.match(LOCKED_NUDGE_REASON, /Upgrade to a Premium tag/);
    assert.doesNotMatch(LOCKED_NUDGE_REASON, /whatsapp|alert|could not get through|could not reach/i);
  });

  // The scanner's reason is what a contact buys. It must never ride along.
  test("it is one fixed sentence: nothing from the scanner is put into it", () => {
    assert.equal(typeof LOCKED_NUDGE_REASON, "string");
    assert.doesNotMatch(LOCKED_NUDGE_REASON, /\$\{|%s|\{\{/);
  });

  // Written to sell, on a UTILITY template. A price or a discount is the line
  // it does not cross: that is what gets a utility template paused.
  test("it quotes no price and no discount", () => {
    assert.doesNotMatch(LOCKED_NUDGE_REASON, /₹|Rs\.?\s*\d|\d+\s*%|\boffer\b|\bdiscount\b|\bfree month\b/i);
  });

  // The same message for every locked E-Tag, door hanger stock included: there
  // is no longer a second sentence to choose between.
  test("is the one fixed message, for every tag", () => {
    assert.equal(lockedNudgeReason(), LOCKED_NUDGE_REASON);
  });
});

describe("a verified scan of a locked tag", () => {
  // The last four of the fixture plate, UP07TS5432.
  const LAST_FOUR = "5432";
  const verify = (tag, address = uniqueAddress(), lastFour = LAST_FOUR) =>
    app.inject({ method: "POST", url: `/api/tags/${tag.token}/verify`, payload: { lastFour }, remoteAddress: address });

  // The count is written after the scanner has been answered, so it is waited
  // for rather than read straight away.
  async function attempts(tag, expected) {
    const deadline = Date.now() + 3000;
    for (;;) {
      const n = (await fresh(tag)).blockedAttempts || 0;
      if (n >= expected || Date.now() > deadline) return n;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  test("reading the plate off a locked tag counts as someone who could not reach the owner", async () => {
    const tag = await makeTag(await makeOwner());
    const res = await verify(tag);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().contactAvailable, false);
    assert.equal(res.json().contactBlockedCode, "FREE_USED");
    assert.equal(await attempts(tag, 1), 1);
  });

  // The scan page must not be able to claim the owner was told, because that
  // is sometimes untrue: the message is capped, and a send can fail.
  test("the scanner's answer says nothing about the owner being told", async () => {
    const tag = await makeTag(await makeOwner());
    const body = (await verify(tag)).json();

    for (const key of Object.keys(body)) {
      assert.doesNotMatch(key, /notif|nudge|told|alert|status/i, `the verify answer carries "${key}"`);
    }
  });

  test("the same scanner trying again that day is one attempt, not several", async () => {
    const tag = await makeTag(await makeOwner());
    const address = uniqueAddress();

    await verify(tag, address);
    await attempts(tag, 1);
    await verify(tag, address);
    await verify(tag, address);
    await settle();

    assert.equal((await fresh(tag)).blockedAttempts, 1);
  });

  test("a second person is a second attempt", async () => {
    const tag = await makeTag(await makeOwner());

    await verify(tag);
    await verify(tag);

    assert.equal(await attempts(tag, 2), 2);
  });

  test("a wrong plate counts nothing", async () => {
    const tag = await makeTag(await makeOwner());
    const res = await verify(tag, uniqueAddress(), "0000");
    await settle();

    assert.equal(res.statusCode, 401);
    assert.equal((await fresh(tag)).blockedAttempts, undefined);
  });

  test("a tag that can still be contacted counts nothing", async () => {
    const tag = await makeTag(await makeOwner(), { freeContactUsed: false, freeContactsSpent: 1 });
    const res = await verify(tag);
    await settle();

    assert.equal(res.json().contactAvailable, true);
    assert.equal((await fresh(tag)).blockedAttempts, undefined);
  });

  test("a premium tag counts nothing", async () => {
    const tag = await makeTag(await makeOwner(), { premium: true, activatedAt: iso(Date.now() - HOUR) });
    await verify(tag);
    await settle();

    assert.equal((await fresh(tag)).blockedAttempts, undefined);
  });

  test("there is no endpoint for a scanner to trigger the owner's message", async () => {
    const tag = await makeTag(await makeOwner());
    const res = await app.inject({
      method: "POST",
      url: `/api/tags/${tag.token}/notify-locked`,
      payload: { grant: "anything" },
      remoteAddress: uniqueAddress()
    });
    assert.equal(res.statusCode, 404);
  });

  // The masked CALL stays locked (tested in call-access.test.js /
  // contact-routing.test.js), but the WhatsApp alert is not that call and
  // never was — see the masking check in /api/contact-requests.
  test("WhatsApp still reaches the owner: only the masked call is locked", async () => {
    // An owner contact channel is required to send at all — see
    // contact-actions.js. Email, since Meta WhatsApp has no real creds here.
    const tag = await makeTag(await makeOwner({ email: "locked-nudge-qa@example.invalid" }));
    const { grant } = (await verify(tag)).json();

    const message = await app.inject({
      method: "POST",
      url: "/api/contact-requests",
      payload: { token: tag.token, action: "message", messageChannel: "whatsapp", reason: REASON, grant },
      remoteAddress: uniqueAddress()
    });
    assert.equal(message.statusCode, 200);
    assert.equal(message.json().ok, true);
    assert.equal((await fresh(tag)).freeContactUsed, true);
  });

  // Door hanger stock is a locked E-Tag like any other: WhatsApp is already
  // covered above for every E-Tag, and this confirms the call and Emergency
  // call lock the same way here too — door hanger stock gets no exemption.
  test("a locked door hanger tag still refuses the call and the Emergency call", async () => {
    const tag = await makeTag(await makeOwner({ mobile: "+919300000001", phone: "+919300000001" }), { emergencyContact: "+919300000002" });
    const address = uniqueAddress();
    const { grant } = (await verify(tag, address)).json();

    const call = await app.inject({ method: "POST", url: `/api/tags/${tag.token}/register-call`, payload: { phone: "9300000003", grant }, remoteAddress: address });
    assert.equal(call.statusCode, 402);
    assert.equal(call.json().code, "FREE_USED");

    const sos = await app.inject({ method: "POST", url: `/api/tags/${tag.token}/register-emergency-call`, payload: { phone: "9300000003", grant }, remoteAddress: address });
    assert.equal(sos.statusCode, 402);
    assert.equal(sos.json().code, "EMERGENCY_LOCKED");
  });

  test("the dashboard shows how many people could not reach them", async () => {
    const ownerId = await makeOwner();
    const tag = await makeTag(ownerId);
    assert.equal((await dashboardTag(tag, ownerId)).missedContacts, 0);

    await verify(tag);
    await verify(tag);
    await verify(tag);
    await attempts(tag, 3);

    assert.equal((await dashboardTag(tag, ownerId)).missedContacts, 3);
  });
});

// Owner's decision, 30 Sep 2026: a locked E-Tag places no masked call of any
// kind. The Emergency call used to be exempt from the free contacts.
describe("the Emergency call on a locked tag", () => {
  const EMERGENCY = "+919800012345";
  const LAST_FOUR = "5432";
  const load = async (tag) =>
    (await app.inject({ method: "GET", url: `/api/tags/${tag.token}`, remoteAddress: uniqueAddress() })).json();
  async function emergencyCall(tag) {
    const address = uniqueAddress();
    const verified = await app.inject({
      method: "POST", url: `/api/tags/${tag.token}/verify`, payload: { lastFour: LAST_FOUR }, remoteAddress: address
    });
    return app.inject({
      method: "POST",
      url: `/api/tags/${tag.token}/register-emergency-call`,
      payload: { phone: "9811122233", grant: verified.json().grant },
      remoteAddress: address
    });
  }

  test("is not offered: the page is told to show the public helplines", async () => {
    const locked = await makeTag(await makeOwner(), { emergencyContact: EMERGENCY });
    const open = await makeTag(await makeOwner(), { emergencyContact: EMERGENCY, freeContactUsed: false, freeContactsSpent: 0 });

    assert.equal((await load(locked)).tag.emergencyAvailable, false);
    assert.equal((await load(open)).tag.emergencyAvailable, true, "an E-Tag with contacts left still offers it");
  });

  test("is refused by the server, and registers no call", async () => {
    const tag = await makeTag(await makeOwner(), { emergencyContact: EMERGENCY });
    const res = await emergencyCall(tag);

    assert.equal(res.statusCode, 402);
    assert.equal(res.json().code, "EMERGENCY_LOCKED");
    assert.equal(await collections.pendingCalls.countDocuments({ token: tag.token }), 0);
  });

  test("still connects on an E-Tag that has a free contact left, and does not spend it", async () => {
    const tag = await makeTag(await makeOwner(), { emergencyContact: EMERGENCY, freeContactUsed: false, freeContactsSpent: 1 });
    const res = await emergencyCall(tag);

    assert.notEqual(res.statusCode, 402, res.body);
    const after = await fresh(tag);
    assert.equal(after.freeContactsSpent, 1);
    assert.equal(after.freeContactUsed, false);
  });

  // A premium tag whose year has run out is blocked for calls too, but it is
  // not this rule: its Emergency call stays on.
  test("still connects on a premium tag whose year has lapsed", async () => {
    const tag = await makeTag(await makeOwner(), {
      premium: true,
      emergencyContact: EMERGENCY,
      activatedAt: iso(Date.now() - 800 * 24 * HOUR),
      createdAt: iso(Date.now() - 800 * 24 * HOUR)
    });

    assert.equal((await load(tag)).tag.emergencyAvailable, true);
    assert.notEqual((await emergencyCall(tag)).statusCode, 402);
  });
});

describe("what the owner's dashboard shows", () => {
  // The projection left both fields out, so the dashboard saw a tag with
  // neither and fell back to the default: two free contacts were shown as one.
  test("door hanger stock is shown with its two free contacts", async () => {
    const ownerId = await makeOwner();
    const unused = await makeTag(ownerId, { freeContactUsed: false, freeContactsSpent: 0, plateNumber: "DL01AA0001" });
    const half = await makeTag(ownerId, { freeContactUsed: false, freeContactsSpent: 1, plateNumber: "DL01AA0002" });

    const a = await dashboardTag(unused, ownerId);
    const b = await dashboardTag(half, ownerId);

    assert.deepEqual([a.freeContactAllowance, a.freeContactsLeft], [2, 2]);
    assert.deepEqual([b.freeContactAllowance, b.freeContactsLeft], [2, 1]);
  });

  test("a premium tag never reports missed contacts", async () => {
    const ownerId = await makeOwner();
    const tag = await makeTag(ownerId, { premium: true, activatedAt: iso(Date.now() - HOUR), blockedAttempts: 4 });
    assert.equal((await dashboardTag(tag, ownerId)).missedContacts, 0);
  });
});

describe("a recycled sticker starts clean", () => {
  test("what happened after the last owner's tag locked is cleared with the rest", () => {
    for (const field of ["blockedAttempts", "lastBlockedAt", "lockedNudgeAt"]) {
      assert.ok(DEMO_TAG_FIELDS.includes(field), `${field} would survive into the next customer's tag`);
    }
  });
});

describe("what a WhatsApp alert costs", () => {
  // createContactAction, with e-mail switched to its dev path (logged, not
  // sent) so the alert "delivers" without a provider. WhatsApp is not
  // configured in a test run, so e-mail is the channel that reaches the owner.
  const quietEnv = { ...env, emailSmtpHost: "" };
  const alert = (tag) => createContactAction(quietEnv, { token: tag.token, action: "message", messageChannel: "whatsapp", reason: REASON });
  const realLog = console.log;
  before(() => { console.log = () => {}; });
  after(() => { console.log = realLog; });

  // Nothing, for any E-Tag — door hanger stock included. It never was the
  // masked call the free allowance protects (see call-access.js), so sending
  // one, however many times, touches neither freeContactsSpent nor
  // freeContactUsed.
  test("an unlocked E-Tag: nothing is spent, however many times it is sent", async () => {
    const tag = await makeTag(await makeOwner({ email: `${MARK}-a@example.com` }), { freeContactsSpent: 0, freeContactUsed: false });

    assert.equal((await alert(tag)).ok, true);
    assert.equal((await alert(tag)).ok, true);
    assert.equal((await alert(tag)).ok, true);
    await settleTrialEndedNotices();

    const after = await fresh(tag);
    assert.equal(after.freeContactsSpent, 0, "three alerts, and the free call is still there");
    assert.equal(after.freeContactUsed, false);
    assert.equal(after.contactAttempts, 3, "they are still counted as contacts");
    assert.equal("trialEndedNotice" in after, false);
  });

  test("an already-locked E-Tag: it still goes through, and announces nothing", async () => {
    const tag = await makeTag(await makeOwner({ email: `${MARK}-b@example.com` }));

    assert.equal((await alert(tag)).ok, true);
    await settleTrialEndedNotices();

    const after = await fresh(tag);
    // Unchanged from the fixture: the WhatsApp alert touched neither field.
    assert.equal(after.freeContactUsed, true);
    assert.equal(after.freeContactsSpent, DOORHANGER_FREE_CONTACTS);
    // trialEndedNotice is a call-connect event only (see webhooks/exotel.js).
    // This tag locked before this alert, and the alert itself spends nothing,
    // so there is no spend here for the notice to be claimed by.
    assert.equal("trialEndedNotice" in after, false);
  });
});
