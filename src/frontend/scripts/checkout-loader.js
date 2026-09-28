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

  function inject(src, ready) {
    return new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = src;
      script.onload = function () { resolve(ready()); };
      script.onerror = function () { script.remove(); resolve(false); };
      document.head.appendChild(script);
    });
  }

  // Loaded on demand because most ad traffic bounces before checkout, and
  // Instagram's in-app browser can tear the WebView down mid-init, which
  // surfaced as a spurious "Java object is gone" console error.
  var razorpayLoad = null;
  window.ptLoadRazorpay = function () {
    if (typeof window.Razorpay === "function") return Promise.resolve(true);
    if (!razorpayLoad) {
      razorpayLoad = inject(RAZORPAY_SRC, function () { return typeof window.Razorpay === "function"; })
        .then(function (ok) { if (!ok) razorpayLoad = null; return ok; });
    }
    return razorpayLoad;
  };

  var addressLoad = null;
  function loadAddressStep() {
    if (!addressLoad) {
      addressLoad = inject(addressSrc, function () { return !!window.ptCollectAddress && !window.ptCollectAddress.lazy; })
        .then(function (ok) { if (!ok) addressLoad = null; return ok; });
    }
    return addressLoad;
  }

  var stub = function (options) {
    return loadAddressStep().then(function (ok) {
      // false reads as "dismissed" to every caller, which is the quiet outcome.
      return ok ? window.ptCollectAddress(options) : false;
    });
  };
  stub.lazy = true;
  if (addressSrc && !window.ptCollectAddress) window.ptCollectAddress = stub;

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
