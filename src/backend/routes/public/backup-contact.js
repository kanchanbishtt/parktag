// "Remove my number", from the WhatsApp notice a backup contact receives
// (lib/core/backup-contact.js). Unauthenticated on purpose: the person tapping
// it has no account and never will. The token is the whole credential, and all
// it can do is take one number off one owner.
//
// The page at /backup/<token> (app.js) only shows a button; this POST does the
// work. A GET that removed the number would be set off by WhatsApp's link
// preview, or any crawler, before the person had decided anything.

import { getCollections } from "../../lib/db/repositories.js";
import { declineBackupContact } from "../../lib/core/backup-contact.js";

export function registerBackupContactRoutes(app, env) {
  app.post(
    "/api/backup-contact/decline",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const collections = await getCollections(env);
      if (!collections) {
        reply.code(500);
        return { ok: false, error: "Something went wrong. Please try again." };
      }

      const { status } = await declineBackupContact(collections, String(request.body?.token || ""));
      if (status === "invalid") {
        reply.code(404);
        return { ok: false, status, error: "This link has already been used or is no longer active." };
      }

      request.log.info({ event: "backup-contact-declined" }, "[backup] a backup contact removed their number");
      return { ok: true, status };
    }
  );
}
