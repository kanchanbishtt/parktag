import { ObjectId } from "mongodb";

import { getCollections } from "../lib/repositories.js";

export function registerProviderRoutes(app, env) {
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

    if (customField) {
      // Full call logging (spec §5): capture duration, result, and recording when
      // Exotel reports them. Only set fields that are present so intermediate
      // events don't wipe earlier values.
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

      await collections.contactRequests.updateOne(
        { _id: new ObjectId(customField) },
        { $set: set }
      ).catch(() => null);
    }

    return { ok: true };
  });
}
