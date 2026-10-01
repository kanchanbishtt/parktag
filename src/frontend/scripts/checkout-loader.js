// Loads the two heavy checkout dependencies on demand instead of in the page's
// <script> tags, where they held up the parser and everything after it.
//
//   window.ptLoadRazorpay()   Razorpay's checkout.js (third party). Resolves
//                             true once window.Razorpay is a function.
//   window.ptCollectAddress() a stub for the real address sheet in
//                             /scripts/owner/address-step.js. Callers keep
//                             calling it exactly as before: the first call pulls
//                             the real file in, which replaces this stub, then
//                             the call is forwarded. Both are also fetched when
//                             the browser goes idle after load, so the first
//                             buy tap does not wait on them.
//
// The stamped URL of address-step.js comes from this tag's data-address-step
// attribute, so the page's ?v= convention still applies to it.
(function () {
  var self = document.currentScript;
  var addressSrc = self && self.getAttribute("data-address-step");
  var RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";
  // Same number the sold-out and support fallbacks already use elsewhere
  // (get.js, welcome.js, admin/activations.js) — kept here too rather than
  // factored out, since there is no shared-constants module in this
  // unbundled codebase and one more copy is cheaper than one.
  var WHATSAPP_NUMBER = "918791638854";
  var LOAD_TIMEOUT_MS = 12000;
  var RETRY_DELAY_MS = 1200;

  function inject(src, ready) {
    return new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = src;
      script.onload = function () { resolve(ready()); };
      script.onerror = function () { script.remove(); resolve(false); };
      document.head.appendChild(script);
    });
  }

  // A hung <script> (seen in the wild as an in-app browser that never fires
  // load or error) must not wait forever, and a transient failure deserves
  // one retry before giving up — the WebView teardown this works around (see
  // below) is often a one-off.
  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; resolve(false); }
      }, ms);
      promise.then(function (ok) {
        if (!settled) { settled = true; clearTimeout(timer); resolve(ok); }
      });
    });
  }

  function injectWithRetry(src, ready) {
    return withTimeout(inject(src, ready), LOAD_TIMEOUT_MS).then(function (ok) {
      if (ok) return true;
      return new Promise(function (resolve) { setTimeout(resolve, RETRY_DELAY_MS); })
        .then(function () { return withTimeout(inject(src, ready), LOAD_TIMEOUT_MS); });
    });
  }

  // Loaded on demand because most ad traffic bounces before checkout, and
  // Instagram's in-app browser can tear the WebView down mid-init, which
  // surfaced as a spurious "Java object is gone" console error.
  var razorpayLoad = null;
  window.ptLoadRazorpay = function () {
    if (typeof window.Razorpay === "function") return Promise.resolve(true);
    if (!razorpayLoad) {
      razorpayLoad = injectWithRetry(RAZORPAY_SRC, function () { return typeof window.Razorpay === "function"; })
        .then(function (ok) { if (!ok) razorpayLoad = null; return ok; });
    }
    return razorpayLoad;
  };

  var addressLoad = null;
  function loadAddressStep() {
    if (!addressLoad) {
      addressLoad = injectWithRetry(addressSrc, function () { return !!window.ptCollectAddress && !window.ptCollectAddress.lazy; })
        .then(function (ok) { if (!ok) addressLoad = null; return ok; });
    }
    return addressLoad;
  }

  function reportFailure(label) {
    if (typeof window.ptReportError === "function") window.ptReportError(label, "checkout-loader");
    if (typeof window.ptTrack === "function") window.ptTrack("checkout_load_failed", {});
  }

  // Both payment paths (online and cash on delivery) live inside the one
  // sheet address-step.js renders, so a failure here is not "card payment
  // broken" — it is "nobody can check out at all". A silent `false` left
  // that looking identical to someone closing the sheet on purpose. This
  // still resolves `false` to every existing caller (the contract is
  // unchanged), but it also tells the person directly, with a way to still
  // place the order.
  function showLoadFailedBanner() {
    if (document.getElementById("pt-checkout-fallback")) return;
    var text = "Hi! I want to order a ParkTag. The checkout page would not open for me, can you help?";
    var box = document.createElement("div");
    box.id = "pt-checkout-fallback";
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;background:#03162D;" +
      "color:#fff;padding:14px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35);" +
      "font:14px/1.4 -apple-system,system-ui,sans-serif;display:flex;gap:10px;align-items:center";
    var msg = document.createElement("span");
    msg.style.cssText = "flex:1";
    msg.textContent = "Checkout would not load. If you're in the Instagram or Facebook app, tap the ⋯ "
      + "menu and choose \"Open in browser\", or order on WhatsApp instead.";
    var wa = document.createElement("a");
    wa.href = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text);
    wa.target = "_blank";
    wa.rel = "noopener";
    wa.textContent = "WhatsApp";
    wa.style.cssText = "flex:none;background:#FF2700;color:#fff;padding:8px 12px;border-radius:8px;" +
      "text-decoration:none;font-weight:700;white-space:nowrap";
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.style.cssText = "flex:none;background:none;border:0;color:#fff;font-size:20px;line-height:1;" +
      "cursor:pointer;padding:0 4px";
    close.onclick = function () { box.parentNode && box.parentNode.removeChild(box); };
    box.appendChild(msg);
    box.appendChild(wa);
    box.appendChild(close);
    document.body.appendChild(box);
    reportFailure("address-step failed to load after retry");
  }

  // Ad clicks from Instagram and Facebook open inside their own in-app
  // browser, an older embedded WebView rather than the visitor's real
  // Chrome or Safari. It is where the teardown bug above actually happens,
  // and where the online-payment app handoff (UPI intents) is least
  // reliable. There is nothing to fix in that WebView from here, so this
  // only tells people the one thing that reliably works around it.
  //
  // Shown as soon as this script runs, not from inside the buy tap: the
  // background warm() below usually replaces window.ptCollectAddress with
  // the real address-step.js well before anyone taps buy (that is the whole
  // point of warming it), so a trigger placed inside the stub would almost
  // never fire in practice on anything but the fastest taps. These five
  // pages are all checkout-relevant already, so showing it on arrival still
  // targets only people who may go on to check out.
  var IS_META_INAPP_BROWSER = /FBAN|FBAV|Instagram/i.test(navigator.userAgent || "");
  function showMetaBrowserHint() {
    if (!IS_META_INAPP_BROWSER) return;
    try {
      if (sessionStorage.getItem("pt_meta_hint_shown")) return;
      sessionStorage.setItem("pt_meta_hint_shown", "1");
    } catch (_) { /* private mode or similar: show it anyway, just not gated */ }
    var box = document.createElement("div");
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:99998;background:#fff;" +
      "color:#03162D;padding:12px 14px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);" +
      "font:13px/1.4 -apple-system,system-ui,sans-serif;display:flex;gap:10px;align-items:center;" +
      "border:1px solid #e5e7eb";
    var msg = document.createElement("span");
    msg.style.cssText = "flex:1";
    msg.innerHTML = "For the smoothest payment, tap <b>⋯</b> at the top right and choose “Open in browser”.";
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.style.cssText = "flex:none;background:none;border:0;color:#03162D;font-size:20px;line-height:1;" +
      "cursor:pointer;padding:0 4px";
    close.onclick = function () { box.parentNode && box.parentNode.removeChild(box); };
    box.appendChild(msg);
    box.appendChild(close);
    document.body.appendChild(box);
  }

  var stub = function (options) {
    return loadAddressStep().then(function (ok) {
      // false reads as "dismissed" to every caller, which is why the banner
      // above is the only way a real failure gets told apart from someone
      // just closing the sheet.
      if (!ok) showLoadFailedBanner();
      return ok ? window.ptCollectAddress(options) : false;
    });
  };
  stub.lazy = true;
  if (addressSrc && !window.ptCollectAddress) window.ptCollectAddress = stub;

  showMetaBrowserHint();

  // After load, when the main thread is free, so the first buy tap does not
  // wait. Razorpay is warmed only where the tag asks (signed-in pages, where it
  // used to load eagerly); on the public pages it stays a buy-tap load.
  function warm() {
    if (addressSrc) loadAddressStep();
    if (self.hasAttribute("data-warm-razorpay")) window.ptLoadRazorpay();
  }
  function whenIdle() {
    if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 2000);
  }
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
})();
