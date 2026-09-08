// The clock. Everything time-based in ParkTag hangs off this one tick.
//
// ── Why in-process, and not Railway Cron ───────────────────────────────────
//
// A cron service is a second container that boots the whole app to run one
// query. It also does not remove the need for a lease or for the unique index
// in lib/core/message-log.js, because a cron that overlaps a slow run has the
// same duplicate problem an interval does. Given both are needed anyway, the
// interval costs one file and no infrastructure. If tick drift ever matters,
// the trigger is the only thing that has to change.
//
// ── What this promises, and what it does not ───────────────────────────────
//
// AT LEAST once, never exactly once. The lease below stops two instances doing
// the same work at the same moment, but a container killed mid-tick has already
// sent some messages and recorded some claims, and nothing here can undo that.
// Exactly-once lives in message-log.js, in a unique index, where it belongs.
//
// ── The rule campaigns must follow ─────────────────────────────────────────
//
// A campaign's due() MUST return a BOUNDED window, never an open-ended "older
// than X". The dedupe row that stops a resend is TTL'd (400 days, see
// repositories.js), so an unbounded query re-matches the same customer forever
// and eventually outlives its own record of having messaged them. Bounded
// means: "the trial ends between 30 and 31 days from now", not "the trial ends
// in under 30 days".

import { getCollections } from "../db/repositories.js";
import { CAMPAIGNS } from "./campaigns/index.js";

// Every 15 minutes. Nothing here is urgent to the minute — the tightest window
// any campaign wants is "3 hours after an abandoned checkout" — and a longer
// gap means fewer wasted queries against Atlas.
const TICK_MS = 15 * 60 * 1000;

// Long enough that a slow tick keeps its lease, short enough that a crashed
// instance frees it within one cycle.
const LEASE_MS = 10 * 60 * 1000;

// First tick is delayed. A deploy restarts every instance at once, and a
// campaign query is the last thing that should compete with the traffic being
// re-established.
const FIRST_TICK_DELAY_MS = 2 * 60 * 1000;

// The blast radius, and the reason it is a constant rather than a config knob.
//
// The realistic scheduler bug is not "sends slightly too many" — it is a date
// comparison inverted, which matches EVERY row and messages the entire customer
// base in one tick. There is no undo for that on WhatsApp. The cap turns a
// catastrophe into an incident with a loud log line, and 200 is comfortably
// above any real day's volume at current scale while being obviously wrong if
// it is ever hit.
const MAX_SENDS_PER_TICK = 200;

const LEASE_ID = "scheduler-lease";
const DUPLICATE_KEY = 11000;

let timer = null;

// Take the lease, or discover somebody else holds it.
//
// Three cases, and the upsert handles all of them without a race:
//
//   no lease row yet          filter misses, upsert inserts       -> we hold it
//   lease exists, expired     filter matches, expiry moves        -> we hold it
//   lease exists, still live  filter misses, upsert tries to      -> they hold it
//                             insert the same _id, throws E11000
//
// The duplicate-key error is not a failure here, it is the answer.
//
// Exported for the test, which drives it directly rather than through runTick.
// Going through runTick measures a race between two whole ticks, and a tick
// that finishes and releases its lease before the other one starts is a timing
// artifact rather than the property worth pinning.
export async function takeLease(collections, now) {
  const expiresAt = new Date(now.getTime() + LEASE_MS);

  try {
    await collections.counters.findOneAndUpdate(
      { _id: LEASE_ID, expiresAt: { $lt: now } },
      { $set: { expiresAt } },
      { upsert: true, returnDocument: "after" }
    );
    return true;
  } catch (err) {
    if (err?.code === DUPLICATE_KEY) return false;
    throw err;
  }
}

async function releaseLease(collections) {
  // Hand it back early so a redeploy does not idle the next instance for the
  // rest of the lease. Best effort: an expired lease is reclaimed anyway.
  await collections.counters
    .updateOne({ _id: LEASE_ID }, { $set: { expiresAt: new Date(0) } })
    .catch(() => {});
}

/**
 * One pass over every campaign. Exported so a test and the dry-run script can
 * drive it directly without waiting on a timer.
 */
export async function runTick(env, log, { force = false } = {}) {
  let collections;
  try {
    collections = await getCollections(env);
  } catch (err) {
    log?.warn?.({ err }, "[scheduler] database unavailable, tick skipped");
    return { ran: false, reason: "no-db" };
  }
  if (!collections) return { ran: false, reason: "no-db" };

  const now = new Date();

  // `force` is for tests and the dry-run script, which have no competitors.
  if (!force && !(await takeLease(collections, now))) {
    return { ran: false, reason: "lease-held" };
  }

  const dryRun = env.campaignDryRun;
  let budget = MAX_SENDS_PER_TICK;
  const summary = {};

  for (const campaign of CAMPAIGNS) {
    if (budget <= 0) break;

    try {
      const result = await campaign.run(env, collections, {
        now,
        limit: budget,
        dryRun,
        log
      });

      const sent = result?.sent || 0;
      budget -= sent;
      summary[campaign.id] = result;
    } catch (err) {
      // One broken campaign must not stop the rest. This is the same reasoning
      // as the per-channel guards in order-fulfilment.js: independent work,
      // independently failable.
      log?.error?.({ err, campaign: campaign.id }, "[scheduler] campaign threw");
      summary[campaign.id] = { error: true };
    }
  }

  if (budget <= 0) {
    // Loud on purpose. Hitting the cap at current scale means a query is wrong,
    // not that business is booming.
    log?.error?.(
      { event: "scheduler-cap-hit", cap: MAX_SENDS_PER_TICK, summary },
      "[scheduler] per-tick send cap HIT — a campaign query is probably matching too much"
    );
  }

  if (!force) await releaseLease(collections);

  log?.info?.({ dryRun, summary }, "[scheduler] tick complete");
  return { ran: true, dryRun, summary };
}

/**
 * Start ticking. Called from server.js after listen, never awaited.
 *
 * Off unless SCHEDULER_ENABLED is set, so a local `npm run dev` and every test
 * run stay silent. Nothing about a developer's laptop should be able to message
 * a customer.
 */
export function startScheduler(env, log) {
  if (!env.schedulerEnabled) {
    log?.info?.("[scheduler] disabled (set SCHEDULER_ENABLED=1 to run campaigns)");
    return () => {};
  }

  if (env.campaignDryRun) {
    log?.warn?.("[scheduler] DRY RUN — campaigns will select recipients and send nothing");
  }

  const tick = () => {
    runTick(env, log).catch((err) => {
      // runTick already guards its internals; this is the backstop that keeps a
      // rejected promise from reaching the process-level handler in server.js.
      log?.error?.({ err }, "[scheduler] tick failed");
    });
  };

  const first = setTimeout(() => {
    tick();
    timer = setInterval(tick, TICK_MS);
    // unref so a pending tick can never hold the process open through a
    // shutdown drain.
    timer.unref?.();
  }, FIRST_TICK_DELAY_MS);
  first.unref?.();

  return () => {
    clearTimeout(first);
    if (timer) clearInterval(timer);
    timer = null;
  };
}
