// ParkTag front-end analytics.
//
// Served by `GET /pt-analytics.js` (see app.js) and deliberately NOT placed under
// the static root: the measurement IDs are injected per environment at request
// time. Staging and dev must never write into the production GA4 property or
// Pixel, and hard-coding the IDs in a file under src/frontend would guarantee
// exactly that.
//
// ONE vocabulary, TWO destinations. Every funnel moment in the app calls
// ptTrack(); this file owns the entire mapping to GA4 and the Meta Pixel. When
// server-side Conversions API lands it becomes a third destination inside
// dispatch(), and not one call site has to change.
(function () {
  "use strict";

  // Replaced server-side. Unset in an environment → empty string → this whole
  // file no-ops. That is the intended state for dev and staging.
  var GA4_ID = "__GA4_MEASUREMENT_ID__";
  var PIXEL_ID = "__META_PIXEL_ID__";

  // The <script> tag declares which surface it is on:
  //   data-surface="app"     owner dashboard, shop, registration
  //   data-surface="scanner" the public scan/report pages
  //
  // Declared rather than inferred from the URL because getting this wrong has a
  // real cost (see the pixel rule below) and a path regex silently rots the
  // first time a route is renamed.
  var surface = (document.currentScript &&
                 document.currentScript.getAttribute("data-surface")) || "app";

  // The scan pages are used by STRANGERS standing at someone else's vehicle.
  // They did not buy anything, did not sign up, and have consented to nothing.
  // Loading the Meta Pixel there would ship Meta a record of an identified
  // person scanning a specific vehicle tag, from a product whose entire promise
  // is privacy. So the Pixel does not load on the scanner surface at all, and
  // the two scanner events below additionally carry `pixel: null` — the rule is
  // enforced twice, because someone will eventually add a third scanner event.
  var pixelAllowed = surface !== "scanner";

  var gaReady = !!GA4_ID;
  var pixelReady = !!PIXEL_ID && pixelAllowed;

  if (!gaReady && !pixelReady) {
    // Nothing configured for this environment. Still define ptTrack so call
    // sites never need to feature-detect.
    window.ptTrack = function () {};
    return;
  }

  // ---------------------------------------------------------------- event map

  // `pixel: null` means the event is GA4-only and must never reach Meta.
  // `custom: true` selects fbq("trackCustom") over fbq("track") — Meta rejects
  // unknown names passed to the standard tracker.
  var EVENTS = {
    view_item:      { ga: "view_item",      pixel: "ViewContent" },
    begin_checkout: { ga: "begin_checkout", pixel: "InitiateCheckout" },
    purchase:       { ga: "purchase",       pixel: "Purchase" },
    sign_up:        { ga: "sign_up",        pixel: "CompleteRegistration" },
    tag_activated:  { ga: "tag_activated",  pixel: "TagActivated", custom: true },
    scan_received:  { ga: "scan_received",  pixel: null },
    contact_action: { ga: "contact_action", pixel: null }
  };

  // Allow-list, not a deny-list. A deny-list means every future call site is one
  // careless argument away from posting a phone number, a plate or a tag token
  // to Google and Meta. Anything not named here is dropped before dispatch.
  var ALLOWED = {
    value: 1, currency: 1, transaction_id: 1, items: 1,
    item_id: 1, item_name: 1, quantity: 1, price: 1,
    method: 1, reason: 1, plan: 1, vehicle_type: 1, cod: 1
  };

  function sanitize(input) {
    var out = {};
    if (!input) return out;

    Object.keys(input).forEach(function (key) {
      if (!ALLOWED[key]) return;
      var value = input[key];

      if (Array.isArray(value)) {
        out[key] = value.map(sanitize);
        return;
      }
      if (value !== null && typeof value === "object") {
        out[key] = sanitize(value);
        return;
      }
      out[key] = value;
    });

    return out;
  }

  // Shared id so the same logical event sent from the browser and (later) from
  // the server can be de-duplicated by Meta instead of double-counted.
  function eventId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (_) { /* fall through */ }
    return "pt-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  // ------------------------------------------------------------------ loaders

  if (gaReady) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    // The scan pages are the one surface where the visitor is not our customer,
    // so we do not follow them around afterwards.
    window.gtag("config", GA4_ID, { send_page_view: true, allow_ad_personalization_signals: pixelAllowed });

    var ga = document.createElement("script");
    ga.async = true;
    ga.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA4_ID);
    document.head.appendChild(ga);
  }

  if (pixelReady) {
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq("init", PIXEL_ID);
    window.fbq("track", "PageView");
  }

  // ---------------------------------------------------------------- dispatch

  function dispatch(name, params) {
    var map = EVENTS[name];
    if (!map) {
      // Unknown name = a typo at the call site. Fail loudly in the console
      // rather than silently sending nothing for the next six months.
      if (window.console) console.warn("[ptTrack] unknown event:", name);
      return;
    }

    var clean = sanitize(params);
    var id = eventId();

    if (gaReady) {
      try {
        window.gtag("event", map.ga, clean);
      } catch (_) { /* analytics must never break the page */ }
    }

    if (pixelReady && map.pixel) {
      try {
        window.fbq(map.custom ? "trackCustom" : "track", map.pixel, clean, { eventID: id });
      } catch (_) { /* analytics must never break the page */ }
    }
  }

  // The only export. Call sites do: ptTrack("purchase", { value: 449, ... })
  window.ptTrack = dispatch;
})();
