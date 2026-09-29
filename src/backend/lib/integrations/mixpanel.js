// Mixpanel — owner-dashboard product analytics.
//
// Server-side only, deliberately. Two of the four events this powers have no
// browser to fire from at all (a scan is a stranger at someone else's
// windscreen; a masked call connecting is an Exotel webhook), and the
// remaining two (dashboard actions, sign-in) already round-trip through an
// authenticated /api/owner/* handler that has the owner's real database id —
// the same id /api/session and /api/owner/dashboard both deliberately refuse
// to hand to the browser (see routes/auth/credentials.js and
// routes/owner/dashboard.js). Tracking from the server avoids ever putting
// that id, or a Mixpanel identity merge, in reach of a script on the page.
//
// Unconfigured is a normal state: with no token this module no-ops, and every
// caller treats it as best-effort so a Mixpanel outage can never fail a
// login, a payment, or a call.

import crypto from "node:crypto";

const TRACK_URL = "https://api.mixpanel.com/track?ip=0";

// Every call site here sits on a request path an owner is waiting on (a
// login, a payment, a tag update). Short, and failure is ignored.
const SEND_TIMEOUT_MS = 3000;

export function isMixpanelConfigured(env) {
  return !!env.mixpanelToken;
}

/**
 * Send one event. Never throws: returns { ok, skipped?, error? }.
 */
export async function sendMixpanelEvent(env, { eventName, distinctId, properties = {} }) {
  if (!isMixpanelConfigured(env)) {
    return { ok: false, skipped: "not-configured" };
  }

  const payload = [
    {
      event: eventName,
      properties: {
        token: env.mixpanelToken,
        distinct_id: String(distinctId),
        time: Math.floor(Date.now() / 1000),
        $insert_id: crypto.randomUUID(),
        ...properties
      }
    }
  ];

  try {
    const response = await fetch(TRACK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/plain" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, error: `mixpanel ${response.status}`, detail: detail.slice(0, 300) };
    }

    // /track answers "1" (accepted) or "0" (rejected) as a bare text body.
    const body = await response.text();
    if (body.trim() !== "1") {
      return { ok: false, error: `mixpanel rejected: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.name === "TimeoutError" ? "timeout" : String(error?.message || error) };
  }
}

/**
 * Fire and forget, with the failure logged rather than thrown.
 */
export function sendMixpanelEventBestEffort(logger, env, event) {
  if (!isMixpanelConfigured(env)) return;

  sendMixpanelEvent(env, event)
    .then((result) => {
      if (!result.ok && !result.skipped) {
        logger?.warn?.(
          { event: "mixpanel-failed", eventName: event.eventName, reason: result.error },
          "[mixpanel] event not delivered"
        );
      }
    })
    .catch(() => {
      // sendMixpanelEvent already swallows everything; belt and braces so a
      // rejected promise can never become an unhandled rejection.
    });
}
