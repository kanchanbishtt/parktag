// The rule the dashboard draws its buttons from.
//
// The server is the authority and refuses anything it should not
// (callback-premium-only.test.js exercises that against a real route and a real
// database). This file covers the other half: which control an owner is shown.
// Get that wrong in the permissive direction and they tap a button the server
// then refuses; get it wrong in the strict direction and somebody who paid for
// a premium tag never sees the feature at all. The second is the quieter bug
// and the worse one, which is why the rule is a plain function rather than
// something only assertable by grepping the page for a function name.
//
// No DOM and no database — the module takes tags, a clock and a window.
import test from "node:test";
import assert from "node:assert/strict";

import {
  callbackState,
  CALLABLE,
  NEEDS_PREMIUM,
  NOT_CALLABLE
} from "../../frontend/scripts/owner/callback-eligibility.js";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const TEN_MIN = 10 * 60 * 1000;

const PREMIUM_TAG = { token: "prem", premium: true, plateNumber: "DL5CB1234" };
const ETAG = { token: "free", premium: false, plateNumber: "DL8SX9911" };
const TAGS = [PREMIUM_TAG, ETAG];

function contact(overrides = {}) {
  return {
    id: "r1",
    token: "prem",
    phone: "+919812345678",
    action: "call",
    callOutcome: null,
    createdAt: new Date(NOW - 2 * 60 * 1000).toISOString(),
    ...overrides
  };
}

function stateOf(overrides, tags = TAGS) {
  return callbackState(contact(overrides), { tags, now: NOW, windowMs: TEN_MIN });
}

test("a recent call on a premium tag is callable", () => {
  assert.equal(stateOf({}), CALLABLE);
});

test("the same call on an E-Tag asks for premium instead", () => {
  assert.equal(stateOf({ token: "free" }), NEEDS_PREMIUM);
});

test("holding a premium tag elsewhere does not help the E-Tag", () => {
  // The account has a premium sticker. This contact did not arrive on it.
  assert.equal(stateOf({ token: "free" }, [PREMIUM_TAG, ETAG]), NEEDS_PREMIUM);
});

test("a tag that is no longer in the list is refused", () => {
  // A deleted vehicle. The dashboard omits deleted tags and the server omits
  // them from its premium list too, so both sides refuse rather than one
  // offering a button the other will not honour.
  assert.equal(stateOf({ token: "vanished" }), NEEDS_PREMIUM);
});

test("an anonymous report is not callable at any tier", () => {
  // Nobody to dial. Premium does not conjure a number.
  assert.equal(stateOf({ phone: null }), NOT_CALLABLE);
  assert.equal(stateOf({ phone: "" }), NOT_CALLABLE);
  assert.equal(stateOf({ phone: null, token: "free" }), NOT_CALLABLE,
    "and the upgrade nudge must not appear for a contact that could never be returned");
});

test("a call that was answered is not offered again", () => {
  assert.equal(stateOf({ callOutcome: "answered" }), NOT_CALLABLE);
});

test("missed and unknown outcomes both stay callable", () => {
  // Exotel's status callback has never been configured, so callOutcome is null
  // on every call in the database. Gating on `=== "missed"` would hide the
  // button from all of them.
  assert.equal(stateOf({ callOutcome: null }), CALLABLE);
  assert.equal(stateOf({ callOutcome: "missed" }), CALLABLE);
  assert.equal(stateOf({ callOutcome: "failed" }), CALLABLE);
});

test("past the window it is not callable, and not an upsell either", () => {
  // Seeing who called lasts 48 hours; ringing them back lasts ten minutes.
  // Nagging about an upgrade over a contact from yesterday would be noise.
  const old = { createdAt: new Date(NOW - 11 * 60 * 1000).toISOString() };
  assert.equal(stateOf(old), NOT_CALLABLE);
  assert.equal(stateOf({ ...old, token: "free" }), NOT_CALLABLE);
});

test("the boundary itself is still inside the window", () => {
  assert.equal(stateOf({ createdAt: new Date(NOW - TEN_MIN).toISOString() }), CALLABLE);
  assert.equal(stateOf({ createdAt: new Date(NOW - TEN_MIN - 1).toISOString() }), NOT_CALLABLE);
});

test("a contact from the future is not treated as expired", () => {
  // Clock skew between the phone and the server, which is ordinary.
  assert.equal(stateOf({ createdAt: new Date(NOW + 30 * 1000).toISOString() }), CALLABLE);
});

test("junk in does not become a callable row", () => {
  assert.equal(callbackState(null, { tags: TAGS, now: NOW, windowMs: TEN_MIN }), NOT_CALLABLE);
  assert.equal(stateOf({ createdAt: "not a date" }), NOT_CALLABLE);
  // No tag list: nothing can match, so the honest answer is that this account
  // has no premium tag — not that the contact is unreachable.
  //
  // The clock and the window are still passed. Omitting them is not the same
  // test: `now` would default to the wall clock and `windowMs` to 0, so the
  // window check above would answer first and every contact would read as
  // NOT_CALLABLE — including on the day this was written.
  assert.equal(callbackState(contact(), { now: NOW, windowMs: TEN_MIN }), NEEDS_PREMIUM);
});

test("a WhatsApp report that left a number is callable on a premium tag", () => {
  // The case the whole feature started from: the owner is told somebody
  // contacted them and has nothing to act on.
  assert.equal(stateOf({ action: "message", messageChannel: "whatsapp" }), CALLABLE);
  assert.equal(stateOf({ action: "message", token: "free" }), NEEDS_PREMIUM);
});

test("the three answers are distinct", () => {
  // They drive three different controls; collapsing any two would silently
  // merge "upgrade to reach them" with "there is nothing to do here".
  assert.equal(new Set([CALLABLE, NEEDS_PREMIUM, NOT_CALLABLE]).size, 3);
});
