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

// Abandoned checkout, against the approved `parktag_cart_reminder`:
//
//   {{1}} first name   {{2}} product   {{3}} a link to finish
//
// The link is a body variable, not a button, because that is the shape the
// template was approved with. New templates should use a button instead: a URL
// in the body is not tappable in every WhatsApp client and cannot be tracked.
export async function sendMetaWhatsappCartReminder(env, { to, name, product, url }) {
  return sendTemplate(env, {
    to,
    template: "parktag_cart_reminder",
    components: bodyComponent(name, product, url),
    publicMessage: "Unable to send the WhatsApp order reminder."
  });
}

// The owner alert. The most important message ParkTag sends, and the one whose
// template name is most likely to change, so it is a constant rather than a
// literal buried in the call.
//
// Three versions exist in WhatsApp Manager and the differences matter:
//
//   parktag_owner_notification     v1. One unbroken sentence. No header, no
//                                  footer, no bold, nothing to tap. This was
//                                  live for months.
//   parktag_owner_notification_v2  header + footer, still nothing to tap.
//   parktag_owner_notification_v3  bold, and a "Call them back" button to
//                                  /v/:tagId.
//
// v3 needs Meta approval, which is measured in days. Point this at v2 in the
// meantime: it is already approved, already better, and takes the same two
// body variables in the same order, so the switch is this one line.
//
// WHEN MOVING TO v3, the button parameter below is not optional. A URL button
// with no parameter is rejected by Meta at send time, so `tagId` becomes
// required and contact-actions.js must pass it.
export const OWNER_ALERT_TEMPLATE = "parktag_owner_notification_v2";

export async function sendMetaWhatsappAlert(env, { to, ownerName, reason, tagId = null }) {
  const usesButton = OWNER_ALERT_TEMPLATE.endsWith("_v3");

  // Refused rather than sent without it. A v3 send with no tagId fails at Meta
  // with a parameter-count error, which surfaces as "the owner was never told
  // somebody is at their car" — the single worst failure in this app.
  if (usesButton && !tagId) {
    throw new Error("The owner alert template needs a tagId for its Call back button.");
  }

  return sendTemplate(env, {
    to,
    template: OWNER_ALERT_TEMPLATE,
    components: usesButton
      ? [
          ...bodyComponent(ownerName, reason),
          // Index "0" is the button's position in the template, not an id. The
          // parameter is the dynamic SUFFIX of the approved base URL, so it is
          // the tag id and never a whole link.
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(tagId) }] }
        ]
      : bodyComponent(ownerName, reason),
    publicMessage: "Unable to send the WhatsApp message right now."
  });
}

// Activation. `parktag_tag_activated` was approved months ago and has delivered
// zero messages, because nothing ever called it.
//
//   {{1}} first name   {{2}} vehicle label   {{3}} plate number
//
// The FULL plate, not the masked one the success screen shows. That masking
// exists because the scan page is used by strangers standing at someone else's
// car; this message goes to a number the owner has just proved by OTP, about a
// plate painted on the outside of their own vehicle.
// The premium year is ending, against the approved `parktag_trial_ending`:
//
//   {{1}} first name   {{2}} vehicle   {{3}} how long is left ("30 days")
//   button  "Keep premium on" -> app.parktag.me/owner-membership?tag={{1}}
//
// UTILITY, and it stayed utility because the PRICE came out of the body at
// submission. Meta reclassified three sibling templates to MARKETING on
// re-review; the ones that survived all describe a dated change to a service
// the customer currently holds, with no invitation to buy in the text. Adding
// "from Rs 249" here would very likely flip it, and the e-mail counterpart
// carries the price instead.
export async function sendMetaWhatsappTrialEnding(env, { to, name, vehicle, remaining, tagId }) {
  return sendTemplate(env, {
    to,
    template: "parktag_trial_ending",
    components: [
      ...bodyComponent(name, vehicle, remaining),
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(tagId) }] }
    ],
    publicMessage: "Unable to send the WhatsApp renewal reminder."
  });
}

export async function sendMetaWhatsappTagActivated(env, { to, name, vehicle, plate }) {
  return sendTemplate(env, {
    to,
    template: "parktag_tag_activated",
    components: bodyComponent(name, vehicle, plate),
    publicMessage: "Unable to send the WhatsApp activation confirmation."
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
