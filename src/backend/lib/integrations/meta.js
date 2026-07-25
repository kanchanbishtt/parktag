import crypto from "node:crypto";

import { redactText, safeEqual } from "../auth/security.js";

// Meta signs every webhook POST with `X-Hub-Signature-256: sha256=<hex hmac>`
// computed over the *raw* request body using the App Secret (Meta App
// dashboard → Settings → Basic — NOT the WhatsApp access token). Verifying
// this is the only way to know a webhook call actually came from Meta and
// not an attacker POSTing directly to our public endpoint.
export function verifyMetaWebhookSignature(env, rawBody, signatureHeader) {
  if (!env.metaAppSecret || !rawBody || !signatureHeader) return false;

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;

  const expected = crypto
    .createHmac("sha256", env.metaAppSecret)
    .update(rawBody)
    .digest("hex");

  return safeEqual(signatureHeader.slice(prefix.length), expected);
}

// Meta's error payloads sometimes echo the destination phone number back in
// the message text (e.g. "Recipient +91XXXXXXXXXX is not a WhatsApp user").
// Redact PII before this ever reaches logs or the admin API.
function sanitizeProviderDetail(detail) {
  if (detail === null || detail === undefined) return null;
  return redactText(detail).slice(0, 1000);
}

function normalizeIndianNumber(input) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    return digits.replace("+", "");
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }
  return digits;
}

export function isMetaWhatsappConfigured(env) {
  return !!(env.metaWhatsappPhoneNumberId && env.metaWhatsappAccessToken);
}

export async function sendMetaWhatsappOtp(env, { to, code }) {
  if (!isMetaWhatsappConfigured(env)) {
    throw new Error("Meta WhatsApp is not configured.");
  }

  const toNumber = normalizeIndianNumber(to);
  const url = `https://graph.facebook.com/v19.0/${env.metaWhatsappPhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.metaWhatsappAccessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "template",
      template: {
        name: "parktag_login",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: code }]
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }]
          }
        ]
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    const err = new Error("Unable to send WhatsApp OTP.");
    err.providerDetail = sanitizeProviderDetail(detail);
    throw err;
  }

  return data;
}

export async function sendMetaWhatsappAlert(env, { to, ownerName, reason }) {
  if (!isMetaWhatsappConfigured(env)) {
    throw new Error("Meta WhatsApp is not configured: missing metaWhatsappPhoneNumberId or metaWhatsappAccessToken");
  }

  const toNumber = normalizeIndianNumber(to);
  const url = `https://graph.facebook.com/v19.0/${env.metaWhatsappPhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.metaWhatsappAccessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "template",
      template: {
        name: "parktag_owner_notification",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: ownerName },
              { type: "text", text: reason }
            ]
          }
        ]
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    const err = new Error("Unable to send the WhatsApp message right now.");
    err.providerDetail = sanitizeProviderDetail(detail);
    err.providerStatusCode = response.status;
    throw err;
  }

  return data;
}
