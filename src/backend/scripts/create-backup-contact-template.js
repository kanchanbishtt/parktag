// Submit `parktag_backup_contact_v1` to Meta for approval. Run once.
//
//   node --env-file=.env src/backend/scripts/create-backup-contact-template.js
//
// Reads META_WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID, the same
// two verify-whatsapp-templates.js uses; the token needs the
// whatsapp_business_management scope. Submitting twice is harmless: Meta
// refuses a name that already exists and this prints why.
//
// Until it is approved, saving a backup number sends nothing and still saves
// (lib/core/backup-contact.js). It switches itself on at approval, no deploy.
// The copy and the reasons for it: docs/WHATSAPP_TEMPLATES.md 2.12.

import { pathToFileURL } from "node:url";

import { BACKUP_CONTACT_TEMPLATE } from "../lib/integrations/meta.js";

// Starts and ends on plain words: Meta rejects a body whose first or last
// token is a placeholder.
export const BACKUP_CONTACT_BODY =
  "This number has been added by *{{1}}* as the backup contact on their ParkTag.\n\n" +
  "If someone needs to reach them about their vehicle and they miss the call, it will ring you. " +
  "The caller never sees your number.\n\n" +
  "Not you, or don't want this? Tap below to remove your number.";

export function buildBackupContactTemplatePayload() {
  return {
    name: BACKUP_CONTACT_TEMPLATE,
    // "en", matching the language code sendTemplate() sends with.
    language: "en",
    category: "UTILITY",
    components: [
      { type: "HEADER", format: "TEXT", text: "ParkTag" },
      {
        type: "BODY",
        text: BACKUP_CONTACT_BODY,
        // Meta requires a sample value for every variable.
        example: { body_text: [["Kanchan"]] }
      },
      { type: "FOOTER", text: "Powered by ParkTag" },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "Remove my number",
            url: "https://app.parktag.me/backup/{{1}}",
            example: ["https://app.parktag.me/backup/3f9c2a7d1e5b4c8a9f0d6e2b7a1c4d5e"]
          }
        ]
      }
    ]
  };
}

async function main() {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN || "";
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
  if (!token || !waba) {
    console.error("Set META_WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID.");
    process.exitCode = 1;
    return;
  }

  const response = await fetch(`https://graph.facebook.com/v19.0/${waba}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildBackupContactTemplatePayload())
  });
  const data = await response.json();

  if (!response.ok) {
    console.error(`Meta refused it: ${data?.error?.error_user_msg || data?.error?.message || response.status}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Submitted ${BACKUP_CONTACT_TEMPLATE}: id ${data.id}, status ${data.status}, category ${data.category}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
