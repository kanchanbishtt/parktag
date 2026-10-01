// Submit three alert templates to Meta for approval. Run once.
//
//   node --env-file=.env src/backend/scripts/create-alert-templates.js
//   node src/backend/scripts/create-alert-templates.js --dry-run    (print, send nothing)
//
//   parktag_owner_notification_v4    the owner alert, now naming the vehicle
//   parktag_emergency_location_v1    the car's location, to the emergency contact
//   parktag_free_trial_ended         the last free contact was just spent: trial over
//
// Reads META_WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID, the same
// two verify-whatsapp-templates.js uses; the token needs the
// whatsapp_business_management scope. Submitting twice is harmless: Meta
// refuses a name that already exists and this prints why.
//
// The copy lives in docs/WHATSAPP_TEMPLATES.md (sections 2.9 to 2.11). Change
// it there and here together.
//
// All three are submitted as UTILITY, and Meta decides the final category on
// review. The app starts sending each one by itself the moment it is approved
// (every caller already tries it, and until then falls back to the old alert
// or, for the trial notice, sends nothing), so run `npm run verify:whatsapp`
// after approval and check the category it prints: a template Meta has filed
// as MARKETING should be deleted in WhatsApp Manager, which puts its message
// back on the fallback.

import { pathToFileURL } from "node:url";

import {
  OWNER_ALERT_PLATE_TEMPLATE,
  EMERGENCY_LOCATION_TEMPLATE,
  FREE_TRIAL_ENDED_TEMPLATE
} from "../lib/integrations/meta.js";

const HEADER = { type: "HEADER", format: "TEXT", text: "ParkTag" };
const FOOTER = { type: "FOOTER", text: "Powered by ParkTag" };

// `samples` are the values Meta requires for every variable, in order.
function body(text, samples) {
  return { type: "BODY", text, example: { body_text: [samples] } };
}

// A URL button is a fixed base plus one variable suffix; the sample is the
// whole URL with that suffix filled in.
function urlButton(text, base, sample) {
  return { type: "BUTTONS", buttons: [{ type: "URL", text, url: `${base}{{1}}`, example: [`${base}${sample}`] }] };
}

export function buildAlertTemplatePayloads() {
  // "en", matching the language code sendTemplate() sends with. A template
  // created as en_US would not be found by a send asking for en.
  const base = { language: "en", category: "UTILITY" };

  return [
    {
      ...base,
      name: OWNER_ALERT_PLATE_TEMPLATE,
      components: [
        HEADER,
        body(
          "Hello {{1}}, someone scanned the ParkTag QR sticker on your vehicle *{{2}}* and reported: {{3}}.\n\n" +
            "Please check your vehicle when you can.",
          ["Girish", "DL9CP4455", "the vehicle's lights appear to be on"]
        ),
        FOOTER
      ]
    },
    {
      ...base,
      name: EMERGENCY_LOCATION_TEMPLATE,
      components: [
        HEADER,
        body(
          "An emergency has been reported at vehicle *{{1}}*, near *{{2}}*.\n\n" +
            "The person at the vehicle is calling you through ParkTag. " +
            "If you miss the call, tap the button below to see where the vehicle is.",
          ["DL9CP####", "Wave Mall, Sector 18, Noida"]
        ),
        FOOTER,
        urlButton("Open in Maps", "https://www.google.com/maps/search/?api=1&query=", "28.5677,77.323")
      ]
    },
    {
      ...base,
      name: FREE_TRIAL_ENDED_TEMPLATE,
      components: [
        HEADER,
        body(
          "Hi *{{1}}*, the free trial on the ParkTag for your vehicle *{{2}}* has ended.\n\n" +
            // Calls only. WhatsApp alerts are left out on purpose (owner's
            // decision, 1 Oct 2026): the message names what Premium brings back.
            "Its free contacts are used up, so private calls and the emergency call " +
            "through this tag are now switched off.",
          ["Girish", "DL9CP4455"]
        ),
        FOOTER,
        urlButton("See my vehicle", "https://app.parktag.me/v/", "65f1a2b3c4d5e6f701234567")
      ]
    }
  ];
}

async function main() {
  const payloads = buildAlertTemplatePayloads();

  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify(payloads, null, 2));
    return;
  }

  const token = process.env.META_WHATSAPP_ACCESS_TOKEN || "";
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
  if (!token || !waba) {
    console.error("Set META_WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID.");
    process.exitCode = 1;
    return;
  }

  for (const payload of payloads) {
    const response = await fetch(`https://graph.facebook.com/v19.0/${waba}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) {
      console.error(`${payload.name}: Meta refused it: ${data?.error?.error_user_msg || data?.error?.message || response.status}`);
      process.exitCode = 1;
      continue;
    }

    console.log(`${payload.name}: submitted, id ${data.id}, status ${data.status}, category ${data.category}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
