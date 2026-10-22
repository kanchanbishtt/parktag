# ParkTag Android app: handover

Branch: `feat/flutter-app` (based on `main` at `3291e25`). Last updated 2026-10-19.

This is a native Flutter app for ParkTag owners and scanners, Android first. It talks to the same Railway backend and MongoDB as the website (`https://app.parktag.me`). The website is unchanged and stays live. There is no separate app backend.

Original build spec: `docs/FLUTTER_APP_SPEC.md`.

## Where it stands

Every web feature (213 in total) was checked against the app:

| Status | Count |
|---|---|
| Built native | 164 |
| Opens the web page (Custom Tab) | 6 |
| Left out on purpose | 37 |
| Partly built | 6 |
| Missing | 0 |

Checks on this branch: `flutter analyze` is clean, `flutter test` passes 284 of 284, and `flutter build apk --debug` builds.

### Partly built (pick up here)

1. **Premium sticker artwork.** The E-Tag download works, but the official premium artwork (`org-parktag-sticker.svg` on the web) is not bundled. Add it as an asset and use it in `features/owner/tag_etag.dart`.
2. **Vault image compression.** The app relies on image_picker's compression. The web's multi-step WebP ladder and its "X to Y smaller" message are not ported (`features/vault/vault_shrink.dart`).
3. **Shop copy.** Prices and images are live, but product descriptions, feature bullets and discount badges are missing (the web has them in `welcome-shop.js` PRODUCTS).
4. **Membership progress bar.** Days left are shown. Paid tags get no bar because the API sends only `coveredUntil` and no period start. This needs a backend field first.
5. **Trial-ending reminders.** These go out by push, WhatsApp and email. There is no in-app banner.
6. **Free E-Tag lead magnet.** The Add your vehicles step covers sign-up, but the web wizard's print popup is not ported.

### Left out on purpose (do not add)

- **Google Play billing policy.** The app sells no digital goods: no membership plans, no callback passes, no upgrade or renew prompts, and no links to them. Physical stickers through Razorpay or Cash on Delivery are allowed. Before any release, grep for `Upgrade`, `View plans`, `Renew` and rupee text outside `features/shop`.
- **Web-only items:** PWA install, cache tricks, GA4, Meta Pixel and Clarity trackers, the banner carousel and confetti.
- **Features with no backend or no web UI yet:** editing a plate after activation, changing the vault PIN, document expiry reminders, review submission and the Preferences tab.
- **Custom Tab flows that stay on the web on purpose:** the guest shop, Report wrong info and Transfer tag (they need reCAPTCHA), forgot password (it resets through an emailed link), and the backup contact "Remove my number" page.

## How the app is laid out

```
app/lib/
  main.dart            Firebase, Crashlytics, App Check, push setup
  router.dart          go_router, 5-tab StatefulShellRoute, guards, deep links, 404
  core/                api client, AppState (ChangeNotifier), models, session, theme, widgets
  push/push.dart       FCM token registration and notification taps
  features/
    auth/              mobile + PIN, WhatsApp OTP, email OTP, password, Google, set PIN or password, add vehicles
    onboarding/        splash, onboarding, guest hub, help and FAQ
    owner/             home, activity (callback rules), tags, vehicle detail, E-Tag
    scan/              QR scanner, public tag page, contact, masked call, SOS, helplines, activation
    shop/              catalogue, variant picker, checkout, Razorpay or COD, address, orders, tracking
    vault/             document vault with its own PIN
    more/              profile, membership (read-only), referral, support, legal, PIN, delete account
```

Key rules:

- **Auth.** The app stores the backend's `wavetag_session` cookie in `flutter_secure_storage` and sends it on every request, so the app uses the same session as the web.
- **Ported web logic.** Business rules copied from the web live next to their screens:
  - `owner/activity_rules.dart` is a port of `src/frontend/scripts/owner/callback-eligibility.js`.
  - `scan/call_state.dart` is a port of the scanner's call-blocked logic.
  - `owner/tag_rules.dart` holds the vehicle types and mount rules.
- **Keep the ports in sync.** If you change one of those web files, change its Dart port as well.
- **Raw JSON.** Models keep the server's raw JSON in `raw`, so a new field can be read without breaking anything.

Deep links (Android App Links on `app.parktag.me`) open the app on these paths:

- `/tag/<token>`
- `/v/<id>?open=`
- `/get?ref=CODE` (the code is kept for 7 days and prefilled at checkout)
- `/track-order`

## Backend changes on this branch

These are in `src/backend` and ship with the next web deploy:

- **Dashboard phone mask.** `/api/owner/dashboard` returns `phoneLast4` and `hasPhone` instead of the full phone number. The web dashboard was updated to match.
- **FCM push.** New `lib/integrations/fcm.js` and `routes/owner/push.js` (register and unregister a device token). Missed contacts and callbacks send a push.
- **App Check on OTP.** `lib/integrations/appcheck.js`. `send-otp` accepts a Firebase App Check token from the app. If the token is missing or invalid, the app falls back to the web screen with reCAPTCHA (`code: "CAPTCHA_REQUIRED"`).
- **Tests.** `appcheck-send-otp.test.js`, `dashboard-phone-mask.test.js` and `owner-push-fcm.test.js`. The full backend suite passed except `oauth-mcp.test.js`, which is flaky and unrelated to this work.

Run the backend tests against a throwaway local `mongod` with a database prefix of `test_`. Never run them against the `.env` that points at live Atlas.

## Running it

Requirements: Flutter 3.47.x and JDK 17.

```bash
cd app
flutter pub get
flutter analyze
flutter test
flutter run            # debug build, package me.parktag.app.debug
flutter build apk --debug
```

`android/app/google-services.json` is gitignored. Download it from Firebase project `parktag1` (Project settings, Android apps). Both `me.parktag.app` and `me.parktag.app.debug` are registered there.

## Still to do outside the code

1. **Railway env vars.** Until these three are set, push does nothing and OTP falls back to the web screen:
   - `FIREBASE_PROJECT_NUMBER=118197410323`
   - `APPCHECK_APP_IDS` set to the Android app id from Firebase
   - `FCM_SERVICE_ACCOUNT_JSON`, a service account key from Firebase. It is a secret: put it in Railway only, never in the repo or in chat.
2. **Google Cloud console (project parktag1):**
   - Android OAuth client for Google sign-in. For the debug app: package `me.parktag.app.debug`, SHA-1 `78:4D:81:0D:FE:F4:BB:37:E2:79:A2:F7:1A:F4:E6:77:22:5B:36:C8`. Add the release one once the release keystore is in place.
   - Turn on the FCM v1 API.
   - App Check with Play Integrity for the release app.
3. **Release keystore.** It is on the Windows machine at `C:/Users/admin/.parktag/android.keystore`. Copy it, back it up and wire it into the release signing config. There is no release build without it.
4. **Device QA on a real phone:**
   - Scan a real sticker.
   - Upload to the vault.
   - Make a Razorpay test payment from a release build.
   - Check push in the background and killed states.
   - Check that App Links verify for the new `/track-order` path.
5. **Content.** Onboarding and help images. The screens show icons until the images exist.
6. **Open question.** Should Home show the full referral card with its rupee discount headline? Today the full card is only on More, and Home shows the code and the link. If yes, relax the "no rupee text on Home" check in `test/features/owner/owner_test.dart`.
7. **iOS.** Not started. It needs an entitlements file and an `apple-app-site-association` file for links, plus APNs for push.
