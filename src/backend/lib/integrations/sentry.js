// Error monitoring. Reports server errors (5xx, crashes, stray rejections) to
// Sentry so a failure is known before an owner or scanner reports it.
//
// Off unless SENTRY_DSN is set, so dev, CI and tests send nothing.
//
// ── What is NOT sent ────────────────────────────────────────────────────────
// The product's promise is that an owner's phone number stays hidden, and the
// errors here are raised while handling exactly that data. So the event is cut
// down to the stack trace and a few labels before it leaves the process:
//
//   • no request object: URLs carry tokens and phone numbers in the query
//     string (see sanitizeLogUrl in app.js), bodies carry OTPs and addresses,
//     headers carry the session cookie;
//   • no user, no IP (`sendDefaultPii: false`, and `user` is dropped anyway);
//   • no breadcrumbs: outgoing HTTP breadcrumbs record provider URLs, some of
//     which embed credentials, and console breadcrumbs repeat log lines;
//   • emails and long digit runs are masked in every message, because driver
//     errors quote the offending value (a duplicate-key error names the mobile).
//
// Tags are the route PATTERN (`/t/:token`), never the raw URL, plus method and
// status: enough to group and find the handler, nothing that identifies anyone.

import * as Sentry from "@sentry/node";

const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;
// Six or more digits, allowing spaces and dashes inside: mobiles with or
// without +91, landlines, and six-digit OTPs.
const LONG_DIGITS = /\+?\d[\d\s-]{4,}\d/g;

export function redactText(value) {
  if (typeof value !== "string") return value;
  return value.replace(EMAIL, "[email]").replace(LONG_DIGITS, "[number]");
}

// Exported for tests. Mutates and returns the event, per Sentry's contract.
export function scrubEvent(event) {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;

  if (event.message) {
    event.message = redactText(event.message);
  }

  for (const exception of event.exception?.values ?? []) {
    exception.value = redactText(exception.value);
    // Local variables would carry the very values redacted above.
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }

  return event;
}

// Client errors are the app working as designed: a bad OTP, a throttle, a
// missing tag. Only failures on our side are worth an alert. A clientError()
// thrown without a statusCode still answers 500, so the `expose` mark (see
// lib/errors.js) is checked too: its message was written for the user, which
// makes it a validation outcome, not a crash.
export function shouldReport(statusCode, error) {
  if (error?.expose === true) return false;
  return !Number.isInteger(statusCode) || statusCode >= 500;
}

// The SDK's own uncaught-exception and unhandled-rejection handlers are left
// out: server.js already decides what each of those does (drain and exit,
// or log and keep serving), and it reports to Sentry itself below.
const REPLACED_INTEGRATIONS = new Set(["OnUncaughtException", "OnUnhandledRejection"]);

export function initSentry(env) {
  if (!env.sentryDsn) return false;

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.runtimeMode,
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    sendDefaultPii: false,
    integrations: (defaults) => defaults.filter((i) => !REPLACED_INTEGRATIONS.has(i.name)),
    beforeSend: scrubEvent,
    beforeSendTransaction: () => null
  });

  return true;
}

// A failure the BROWSER saw and reported itself, via POST /api/system/client-
// error — mainly the Meta in-app browser tearing a checkout script down
// mid-load. Deliberately captureMessage, not captureException: there is no
// real stack from the client, only a message the page sent, and inventing an
// Error around it would misrepresent what this is. scrubEvent still runs on
// it (beforeSend applies to every event type), so emails and long digit runs
// are redacted the same way a server error's would be.
export function captureClientError({ message, context, extra } = {}) {
  if (!Sentry.isInitialized()) return;

  Sentry.withScope((scope) => {
    scope.setTag("source", "client");
    if (context) scope.setTag("context", String(context).slice(0, 64));
    scope.setLevel("warning");
    for (const [key, value] of Object.entries(extra || {})) {
      scope.setExtra(key, redactText(value));
    }
    Sentry.captureMessage(String(message || "Client error").slice(0, 500));
  });
}

export function captureServerError(error, { request, statusCode, context } = {}) {
  if (!Sentry.isInitialized()) return;

  Sentry.withScope((scope) => {
    if (request) {
      scope.setTag("method", request.method);
      scope.setTag("route", request.routeOptions?.url || "unmatched");
    }
    if (statusCode) scope.setTag("status", String(statusCode));
    if (context) scope.setTag("context", context);
    Sentry.captureException(error);
  });
}

// Give queued events a moment to leave before the process exits.
export async function flushSentry(timeoutMs = 2000) {
  if (!Sentry.isInitialized()) return;
  await Sentry.close(timeoutMs);
}
