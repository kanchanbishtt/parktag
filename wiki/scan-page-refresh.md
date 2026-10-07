# Scan page refresh, and no raw errors for visitors

## What customers saw

Refreshing the vehicle contact page (the page a scanner reaches from the QR
sticker) showed this instead of the page:

    {"message":"Route GET:/vehicle not found","error":"Not Found","statusCode":404}

## Root cause

1. A sticker opens `/vehicle/<token>` (or `/tag/<token>`).
2. As soon as the tag loads, `pt-analytics.js` (`ptScannerEngaged`) rewrites
   the address bar to plain **`/vehicle`**. It does this on purpose, so the
   Meta Pixel never reports a tag token. It happens only on `*.parktag.me`
   with the Pixel configured, which is why it never showed up locally.
3. Nothing on the server answered `GET /vehicle`. A refresh, a reopened tab or
   a shared link asked for that path, and Fastify's default 404 handler
   answered with its raw JSON.

So every scanner who refreshed the contact page after it loaded hit this. It
was not limited to one tag.

## Fix (2026-10-07)

- **The stripped address works.** `GET /vehicle` and `GET /tag` (no token)
  serve the scan page. `scanner/app.js` keeps the token in the tab's
  `sessionStorage` (`pt_scan_token`) when it first reads it from the URL, and
  uses it when the URL no longer has one. A refresh brings back the same
  vehicle. The token still never stays in the address bar, and storage is
  never sent to the Pixel.
- **No token at all** (bare `/vehicle` in a new tab, or storage blocked): the
  page says "Scan the sticker again", not a developer message.
- **Share** sends `/tag/<token>`, not the stripped address bar.
- **Safety net for every page:** `setNotFoundHandler` in `app.js`. A browser
  asking for any page the app does not have gets `pages/not-found.html` (a
  ParkTag "page not found" screen with "Go to ParkTag" and "Owner sign in").
  The API, scripts, images and webhooks keep the exact JSON 404 they always had.

## Guard

`tests/scan-page-refresh.test.js` reads the path `pt-analytics.js` strips to
and checks the app serves it as the scan page. If someone changes the strip
path without adding a route, the test fails. It also checks the friendly 404
for pages and the unchanged JSON 404 for the API.
