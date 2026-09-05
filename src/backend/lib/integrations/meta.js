import crypto from "node:crypto";

import { redactText, safeEqual } from "../auth/security.js";
import { toE164 } from "../core/phone.js";

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


export function isMetaWhatsappConfigured(env) {
  return !!(env.metaWhatsappPhoneNumberId && env.metaWhatsappAccessToken);
}

// Every message this file sends is a pre-approved template posted to the same
// Graph endpoint with the same auth, and the only things that differ are the
// template name, its parameters and the sentence shown to a user when the send
// fails. That was four copies of the request, and they had already drifted —
// three attached `providerStatusCode` to the thrown error and the OTP one did
// not, so the same provider failure was more diagnosable on some paths than
// others for no reason anybody chose.
//
// A note on parameters: Meta REJECTS an empty string in a template variable
// (it is a parameter-count/format mismatch to them, not a blank). A caller that
// might not have a value has to pass a real fallback, not "" — see the tracking
// link in order-fulfilment.js, which used to send "" whenever a waybill had not
// come back from Delhivery yet and so failed every pre-shipment confirmation.
async function sendTemplate(env, { to, template, components, publicMessage }) {
  if (!isMetaWhatsappConfigured(env)) {
    throw new Error(
      "Meta WhatsApp is not configured: missing metaWhatsappPhoneNumberId or metaWhatsappAccessToken"
    );
  }

  // WITH the plus sign, and E.164. Meta documents that when the + is absent it
  // prepends the BUSINESS number's country calling code to whatever it was
  // given, without checking whether one is already there — its own worked
  // example, for an Indian business, shows "1 (631) 555-1234" being delivered
  // to +9116315551234. This sender used to strip the +, which put every
  // message ParkTag sends into precisely that shape. It has worked, so Meta is
  // more forgiving in practice than on paper; the cost of it ever matching its
  // documentation is a login code delivered to a stranger.
  const toNumber = toE164(to);
  if (!toNumber) {
    // Refused rather than sent as-is. An unreadable number cannot be delivered
    // to the right handset by any provider, and passing it on only moves the
    // failure somewhere it is harder to see.
    throw new Error("Not a valid phone number for WhatsApp delivery.");
  }
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
        name: template,
        language: { code: "en" },
        components
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    const err = new Error(publicMessage);
    err.providerDetail = sanitizeProviderDetail(detail);
    err.providerStatusCode = response.status;
    throw err;
  }

  return data;
}

// Body parameters, in the order the approved template numbers them. Split out
// because every template here is body-only except the OTP, which also has to
// fill the code into its one-tap copy button.
function bodyComponent(...values) {
  return [
    {
      type: "body",
      parameters: values.map((text) => ({ type: "text", text: String(text) }))
    }
  ];
}

export async function sendMetaWhatsappOtp(env, { to, code }) {
  return sendTemplate(env, {
    to,
    template: "parktag_login",
    components: [
      ...bodyComponent(code),
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: code }]
      }
    ],
    publicMessage: "Unable to send WhatsApp OTP."
  });
}

export async function sendMetaWhatsappAlert(env, { to, ownerName, reason }) {
  return sendTemplate(env, {
    to,
    template: "parktag_owner_notification",
    components: bodyComponent(ownerName, reason),
    publicMessage: "Unable to send the WhatsApp message right now."
  });
}

// Order confirmation over WhatsApp, against `parktag_order_update_v2`:
//
//   body    {{1}} name   {{2}} order number   {{3}} status
//   button  "Track order" -> app.parktag.me/track-order?order={{1}}
//
// The tracking link is a BUTTON rather than a fourth body variable, and it
// points at ParkTag's own tracking page rather than straight at the courier.
// The courier link only exists once Delhivery has accepted the parcel, which is
// after most confirmations go out — v1 put that link in the body, so the
// message that mattered most (the one sent before anything had shipped) carried
// either a dead link or a placeholder. /track-order has no such gap: it answers
// "preparing to ship" before there is a waybill and shows the live scan history
// after, and it already reads ?order= to fill the field in, so the buyer only
// supplies the last four digits of their own phone.
//
// The base URL is fixed in the template, not built from env.appBaseUrl. That
// variable points at the LANDING site (www), which does not serve this page —
// see the note on password-reset links. A template URL is also approved once
// and cannot vary per environment, so it has to name the host that really
// answers.
//
// v2 rather than an edit: v1 is approved and live, and editing components sends
// a template back through review. Two names means the switch is a deploy, not a
// wait.
export async function sendMetaWhatsappOrderUpdate(env, { to, name, orderNumber, status }) {
  return sendTemplate(env, {
    to,
    template: "parktag_order_update_v2",
    components: [
      ...bodyComponent(name, orderNumber, status),
      // Index "0" is the button's position in the template, not an id. The
      // parameter is the dynamic SUFFIX of the approved URL — Meta appends it,
      // so this is the order number and never a whole link.
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: String(orderNumber) }]
      }
    ],
    publicMessage: "Unable to send the WhatsApp order update."
  });
}

// Membership confirmation. Requires an approved template named
// `parktag_membership_confirmed` with three body variables in this order:
// {{1}} name, {{2}} plan label, {{3}} the date premium runs until.
//
// This is the ONLY thing that tells a buyer their membership went through if
// they closed the tab during payment — nothing else was sent, on any channel,
// and the Razorpay webhook path has no browser to show a dialog to at all.
export async function sendMetaWhatsappMembershipConfirmation(
  env,
  { to, name, planLabel, endsOn }
) {
  return sendTemplate(env, {
    to,
    template: "parktag_membership_confirmed",
    components: bodyComponent(name, planLabel, endsOn),
    publicMessage: "Unable to send the WhatsApp membership confirmation."
  });
}
