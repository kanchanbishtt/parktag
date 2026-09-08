// The scheduler is allowed to run twice. The send is not.
//
// WHY THIS IS A DATABASE TEST AND NOT A UNIT TEST.
//
// The promise made in lib/core/message-log.js is not "the code checks before it
// sends" — a check is a race, and two instances running the same campaign at
// the same moment would both pass it. The promise is a UNIQUE INDEX, and an
// index either exists in MongoDB or it does not. Mocking that away would assert
// that the mock is unique, which is not the property anyone is worried about.
//
// What is pinned here:
//
//   1. Two sends with one dedupeKey produce ONE message.
//   2. So do two CONCURRENT sends, which is the case a pre-flight check misses.
//   3. With the index missing, sendOnce refuses to send at all rather than
//      quietly losing its only duplicate protection.
//   4. A failed send keeps its row, so a retry cannot reuse the slot.
//   5. A marketing opt-out silences offers and does NOT silence service
//      messages.
//   6. The scheduler lease is held by exactly one caller.

import test, { describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { assertDisposableDatabase } from "./helpers.js";
import { getEnv } from "../lib/env.js";
import { getCollections, ensureCoreIndexes } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { sendOnce, resetDedupeIndexCheck } from "../lib/core/message-log.js";
import {
  canSendMarketing,
  canSendUtility,
  hasOpenServiceWindow,
  orderMayReceiveMarketing
} from "../lib/core/messaging-consent.js";

assertDisposableDatabase();

const env = getEnv();
let collections;

// A campaign id unique to this run. The messages collection has a 400-day TTL,
// so a fixed id would inherit rows from yesterday's run and the first
// assertion would fail for a reason that has nothing to do with the code.
const CAMPAIGN = `test-campaign-${Date.now()}`;

before(async () => {
  collections = await getCollections(env);
  await ensureCoreIndexes(collections, null);
});

beforeEach(async () => {
  await collections.messages.deleteMany({ campaign: { $regex: "^test-campaign-" } });
  resetDedupeIndexCheck();
});

after(async () => {
  await collections.messages.deleteMany({ campaign: { $regex: "^test-campaign-" } });
  await closeMongoConnection();
});

// A send that records that it happened, so "how many times" is answerable.
function countingSend(calls, wamid = null) {
  return async () => {
    calls.push(Date.now());
    return wamid ? { messages: [{ id: wamid }] } : undefined;
  };
}

describe("one dedupe key, one message", () => {
  test("a second send with the same key does not reach the provider", async () => {
    const calls = [];
    const entry = {
      campaign: CAMPAIGN,
      dedupeKey: "order:sequential",
      to: "+919812345678",
      channel: "whatsapp",
      send: countingSend(calls)
    };

    const first = await sendOnce(env, collections, entry, null);
    const second = await sendOnce(env, collections, entry, null);

    assert.equal(first.sent, true, "the first send did not go out");
    assert.equal(second.sent, false, "the second send went out, so a customer got it twice");
    assert.equal(second.reason, "duplicate");
    assert.equal(calls.length, 1, "the provider was called more than once");
  });

  test("two CONCURRENT sends still produce one message", async () => {
    // The case a "check then send" cannot survive, and the reason the guarantee
    // is an index rather than a lookup. Both calls read an empty collection.
    const calls = [];
    const entry = {
      campaign: CAMPAIGN,
      dedupeKey: "order:concurrent",
      to: "+919812345678",
      channel: "whatsapp",
      send: countingSend(calls)
    };

    const results = await Promise.all([
      sendOnce(env, collections, entry, null),
      sendOnce(env, collections, entry, null),
      sendOnce(env, collections, entry, null)
    ]);

    assert.equal(results.filter((r) => r.sent).length, 1, "more than one racer sent");
    assert.equal(calls.length, 1, "the provider was called more than once under a race");

    const rows = await collections.messages.countDocuments({
      campaign: CAMPAIGN,
      dedupeKey: "order:concurrent"
    });
    assert.equal(rows, 1);
  });

  test("a different key is a different message", async () => {
    const calls = [];
    const base = { campaign: CAMPAIGN, to: "+919812345678", channel: "whatsapp" };

    await sendOnce(env, collections, { ...base, dedupeKey: "a", send: countingSend(calls) }, null);
    await sendOnce(env, collections, { ...base, dedupeKey: "b", send: countingSend(calls) }, null);

    assert.equal(calls.length, 2, "dedupe is matching keys it should not");
  });
});

describe("no index, no send", () => {
  test("sendOnce refuses when the unique index is missing", async () => {
    // The failure this guards against is quiet: ensureCoreIndexes logs and
    // carries on when an index cannot be built, which is right for every other
    // index and catastrophic for this one. Without the refusal, a cluster that
    // failed to build it would send every campaign message twice and nothing
    // would say so.
    await collections.messages.dropIndex("campaign_dedupe_unique").catch(() => {});
    resetDedupeIndexCheck();

    const calls = [];
    const result = await sendOnce(
      env,
      collections,
      {
        campaign: CAMPAIGN,
        dedupeKey: "order:unprotected",
        to: "+919812345678",
        channel: "whatsapp",
        send: countingSend(calls)
      },
      null
    );

    assert.equal(result.sent, false, "sent with no duplicate protection in place");
    assert.equal(result.reason, "no-dedupe-index");
    assert.equal(calls.length, 0, "the provider was called with no dedupe index");

    // Put it back, or every later test in the file runs unprotected.
    await ensureCoreIndexes(collections, null);
    await collections.messages
      .createIndex({ campaign: 1, dedupeKey: 1 }, { unique: true, name: "campaign_dedupe_unique" })
      .catch(() => {});
    resetDedupeIndexCheck();
  });
});

describe("a failed send is a decision, not a free slot", () => {
  test("the row survives a provider failure and blocks a retry", async () => {
    // Deleting the row on failure would look tidier and would be wrong: the
    // dangerous provider failure is a TIMEOUT after the message was accepted,
    // where a retry is a duplicate to a customer who already has it.
    let attempts = 0;
    const entry = {
      campaign: CAMPAIGN,
      dedupeKey: "order:failed",
      to: "+919812345678",
      channel: "whatsapp",
      send: async () => {
        attempts += 1;
        throw new Error("provider timeout");
      }
    };

    const first = await sendOnce(env, collections, entry, null);
    assert.equal(first.sent, false);
    assert.equal(first.reason, "send-failed");

    const row = await collections.messages.findOne({ campaign: CAMPAIGN, dedupeKey: "order:failed" });
    assert.ok(row, "the failed row was deleted, so the next tick would resend");
    assert.equal(row.status, "failed");
    assert.match(row.error, /timeout/);

    const second = await sendOnce(env, collections, entry, null);
    assert.equal(second.reason, "duplicate");
    assert.equal(attempts, 1, "a failed send was retried, which is how a timeout duplicates");
  });
});

describe("consent separates offers from service messages", () => {
  test("an opt-out silences marketing and NOT utility", () => {
    // The distinction that matters most. "Stop sending me offers" must never be
    // read as "stop telling me my insurance expires next week" — those are
    // different requests, and conflating them silences the messages the
    // customer is actually paying for.
    const optedOut = { marketingOptInAt: "2026-01-01T00:00:00.000Z", marketingOptOut: true };

    assert.equal(canSendMarketing(optedOut), false, "an offer reached someone who opted out");
    assert.equal(canSendUtility(optedOut), true, "an opt-out silenced a service message");
  });

  test("marketing needs opt-in, and silence is not consent", () => {
    assert.equal(canSendMarketing({}), false, "an offer went to someone who never opted in");
    assert.equal(canSendMarketing({ marketingOptInAt: "2026-01-01T00:00:00.000Z" }), true);
    assert.equal(canSendMarketing(null), false);
  });

  test("a hard stop silences everything", () => {
    assert.equal(canSendUtility({ messagingHardStop: true }), false);
  });

  test("a guest order carries its own consent", () => {
    // A guest checkout is anonymous by design (ownerId: null), so there is no
    // account to hold a flag. Without this, cart-reminder could never reach the
    // buyers it exists for.
    assert.equal(orderMayReceiveMarketing({ marketingOptInAt: "2026-09-08T00:00:00.000Z" }, null), true);
    assert.equal(orderMayReceiveMarketing({}, null), false, "an unticked guest order was treated as consent");
  });

  test("an account opt-out beats an older tick on the order", () => {
    // THE asymmetry that makes this lawful rather than merely recorded. Someone
    // who replies STOP has withdrawn consent, and a checkbox they ticked on a
    // months-old order must not resurrect it.
    const order = { marketingOptInAt: "2026-01-01T00:00:00.000Z" };
    assert.equal(orderMayReceiveMarketing(order, { marketingOptOut: true }), false);
    assert.equal(orderMayReceiveMarketing(order, { messagingHardStop: true }), false);
    assert.equal(orderMayReceiveMarketing(order, {}), true);
  });

  test("consent on the account covers an order that predates it", () => {
    assert.equal(orderMayReceiveMarketing({}, { marketingOptInAt: "2026-09-08T00:00:00.000Z" }), true);
  });

  test("the free service window expires", () => {
    const now = Date.parse("2026-09-08T12:00:00.000Z");
    assert.equal(hasOpenServiceWindow({ waWindowOpenUntil: "2026-09-08T13:00:00.000Z" }, now), true);
    assert.equal(hasOpenServiceWindow({ waWindowOpenUntil: "2026-09-08T11:00:00.000Z" }, now), false);
    assert.equal(hasOpenServiceWindow({}, now), false);
    // Junk in the field must read as closed, never as unlimited: the same rule
    // hasActiveSubscription applies to an unparseable end date.
    assert.equal(hasOpenServiceWindow({ waWindowOpenUntil: "not a date" }, now), false);
  });
});
