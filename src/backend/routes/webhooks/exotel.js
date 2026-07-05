import { ObjectId } from "mongodb";

import { getCollections } from "../../lib/db/repositories.js";

export function registerProviderRoutes(app, env) {
  // Dial Whom webhook — Exotel hits this GET when a call arrives on the virtual
  // number. We look up the pre-registered pending call by the caller's A-party
  // number and return the B-party (target) phone as plain text.
  // Non-200 or empty body = Exotel plays busy tone to the caller.
  app.get("/api/exotel/dial-whom", async (request, reply) => {
    const collections = await getCollections(env);
    const callSid  = request.query.CallSid  || null;
    const rawCaller = request.query.CallFrom || request.query.Callfrom || request.query.caller || null;

    reply.type("text/plain");

    if (!collections || !rawCaller) {
      return reply.send("");
    }

    const callerPhone = toE164(rawCaller);
    const now = new Date();

    const record = await collections.pendingCalls.findOneAndUpdate(
      { callerPhone, consumed: false, expiresAt: { $gt: now } },
      { $set: { consumed: true, consumedAt: now.toISOString() } },
      { returnDocument: "after" }
    );

    if (!record) {
      console.warn("[dial-whom] unmatched inbound call — no pending record found for this caller");
      return reply.send("");
    }

    // Store the CallSid on the contactRequest so the status callback can link
    // back to it after the call ends (inbound calls have no CustomField).
    if (callSid && record.requestId) {
      await collections.contactRequests.updateOne(
        { _id: record.requestId },
        { $set: { providerRequestId: callSid, status: "connecting", updatedAt: now.toISOString() } }
      ).catch(() => null);
    }

    return reply.send(toE164(record.targetPhone));
  });

  app.post("/api/provider/exotel/webhook", async (request) => {
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

    const duration =
      body.ConversationDuration ?? body.Duration ?? body.DialCallDuration ?? null;
    if (duration !== null && duration !== "") set.callDuration = Number(duration) || 0;

    const result = body.CallStatus || body.DialCallStatus || body.Status || null;
    if (result) set.callResult = result;

    if (body.RecordingUrl) set.recordingUrl = body.RecordingUrl;

    if (customField) {
      // Outbound call path — CustomField holds the contactRequest _id directly.
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
