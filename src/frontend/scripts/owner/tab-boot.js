// Which view the dashboard opens on, decided before the body is parsed.
//
// The tab lives in the URL fragment so a refresh keeps you where you were. That
// restore used to run from welcome-shop.js, which sits at the BOTTOM of a
// 2,600-line page — by the time it executed the browser had already painted the
// Tags view, so reloading on #profile flashed Tags and then jumped. The fix is
// not a faster restore; it is deciding before the first paint.
//
// This runs in <head>, blocking, before <body> exists. It cannot touch the view
// elements — they have not been parsed — so it writes the answer onto <html>
// and the stylesheet does the rest. See `html[data-tab=...]` in welcome.html.
//
// An external file rather than an inline <script> because /owner-welcome is in
// NO_INLINE_SCRIPT_PAGES: its CSP drops 'unsafe-inline' from script-src, so an
// inline block here would silently never run. Only script-src-attr still allows
// inline, which is why the page's onclick handlers keep working.
//
// Deliberately not deferred and deliberately tiny. A blocking script in the head
// costs a paint delay, and the whole point is to spend that rather than paint
// the wrong thing.
(function () {
  var key = (window.location.hash || "").slice(1);

  // Only the keys that name a view. Anything else — a real anchor, junk somebody
  // pasted — is left alone, and the page opens on Tags as it always did.
  if (key === "shop" || key === "profile") {
    document.documentElement.setAttribute("data-tab", key);
  }
})();
