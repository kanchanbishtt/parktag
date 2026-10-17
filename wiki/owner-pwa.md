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
- **Not done:** push notifications (WhatsApp already delivers scan alerts)
  and anything iOS-App-Store shaped. The Play Store app has its own section
  below.

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

## The Play Store app (Trusted Web Activity)

The Android app is this site shown by Chrome with no browser bar, wrapped by
Bubblewrap. No Android code of our own; the manifest above is what it reads.
Two things on the site side make it work, both in branch
`feat/play-twa-assetlinks`.

**Digital Asset Links.** Android drops the browser bar only if the site says
the app may speak for it: `GET /.well-known/assetlinks.json` names the package
(`ANDROID_APP_PACKAGE` in `lib/core/pwa.js`, a constant, `me.parktag.app`,
because `scripts/pwa.js` has to know the same name) and the SHA-256 of the
signing certificate(s) (`ANDROID_APP_SHA256_FINGERPRINTS`, comma separated).
`assetLinks()` in `lib/core/pwa.js` accepts the fingerprint however it was
pasted (colons or not, any case, keytool's `SHA256:` prefix, comma or
newline separated) and drops anything that is not 32 bytes of hex; a dropped
entry is counted in one warning at start-up, because the only other symptom
is a browser bar on a phone. Unset, the route is a 404: an empty statement
is a claim about an app that does not exist. Served public, cached
an hour, no session needed. If the app shows a browser bar, this file is the
first thing to check: it must answer 200 with `application/json`, with no
redirect, and the fingerprint must be the certificate the installed APK was
actually signed with.

**Play's payment policy.** A subscription sold inside a Play app has to go
through Play's billing, so the membership plans are not sold in the app.
`scripts/pwa.js` recognises a launch from the app (the app opens
`/owner?pt_app=android`, and Chrome gives a page the app opened the referrer
`android-app://me.parktag.app`; either is kept in `sessionStorage` for the
rest of the session, and the package is matched whole so a link tapped in
WhatsApp, which arrives with WhatsApp's `android-app://` referrer, is still
the ordinary site; the query marker counts on an Android user agent only,
because the app's launch URL can be copied and opened on a laptop, and that
is a browser tab that may buy plans). `window.ptInAndroidApp()` is the answer, and anything
marked `data-hide-in-android-app` is hidden the moment the page is parsed,
before any data arrives. On the membership screen that is the plans heading,
the plans and the sticky button; the vehicle picker stays, because picking a
vehicle is how its cover date is read, and the note still leads with that
date and says plans are not sold in the app, with no pointer to the website
(Play reads a pointer to another way of paying as a sale). On the dashboard
the "View plans" link is hidden and a lapsed row says "Premium has ended"
rather than "Renew"; the membership card and its countdown stay, they are
information. The paid callback pass (the ₹ "Call Back" button once the
free ten minutes are over) is a digital purchase too, so inside the app the
prompt card and the activity row say "Free time used up" and sell nothing,
and the "Renew to call back" upsell reads "Call service ended". Physical
tag orders through the shop tab are untouched: Play's rule is about digital
goods, which is also why Razorpay is still warmed on those pages inside the
app. Selling plans in the app later means Google Play
Billing (or, for India, user-choice billing alongside it); nothing here
precludes that.

**One thing only a phone can verify.** With App Links verified, Android also
opens ordinary `https://app.parktag.me/...` links (a WhatsApp scan alert, an
order email) inside the app, and those carry no `pt_app=android`. For them
the detection rests on Chrome exposing `android-app://me.parktag.app` as
`document.referrer`, which Chrome does for a Trusted Web Activity launch but
which headless Chrome would not reproduce in QA. Check 4 below covers it. If
it ever fails, either drop the `https` intent filter from the generated
`AndroidManifest.xml` (then only the launcher opens the app, always with the
marker) or add a second signal (`navigator.getInstalledRelatedApps()` with a
`related_applications` entry in the manifest).

### Building and publishing the app

Done once on 2026-10-17 (steps 1 to 3); the project, toolchain and keystore
live outside the repo, so later builds are a version bump and a re-run.

1. The Bubblewrap project is `C:/Users/admin/parktag-android`
   (`twa-manifest.json` is the source of truth: package `me.parktag.app`,
   host `app.parktag.me`, start URL `/owner?pt_app=android`, `standalone`,
   navy `#03162D`, **`minSdkVersion` 24**: the androidbrowserhelper library
   Bubblewrap bundles requires it, and 21 fails the manifest merge). The
   toolchain is under `C:/Users/admin/.bubblewrap` (`config.json` naming the
   JDK 17 and the Android SDK; the SDK is laid out the way Bubblewrap's own
   installer does it, with `bin/sdkmanager.bat` at the SDK root). The
   signing key is `C:/Users/admin/.parktag/android.keystore`, alias
   `parktag`, passwords in `android-keystore.txt` beside it. It is a PKCS12
   keystore, so the key password is the store password. Keep both files for
   the life of the app: this is the Play upload key.
2. Build, from PowerShell in the project folder with `JAVA_HOME` set to that
   JDK: remove the `NoDefaultCurrentDirectoryInExePath` environment variable
   for the session first (this machine sets it, and then `cmd` cannot find
   `gradlew.bat` in the current folder, which is how Bubblewrap calls it),
   then `bubblewrap update --skipVersionUpgrade` and `bubblewrap build
   --skipPwaValidation`. Gradle succeeds; Bubblewrap's own signing step fails
   on Windows (it wraps the passwords in quotes that `cmd` passes through),
   so sign by hand: `apksigner sign --ks <keystore> --ks-key-alias parktag
   --ks-pass pass:<pw> --key-pass pass:<pw> --out app-release-signed.apk
   app-release-unsigned-aligned.apk`, then `gradlew.bat bundleRelease`, copy
   `app/build/outputs/bundle/release/app-release.aab` to
   `app-release-bundle.aab` and `jarsigner -keystore <keystore>
   app-release-bundle.aab parktag`. Check with `apksigner verify
   --print-certs` and `jarsigner -verify`. Never write `twa-manifest.json`
   with PowerShell's `Set-Content -Encoding utf8`: the BOM breaks
   Bubblewrap's JSON parse. Bump `appVersionCode` and `appVersionName` for
   every Play upload.
3. The upload key's SHA-256 is
   `25:D5:CD:2A:63:A0:B8:E5:DB:47:61:AA:4C:CA:AA:24:6A:4E:30:B0:F0:7E:2B:E4:64:F2:8C:B1:A5:8F:86:10`.
   Set `ANDROID_APP_SHA256_FINGERPRINTS` to it on the server, deploy this
   branch, open `https://app.parktag.me/.well-known/assetlinks.json` and
   check it names that key.
4. Install the APK on a phone, open it: the dashboard, no address bar. The
   membership screen shows no plans. Then, with the app closed, tap a
   WhatsApp scan-alert link (`/v/...`): it opens in the app, and the
   membership screen still shows no plans (the referrer path above). The
   same phone's Chrome still shows them.
5. In Play Console, create the app and enrol in Play App Signing. Play then
   signs what users download with its own key: copy the "App signing key
   certificate" SHA-256 from Setup → App signing and add it as a second
   fingerprint (comma separated; keep the upload key too). Without this the
   Play-installed app shows a browser bar even though the sideloaded APK did
   not.
6. Upload the `.aab` to internal testing first, install from the Play link,
   repeat check 4. Then the closed/open track and production as the account
   allows (a new personal account must run a closed test with 12 testers for
   14 days first; an organisation account does not).
