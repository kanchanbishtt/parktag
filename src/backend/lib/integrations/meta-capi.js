// Meta Conversions API — the server-side half of the Pixel.
//
// The browser Pixel is not enough on its own, for three reasons that all cost
// real money:
//
//   1. 15-30% of client-side events never arrive. Ad blockers, iOS ITP, and
//      tabs closed mid-request all eat them. Meta then optimises against a
//      sample that systematically under-counts the buyers who block trackers.
//
//   2. Some conversions have no browser to fire from at all. A Razorpay
//      payment confirmed by webhook after the buyer closed the tab is a real
//      sale with no page left to run a script on.
//
//   3. `TagActivated` happens on the scan page, where the Pixel deliberately
//      does not load — that page is also used by strangers standing at someone
//      else's vehicle (see assets/analytics.js). The server has no such problem:
//      it knows exactly who activated and sends nothing about anyone else.
//
// Unconfigured is a normal state: with no access token this module no-ops, and
// every caller treats it as best-effort so a Meta outage can never fail a
// payment or an activation.

import crypto from "node:crypto";

const GRAPH_VERSION = "v19.0";

// Meta rejects the whole batch if a request hangs, and every call site here sits
// on a request path a customer is waiting on. Short, and failure is ignored.
const SEND_TIMEOUT_MS = 3000;

export function isMetaCapiConfigured(env) {
  return !!(env.metaPixelId && env.metaCapiAccessToken);
}

// Meta matches users on SHA-256 of NORMALISED values. Normalisation is not
// optional: an unnormalised hash is a different hash, so it silently matches
// nobody and the event lands as anonymous. Lowercase, trim, and for phones
// strip to digits with country code and no leading +.
function hash(value) {
  if (value === null || value === undefined) return null;
  const normalised = String(value).trim().toLowerCase();
  if (!normalised) return null;
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

function hashPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  // A bare 10-digit Indian number has to carry its country code or it will not
  // match the same person as the +91 form the Pixel sees in the browser.
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return crypto.createHash("sha256").update(withCountry).digest("hex");
}

// Only hashed identifiers and the two non-hashed fields Meta explicitly allows
// (IP and user agent) are ever sent. No plate, no tag token, no name, and no
// page URL for events that originate on the scan page.
function buildUserData({ phone, email, clientIp, userAgent, fbp, fbc }) {
  const userData = {};

  const ph = hashPhone(phone);
  if (ph) userData.ph = [ph];

  const em = hash(email);
  if (em) userData.em = [em];

  // These two are sent in the clear by design — Meta uses them for matching and
  // documents them as un-hashed fields.
  if (clientIp) userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;

  // The browser cookies, when the caller has them. They are what lets a
  // server-sent event join up with the same person's browser session.
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  return userData;
}

/**
 * Send one event. Never throws: returns { ok, skipped?, error? }.
 *
 * `eventId` MUST match the id the browser used for the same logical conversion,
 * or Meta counts it twice. See the deterministic ids in assets/analytics.js —
 * a purchase is keyed on its order number precisely so both halves agree
 * without having to pass anything between them.
 */
export async function sendCapiEvent(env, {
  eventName,
  eventId,
  eventSourceUrl,
  actionSource = "website",
  userData = {},
  customData = {},
  testEventCode
}) {
  if (!isMetaCapiConfigured(env)) {
    return { ok: false, skipped: "not-configured" };
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: actionSource,
        ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: buildUserData(userData),
        custom_data: customData
      }
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {})
  };

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${env.metaPixelId}/events`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.metaCapiAccessToken}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, error: `meta capi ${response.status}`, detail: detail.slice(0, 300) };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.name === "TimeoutError" ? "timeout" : String(error?.message || error) };
  }
}

/**
 * Fire and forget, with the failure logged rather than thrown.
 *
 * Every call site is a payment or an activation the customer is waiting on. An
 * analytics vendor being slow or down is not a reason to fail either of those,
 * so nothing here is awaited by the request and nothing here can reject.
 */
export function sendCapiEventBestEffort(logger, env, event) {
  if (!isMetaCapiConfigured(env)) return;

  sendCapiEvent(env, event)
    .then((result) => {
      if (!result.ok && !result.skipped) {
        // Takes a logger rather than the app so it can be called from the core
        // helpers too, which are handed a `log` and have no app to reach for.
        logger?.warn?.(
          { event: "meta-capi-failed", eventName: event.eventName, reason: result.error },
          "[meta capi] event not delivered"
        );
      }
    })
    .catch(() => {
      // sendCapiEvent already swallows everything; this is belt and braces so a
      // rejected promise can never become an unhandled rejection.
    });
}

// The browser and the server must agree on an event's id or Meta counts the
// conversion twice. Both sides derive it from a natural key rather than passing
// a random id around: an order number for a purchase, a tag id for an
// activation. Kept here so the two halves cannot drift apart silently.
export function purchaseEventId(orderNumber) {
  return `purchase:${orderNumber}`;
}

export function activationEventId(tagId) {
  return `tag_activated:${tagId}`;
}
