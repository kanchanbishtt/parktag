import { ObjectId } from "mongodb";

import { getCollections } from "../../lib/db/repositories.js";
import { safeEqual } from "../../lib/auth/security.js";
import { normalizeCallOutcome, parseCallDuration } from "../../lib/core/call-outcome.js";
import { sendMixpanelEventBestEffort } from "../../lib/integrations/mixpanel.js";
import { spendFreeContactPipeline, MIN_ANSWERED_CALL_SECONDS } from "../../lib/core/call-access.js";
import { notifyTrialEnded } from "../../lib/core/trial-ended-notice.js";

// Exotel has no request-signing scheme for callbacks (unlike Twilio/Meta), so
// the mitigation is a shared secret embedded in the callback URLs configured
// in the Exotel dashboard, e.g. `.../api/exotel/dial-whom?token=<secret>`.
// Without this, both endpoints below are fully unauthenticated: dial-whom
// resolves ANY caller-supplied phone number to the private target number of a
// pending call (bypassing the whole point of the masked-number flow), and the
// webhook lets anyone overwrite the status/recording/duration of an arbitrary
// contact-request record just by guessing or knowing its Mongo _id / CallSid.
function isAuthorizedExotelRequest(env, request) {
  if (!env.exotelWebhookSecret) {
    // No secret configured. Fail CLOSED in production so a mis-secured deploy
    // can't leak private phone numbers; fail open only in dev so local testing
    // works without Exotel credentials. (Production also refuses to boot at all
    // without this secret — see REQUIRED_IN_PRODUCTION in lib/env.js.)
    return env.runtimeMode !== "production";
  }
  const supplied = request.query?.token || request.headers["x-exotel-webhook-secret"];
  // Trim both sides: env vars pasted into Railway/Exotel frequently pick up a
  // trailing newline or space, which would fail the length-sensitive
  // constant-time compare even when the secret is otherwise correct. No
  // legitimate secret has leading/trailing whitespace, so this only removes a
  // footgun — it does not weaken the check.
  return (
    typeof supplied === "string" &&
    safeEqual(supplied.trim(), String(env.exotelWebhookSecret).trim())
  );
}

