# Owner app as a PWA

The owner pages (sign-in through the dashboard) are installable: on Android
Chrome and desktop Chrome the dashboard's menu drawer offers "Install the
ParkTag app", and on iPhone the owner uses Share → "Add to Home Screen". The
installed app opens at `/owner`, which sends a signed-in owner to the dashboard
and anyone else to sign-in. The scanner and shop pages are deliberately not
installable: a stranger at a windscreen is never asked to install anything.

## What was added

| Piece | Where | Served as |
|---|---|---|
| Web app manifest | `src/frontend/manifest.webmanifest` | static file, `application/manifest+json` |
| Icons | `src/frontend/images/pwa-icon-{192,512}.png` (purpose `any`), `pwa-icon-maskable-{192,512}.png` (purpose `maskable`) | static, 30-day cache like other images |
| Service worker | `src/backend/assets/sw.js`, route `GET /sw.js` in `app.js` | stamped with a version, `Cache-Control: no-cache`, ETag + 304 |
| Offline page | `src/frontend/pages/offline.html`, route `GET /offline` | public shell, everything inline |
| Install script | `src/frontend/scripts/pwa.js` | versioned script like the rest (`?v=` stamp, immutable) |
| Version helper | `src/backend/lib/core/pwa.js` | `serviceWorkerVersion` / `renderServiceWorker` |
| Page tags | every `src/frontend/pages/owner/*.html` head | manifest link, `mobile-web-app-capable`, Apple metas, `pwa.js` |
| Install row | `welcome.html` drawer, `#menuInstallRow` | hidden until Chrome fires `beforeinstallprompt` |

## Decisions

- **The worker only handles page loads, and only to show the offline page.**
  Scripts, styles, images and every `/api` call are not intercepted. Signed-in
  pages are `no-store` on purpose and that stays true: the worker never caches
  them, so a borrowed phone cannot replay a dashboard from a cache and an OTP
  or payment call can never be answered stale. The whole offline story is one
  cached file, `/offline`.
- **The worker lives under `src/backend/assets`, not `src/frontend`.** Same
  reason as `analytics.js`: it carries a placeholder (`__SW_VERSION__`) filled
  on the way out, and anything under the frontend root is also reachable raw.
  The route is at `/sw.js` because a worker's scope cannot reach above the path
  it was loaded from, and the owner pages live at `/owner-*`.
- **The version folds in the offline page.** A browser installs a new worker
  only when `/sw.js` changes byte for byte, and the worker refreshes its copy
  of `/offline` only when it installs. So the stamp is `assetVersion` plus a
  digest of `offline.html`; editing either rolls the worker, and the activate
  step deletes every cache with another name.
- **`no-cache` on `/sw.js`.** Browsers cap a worker script's HTTP caching at
  24 hours; `no-cache` plus an ETag means a deploy is picked up on the next
  visit with a 304 the rest of the time.
- **The install row is only on the dashboard.** `pwa.js` cancels Chrome's own
  install bar only on a page that has the row; on sign-in and register pages
  the event is left alone so Chrome's usual offer still appears. Safari never
  fires the event, so on iPhone the row stays hidden.
- **No `theme-color` meta on the pages.** The manifest's `theme_color`
  (`#03162D`, the dashboard header navy) colours the installed app's title
  bar; a meta tag would also have recoloured the address bar on the ordinary
  website, which was not asked for.
- **Scope is `/`.** A scope of `/owner` would have left `/register-owner`,
  `/forgot-password` and the Google OAuth return out of the app, each opening
  in a browser tab inside the installed app.
- **Not done:** push notifications (WhatsApp already delivers scan alerts),
  a Play Store listing (Bubblewrap/TWA, needs `/.well-known/assetlinks.json`
  and a Play account), and anything iOS-App-Store shaped.

## How the icons were made

From `images/icon.png` (449×449, the round navy "P" on a transparent square)
with .NET `System.Drawing` in PowerShell: the `any` icons are that file
resized; the `maskable` icons are a full-bleed `#03162D` square (the colour
sampled from the logo) with the logo scaled to 80% and centred, which is the
safe zone Android masks inside. Regenerate the same way if the logo changes.

## Verification

- `src/backend/tests/owner-pwa.test.js`: manifest served and parses, every
  icon is a real PNG, `/sw.js` stamped + `no-cache` + 304, the worker source
  is not reachable unstamped, `/offline` needs no other file, every owner page
  (signed-out and signed-in) carries the manifest and the stamped script, the
  strict sign-in CSP still allows it, the drawer row is present and hidden,
  `/get` `/shop` `/verify` `/offline` carry none of it.
- Headless Chrome (playwright-core, mobile viewport) against the app on
  `:3100`: worker active at scope `/`, one cache named by version holding
  `/offline`, `/owner` lands on the dashboard, the row is hidden until a
  (simulated) install offer, tapping it prompts and hides the row, offline
  navigation shows the ParkTag offline page, `/api` is not served offline,
  back online the same link returns the dashboard, sign-out still works. The
  only console error is the pre-existing Razorpay risk-detection script that
  the CSP blocks by design (see the `STRICT_SCRIPT_SOURCES` comment in
  `app.js`).

## Testing it live

1. Android Chrome: open `/owner-login`, sign in, open the menu — "Install the
   ParkTag app" appears once Chrome is satisfied (it needs a visit or two on
   some versions). Tap it, accept. The icon on the home screen is the masked
   navy "P"; opening it goes straight to the dashboard with no address bar.
2. Turn on flight mode, open the app: the ParkTag "You are offline" page, not
   Chrome's. Turn it off, tap "Try again": the dashboard.
3. iPhone Safari: Share → Add to Home Screen on any owner page; the name is
   "ParkTag" and the icon is `apple-touch-icon.png`.
4. Desktop Chrome: the install icon appears in the address bar on owner pages;
   DevTools → Application → Manifest shows no warnings, Service Workers shows
   `/sw.js` activated.
5. Worth one real try from the installed app on each platform, because a
   headless browser cannot stand in for it: "Continue with Google" (leaves
   for accounts.google.com and must come back signed in) and a Razorpay
   netbanking payment (leaves for the bank and must come back to the order).
   Both are out-of-scope navigations; Android opens them in a Chrome tab over
   the app and returns, iOS in an in-app sheet. Cards, UPI and wallets never
   leave the page and need no special check.
