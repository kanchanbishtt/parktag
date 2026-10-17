// The owner app's service worker.
//
// It does one thing: when the phone is offline and the owner opens the app,
// show the ParkTag offline page instead of the browser's error screen. Nothing
// else is intercepted. Scripts, styles, images and every /api call go to the
// network exactly as they did before this file existed, so a signed-in page
// is never served from a cache (they are no-store on purpose) and a payment or
// OTP call can never be answered by a stale copy.
//
// Served through /sw.js in app.js, which fills in the version below. The
// version changes whenever the stylesheets, scripts or the offline page
// change, and a changed byte here is what makes the browser install the new
// worker, which re-fetches the offline page into a fresh cache and drops the
// old one. Deliberately under src/backend/assets, like analytics.js: anything
// under src/frontend is also reachable raw, unstamped, through the static
// handler.

const VERSION = "__SW_VERSION__";
const CACHE = `parktag-offline-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` bypasses the HTTP cache, so the copy kept is the one the
      // server is serving now, not one the browser already had.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("parktag-offline-") && name !== CACHE)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  // Only a page load (an address bar, a tap on a link, a redirect). Returning
  // without respondWith() leaves every other request to the browser.
  if (event.request.mode !== "navigate" || event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } catch {
        const cache = await caches.open(CACHE);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ||
          new Response("You are offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })
        );
      }
    })()
  );
});
