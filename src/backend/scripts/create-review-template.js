// Submit `parktag_review_request_v1` to Meta for approval. Run once.
//
//   node --env-file=.env src/backend/scripts/create-review-template.js
//
// Reads META_WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID, the same
// two verify-whatsapp-templates.js uses; the token needs the
// whatsapp_business_management scope. Submitting twice is harmless: Meta
// refuses a name that already exists and this prints why.
//
// Submitted as UTILITY. Meta decides the final category on review and may
// move it to MARKETING. Check with `npm run verify:whatsapp` or WhatsApp
// Manager, and only set REVIEW_REQUESTS_ENABLED=1 once it reads APPROVED and
// UTILITY (see lib/core/campaigns/review-request.js for why).

import { pathToFileURL } from "node:url";

import { REVIEW_REQUEST_TEMPLATE } from "../lib/integrations/meta.js";

export const REVIEW_REQUEST_BODY =
  "Hi {{1}}, your ParkTag has been with you for a few days. How's it going? " +
  "Reply with a line about your experience, and a photo of the tag on your car if you like. " +
  "We read every reply. 🙏";

export function buildReviewTemplatePayload() {
  return {
    name: REVIEW_REQUEST_TEMPLATE,
    // "en", matching the language code sendTemplate() sends with. A template
    // created as en_US would not be found by a send asking for en.
    language: "en",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: REVIEW_REQUEST_BODY,
        // Meta requires a sample value for every variable.
        example: { body_text: [["Priya"]] }
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
    body: JSON.stringify(buildReviewTemplatePayload())
  });
  const data = await response.json();

  if (!response.ok) {
    console.error(`Meta refused it: ${data?.error?.error_user_msg || data?.error?.message || response.status}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Submitted ${REVIEW_REQUEST_TEMPLATE}: id ${data.id}, status ${data.status}, category ${data.category}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
