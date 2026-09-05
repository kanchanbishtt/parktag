// Is the WhatsApp channel actually able to send what this app sends?
//
// Four templates are referenced by lib/integrations/meta.js and NONE of them
// lives in this repo — they are records in Meta's WhatsApp Manager, approved
// separately, and a template that is missing, rejected, paused or defined with
// a different number of variables fails only at the moment a real customer was
// supposed to be told something. Every caller is best-effort by design, so that
// failure is a log line behind a payment that already succeeded.
//
// This is the check that turns that into something you can run before a deploy.
// It reads the account, lists what Meta actually holds, and compares it against
// what the code will send — including the variable COUNT, which is the failure
// nobody predicts: a template approved with two placeholders and called with
// three is rejected at send time with a parameter mismatch.
//
//   node src/backend/scripts/verify-whatsapp-templates.js
//
// Reads META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID and
// WHATSAPP_BUSINESS_ACCOUNT_ID from the environment (a .env is loaded by
// `node --env-file`, or export them inline). Listing needs the
// whatsapp_business_management scope; sending needs whatsapp_business_messaging.
//
// To also send ONE real message to a real handset — it will cost a fraction of
// a rupee and arrive on someone's phone, so it is opt-in and never the default:
//
//   WHATSAPP_TEST_TO=9812345678 node src/backend/scripts/verify-whatsapp-templates.js

import {
  isMetaWhatsappConfigured,
  sendMetaWhatsappMembershipConfirmation,
  sendMetaWhatsappOrderUpdate
} from "../lib/integrations/meta.js";

const env = {
  metaWhatsappPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || "",
  metaWhatsappAccessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || "",
  metaWhatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  appBaseUrl: process.env.APP_BASE_URL || "https://parktag.me"
};

// What meta.js will send, and how many body variables each call fills. The
// counts are the point: they are what Meta checks at send time.
const EXPECTED = [
  { name: "parktag_login", bodyParams: 1, used: "OTP login, COD verification, account deletion" },
  { name: "parktag_owner_notification", bodyParams: 2, used: "scanner reports an issue with a vehicle" },
  { name: "parktag_order_update_v2", bodyParams: 3, used: "shop order confirmation + Track order button" },
  { name: "parktag_membership_confirmed", bodyParams: 3, used: "membership purchase confirmation" }
];

function line(label, value) {
  console.log(`  ${String(label).padEnd(30)} ${value}`);
}

// Meta returns the body text with {{1}}-style placeholders. The highest number
// present is how many parameters it will demand — counting occurrences would
// miscount a template that uses {{1}} twice.
function bodyParamCount(components = []) {
  const body = components.find((c) => c.type === "BODY");
  if (!body || !body.text) return 0;
  const found = [...String(body.text).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return found.length ? Math.max(...found) : 0;
}

async function graph(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/v19.0/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.metaWhatsappAccessToken}` }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }
  return data;
}

async function main() {
  console.log("\nWhatsApp channel\n");

  if (!isMetaWhatsappConfigured(env)) {
    console.log("  META_WHATSAPP_PHONE_NUMBER_ID / META_WHATSAPP_ACCESS_TOKEN are not set.");
    console.log("  Nothing in this app will send a WhatsApp message.\n");
    process.exitCode = 1;
    return;
  }

  const number = await graph(env.metaWhatsappPhoneNumberId, {
    fields: "display_phone_number,verified_name,quality_rating,status,account_mode,name_status"
  });
  line("number", number.display_phone_number);
  line("name", `${number.verified_name} (${number.name_status})`);
  line("status", `${number.status} · ${number.account_mode} · quality ${number.quality_rating}`);

  console.log("\nTemplates\n");

  if (!env.metaWhatsappBusinessAccountId) {
    // Not fatal: sending never needs it. But without it the comparison below —
    // the only part that catches a rejected or mis-shaped template before a
    // customer does — cannot run at all, so say so rather than print nothing.
    console.log("  WHATSAPP_BUSINESS_ACCOUNT_ID is not set, so templates cannot be listed.");
    console.log("  Find it in WhatsApp Manager → Account tools → Overview.\n");
    process.exitCode = 1;
    return;
  }

  const listed = await graph(`${env.metaWhatsappBusinessAccountId}/message_templates`, {
    fields: "name,status,category,components,language",
    limit: "200"
  });
  const byName = new Map((listed.data || []).map((t) => [t.name, t]));

  let ok = true;
  for (const want of EXPECTED) {
    const got = byName.get(want.name);
    if (!got) {
      line(want.name, `MISSING — ${want.used}`);
      ok = false;
      continue;
    }

    const actual = bodyParamCount(got.components);
    const mismatch = actual !== want.bodyParams;
    const note = mismatch
      ? `variables ${actual}, code sends ${want.bodyParams} — WILL FAIL AT SEND`
      : `${actual} variables`;

    line(want.name, `${got.status} · ${got.category} · ${note}`);
    if (got.status !== "APPROVED" || mismatch) ok = false;
  }

  const testTo = process.env.WHATSAPP_TEST_TO;
  if (testTo) {
    console.log("\nLive send\n");
    // Through the real senders, not a hand-rolled fetch: a script that builds
    // its own payload proves only that the script works.
    for (const [label, send] of [
      ["parktag_order_update", () => sendMetaWhatsappOrderUpdate(env, {
        to: testTo, name: "there", orderNumber: "PT-260905-00417",
        status: "Confirmed and being packed"
      })],
      ["parktag_membership_confirmed", () => sendMetaWhatsappMembershipConfirmation(env, {
        to: testTo, name: "there", planLabel: "12 Months", endsOn: "5 September 2027"
      })]
    ]) {
      try {
        const result = await send();
        // `contacts[].wa_id` is Meta telling us which WhatsApp account it
        // actually resolved the number to — the only external confirmation that
        // normalisation was right. `input` is what we sent, so the pair reads
        // as "we asked for X, it went to Y".
        const contact = result?.contacts?.[0];
        line(label, `sent · ${result?.messages?.[0]?.id || "no id returned"}`);
        if (contact) {
          line("  resolved", `${contact.input} -> wa_id ${contact.wa_id}`);
        }
      } catch (err) {
        line(label, `FAILED · ${err.message} · ${err.providerDetail || ""}`);
        ok = false;
      }
    }
  }

  console.log(ok ? "\nAll templates ready.\n" : "\nSomething above will fail in production.\n");
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
});