export function registerProviderRoutes(app, env) {
  if (!env.exotelWebhookSecret) {
    app.log.warn(
      "[exotel webhooks] EXOTEL_WEBHOOK_SECRET is not configured — /api/exotel/dial-whom and " +
      "/api/provider/exotel/webhook are accepting UNAUTHENTICATED requests. Set EXOTEL_WEBHOOK_SECRET " +
      "and add `?token=<secret>` to both callback URLs configured in the Exotel dashboard."
    );
  }

  // Dial Whom webhook — Exotel hits this GET when a call arrives on the virtual
  // number. We look up the pre-registered pending call by the caller's A-party
  // number and return the B-party (target) phone as plain text.
  // Non-200 or empty body = Exotel plays busy tone to the caller.
  app.get("/api/exotel/dial-whom", async (request, reply) => {
    reply.type("text/plain");

    if (!isAuthorizedExotelRequest(env, request)) {
      // Diagnostic (no PII): reveals WHY auth failed so a mis-configured Exotel
      // callback URL is obvious from the logs — token absent vs length mismatch
      // (URL-encoding/typo) vs equal-length value mismatch (wrong secret).
      const supplied = request.query?.token || request.headers["x-exotel-webhook-secret"];
      request.log.warn({
        event: "dial-whom-auth-failed",
        tokenSupplied: typeof supplied === "string",
        suppliedLen: typeof supplied === "string" ? supplied.length : 0,
        expectedLen: (env.exotelWebhookSecret || "").length,
        secretConfigured: !!env.exotelWebhookSecret,
        runtimeMode: env.runtimeMode
      }, "[dial-whom] rejected: auth failed (check ?token= on the Exotel Dial-Whom URL)");
      reply.code(401);
      return reply.send("");
    }

    const collections = await getCollections(env);
    const callSid  = request.query.CallSid  || null;
    const rawCaller = request.query.CallFrom || request.query.Callfrom || request.query.caller || null;

    if (!collections || !rawCaller) {
      request.log.warn({
        event: "dial-whom-no-caller",
        hasCollections: !!collections,
        queryKeys: Object.keys(request.query || {})
      }, "[dial-whom] no caller number in request (Exotel did not send CallFrom)");
      return reply.send("");
    }

    const callerPhone = toE164(rawCaller);
    const now = new Date();

    // A number with two live routes pointing at different people, registered
    // from different clients, is not a number we can route. Either answer would
    // be a guess, and the wrong guess hands the caller to whoever planted the
    // other row — on a call the caller believes is reaching a vehicle owner.
    // Registration refuses to create that state (see claimCallerNumber in
    // routes/public), so getting here means a row predates that check or two
    // registrations raced it. Play busy rather than pick.
    //
    // Routes registered by the SAME client are left alone: scanning car A and
    // then car B, or trying the owner and then Emergency, legitimately leaves
    // two routes for one handset, and newest-wins below is the right answer for
    // those.
    const liveRoutes = await collections.pendingCalls
      .find({ callerPhone, consumed: false, expiresAt: { $gt: now } })
      .project({ targetPhone: 1, registrantIpHash: 1 })
      .toArray();

    const targets = new Set(liveRoutes.map((row) => toE164(row.targetPhone)));
    const registrants = new Set(liveRoutes.map((row) => row.registrantIpHash || ""));

    if (targets.size > 1 && registrants.size > 1) {
      request.log.warn(
        {
          event: "dial-whom-contested",
          caller: maskPhone(callerPhone),
          routes: liveRoutes.length,
          targets: targets.size
        },
        "[dial-whom] refusing to route: this number has conflicting routes from different clients"
      );
      return reply.send("");
    }

    // Newest registration wins. Without the sort Mongo returns whichever
    // unconsumed row the scan reaches first — in practice the OLDEST — so a
    // scanner who tried Private Call, got no answer, then tapped Emergency was
    // reconnected to the owner's own (unanswered) phone instead of the next of
    // kin. That is precisely the accident case SOS exists for.
    // _id is the tiebreak because it is monotonic: two registrations can share
    // a createdAt millisecond, and a tie would put us back to arbitrary order.
    //
    // Retired by the OUTCOME, not by the attempt. Spending the authorisation
    // here meant the first connect burned it whether or not anyone picked up,
    // so a caller whose call rang out could not redial: Exotel asked again, the
    // server had nothing to hand it, and the number simply stopped working. A
    // real customer's tester hit that on 8 Sep 2026, one connect and four dead
    // redials. The status callback below now retires it once the two of them
    // have actually spoken, and `callSid` is stamped on here so it can find the
    // right row when that happens.
    // Exotel asks this URL once per call, or once per ATTEMPT when the Connect
    // applet's "Fetch Numbers after every call attempt" is on; the later asks
    // carry the previous leg's result. Counted on the route so a route with a
    // backup can answer each ask with only what is still worth dialling.
    const prevStatus = String(request.query.DialCallStatus || "").toLowerCase() || null;
    const prevNumber = request.query.DialWhomNumber ? toE164(request.query.DialWhomNumber) : null;

    const record = await collections.pendingCalls.findOneAndUpdate(
      { callerPhone, consumed: false, expiresAt: { $gt: now } },
      { $set: { lastDialedAt: now.toISOString(), ...(callSid ? { callSid } : {}) }, $inc: { dialRequests: 1 } },
      { returnDocument: "after", sort: { createdAt: -1, _id: -1 } }
    );

    if (!record) {
      // Distinguish "never registered / caller-number mismatch" from "already
      // consumed" and "expired" — the three ways a match can miss.
      const any = await collections.pendingCalls.findOne({ callerPhone });
      request.log.warn({
        event: "dial-whom-no-match",
        callerPhone: maskPhone(callerPhone),
        anyRecordForCaller: !!any,
        alreadyConsumed: any ? !!any.consumed : null,
        expired: any ? new Date(any.expiresAt) <= now : null
      }, "[dial-whom] no pending call matched this caller");
      return reply.send("");
    }

    // A route lives ten minutes, and the owner can take the tag down inside
    // that window: Tag Active off, Calls Active off, or the vehicle deleted
    // (which also sets the status inactive). None of those touch the route, so
    // the tag is read again here, at the moment a phone would ring, and held to
    // the same rule register-call and register-emergency-call applied. The
    // owner's own call back to a scanner is not a scan and is not gated here.
    if (record.type === "scanner_to_owner" || record.type === "scanner_to_emergency") {
      const tag = await collections.tags.findOne(
        { token: record.token },
        { projection: { status: 1, deletedAt: 1, callsPaused: 1 } }
      );
      const tagLive = Boolean(tag) && tag.status === "active" && !tag.deletedAt;
      const callsOpen = record.type === "scanner_to_emergency" || !tag?.callsPaused;
      if (!tagLive || !callsOpen) {
        request.log.info({
          event: "dial-whom-tag-closed",
          caller: maskPhone(callerPhone),
          type: record.type,
          tagStatus: tag ? tag.status : null,
          callsPaused: tag ? Boolean(tag.callsPaused) : null
        }, "[dial-whom] route matched but its tag no longer takes this call");
        return reply.send("");
      }
    }

    request.log.info({
      event: "dial-whom-connect",
      caller: maskPhone(callerPhone),
      target: maskPhone(toE164(record.targetPhone))
    }, "[dial-whom] matched — returning owner number to Exotel");

    // Store the CallSid on the contactRequest so the status callback can link
    // back to it after the call ends (inbound calls have no CustomField).
    if (callSid && record.requestId) {
      await collections.contactRequests.updateOne(
        { _id: record.requestId },
        { $set: { providerRequestId: callSid, status: "connecting", updatedAt: now.toISOString() } }
      ).catch(() => null);
    }

    // The owner's backup number, when the route carries one, rides behind the
    // owner's own. Exotel's Connect applet accepts a comma-separated list from
    // this URL and dials the legs in order, moving on when one is not answered
    // within its ring time — that applet setting ("dial in order", short ring
    // time on the first leg) is configured in the Exotel dashboard, not here.
    // Snapshotted at register-call (public/index.js), so this reads the route
    // and never the owner record. Emergency routes carry no backup.
    const ownerLeg = toE164(record.targetPhone);
    const backupLeg = record.backupPhone ? toE164(record.backupPhone) : null;

    // No backup: exactly what this returned before backups existed, on every
    // ask, so nothing changes for the calls that have always worked.
    if (!backupLeg) return reply.send(ownerLeg);

    // With a backup, the first ask gets both legs in order. A later ask (the
    // applet re-fetching after an attempt) gets the backup only while the
    // owner was the leg that just failed, and nothing once someone answered
    // or the backup itself has been tried — so no phone rings twice.
    const attempt = record.dialRequests || 1;
    let legs;
    if (attempt === 1) {
      legs = [ownerLeg, backupLeg];
    } else if (prevStatus === "completed") {
      legs = [];
    } else if (prevNumber ? prevNumber === ownerLeg : attempt === 2) {
      legs = [backupLeg];
    } else {
      legs = [];
    }
    request.log.info({
      event: "dial-whom-legs",
      attempt,
      prevStatus,
      prevLeg: prevNumber ? maskPhone(prevNumber) : null,
      legs: legs.map(maskPhone)
    }, "[dial-whom] legs for this attempt");
    return reply.send(legs.join(","));
  });

  app.post("/api/provider/exotel/webhook", async (request, reply) => {
    if (!isAuthorizedExotelRequest(env, request)) {
      reply.code(401);
      return { ok: false };
    }

    const collections = await getCollections(env);

    if (!collections) {
      return { ok: true };
    }

    const body = request.body || {};
    const customField = body.CustomField || body.custom_field || null;
    const callSid = body.CallSid || body.Sid || null;
    const messageSid =
      body.MessageSid ||
      body.message_sid ||
      body.sid ||
      null;
    const status =
      body.CallStatus ||
      body.EventType ||
      body.event_type ||
      body.Status ||
      body.status ||
      "provider_update";

    // Full call logging: capture duration, result, and recording when Exotel
    // reports them. Only set fields that are present so intermediate events
    // don't wipe earlier values.
    const set = {
      provider: "exotel",
      providerWebhookStatus: status,
      status,
      updatedAt: new Date().toISOString()
    };
    if (callSid || messageSid) set.providerRequestId = callSid || messageSid;

    // Conversation time first: it is the field that says whether anyone
    // actually spoke, and DialCallDuration counts ringing as well, so it is the
    // last resort rather than the first.
    const duration =
      body.ConversationDuration ?? body.Duration ?? body.DialCallDuration ?? null;
    const seconds = parseCallDuration(duration);
    if (seconds !== null) set.callDuration = seconds;

    const result = body.CallStatus || body.DialCallStatus || body.Status || null;
    if (result) set.callResult = result;

    // Normalised alongside the raw value, never instead of it.
    //
    // `callResult` keeps whatever Exotel actually said, because when this is
    // wrong the raw word is the only thing that explains why. `callOutcome` is
    // the three-word vocabulary everything else reads — see lib/core/
    // call-outcome.js for why the dashboard must not be parsing provider
    // spellings itself.
    //
    // Only written when we can conclude something. A mid-call event that
    // reports neither a terminal status nor a duration must not overwrite the
    // outcome an earlier terminal event already established.
    const outcome = normalizeCallOutcome({ status: result, duration });
    if (outcome) set.callOutcome = outcome;

    // Which of the owner's numbers picked up. DialWhomNumber is the leg the
    // Connect applet actually bridged; compared with the route's snapshot so
    // the owner's activity can say "on backup number". Only meaningful on a
    // route that had a backup; left unset otherwise, and best-effort — a
    // missing field here must never cost the outcome above.
    const dialedLeg = body.DialWhomNumber || body.dial_whom_number || null;
    if (outcome === "answered" && callSid && dialedLeg) {
      const route = await collections.pendingCalls.findOne({ callSid }).catch(() => null);
      if (route?.backupPhone) {
        set.answeredOn = toE164(dialedLeg) === toE164(route.backupPhone) ? "backup" : "primary";
      }
    }

    // A conversation happened, so this authorisation has done its job. Matched
    // on the CallSid stamped by dial-whom, never on the caller's number alone,
    // so a report for a call this server did not route cannot retire somebody
    // else's live authorisation. Anything short of answered leaves it alone,
    // which is what lets an unanswered call be redialled until it expires.
    if (outcome === "answered" && callSid) {
      await collections.pendingCalls
        .updateOne(
          { callSid, consumed: false },
          { $set: { consumed: true, consumedAt: new Date().toISOString() } }
        )
        .catch(() => null);

      // Read-only lookup, same match either path above just wrote by: the
      // owner's product-analytics id is never stamped onto the pendingCalls
      // row itself, so it has to come from whichever contactRequest this
      // event belongs to.
      const contactRequest = await collections.contactRequests
        .findOne(
          customField && ObjectId.isValid(customField)
            ? { _id: new ObjectId(customField) }
            : { providerRequestId: callSid }
        )
        .catch(() => null);
      if (contactRequest?.ownerId) {
        sendMixpanelEventBestEffort(request.log, env, {
          eventName: "masked_call_connected",
          distinctId: String(contactRequest.ownerId),
          properties: { call_duration: seconds, call_type: contactRequest.action || null }
        });
      }

      // The free contact is spent HERE, not at dial time (see register-call in
      // routes/public/index.js) — only once the two people on the line
      // actually talked for MIN_ANSWERED_CALL_SECONDS. `action === "call"`
      // excludes the emergency/SOS route (never spends) and the owner-to-
      // scanner callback (the OWNER's call, not the scanner's allowance).
      //
      // Claimed on the contactRequest, atomically, before the tag is touched:
      // Exotel can and does redeliver a terminal status event, and a second
      // delivery of the same answered call must spend nothing a second time.
      if (
        contactRequest?.action === "call" &&
        contactRequest.token &&
        seconds !== null &&
        seconds >= MIN_ANSWERED_CALL_SECONDS
      ) {
        const claim = await collections.contactRequests
          .findOneAndUpdate(
            { _id: contactRequest._id, freeContactSpentAt: { $exists: false } },
            { $set: { freeContactSpentAt: new Date().toISOString() } }
          )
          .catch(() => null);

        if (claim) {
          const tag = await collections.tags.findOne({ token: contactRequest.token }).catch(() => null);
          if (tag && !tag.premium) {
            const spentAt = new Date().toISOString();
            await collections.tags
              .updateOne({ _id: tag._id }, spendFreeContactPipeline(spentAt, { updatedAt: spentAt }))
              .catch(() => null);
            // If that was the last free call, the owner is told the trial is
            // over. Not awaited: Exotel is waiting on this response and the
            // send can take seconds. notifyTrialEnded claims on the tag
            // itself (freeContactUsed + trialEndedNotice), so it is safe to
            // call unconditionally here — it is a no-op unless this spend was
            // the one that locked the tag.
            notifyTrialEnded(env, collections, tag, request.log);
          }
        }
      }
    }

    if (body.RecordingUrl) set.recordingUrl = body.RecordingUrl;

    if (customField && ObjectId.isValid(customField)) {
      // Outbound call path — CustomField holds the contactRequest _id directly.
      // Validate first: new ObjectId() on a malformed value throws SYNCHRONOUSLY
      // (before the promise), so the trailing .catch wouldn't swallow it and the
      // handler would 500 instead of quietly ignoring a junk CustomField.
      await collections.contactRequests.updateOne(
        { _id: new ObjectId(customField) },
        { $set: set }
      ).catch(() => null);
    } else if (callSid) {
      // Inbound call path — link by CallSid stored on the contactRequest by
      // the Dial Whom handler when the call was first routed.
      await collections.contactRequests.updateOne(
        { providerRequestId: callSid },
        { $set: set }
      ).catch(() => null);
    }

    return { ok: true };
  });
}

function toE164(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

// Log-safe phone mask: keep the country/prefix and last 4, hide the middle.
function maskPhone(input) {
  const s = String(input || "");
  if (s.length <= 6) return s;
  return `${s.slice(0, 3)}***${s.slice(-4)}`;
}
