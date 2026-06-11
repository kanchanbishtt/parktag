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
      await collections.contactRequests.updateOne(
        { _id: new ObjectId(customField) },
        {
          $set: {
            provider: "exotel",
            providerRequestId: callSid || messageSid,
            providerWebhookStatus: status,
            status
          }
        }
      ).catch(() => null);
    }

    return { ok: true };
  });
}
