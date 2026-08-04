// ── Back controls that actually go back ────────────────────────────────────
//
// The back arrows on the add-vehicle and vehicle-detail screens were hardcoded
// to /owner-welcome, so "back" always meant "the owner dashboard" regardless of
// where the visitor had come from.
//
// That broke the main acquisition path. Get Solo Tag / Get Duo Pack / Order Now
// on the public pricing page all lead to /register-owner, so someone who opened
// the add-vehicle screen from the landing page, changed their mind and pressed
// back was dropped on the owner dashboard — or, with no session, bounced on to
// the login screen, because /owner-welcome redirects there when it cannot read
// a session. A visitor who was reading about prices got asked to sign in.
//
// history.back() returns them to the previous page AND its scroll position, so
// they land back on the pricing section they were actually reading. It also
// still does the right thing for the in-app route (dashboard → add vehicle →
// back → dashboard), because that is genuinely the previous page.
//
// The element stays an <a href="…">: the href is the fallback for the one case
// history cannot serve — the page opened in a fresh tab or from a pasted URL,
// where there is no previous entry — and keeping it an anchor preserves
// middle-click, "open in new tab", and no-JS behaviour, all of which a
// JS-only button would break.

(function () {
  "use strict";

  function wire(link) {
    link.addEventListener("click", function (event) {
      // Let the browser handle modified clicks (new tab/window) and anything a
      // previous handler already claimed.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      // Nothing to go back to — a fresh tab or a pasted URL. Leave the click
      // alone so the anchor navigates to its href as before.
      if (window.history.length <= 1) return;

      event.preventDefault();

      var fallback = link.getAttribute("href");

      // history.back() cannot report failure, and it is a no-op when the only
      // entry is this page. If we are still here shortly afterwards, fall back
      // rather than leaving the visitor with a dead button.
      var timer = window.setTimeout(function () {
        if (fallback) window.location.href = fallback;
      }, 400);

      // Once the navigation takes, this page is unloaded or frozen into the
      // back/forward cache. Cancelling here matters for the bfcache case: a
      // frozen timer resumes if the visitor comes FORWARD to this page again,
      // and would then fire a stale redirect to the fallback.
      window.addEventListener(
        "pagehide",
        function () {
          window.clearTimeout(timer);
        },
        { once: true }
      );

      window.history.back();
    });
  }

  function init() {
    var links = document.querySelectorAll("[data-back]");
    for (var i = 0; i < links.length; i += 1) wire(links[i]);
  }

  // Loaded at the end of <body>, so the DOM is normally ready — but guard the
  // ordering anyway so this cannot silently no-op if it is ever moved.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
