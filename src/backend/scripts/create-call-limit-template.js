// Submit `parktag_call_limit_reached` to Meta for approval. Run once.
//
//   node --env-file=.env src/backend/scripts/create-call-limit-template.js
//
// Reads META_WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID, the same
// two verify-whatsapp-templates.js uses; the token needs the
// whatsapp_business_management scope. Submitting twice is harmless: Meta
// refuses a name that already exists and this prints why.
//
// Submitted as UTILITY, same reasoning as parktag_trial_ending: this reports
// a state change to a service the owner already holds (their free masked-call
// trial), not an offer. Meta decides the final category on review and may
// move it to MARKETING — check with `npm run verify:whatsapp` or WhatsApp
// Manager, and only let lib/core/campaigns/call-limit-reached.js send once it
// reads APPROVED and UTILITY.
//
// The button URL follows the same convention as parktag_trial_ending's: a
// fixed base the template was approved with, plus the tag id as Meta's
// dynamic URL suffix. It cannot vary per environment — see the note on that
// template in lib/integrations/meta.js.

import { pathToFileURL } from "node:url";

import { CALL_LIMIT_REACHED_TEMPLATE } from "../lib/integrations/meta.js";

export const CALL_LIMIT_REACHED_BODY =
  "Hi {{1}}, someone just tried to reach you through your ParkTag on {{2}}. " +
  "Your free masked-call trial has been fully used, so Private Call is off for now. " +
  "Upgrade to Premium to keep receiving calls.";

export function buildCallLimitTemplatePayload() {
  return {
    name: CALL_LIMIT_REACHED_TEMPLATE,
    // "en", matching the language code sendTemplate() sends with. A template
    // created as en_US would not be found by a send asking for en.
    language: "en",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: CALL_LIMIT_REACHED_BODY,
        // Meta requires a sample value for every variable, in order.
        example: { body_text: [["Priya", "Honda Activa"]] }
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "Upgrade to Premium",
            url: "https://app.parktag.me/owner-membership?tag={{1}}",
            example: ["68f1a2b3c4d5e6f7a8b9c0d1"]
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
    body: JSON.stringify(buildCallLimitTemplatePayload())
  });
  const data = await response.json();

  if (!response.ok) {
    console.error(`Meta refused it: ${data?.error?.error_user_msg || data?.error?.message || response.status}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Submitted ${CALL_LIMIT_REACHED_TEMPLATE}: id ${data.id}, status ${data.status}, category ${data.category}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
