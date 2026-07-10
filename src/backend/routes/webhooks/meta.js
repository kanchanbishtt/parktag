import { getCollections } from "../../lib/db/repositories.js";

export function registerMetaWebhookRoutes(app, env) {
  // Meta sends a GET request to verify the webhook URL is real.
  // Must echo back hub.challenge if hub.verify_token matches.
  app.get("/api/provider/meta/webhook", async (request, reply) => {
    const mode      = request.query["hub.mode"];
    const token     = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    if (mode === "subscribe" && token === env.metaWhatsappWebhookVerifyToken) {
      reply.type("text/plain");
      return reply.send(challenge);
    }

    reply.code(403);
    return { ok: false, error: "Verification token mismatch" };
  });

  // Meta POSTs delivery status updates here after each message.
  // Statuses: sent, delivered, read, failed
  app.post("/api/provider/meta/webhook", async (request) => {
    const collections = await getCollections(env);
    if (!collections) return { ok: true };

    const body = request.body || {};

    // Meta wraps everything in entry[].changes[]
    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value    = change.value || {};
        const statuses = value.statuses || [];

        for (const s of statuses) {
          const messageId = s.id;        // wamid — matches providerRequestId stored at send time
          const status    = s.status;    // sent | delivered | read | failed
          const timestamp = s.timestamp; // unix seconds

          if (!messageId || !status) continue;

          const set = {
            provider: "meta",
            providerWebhookStatus: status,
            updatedAt: new Date().toISOString()
          };

          // Map Meta statuses to our internal status field
          if (status === "delivered") set.status = "delivered";
          else if (status === "read")  set.status = "read";
          else if (status === "failed") {
            set.status = "provider_failed";
            const error = s.errors?.[0];
            if (error) {
              set.providerError     = error.message || "Delivery failed";
              set.providerErrorDetail = `${error.code}: ${error.title || ""}`.trim();
            }
          }

          if (timestamp) set.providerTimestamp = Number(timestamp);

          await collections.contactRequests.updateOne(
            { providerRequestId: messageId },
            { $set: set }
          ).catch(() => null);
        }
      }
    }

    return { ok: true };
  });
}
