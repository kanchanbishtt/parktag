// A small, undeferred error reporter for the checkout-relevant pages.
//
// The main analytics bundle (pt-analytics.js) is deliberately deferred to
// idle/load so it never competes with the hero or the catalogue fetch, but
// that means it never loads at all for a session that bounces in under a few
// seconds — exactly the sessions most likely to be hitting a real failure
// (Instagram's in-app browser tearing the WebView down mid-init, a script
// that 404s, a thrown exception). Clarity has the same blind spot for the
// same reason. This file is the one thing on these pages that is NOT
// deferred, so a fast failure is still reported somewhere.
//
// No PII is sent: a truncated error message, the page URL, the User-Agent,
// and an optional short "context" label. The backend scrubs emails and long
// digit runs again regardless (see lib/integrations/sentry.js).
//
// ES5 only, on purpose: this runs in exactly the older/degraded browsers it
// exists to diagnose.
(function () {
  "use strict";

  function send(message, context) {
    try {
      var body = JSON.stringify({
        message: String(message || "").slice(0, 300),
        context: String(context || "").slice(0, 64),
        url: String(location.href).slice(0, 300),
        userAgent: String(navigator.userAgent || "").slice(0, 300)
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/system/client-error", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/system/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true
        }).catch(function () {});
      }
    } catch (_) {
      // Reporting a failure must never itself throw.
    }
  }

  window.addEventListener("error", function (event) {
    send(event && event.message ? event.message : "window.onerror", "onerror");
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    var message = reason && (reason.message || String(reason));
    send(message || "unhandledrejection", "unhandledrejection");
  });

  // Exposed so call sites with their own diagnosis (checkout-loader.js, a
  // failed Razorpay open) can report something more specific than a generic
  // thrown error.
  window.ptReportError = send;
})();
