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
  // Found by query rather than through document.currentScript, which is null
  // for any script marked `defer` or `async`.
  //
  // This is not a style preference. Every one of these tags carries `defer` so
  // it cannot block first paint, and currentScript would therefore hand back
  // null on all of them — collapsing the surface to the "app" default and
  // loading the Meta Pixel on the scan page, which is the one thing the
  // surface flag exists to prevent. The failure would be silent: no error, no
  // console warning, just a Pixel where there must never be one.
  var selfScript =
    document.currentScript ||
    document.querySelector('script[src*="pt-analytics.js"]');

  var surface = (selfScript && selfScript.getAttribute("data-surface")) || "app";

  // The scan pages are used by STRANGERS standing at someone else's vehicle,
  // so the Pixel is not loaded there on arrival. Two separate reasons:
  //
  //   1. Consent. Someone who scans a tag and leaves has not asked for
  //      anything and should not be added to an advertising audience for it.
  //
  //   2. The URL. fbq sends document.location with every event, and a scan page
  //      lives at /vehicle/:token — so a PageView here would ship vehicle tag
  //      tokens to Meta on every scan. That is a data leak, not a preference.
  //
  // Someone who USES the product is a different case, and is handled by
  // enableScannerRetargeting() at the bottom of this file: after a successful
  // contact action the token is stripped from the URL, the Pixel is loaded, and
  // one event is sent. That audience is both smaller and better — people who
  // actually experienced the product rather than everyone who loaded a page.
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

  // Shared id so the same logical event sent from the browser and from the
  // server (lib/integrations/meta-capi.js) is de-duplicated by Meta rather than
  // counted twice.
  //
  // Where the event has a natural key, the id is DERIVED from it rather than
  // random, so both halves arrive at the same string without having to pass
  // anything between them. A purchase is keyed on its order number; the server
  // builds the identical string in purchaseEventId(). A random id here would
  // make every server-side purchase a second, phantom conversion.
  function eventId(name, params) {
    if (params && params.transaction_id) return name + ":" + params.transaction_id;

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
    var id = eventId(map.ga, clean);

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

  // ------------------------------------------------ scanner retargeting
  //
  // Called ONLY from the scan page, and ONLY after a contact action succeeded.
  // Someone who scanned a tag and actually reached an owner has experienced the
  // product from the outside and is the best-qualified prospect this business
  // has. Retargeting them is worth doing; doing it on page load is not.
  //
  // Three things have to be true before the Pixel is allowed to load here, and
  // all three are enforced below rather than assumed:
  //
  //   1. The person engaged. Page load alone never triggers this.
  //   2. The tag token is out of the URL first. fbq sends document.location
  //      with every event, so stripping has to happen BEFORE init, not after —
  //      otherwise the very first PageView carries the token.
  //   3. It happens once per page.
  //
  // No tag token, no plate, no phone number is ever passed. The event carries
  // the reason chosen from the fixed five-item list and nothing else.
  var scannerRetargetingDone = false;

  window.ptScannerEngaged = function (params) {
    if (scannerRetargetingDone) return;
    if (surface !== "scanner") return;
    if (!PIXEL_ID) return;
    scannerRetargetingDone = true;

    // Strip the token from the address bar before anything can read it.
    // replaceState leaves the page and its JS untouched — the token was already
    // read into memory long before this runs — and only rewrites what fbq will
    // later report as the page URL.
    // Absence is checked BEFORE the try, not inside it.
    //
    // The earlier shape wrapped an `if (replaceState)` in a try and returned
    // only from the catch, which fails closed when the call THROWS but falls
    // straight through when the API is simply missing — skipping the strip and
    // then loading the Pixel on a URL that still carries the token. That is the
    // exact leak this function exists to prevent, so the missing case has to
    // return too.
    if (!(window.history && typeof window.history.replaceState === "function")) return;

    try {
      window.history.replaceState(null, "", "/vehicle");
    } catch (_) {
      // Present but refused. Same rule: no strip, no Pixel.
      return;
    }

    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */

    try {
      window.fbq("init", PIXEL_ID);
      window.fbq("trackCustom", "ScannerEngaged", sanitize(params), { eventID: eventId("ScannerEngaged", null) });
    } catch (_) { /* analytics must never break the page */ }
  };
})();
