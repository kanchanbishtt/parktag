// Every outbound message, logged once, sent once.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Until now every send in this app was a side effect of an HTTP request, so
// "did we already send this?" was answered by the fact that a human had only
// pressed the button once. The scheduler removes that guarantee: a tick that
// runs twice, a container that restarts mid-run, or two Railway instances
// racing all produce the same campaign query and the same recipients.
//
// The fix is not to make the scheduler exactly-once. That is expensive and
// still wrong under a crash. The fix is to make the SEND idempotent and let the
// scheduler be at-least-once, which is the only thing a scheduler can honestly
// promise.
//
// ── Claim before send, not after ───────────────────────────────────────────
//
// The row is inserted BEFORE the provider is called. That ordering is the whole
// design and it is deliberately the less obvious one.
//
//   log after send:   crash between send and log  ->  message sent, no record
//                                                     -> next tick sends AGAIN
//   log before send:  crash between log and send   ->  record, no message
//                                                     -> next tick skips it
//
// The first failure mode messages a customer repeatedly. The second loses one
// message. On a channel where the recipient can block the number that also
// carries OTPs and owner alerts, a lost nudge is enormously cheaper than a
// duplicate, so the ordering is chosen to fail in that direction.
//
// A claimed-but-never-sent row is recoverable: it keeps status "claimed" and
// carries no sentAt, so a sweep could retry it. Nothing does that yet, on
// purpose — it is only worth building once there is evidence sends are being
// lost, and the log itself is what will show that.

import { getCollections } from "../db/repositories.js";

// Raised when the claim collides. Not an error condition: it is the mechanism
// working, and callers treat it as "someone else has this one".
const DUPLICATE_KEY = 11000;

// Has the guarantee actually been built?
//
// ensureCoreIndexes logs and continues when an index cannot be created, which
// is right for every other index in this app and wrong for this one: without
// campaign_dedupe_unique there is no duplicate protection at all, and the
// insert below would happily write a second row and send a second message.
//
// So this is checked once per process rather than assumed. Checked, not
// created: creating it here would paper over a genuine failure at boot, and an
// index that cannot be built usually cannot be built because the data already
// violates it.
let uniqueIndexVerified = null;

async function hasDedupeIndex(collections, log) {
  if (uniqueIndexVerified !== null) return uniqueIndexVerified;

  try {
    const indexes = await collections.messages.indexes();
    uniqueIndexVerified = indexes.some(
      (index) => index.name === "campaign_dedupe_unique" && index.unique === true
    );
  } catch (err) {
    // Cannot tell. Refuse rather than guess: an unreadable index list is not
    // evidence that duplicate protection exists.
    log?.error?.({ err }, "[messages] could not read indexes, campaign sends are held");
    uniqueIndexVerified = false;
  }

  if (!uniqueIndexVerified) {
    log?.error?.(
      { event: "message-dedupe-index-missing" },
      "[messages] campaign_dedupe_unique is MISSING — campaign sends are disabled until it exists"
    );
  }

  return uniqueIndexVerified;
}

// Exposed for tests, which build and drop the index to prove the guard bites.
export function resetDedupeIndexCheck() {
  uniqueIndexVerified = null;
}

/**
 * Send exactly once, ever, for a given (campaign, dedupeKey).
 *
 * `send` is called at most once and must resolve to the provider's message id
 * where there is one (WhatsApp returns a wamid; e-mail does not).
 *
 * Returns { sent, reason }. It NEVER throws: a message is a side effect, and a
 * failure to send one must not be able to fail the request or the tick that
 * triggered it.
 *
 * @param {object} env
 * @param {object} collections
 * @param {object} entry
 * @param {string} entry.campaign     stable campaign id, e.g. "trial-t30"
 * @param {string} entry.dedupeKey    natural key, NEVER a timestamp
 * @param {string} entry.to           recipient, phone or e-mail
 * @param {"whatsapp"|"email"} entry.channel
 * @param {string} [entry.templateName]
 * @param {object} [entry.ownerId]
 * @param {() => Promise<{messages?: Array<{id?: string}>}|void>} entry.send
 * @param {object} [log]
 */
export async function sendOnce(env, collections, entry, log) {
  const { campaign, dedupeKey, to, channel, templateName = null, ownerId = null, send } = entry;

  if (!campaign || !dedupeKey || !to || typeof send !== "function") {
    log?.error?.({ campaign, dedupeKey, hasTo: Boolean(to) }, "[messages] malformed send, skipped");
    return { sent: false, reason: "malformed" };
  }

  if (!(await hasDedupeIndex(collections, log))) {
    return { sent: false, reason: "no-dedupe-index" };
  }

  const now = new Date();
  let claimId;

  // The claim. A second caller with the same key loses here and sends nothing.
  try {
    const { insertedId } = await collections.messages.insertOne({
      campaign,
      dedupeKey,
      ownerId,
      // The recipient is a customer's phone number or address, so it is stored
      // for support and delivery attribution but never logged in the clear —
      // the same rule the OTP logger and the Meta webhook follow.
      to,
      channel,
      templateName,
      status: "claimed",
      wamid: null,
      sentAt: null,
      error: null,
      createdAt: now
    });
    claimId = insertedId;
  } catch (err) {
    if (err?.code === DUPLICATE_KEY) {
      return { sent: false, reason: "duplicate" };
    }
    // The database is unreachable or refused the write. Do NOT send: an
    // unclaimed send is exactly the duplicate this module exists to prevent.
    log?.error?.({ err, campaign }, "[messages] could not claim, send skipped");
    return { sent: false, reason: "claim-failed" };
  }

  try {
    const result = await send();
    // Meta answers { messages: [{ id: "wamid..." }] }. Nodemailer answers
    // something else entirely and has no equivalent, which is why wamid is
    // nullable and its unique index is partial.
    const wamid = result?.messages?.[0]?.id || null;

    await collections.messages.updateOne(
      { _id: claimId },
      { $set: { status: "sent", wamid, sentAt: new Date() } }
    );

    return { sent: true, wamid };
  } catch (err) {
    // The row STAYS. Deleting it on failure would let the next tick retry, and
    // a provider that fails slowly (a timeout after the message was accepted)
    // is exactly the case where a retry duplicates. A failed row is a decision
    // recorded, not a slot to be reused.
    await collections.messages
      .updateOne(
        { _id: claimId },
        { $set: { status: "failed", error: String(err?.message || err).slice(0, 300) } }
      )
      .catch(() => {});

    log?.error?.({ err, campaign, channel, templateName }, "[messages] send failed");
    return { sent: false, reason: "send-failed" };
  }
}

/**
 * Attach a delivery status from Meta to the row that sent it.
 *
 * Called from the Meta webhook. Returns true when a row matched, which is what
 * lets the webhook tell "a status for a message we sent" apart from "a status
 * for something we have no record of" — today every OTP status is the second
 * kind, because OTP sends discard the wamid.
 */
export async function recordDeliveryStatus(collections, { wamid, status, at }) {
  if (!wamid || !status) return false;

  const result = await collections.messages.updateOne(
    { wamid },
    { $set: { status, statusAt: at || new Date() } }
  );

  return result.matchedCount > 0;
}

// Convenience for call sites that have an env but no collections in hand.
export async function withCollections(env, fn, log) {
  try {
    const collections = await getCollections(env);
    if (!collections) return null;
    return await fn(collections);
  } catch (err) {
    log?.error?.({ err }, "[messages] database unavailable");
    return null;
  }
}
