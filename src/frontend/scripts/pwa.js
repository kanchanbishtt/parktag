// Makes the owner pages installable.
//
// Two jobs. First, register the service worker (/sw.js), which gives the app
// its offline page and is one of the things a browser needs before it offers
// "Install". Second, on the dashboard, turn the browser's install offer into a
// row in the menu drawer (#menuInstallRow), so an owner finds it where the
// other settings are instead of in a bar the browser shows once and hides.
//
// On a page without that row (sign-in, register) the browser's own install
// offer is left alone: the event is not cancelled, so Chrome keeps showing
// its usual icon or bar. Safari on iPhone never fires the event (there the
// owner installs from Share, "Add to Home Screen"), so the row stays hidden
// and nothing on the page changes.
//
// A classic script, not a module, so the strict sign-in pages can load it as
// a plain file. Nothing here is required for the page to work: if anything
// throws, the dashboard is exactly as it was without this file.
(function () {
  // ── Opened from the Play Store app? ─────────────────────────────────────
  //
  // The Android app is this site in Chrome with no browser bar (a Trusted Web
  // Activity). Two things mark a launch from it: the app opens /owner with
  // ?pt_app=android, and Chrome gives a page an Android app opened the
  // referrer android-app://<that app's package>. Either is remembered for the
  // session (sessionStorage belongs to this tab, and the app is one tab), so
  // the pages it moves on to still know. The package is matched exactly: a
  // link tapped in WhatsApp also arrives with an android-app:// referrer,
  // WhatsApp's, and that is an ordinary browser tab.
  //
  // What it is for: Play's payment policy does not allow a subscription to be
  // sold inside a Play app other than through Play's own billing. The
  // membership screen and the dashboard's "View plans" ask ptInAndroidApp()
  // and keep the plans out of the app; everything else is the same. The
  // package name is the constant of the same name in lib/core/pwa.js.
  var ANDROID_APP_PACKAGE = "me.parktag.app";
  var APP_FLAG = "pt_android_app";

  function launchedFromAndroidApp() {
    try {
      // The marker counts on Android only: the app's launch URL can be copied
      // and opened on a laptop, and that is a browser tab that may buy plans.
      var android = /Android/i.test(String(navigator.userAgent || ""));
      if (android && /[?&]pt_app=android(&|$)/.test(window.location.search)) return true;
      var ref = String(document.referrer || "");
      var prefix = "android-app://" + ANDROID_APP_PACKAGE;
      return ref === prefix || ref.indexOf(prefix + "/") === 0;
    } catch (e) {
      return false;
    }
  }

  var inAndroidApp = false;
  try {
    if (launchedFromAndroidApp()) window.sessionStorage.setItem(APP_FLAG, "1");
    inAndroidApp = window.sessionStorage.getItem(APP_FLAG) === "1";
  } catch (e) {
    // Storage refused (private mode, cleared site data): this page still knows
    // what it saw, later pages fall back to the ordinary site.
    inAndroidApp = launchedFromAndroidApp();
  }
  window.ptInAndroidApp = function () {
    return inAndroidApp;
  };

  // Markup that must not show in the app says so: data-hide-in-android-app on
  // the dashboard's "View plans" and on the membership plans and their
  // button. Hidden here, as soon as the page is parsed (this script is
  // deferred), not when a script further down has its data: a link to the
  // plans must not be tappable while the dashboard is still loading, nor stay
  // if that load fails.
  if (inAndroidApp) {
    try {
      var hide = document.querySelectorAll("[data-hide-in-android-app]");
      for (var i = 0; i < hide.length; i++) hide[i].style.display = "none";
    } catch (e) {
      // Nothing to hide on this page.
    }
    // The stylesheet keys app-only rules off this class (no rubber-band, no
    // selection handles on the page's chrome); see styles.css.
    try {
      document.documentElement.classList.add("pt-android-app");
    } catch (e) {
      // No document element to mark.
    }
    // The logo on every owner page links to the marketing site, which inside
    // the app opens as a Chrome tab with its own toolbar. In the app the logo
    // is the way home: /owner sends a signed-in owner to the dashboard and
    // anyone else to sign-in.
    try {
      var home = document.querySelectorAll('a[aria-label="ParkTag home"]');
      for (var j = 0; j < home.length; j++) home[j].setAttribute("href", "/owner");
    } catch (e) {
      // No logo link on this page.
    }
  }

  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {
      // A failed registration costs the offline page and nothing else.
    });
  });

  var pending = null;

  function installRow() {
    return document.getElementById("menuInstallRow");
  }

  function alreadyInstalled() {
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      navigator.standalone === true
    );
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    var row = installRow();
    if (!row || alreadyInstalled()) return;
    event.preventDefault();
    pending = event;
    row.style.display = "";
  });

  window.addEventListener("appinstalled", function () {
    pending = null;
    var row = installRow();
    if (row) row.style.display = "none";
  });

  // Wired to the drawer row's onclick in welcome.html.
  window.ptInstallApp = function () {
    var prompt = pending;
    pending = null;
    var row = installRow();
    if (row) row.style.display = "none";
    if (!prompt) return;
    prompt.prompt();
    prompt.userChoice.catch(function () {});
  };
})();
