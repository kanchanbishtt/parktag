# ParkTag Flutter App: Build Spec (v2, Android first)

Status: this was the build spec. The app now exists in `app/`; see `app/HANDOVER.md` for what is built.

Base: the "security and Play first" architecture, with the agreed grafts:
- A WebView sign-in bridge, not a Custom Tab fallback.
- package:http, not dio.
- No state library.
- A phased build order.
- The web platform scaffolded from day one.
- Push also fires on register-call.
- App Check uses limited-use tokens with a jti replay check.

v2 applies the review critiques, each checked against the code. The main corrections:
- The bridge now finishes only when a real owner session exists.
- 401 handling no longer signs people out for a wrong PIN.
- The FCM payload shape is fixed and token pruning is narrowed.
- Vault uploads set a part Content-Type.
- Add-vehicle uses `/api/owner/local-vehicle`.
- B1 also covers callback-eligibility.js.
- Push hooks no longer depend on WhatsApp working.
- The notification channel is created natively.
- An SMS fallback goes through the bridge.

The existing web app stays live and unchanged in behaviour. Its only edits are in B1:
- It reads `phoneLast4`/`hasPhone` instead of `phone`.
- One attribute hides the Google button inside the Android bridge.

---

## 1. Decisions

| Area | Decision | Why / evidence |
|---|---|---|
| Location | `/Users/girishsharma/Developer/parktag/app` (Flutter, `--platforms android,ios,web`) | Android is the target now. The iOS folder is kept compiling. The web folder exists so the later Flutter web build costs nothing extra. |
| Package id | Release `me.parktag.app`. Debug builds use `applicationIdSuffix ".debug"` (`me.parktag.app.debug`). | The app replaces the unpublished TWA (TASKS.md:1459,1471). Live assetlinks.json already names `me.parktag.app` (src/backend/lib/core/pwa.js:48,58-70). The debug suffix keeps debug App Check tokens unusable against production (section 6.2). |
| SDK levels | minSdk 24, targetSdk 36, compileSdk 36 | wiki/owner-pwa.md:209 |
| Toolchain | Flutter 3.47.7 / Dart 3.13.5. Gradle uses JDK 17. | Local Flutter is 3.38.6, and Gradle currently picks Java 1.8. go_router 18.1.0 needs Flutter 3.44 or later. |
| Auth credential | The existing opaque `wavetag_session` cookie. No JWT, no Bearer, no OAuth for owners. | Owner routes accept only the cookie (src/backend/lib/auth/auth.js:166-168). The CSRF hook passes requests that have no Origin and no Referer (src/backend/app.js:634). |
| Cookie storage | `flutter_secure_storage` (Android Keystore). The cookie is sent only to the exact scheme, host and port of the `API` base URL. | It is a 180-day bearer credential (src/backend/lib/auth/session.js:14-23,322-348). |
| Networking | `package:http` plus one `ApiClient` class of about 150 lines, cookie capture included. No dio, no cookie_jar. | `http.MultipartRequest` covers vault uploads. `http/testing` `MockClient` covers tests. |
| State | No library. One `AppState extends ChangeNotifier` holds the session and the last `/api/owner/dashboard` payload. Screens use `FutureBuilder` and `setState`. | One endpoint feeds Home, Tags, Activity and the profile header (src/backend/routes/owner/dashboard.js:186-485). |
| Navigation | `go_router` `StatefulShellRoute.indexedStack` with five tabs: Home, Scan, Shop, Tags, More. Detail screens are top-level routes on the root navigator. | One place for the tab shell, App Links and the guard. The URLs are reused by the later web build. |
| Sign-in | (1) Login PIN, (2) Google for existing owners, (3) WhatsApp OTP with App Check once B3 ships, (4) the WebView bridge: before B3, for devices that fail Play Integrity, and permanently for the SMS fallback. | See section 6. |
| Hard flows | Native: scanner, activation, vault, signed-in shop. Chrome Custom Tab: guest shop `/get`, report-tag, legal pages. In-app WebView: only the sign-in and activation bridge. | Custom Tabs cannot hand a cookie back to the app. |
| Push | FCM via `firebase_messaging`. The `parktag_alerts` channel is created natively (IMPORTANCE_HIGH). Foreground messages show a SnackBar and refresh. | No flutter_local_notifications, no full-screen intent. |
| Digital goods | Never sold in the app. Membership is shown read-only. Callback-pass purchase states read as "not available". | wiki/owner-pwa.md:129-155, parktag-plan-verified.md:298-301 |

### Dependencies (pin exact versions, commit `pubspec.lock`)

| Package | Version | Use |
|---|---|---|
| http | 1.6.0 | API client, multipart, `http/testing` MockClient |
| http_parser | 4.1.2 | `MediaType` for multipart part Content-Type (already a transitive dependency of http, now direct) |
| go_router | 18.1.0 | shell, guard, App Links |
| flutter_secure_storage | 11.2.0 | session cookie, onboarding flag |
| flutter_inappwebview | 6.1.5 | sign-in and activation bridge only (reads the httpOnly cookie via CookieManager) |
| mobile_scanner | 7.4.2 | Scan tab |
| url_launcher | 6.3.3 | `tel:`, Custom Tabs, `https://wa.me/`, map links |
| geolocator | 14.1.1 | opt-in car location, foreground only |
| firebase_core | 5.0.0 | Firebase project `parktag1` |
| firebase_messaging | 17.0.0 | push |
| firebase_app_check | 0.5.0 | Play Integrity token for send-otp |
| google_sign_in | 7.2.0 | existing-owner Google sign-in (`GoogleSignIn.instance.initialize(serverClientId:)` then `authenticate()`) |
| razorpay_flutter | 1.4.7 | physical sticker orders only |
| image_picker | 1.2.4 | vault: camera and gallery |
| file_picker | 13.1.0 | vault: PDF pick |
| qr_flutter | 4.1.0 | render and export the owner's QR from `tags[].scanUrl` |

Inter is bundled as an asset (`assets/fonts/Inter-Variable.ttf`).

Skipped on purpose:
- riverpod, provider and bloc
- dio and cookie_jar
- shared_preferences
- flutter_local_notifications. The channel is about 5 lines of Kotlin.
- google_fonts, shimmer and freezed/json_serializable
- webview_flutter
- path_provider. Use the cache dir from the platform channel.
- share_plus. The share intent goes through the platform channel.

FlutterFire 5.0.0 and 17.0.0 were released on 2026-10-15. If a regression shows up, pin the previous release train for all three Firebase packages together.

---

## 2. Folder layout (`app/`)

```
app/
  pubspec.yaml, pubspec.lock, analysis_options.yaml
  assets/fonts/Inter-Variable.ttf
  assets/onboarding/*.webp, assets/help/*.webp
  android/
    key.properties                  (gitignored; points to the upload keystore OUTSIDE the repo)
    app/google-services.json        (Firebase parktag1, both me.parktag.app and me.parktag.app.debug; gitignored)
    app/build.gradle.kts            (applicationId me.parktag.app, debug suffix .debug, minSdk 24, target/compile 36,
                                     R8 on with proguard-rules.pro, release signingConfig from key.properties)
    app/proguard-rules.pro          (Razorpay keep rules: com.razorpay.**, @JavascriptInterface, onPayment* callbacks)
    app/src/main/AndroidManifest.xml
    app/src/main/res/xml/network_security_config.xml   (cleartext off)
    app/src/debug/res/xml/network_security_config.xml  (debug only: cleartext allowed to 10.0.2.2 only)
    app/src/main/res/xml/data_extraction_rules.xml     (exclude everything)
    app/src/main/res/xml/file_paths.xml                (FileProvider: cache/vault and cache/share only)
    app/src/main/kotlin/me/parktag/app/MainActivity.kt
        onCreate: create NotificationChannel("parktag_alerts", IMPORTANCE_HIGH)
        MethodChannel "parktag/platform": setSecure(bool), openFile(path, mime), shareImage(bytes, name)
  ios/   (generated, untouched beyond build settings)
  web/   (generated; build checked occasionally)
  lib/
    main.dart                 Firebase + App Check init, AppState, MaterialApp.router, Push.init()
    router.dart               go_router: shell, redirect guard, deep links; imports the named route lists below
    core/
      api.dart                ApiClient (http), ApiError, cookie capture, host lock
      session.dart            SessionStore (secure storage), signOut()
      app_state.dart          AppState ChangeNotifier (session, dashboard, refresh(), tokenForTagId())
      models.dart             Owner, Tag, ContactRequest (ContactRequest has NO phone field; it has phoneLast4, hasPhone)
      qr_parse.dart           parseTagUrl(String) -> String? token
      theme.dart              tokens below
      widgets.dart            Skeleton, ErrorCard, EmptyState, showPtSheet, PinField, OtpField, VehicleCard
      platform.dart           setSecure(), openFile(), shareImage(), openCustomTab(url) (always appends pt_app=android)
      web_bridge.dart         WebBridgeScreen: host-locked InAppWebView that captures wavetag_session
      errors.dart             mapCallError(ApiError) shared by register-call, register-emergency-call and owner callback
    push/push.dart            U0 creates a no-op stub (init/register/unregister/currentToken); U7 owns it afterwards
    features/
      onboarding/             splash, carousel, guest hub, help/demo
      auth/                   login (PIN | WhatsApp OTP | Google), set-PIN nudge
      scan/                   scanner, tag result, verify, contact sheets, SOS, activation wizard
      owner/                  home hub, tags list, tag detail, activity
      more/                   profile, login PIN & sessions, membership read-only, delete account, legal/support
      vault/                  lock, list, upload, viewer (vault models live here)
      shop/                   catalogue, address, checkout, COD, orders + tracking (product/order/address models live here)
  test/
    core/                     api_test.dart, qr_parse_test.dart, session_test.dart, no_phone_test.dart,
                              no_digital_sales_test.dart, web_bridge_test.dart
    push/                     push_test.dart
    features/<f>/             widget tests per feature with MockClient
```

**Route contract.** U0 fixes this contract, and `router.dart` does not change after U0. Each `features/<f>/routes.dart` exports fixed names:
- `onboarding`: `onboardingRootRoutes`, plus `homeGuestRoutes` (for `/hub`)
- `auth`: `authRootRoutes`
- `scan`: `scanBranchRoutes` and `scanRootRoutes` (`/t/:token` and activation)
- `owner`: `homeBranchRoutes` (`/home`), `tagsBranchRoutes` (`/tags`) and `ownerRootRoutes` (`/tags/:tagId`, `/activity`)
- `shop`: `shopBranchRoutes` and `shopRootRoutes` (`/shop/address`, `/shop/orders*`)
- `more`: `moreBranchRoutes` and `moreRootRoutes`
- `vault`: `vaultRootRoutes` (`/tags/:tagId/vault`)

Every `*RootRoutes` entry uses `parentNavigatorKey: rootKey`. U0 creates these as empty-list stubs, and each feature unit then owns its folder.

**Core is frozen after U0.** Feature-only models and widgets live in `features/<f>/`. A change to `core/` needs a small serialized follow-up, not a parallel edit. Split a file only when it passes about 500 lines.

---

## 3. Design tokens (`lib/core/theme.dart`)

Taken from src/frontend/styles/styles.css:22-31,359-376 and owner-welcome.css:18-24,828-872,964-975.

| Token | Value |
|---|---|
| bg | #F1F1F0 |
| panel | #FFFFFF |
| ink / navy (header) | #03162D |
| muted | #495B7B |
| line | #E2E8F0 |
| accent | #FF2700 |
| accentDark | #D92200 |
| amberDeep | #C81F00 |
| amberBg | #FFEDEA |
| whatsapp | #25D366 / #128C7E |
| error | #DC2626 |
| success | #16A34A |
| inactive nav | #B0B7C3 |
| shadow | 0 4 24 rgba(0,25,53,.08); lg 0 8 40 rgba(0,25,53,.12) |
| radii | 10, 12, 14, 16, 20, 999 (pills); sheets 22 top corners, max width 480, max height 90% |
| padding | x 16-20 (clamp), header side 18 |
| font | Inter 400-900, bundled |

**Nav bar.** A floating pill (radius 999, white at 92%). The active tab is filled accent with a white label. Inactive tabs show the icon only.

**Copy rules.** Short, second person and privacy-reassuring. Errors read "<What failed>. Try again." Buttons are verbs. Never use em dashes. Where the server returns a user-facing `error` string (423 verify lock, mount mismatch, address 400, 429), show it, and keep local copy only as a fallback. The exceptions are 402 and 410 on call and callback routes: their server text mentions subscribing, so the app always uses local copy there (section 4.4).

---

## 4. Screens

Conventions:
- Every list starts with `Skeleton`. Errors show `ErrorCard` with Retry.
- A 401 on `/api/owner/*` is NOT treated as sign-out by itself. Wrong vault PIN, wrong delete password and wrong current password all return 401 on a valid session (src/backend/routes/owner/vault.js:214, dashboard.js:1294-1296, 1419-1422). ApiClient re-checks `GET /api/session`, and only `session:null` clears the session and redirects to `/hub`. Otherwise the 401 reaches the screen as a normal ApiError.
- A 429 shows the server `error` text and honours `retry-after` / `retryAfterSeconds`.
- All owner data comes from `AppState.dashboard` unless a row says otherwise. Mutations call `appState.refresh()`.

### 4.1 Onboarding and guest (feature `onboarding`)

| Route | Data | States / notes |
|---|---|---|
| `/splash` | `GET /api/session` returns `{session:{role,...}\|null}` | role `owner` goes to `/home`. Otherwise, if the secure-storage flag `onboarded` is unset, go to `/onboarding`, else `/hub`. Offline: "No connection. Try again." |
| `/onboarding` | static, 4 slides: "Masked call with your ParkTag", "Emergency (SOS) contact", "Manage your tags", "Pause calls any time" | Sets `onboarded=1`. Never promise per-channel WhatsApp/SMS toggles. |
| `/hub` (guest Home tab) | none | Tiles: Scan a tag (`/scan`), Sign in (`/login`), Buy a tag (Custom Tab `https://app.parktag.me/get?pt_app=android`), How it works (`/help`). |
| `/help` | static assets | What happens when someone scans, how to activate, privacy explainer. No `/api/demo/*`, which is disabled in production (src/backend/routes/system/demo.js:4-5). |

Guest tabs:
- Home is `/hub`.
- Scan works fully.
- Shop opens a Custom Tab to `/get?pt_app=android`, because guest checkout needs reCAPTCHA (src/backend/routes/shop/index.js:1034-1060).
- Tags and More redirect to `/login`.

### 4.2 Auth (feature `auth`, plus `core/web_bridge.dart`)

| Route | API | Notes |
|---|---|---|
| `/login` | Three segments: Mobile, PIN, Google | Mobile is the default. |
| Mobile, send | `POST /api/auth/send-otp {identifier:"+91XXXXXXXXXX", recaptchaToken:""}` with header `X-Firebase-AppCheck: <getLimitedUseToken()>` | The client validates the 10-digit number first, so every 400 from send-otp is a captcha rejection. After B3 the server also tags it `code:"CAPTCHA_REQUIRED"`. On any 400, open `/login/web`. Before B3 every native send goes this way, so the effect is that Mobile uses the bridge. A 500 (WhatsApp delivery failed, src/backend/routes/auth/otp.js:86-96) shows "WhatsApp could not send the code" with a **Get the code by SMS** action that opens `/login/web`. |
| Mobile, verify | `POST /api/auth/verify-otp {identifier, code}` returns `{ok,isNewUser}` plus Set-Cookie | 409 `ACCOUNT_EXISTS`: show the server message. A new user goes to the set-PIN nudge. After the resend timer, also show "Didn't get it? Use SMS", which opens `/login/web`. |
| PIN | `POST /api/auth/login {identifier, pin}` returns `{ok,user}` plus Set-Cookie | 401: "Wrong number or PIN. Try again." 429 shows retry-after. Works today with no backend change (src/backend/routes/auth/credentials.js:78-241). |
| Google | `GET /api/auth/google/config` returns `{clientId}` (no `ok`). Then `GoogleSignIn.instance.initialize(serverClientId: clientId)`, `authenticate()`, and `POST /api/auth/google/credential {credential: idToken}` | 200 `{redirect}` is success (no `ok` field). 404 `{error:"no_account"}`: "No ParkTag account for this Google email. Use your mobile number." 403 `email_unverified`. Ops: Android OAuth clients (package plus SHA-1) for debug, upload and Play App Signing certificates, in the same GCP project. |
| `/login/web` (bridge) | InAppWebView at `https://app.parktag.me/owner-login?pt_app=android` | See section 6.3. On capture, it pops to `/home`. It also hosts the web's Firebase SMS fallback (src/frontend/scripts/owner/login.js:120-140,359-363), which App Check cannot unlock because `/api/auth/firebase-phone/send` needs a web reCAPTCHA token (src/backend/routes/auth/firebase.js:114-126,165-168). |
| Set-PIN nudge (sheet) | `POST /api/owner/login-pin {pin, confirmPin}` | 6-8 digits. The server rejects weak PINs and a PIN equal to the vault PIN. Skippable. |

After any sign-in:
1. `GET /api/session` must return role `owner`.
2. `appState.refresh()`.
3. `Push.register()`.

### 4.3 Scan tab (feature `scan`)

| Route | API | Notes |
|---|---|---|
| `/scan` | none | `MobileScanner`. On detect, run `parseTagUrl`; on a token, `context.push('/t/$token')`. A rejected code shows "This is not a ParkTag code." The app never opens the scanned URL. The camera permission is asked the first time the tab opens. |
| `/t/:token` | `GET /api/tags/:token` returns `tag{token,status,tagId,vehicleType,vehicleLabel,maskedPlateNumber,callPreviewNumber,emergencyAvailable,callsPaused,claimable,suggestedVehicleType,vehicleCategory}, supportWhatsapp` | 404: "Tag not found. Scan the sticker again." `claimable` goes to activation. `status!='active'` shows "This tag is inactive". Otherwise the verify gate. |
| Verify gate | `POST /api/tags/:token/verify {lastFour}` returns `{grant, vehicleLabel, maskedPlateNumber, contactAvailable, unlimitedContact, contactBlockedCode, messageAlwaysOn, callsPaused}` | 401 shows `attemptsRemaining`. 423 shows the server `error`, which computes the minutes left (src/backend/routes/public/index.js:502-507,584-591). The grant lives in screen state only (15 min) and is never persisted. |
| Contact screen | none | WhatsApp message tile, shown when `messageAlwaysOn`. Private call is hidden when `callsPaused` or `contactBlockedCode` is set. SOS button when `emergencyAvailable`. Reason chips are hardcoded: `lights, towing, parking, window, suspicious` (src/backend/lib/core/contact-actions.js:35-41). "Share where the car is" toggle: geolocator `whenInUse`, asked only when the toggle is turned on, sends `{lat,lng}`. Optional "Let the owner call you back" 10-digit field (masked owner callback). Trust line: "Your number stays private." |
| Message | `POST /api/contact-requests {token, action:"message", messageChannel:"whatsapp", reason, grant, carLocation?, phone?}` | `phone` is sent only when the callback field is filled. Without it the owner's Call back cannot work (src/backend/routes/public/index.js:1077-1078,1211-1222; web: src/frontend/scripts/scanner/app.js:1760-1766). 403 means the grant expired: back to the verify gate. 402 `CALL_SUBSCRIPTION_REQUIRED` (index.js:1185-1192): "This tag cannot be reached right now." 404: the inactive message. Success shows the receipt "Owner alerted successfully". |
| Private call (sheet) | `POST /api/tags/:token/register-call {phone, grant, carLocation?}` returns `{virtualNumber}` | Phone must be a 10-digit Indian mobile. Before dialling, show "Call from the SIM with number ending <last4>." Then `launchUrl('tel:$virtualNumber')`. Errors go through the shared `mapCallError` (below). |
| SOS (confirm dialog, then phone sheet) | `POST /api/tags/:token/register-emergency-call {phone, grant, carLocation?}` returns `{virtualNumber}` | Any non-2xx except `GRANT_IN_USE` shows the helplines with a `tel:112` button, plus the server message when present. That covers 402 `EMERGENCY_LOCKED`, 422 `NO_EMERGENCY_CONTACT`, 429 `EMERGENCY_LIMIT`, 409 `CALLER_IN_USE` and 503 (index.js:1519-1529,1551-1552,1585-1590). |
| Report wrong info | Custom Tab `https://app.parktag.me/report-tag?tag=<token>&pt_app=android` (src/frontend/scripts/scanner/report-tag.js:27-28; src/frontend/scripts/scanner/app.js:435) | Not native, because v2 captcha may be switched on later. |
| Activation wizard (claimable) | Steps: vehicle type (preselect `suggestedVehicleType`; one of `car\|bike\|scooter\|auto_rickshaw\|truck\|bus`), then plate (`^[A-Z0-9-]{4,16}$` after upper-casing and stripping spaces), then name, then phone. Then `POST /api/auth/send-otp` with App Check (as in 4.2), then the code, then `POST /api/tags/:token/activate {displayName, phone, code, plateNumber, vehicleType, vehicleLabel?}`, which returns `{ok,isNewOwner,owner,tag}` plus Set-Cookie | 409 `mount_type_mismatch`: show the server `error` sentence (src/backend/lib/core/tag-issuance.js:146-151). 409 `ACCOUNT_EXISTS`: show the message. On success: `GET /api/session`, refresh, push register, then `/home`. **Fallback**: on a send-otp 400, or on "Get the code by SMS", open the bridge at `https://app.parktag.me/tag/<token>?pt_app=android`. Capture follows the 6.3 rule. The scanner page does not navigate after activation (it shows an in-page done step, src/frontend/scripts/scanner/app.js:2303-2335), so the bridge also checks for a session on every load-stop and when the user closes it. App Check is NOT sent on `/activate`. |

**Shared call error mapper (`core/errors.dart`, used by register-call)**:

| Response | Behaviour |
|---|---|
| 403 `GRANT_IN_USE` or an expired grant | back to the verify gate |
| 409 `CALLS_PAUSED` / `CALLER_IN_USE` | server message |
| 402 `FREE_USED` / `CALL_SUBSCRIPTION_REQUIRED` | "Calls are off for this tag. Send a WhatsApp alert instead." The call tile is hidden. |
| 422 `OWNER_NO_PHONE` | "The owner cannot take calls. Send a WhatsApp alert instead." |
| 503 | "Calling is unavailable right now. Send a WhatsApp alert instead." |

Server text for 402 is never shown.

**QR parsing rules (`core/qr_parse.dart`)**:
- Use `Uri.tryParse`. The scheme must be `https` and the host must equal exactly `app.parktag.me`: no subdomains, no userinfo, no non-default port.
- The path must match `^/(tag|vehicle)/([A-Za-z0-9]{12,64})/?$` (src/backend/app.js:1680-1699).
- Otherwise accept `/tag` or `/vehicle` with a query `token` matching `^[A-Za-z0-9]{12,64}$`.
- Anything else returns null. Never launch the raw string.
- The token stays in memory only and is never logged.
- `/v/:tagId` App Links go to `/tags/:tagId`, behind the auth guard.

### 4.4 Owner: Home, Tags, Activity (feature `owner`)

Source: `GET /api/owner/dashboard?qr=0`. It returns:
- `owner{displayName,greetingName,mobile,backupMobile,credits,profile}`
- `tags[]` (each has `id`, `token`, `scanUrl`, `membership`, `emergencyContact`, ...)
- `requests[]` (max 10; items carry the tag `token`, not `tagId`; src/backend/routes/owner/dashboard.js:388-391)
- `callbackWindowMs`
- `referral`

`AppState.tokenForTagId(tagId)` resolves `tags.firstWhere(id).token`. Every tagId-based filter (filter chips, `?tag=`, push data) uses it to match `requests[].token`. The tag token is never put in a push payload.

| Route | API | Notes |
|---|---|---|
| `/home` | dashboard | Navy header "Hi, <greetingName>". A bell icon opens `/activity`. KPI tiles: premium tags, free calls left (sum of `freeContactsLeft`), missed (`missedContacts`). Latest alert card. Per-vehicle coverage line from `tags[].membership` ("Covered until <date>"; handle the open, lapsed and null/E-Tag states; src/backend/routes/owner/dashboard.js:377, src/backend/lib/core/membership-fulfilment.js:101). No "View plans". Quick actions: Scan, Add vehicle, Shop, Help. Referral card: `referral.code` with Share (`https://wa.me/?text=...`) and Copy. Pull to refresh. |
| `/tags` | dashboard | "My Vehicles (n)": one card per tag (plate, label, status chip, premium badge). Empty: "No vehicles yet / Add your first vehicle below". Add card. |
| Add vehicle (sheet) | `POST /api/owner/local-vehicle {type, number}` returns `{ok,id,token}` | Same endpoint as the web (src/frontend/scripts/owner/welcome.js:2750). 409 "Vehicle already added." (dashboard.js:720-747). 400 shows the server message. Then refresh. Not `etag/generate`, which is idempotent 200 and renders a QR data URL on every call (dashboard.js:672-714). |
| `/tags/:tagId` | dashboard (find by id) | Switches: Tag active, `POST /api/owner/tags/:tagId/status {status:"active"\|"inactive"}`. Calls active, `POST /api/owner/tags/:tagId/calls {active}`. Emergency contact sheet, `POST /api/owner/tags/:tagId/emergency-contact {emergencyContact}` (required, cannot be the owner's own number). Backup number sheet, `POST /api/owner/backup-mobile {mobile}` with the "Is this number right?" confirm, and `DELETE /api/owner/backup-mobile`. QR: `QrImageView(data: tag.scanUrl)`. **Save / share E-Tag**: `QrPainter(data: scanUrl).toImageData(1024)`, then `platform.shareImage(png, "parktag-<plate>.png")`, which uses ACTION_SEND through the FileProvider `cache/share` path (Sampark parity, sampark-teardown.md:207). Documents goes to `/tags/:tagId/vault`. This tag's activity. Delete: confirm "This also deletes its documents.", then `DELETE /api/owner/tags/:tagId`. Do NOT show the Push/Email/WhatsApp/Location/Call-masking switches, which are localStorage-only on web (src/frontend/scripts/owner/welcome.js:3130-3170). |
| `/activity` (and `?tag=`, `?request=`) | dashboard `requests[]` | Each row shows: reason label, action, status/callOutcome, `scannerLocationLabel`, a **Car location** button that opens `carLocationMapUrl` (a Google Maps search link, src/backend/lib/core/car-location.js:48-51) with url_launcher, `•••• <phoneLast4>` when `hasPhone`, and the time. Filter chips per vehicle (by token). Empty: "No activity yet / Contact requests from scanners will appear here". **Call back** shows on the newest row when `hasPhone`: `POST /api/owner/callback/register-call {requestId}` returns `{virtualNumber}`, then `tel:`. Errors map by `code` (below). NEVER call `/api/owner/callback/create-order` or `/verify-payment`. |

**Owner callback error map.** The server `error` text for 402 and 410 says "Subscribe/Upgrade" (dashboard.js:98-106), so it is never shown.

| Code | Copy |
|---|---|
| 402 `NO_PHONE` | "Add your mobile number in Profile", with a button to `/more/profile` (dashboard.js:1634) |
| 402 `PREMIUM_REQUIRED` | "Call back is not available for this vehicle." |
| 402 `CALL_SUBSCRIPTION_REQUIRED` | "Call service ended for this vehicle." |
| 410 `CALLBACK_WINDOW_EXPIRED` | "The callback window has passed." (dashboard.js:1735-1746) |
| 410 `CALLBACK_NOT_LATEST` | "Only your latest alert can be called back." (dashboard.js:1758) |

None of these shows purchase UI.

### 4.5 More (feature `more`)

| Route | API | Notes |
|---|---|---|
| `/more` | dashboard owner block | Identity card, then rows: Profile, Delivery address (`/shop/address`), Orders (`/shop/orders`), Login PIN & devices, Membership, Help, Terms/Privacy/Refund (Custom Tab), Sign out, Delete account (danger). |
| `/more/profile` | `PATCH /api/owner/profile {displayName, gender?, dateOfBirth?}` | Email is read-only. Add or change mobile: `POST /api/owner/mobile/send-otp {mobile}` returns `{phoneHint}`, then `POST /api/owner/mobile {mobile, otp}`. Copy: "We verify it once, so a scanner can reach you without seeing it." |
| `/more/pin` | `GET /api/owner/login-pin` returns `{hasPin,setAt}`. `POST /api/owner/login-pin {pin, confirmPin, currentPin?}`. `DELETE /api/owner/login-pin {currentPin}`. `POST /api/owner/sessions/revoke-others` returns `{revoked}`. | Shows "Signed out on other devices" when `signedOutElsewhere`. FLAG_SECURE on. A wrong `currentPin` returns 401 and stays on screen (see the 401 rule). |
| `/more/membership` | `GET /api/owner/membership` | Render only `tags[{plateNumber, vehicleLabel, coveredUntil, trial}]` and the trial text. Never render `plans`, prices or a buy button, and never link to the web to buy. |
| `/more/delete-account` | `POST /api/owner/account/send-delete-code` | 200 `{channel, hint}`: show the OTP field with `hint`, then `DELETE /api/owner/account {otp}` (400 `OTP_INVALID`). 400 `PASSWORD_REQUIRED` (dashboard.js:1338-1342; any account with a passwordHash): show a password field, then `DELETE /api/owner/account {password}`. A wrong password is 401 "Incorrect password." and stays on screen (dashboard.js:1412-1423). 409 `NO_DESTINATION`: "We can't send a code. Contact support." with the support link. On success: `Push.unregister()` (best effort), wipe secure storage, go to `/hub`. |
| Sign out | `DELETE /api/owner/push-tokens {token}`, then `POST /api/auth/logout` (body `{}`), then wipe secure storage and the vault cache | In `core/session.dart` `signOut()`. Logout must hit the server before the local wipe: only `clearSession` deletes the server row (src/backend/lib/auth/session.js:305-317). |

### 4.6 Vault (feature `vault`, FLAG_SECURE on every vault route)

| Route | API | Notes |
|---|---|---|
| `/tags/:tagId/vault` | `GET /api/owner/vault/status?tagId=` returns `{hasPin, unlocked, limits, entitlement}` | No PIN: set-PIN sheet, `POST /api/owner/vault/pin {pin}`. Locked: `POST /api/owner/vault/unlock {pin}`. 401 "Incorrect PIN." keeps the session (src/backend/routes/owner/vault.js:214). 429 shows `retryAfterSeconds`. |
| List | `GET /api/owner/vault/documents?tagId=` returns `{documents[{id,docType,label,mimeType,size,viewable,thumb,createdAt}], usedBytes, entitlement, documentCount}` | 423 means locked: show unlock. |
| Upload (sheet) | `POST /api/owner/vault/documents` multipart: fields `tagId`, `docType` (`rc\|insurance\|puc\|licence\|other`), `label`, then one `file` part | Camera or gallery via image_picker (`imageQuality: 80`, which gives JPEG). PDF via file_picker. Client checks: 5MB, and an extension in pdf/jpg/jpeg/png/webp. **The file part must carry its type**: `http.MultipartFile.fromBytes('file', bytes, filename: name, contentType: MediaType(...))`, chosen from the extension. The default `application/octet-stream` gets 415 (src/backend/routes/owner/vault.js:324-329; allowlist src/backend/lib/core/vault.js:168). Fields come before the file part, which MultipartRequest already does (vault.js:306-309). Omit `thumb`. 409 `DOCUMENT_LIMIT_REACHED`/`STORAGE_FULL`, 413 and 415 map to messages. |
| Rename / delete | `PATCH /api/owner/vault/documents/:docId {docType?, label?}`, `DELETE /api/owner/vault/documents/:docId` | |
| View | `GET /api/owner/vault/documents/:docId/file` (bytes) | Images: `Image.memory`, never written to disk. PDFs: write to `cache/vault/`, then `openFile` via FileProvider. The external viewer is outside FLAG_SECURE; this is accepted. |
| Lock | `POST /api/owner/vault/lock` (body `{}`) | Called on leaving the vault and on app pause. Also wipes `cache/vault/`. |

### 4.7 Shop (feature `shop`, signed-in only; guests get the Custom Tab)

Shop routes return a bare `{error}` with no `ok` on failure, and success bodies such as `{keyId}` also have no `ok` (src/backend/routes/shop/index.js:698,1808-1830,2174-2181). ApiClient decides success from the HTTP status only (section 6.1).

| Route | API | Notes |
|---|---|---|
| `/shop` | `GET /api/shop/pricing` returns `{products{id:{name,amountPaise,soldOut?}}, offers, launchOffer, codSurchargePaise, flashDiscountPaise}` | Product cards. Sold-out products are disabled. |
| Promo / referral | `POST /api/shop/promo/check {code, productId, quantity, context:"dashboard"}`, `POST /api/shop/referral/check {code}` | Display only. The server re-resolves at create-order. |
| `/shop/address` | `GET` / `POST /api/owner/address {fullName, phone, line1, line2, landmark, city, state, pincode}`. Suggestions: `GET /api/shop/address-suggest?q=&pin=` | 400 shows the server message (dashboard.js:855-858). |
| Pay online | `GET /api/shop/razorpay-key` returns `{keyId}`. `POST /api/shop/create-order {productId, quantity?, variant?, replaceTagId?, promo?, ref?}` returns `{orderId, orderNumber, amount, currency, prefill, referralRefused, promoRefused}`. Then `Razorpay().open({key, order_id, amount, currency, prefill})`, then `POST /api/shop/verify-payment {razorpay_order_id, razorpay_payment_id, razorpay_signature}` | Stop before payment if `referralRefused`. If the app is killed mid-payment, the Razorpay webhook fulfils the order (src/backend/routes/webhooks/razorpay.js:31-40). |
| COD | `POST /api/shop/cod-otp/send` returns `{phoneHint}`. Then `POST /api/shop/place-cod {productId, otp, quantity?, variant?, promo?}` returns `{orderNumber, flashOfferSeconds}`. Optional prepay flash: `POST /api/shop/cod-prepay-order {orderNumber}`, Razorpay, then `POST /api/shop/cod-prepay-verify {orderNumber, razorpay_*}` | 60s countdown. |
| Confirmed | none | "How to activate" steps that point to the Scan tab. |
| `/shop/orders`, `/shop/orders/:id` | `GET /api/owner/orders`, `GET /api/owner/orders/:id/track` | Scans timeline. |

Razorpay is used only for `/api/shop/*`. Membership and callback-pass endpoints are never called.

---

## 5. Push design

### Backend (unit B2; storage in B1)

**Collection.** `pushTokens` `{token (unique), ownerId: ObjectId, platform: "android"|"ios"|"web", sessionHash: sha256(sessionId), createdAt, updatedAt}`.
- Indexes: `token_unique`, `owner`, `session`.
- A TTL of 120 days on `updatedAt` prunes orphans, because the app re-posts the token on every start.
- Registered in src/backend/lib/db/repositories.js (B1).

**Routes.** New file `src/backend/routes/owner/push.js`, registered in src/backend/app.js next to `registerLoginPinRoutes`.
- `POST /api/owner/push-tokens {token, platform}`
  - Owner cookie. Zod: `token` 1-4096 characters matching `^[A-Za-z0-9:_-]+$`.
  - Rate limit 10 per 5 minutes.
  - Upsert by token. A token held by another owner is reassigned to the caller.
  - At most 10 tokens per owner; the oldest are dropped.
  - Returns `{ok:true}`.
- `DELETE /api/owner/push-tokens {token}`
  - Deletes `{token, ownerId}` only.
  - Idempotent, same rate limit.

**Sender.** `src/backend/lib/integrations/fcm.js`, with no new dependency.
- Sign a service-account JWT with `node:crypto` `createSign('RSA-SHA256')`, scope `https://www.googleapis.com/auth/firebase.messaging`.
- Exchange it at `https://oauth2.googleapis.com/token` with `fetchWithTimeout` (lib/core/fetch-timeout.js:11). Cache the access token for about 55 minutes.
- POST to `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`. Read `projectId` from the service-account JSON's `project_id`.
- Message body:
  ```json
  {"message":{"token":"<t>",
    "notification":{"title":"<reason label>","body":"<masked plate>[ · Near <city>]"},
    "data":{"type":"contact|call|locked","tagId":"<id>","requestId":"<id>"},
    "android":{"priority":"HIGH","ttl":"600s","collapse_key":"<requestId>",
               "notification":{"tag":"<requestId>","channel_id":"parktag_alerts"}}}}
  ```
  The top-level `notification` holds only title and body. `tag` and `channel_id` belong under `android.notification`.
- Export `sendOwnerPush(env, collections, ownerId, {title, body, data, collapseKey})`.
  - It runs `Promise.allSettled` over the owner's tokens and never throws.
  - It is a no-op when `FCM_SERVICE_ACCOUNT_JSON` is unset.
- **Pruning.** Delete a token row only on 404 `UNREGISTERED`, or on a 400 whose error details name the field `message.token`. A generic 400 `INVALID_ARGUMENT` (for example a malformed payload) is logged and never deletes rows, because otherwise one bad payload would wipe every owner's tokens.

**Hooks.** Each hook is fire-and-forget: `void sendOwnerPush(...).catch(() => {})`. It is never awaited on the scanner response path, never added to `attempts`, and never counted toward `reached`.
1. In `createContactAction` (src/backend/lib/core/contact-actions.js): fire once the contact request row exists and before the `attempts` / `reached` checks (around lines 207-213). Those checks throw when WhatsApp and email both fail, and that is exactly when push matters most.
2. Locked-tag nudge: fire from `recordLockedAttempt` (src/backend/lib/core/locked-tag-nudge.js:174) once the once-per-day throttle decides a nudge is due, NOT inside `sendNudge`. `sendNudge` returns early on `!canSendUtility(owner)` (locked-tag-nudge.js:111-112), and push must not depend on WhatsApp consent.
3. A successful `register-call` in src/backend/routes/public/index.js (around 1254-1454). Message: "Someone is calling you about your car. Answer the ParkTag number."
- No push for the emergency alert, whose recipient is not an app user (emergency-alert.js).
- Push is not gated by `canSendUtility`. A registered token plus the Android permission is the opt-in.

**Payload privacy.**
- Title: the reason label.
- Body: `maskPlateNumber(plate)` plus an optional "Near <city>".
- `data`: `{type, tagId, requestId}` only.
- Never phone numbers, the full plate, the tag token or scanner data.

**Cleanup.**
- In src/backend/lib/auth/session.js:251-317, `clearSession` (logout), `revokeSessionsForUser` and `revokeOtherSessionsForUser` delete tokens by the `sessionHash` of each revoked session.
- Account deletion (src/backend/routes/owner/dashboard.js:1491-1502, unit B1) adds `collections.pushTokens.deleteMany({ ownerId })`.

**Env and ops.**
- Railway secret `FCM_SERVICE_ACCOUNT_JSON`.
- Firebase console (`parktag1`): add Android apps `me.parktag.app` (upload SHA-1/SHA-256, and Play App Signing SHA-1/SHA-256 in P8) and `me.parktag.app.debug` (debug SHA-1/SHA-256).
- Download `google-services.json`.
- The FCM v1 API is enabled.

### App (unit U7, `lib/push/push.dart`; U0 ships a no-op stub with the same API)

- `Push.init()` runs in main. It sets up `onMessage`, `onMessageOpenedApp`, `getInitialMessage` and `onTokenRefresh` (re-post on refresh).
- `Push.register()` runs after sign-in and on every signed-in cold start:
  1. Read `getNotificationSettings()`.
  2. Only when the status is `notDetermined`: show the pre-prompt sheet ("Get alerted the moment someone needs you at your car"), then `requestPermission()` (POST_NOTIFICATIONS on Android 13+).
  3. When the status is authorized: `getToken()`, then `POST /api/owner/push-tokens {token, platform:"android"}`. This is silent on cold start.
  4. When denied: do nothing. Never nag.
- `Push.unregister()`: `DELETE /api/owner/push-tokens {token}`, then `deleteToken()`.
- The channel `parktag_alerts` (IMPORTANCE_HIGH) is created in `MainActivity.onCreate` (U0). The manifest meta-data `com.google.firebase.messaging.default_notification_channel_id` points to it, and the server sets `android.notification.channel_id` too. No full-screen intent, no foreground service.
- Foreground: SnackBar "New alert: <title>" with a View action, plus `appState.refresh()`. Dedupe by `requestId` in memory.
- Tap: `go('/activity?tag=<tagId>&request=<requestId>')`, then refresh. Activity resolves tagId to a token through AppState. The push payload is never trusted for data.
- Fallback while B2 is unshipped: refresh on `AppLifecycleState.resumed`.
- Copy must not promise instant push. WhatsApp stays the guaranteed channel, because some OEMs delay FCM.

---

## 6. Auth and session details

### 6.1 ApiClient (`core/api.dart`, `core/session.dart`)

Success and errors:
- Success is decided by HTTP status only (2xx). The client never reads `ok` to decide success, because several routes return bare `{clientId}`, `{keyId}`, `{redirect}` or `{error}` bodies (src/backend/routes/auth/google.js:274,280-331; src/backend/routes/shop/index.js:698,1808-1830).
- A non-2xx becomes `ApiError(status, code: body['code'], message: body['error'] ?? "Something went wrong. Try again.", retryAfter, extra: body)`.

Request bodies:
- POST, PATCH and DELETE always send `content-type: application/json` with a JSON body, which defaults to `{}`. Fastify rejects an empty JSON body (FST_ERR_CTP_EMPTY_JSON_BODY), and that would silently break logout, vault lock, revoke-others and send-delete-code.
- GET sends no content-type.

Cookies:
- On every response, parse `set-cookie` and look only for `wavetag_session=`.
  - A value: `SessionStore.write(value)`.
  - `Max-Age=0` or an empty value: clear.
- Add `Cookie: wavetag_session=<v>` only when the request's scheme, host and port all equal those of the `API` base URL. In production that is https on `app.parktag.me`. Any other origin never gets the cookie.

Headers:
- Never set `Origin` or `Referer`. A test asserts this, because the CSRF pass at src/backend/app.js:634 depends on it.
- `User-Agent: ParkTagApp/<ver>` is for analytics only.

401 handling:
- On a 401 from `/api/owner/*`, call `GET /api/session` once.
- Only `session:null` clears storage and redirects to `/hub`.
- Otherwise rethrow the 401 as a normal ApiError (wrong PIN or password).

Timeouts: 15s.

Logging:
- Release builds log no request or response bodies at all.
- Debug builds never log the bodies of `/api/auth/*`, `*/verify`, `*/register-*call`, `/api/owner/vault/*` or `/api/owner/dashboard`.

### 6.2 App Check (unit B3 plus the client)

**Client.**
- Call `FirebaseAppCheck.instance.activate(providerAndroid: AndroidPlayIntegrityProvider())` in release, and the debug provider in debug.
- Send `getLimitedUseToken()` as `X-Firebase-AppCheck` only on `POST /api/auth/send-otp`.

**Debug tokens.**
- Debug builds are the separate Firebase app `me.parktag.app.debug`.
- Production `APPCHECK_APP_IDS` lists only the release app id, so a debug token never passes production. Debug builds against production fall back to the bridge.
- Developers test App Check against a local backend whose `APPCHECK_APP_IDS` includes the debug app id.
- Debug tokens are registered per developer, revoked when no longer needed, and never committed or pasted into logs or docs.

**Server.**
- Verify RS256 against `https://firebaseappcheck.googleapis.com/v1/jwks` with `createPublicKey({key: jwk, format: "jwk"})` and `crypto.verify`. Cache the JWKS for 6 hours.
- Check that:
  - `iss == https://firebaseappcheck.googleapis.com/<FIREBASE_PROJECT_NUMBER>`
  - `aud` includes `projects/<FIREBASE_PROJECT_NUMBER>`
  - `exp` is in the future
  - `sub` is in `APPCHECK_APP_IDS`
- Replay guard: insert `jti` into `appCheckJti` (unique, TTL at `exp`). A duplicate counts as invalid.
- A valid token skips `verifyRecaptcha`. A missing or invalid token runs the existing reCAPTCHA path unchanged, so web is unaffected.
- The captcha-failure 400 gains `code: "CAPTCHA_REQUIRED"` (src/backend/routes/auth/otp.js:69-76). Web ignores it.
- No User-Agent or header bypass. The per-IP (5/min) and per-destination (5/hour) caps are untouched.

### 6.3 WebView bridge (`core/web_bridge.dart`)

**Setup.**
- `InAppWebView` with JavaScript on, because the page needs it.
- No `addJavaScriptHandler`, so there is no JS bridge.
- Third-party cookies off.
- Delete all WebView cookies before opening.

**`shouldOverrideUrlLoading` allowlist.**
- Allowed hosts:
  - `app.parktag.me`
  - `www.google.com/recaptcha/*`
  - `www.gstatic.com`
  - `www.recaptcha.net`
  - The Firebase JS hosts used by the login page's SMS flow (confirm from src/frontend/scripts/firebase-sms.js).
- Everything else is CANCELLED, including `accounts.google.com`.
- `tel:` and `https://wa.me` are handed to url_launcher.

**Completion.** One rule covers both sign-in and activation.
- The check runs:
  - on every main-frame `onLoadStop` on `app.parktag.me`
  - when the user closes the bridge
- Steps:
  1. `CookieManager.instance().getCookie(url: WebUri('https://app.parktag.me'), name: 'wavetag_session')`. If it is absent, do nothing and stay.
  2. Call `GET /api/session` with that cookie through ApiClient. Only when the role is `owner`: `SessionStore.write`, `CookieManager.instance().deleteAllCookies()`, then pop to `/home`.
  3. On any failure, write nothing and stay in the WebView. On close, also wipe the WebView cookies.
- Pre-auth pages such as `/owner-login`, `/owner-verify` (src/frontend/scripts/owner/login.js:379) and `/owner-login-pin` carry no session, so they never finish the bridge.
- Successful web sign-in lands on `/owner-welcome` (login.js:198,431; verify.js:70,123,141). Activation sets the cookie without navigating (src/backend/routes/public/index.js:979-991; src/frontend/scripts/scanner/app.js:2303-2335), and the close-check covers it.

**Scope.**
- Used only for sign-in, SMS fallback and activation. Never for the shop, vault or membership.
- The Google button is hidden inside the bridge by `data-hide-in-android-app` on the Google button in `src/frontend/pages/owner/login.html` (B1). pwa.js already hides that attribute when `pt_app=android` (src/frontend/scripts/pwa.js:65-81). Google OAuth is blocked in embedded WebViews anyway, so native Google is the only Google path.

**Lifetime.** The bridge stops being the primary OTP path once B3 has been live for 2 weeks with a native send-otp success rate of at least 98%. It stays permanently for SMS fallback and Integrity failures.

---

## 7. Play policy rules (hard)

1. No in-app purchase of membership, auto-renew or the paid callback pass.
   - The app never calls `/api/owner/membership/create-order`, `/verify-payment`, `/subscribe`, `/subscription/verify`, `/api/owner/callback/create-order` or `/api/owner/callback/verify-payment`.
   - `test/core/no_digital_sales_test.dart` greps `lib/` and fails if these strings appear.
2. No pointer to the website for paying for digital goods, including copy such as "buy on parktag.me". Server 402/410 text that says "Subscribe" or "Upgrade" is never shown.
3. Every Custom Tab or WebView URL goes through `openCustomTab()` / `WebBridgeScreen`. Both always append `pt_app=android`, so pwa.js hides plans (src/frontend/scripts/pwa.js:23-60).
4. Razorpay is allowed only for physical stickers (`/api/shop/*`).
5. Account deletion:
   - It is reachable in-app (More, then Delete account).
   - The Play Console Data safety form lists a public web deletion URL: a support page that links to web sign-in, then Delete account (POST /api/owner/account/send-delete-code exists at src/backend/routes/owner/dashboard.js:1321).
6. Permissions: `INTERNET`, `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (requested at contact time only), `POST_NOTIFICATIONS`. None of `USE_FULL_SCREEN_INTENT`, `SYSTEM_ALERT_WINDOW`, `RECORD_AUDIO`, background location, battery-optimisation exemption or `CALL_PHONE`.
7. Data Safety declares:
   - name, phone and email
   - approximate and precise location (optional, scanner car location)
   - files and docs (vault)
   - device id (FCM token)
   - purchase history
   - payment info (processed by Razorpay)

## 8. Security rules

**Storage and transport.**
- The session lives only in Keystore-backed secure storage.
- `android:allowBackup="false"`, plus `dataExtractionRules` excluding everything.
- Cleartext is disabled in release. Debug allows only `10.0.2.2`.
- R8 is on, with the Razorpay keep rules.

**Screens.** FLAG_SECURE (`platform.setSecure(true)`) is on for the vault, OTP, PIN and login screens, and is turned off on route exit.

**Privacy.**
- `ContactRequest.fromJson` never reads `phone`, only `phoneLast4` and `hasPhone`. A test covers this.
- The scanner token and grant are memory-only and never logged or persisted.
- QR and App Link parsing follows the strict host and path rule (4.3). The app never opens arbitrary scanned URLs.

**WebView and intents.**
- WebView: host allowlist, no JS bridge, cookies wiped before, after and on close. The session is captured only after `/api/session` confirms the owner role.
- Intent hand-off is limited to `tel:`, `https://wa.me`, Google Maps links from `carLocationMapUrl`, the app's own share intent, and `upi:` only inside Razorpay (handled by its SDK).
- The vault cache is wiped on lock, pause and logout. Images render from memory. `cache/share` is wiped on app start.

**Forbidden.**
- Never add CORS, Bearer owner tokens or User-Agent-based trust.
- The debug signing fingerprint is never added to production `ANDROID_APP_SHA256_FINGERPRINTS`.
- A wrong secret (401 on a valid session) never wipes the session.

**Secrets.**
- The upload keystore stays outside the repo.
- `key.properties` and `google-services.json` are gitignored.
- App Check debug tokens stay out of the repo, CI and docs.

---

## 9. Backend changes (exact)

| Unit | Files | Change | Tests |
|---|---|---|---|
| B1 foundation (ship first, before any Activity UI) | src/backend/routes/owner/dashboard.js; src/frontend/scripts/owner/welcome.js; src/frontend/scripts/owner/callback-eligibility.js; src/frontend/pages/owner/login.html; src/backend/lib/env.js; .env.example; src/backend/tests/helpers.js; src/backend/lib/db/repositories.js; src/backend/tests/callback-eligibility.test.js; src/backend/tests/call-outcomes.test.js; src/backend/tests/callback-pass.test.js | See the B1 detail below. | New `src/backend/tests/dashboard-phone-mask.test.js`, scoped to `requests[]`: no item has a `phone` key, no run of 10 or more digits appears inside any `requests[]` item, `phoneLast4` equals the last 4 digits, and `hasPhone` is correct. The owner's own `mobile`, `backupMobile` and `tags[].emergencyContact` are legitimately full (dashboard.js:382). Existing tests stay green after the fixture update. |
| B2 push | src/backend/routes/owner/push.js (new); src/backend/app.js (register only); src/backend/lib/integrations/fcm.js (new); src/backend/lib/core/contact-actions.js; src/backend/lib/core/locked-tag-nudge.js; src/backend/routes/public/index.js (register-call hook only); src/backend/lib/auth/session.js | As in section 5 | New `src/backend/tests/owner-push-fcm.test.js`; cases listed below. |
| B3 App Check | src/backend/lib/integrations/appcheck.js (new); src/backend/routes/auth/otp.js | Section 6.2, plus `code:"CAPTCHA_REQUIRED"` on the captcha-failure 400 | New `src/backend/tests/appcheck-send-otp.test.js`, with a locally generated RSA key and stubbed JWKS. A valid token skips reCAPTCHA. Expired, wrong aud, wrong sub, bad signature or a reused jti fall through to reCAPTCHA, and production rejects with `code:"CAPTCHA_REQUIRED"`. The per-destination cap still applies. |

B2 test cases (`owner-push-fcm.test.js`):
- Upsert and reassignment.
- The 10-token cap.
- DELETE is scoped to the owner.
- CSRF still blocks a foreign Origin.
- Logout and revoke-others delete tokens.
- The FCM request body has `tag`/`channel_id` under `android.notification`, and the top-level `notification` has only title and body.
- A stubbed 404 UNREGISTERED deletes the row. A stubbed 400 naming `message.token` deletes the row. A stubbed generic 400 INVALID_ARGUMENT leaves all rows.
- With WhatsApp and email both stubbed to fail, push is still sent once.
- A push failure does not change `reached` or the contact status.
- A locked attempt pushes even when `canSendUtility` is false, while the once-per-day throttle still applies.
- The payload has no run of 10 or more digits, no full plate and no tag token.
- The sender is a no-op without env.

B1 detail:
- dashboard.js:
  - Replace `phone: item.phone` (line 391) with `phoneLast4: item.phone ? String(item.phone).replace(/\D/g, "").slice(-4) : null, hasPhone: Boolean(item.phone)`.
  - Add `collections.pushTokens.deleteMany({ ownerId })` to the account-deletion `Promise.all` (lines 1491-1502).
- welcome.js: update the readers around lines 1810, 1847 and 1933 to use `phoneLast4` / `hasPhone`.
- callback-eligibility.js:59: change `!request.phone` to `!request.hasPhone`. Otherwise every web row becomes NOT_CALLABLE after B1. Update the fixtures in callback-eligibility.test.js:23, call-outcomes.test.js:23 and callback-pass.test.js:724 to use `hasPhone: true` (plus `phoneLast4` where asserted).
- login.html: add `data-hide-in-android-app` to the Google sign-in button. This is one attribute, and the web outside the app is unchanged.
- env.js: add `fcmServiceAccountJson`, `firebaseProjectNumber` and `appCheckAppIds` (comma list), each defaulting to `''`.
- .env.example: add placeholders for those three.
- helpers.js: add `FCM_` and `APPCHECK_` to the env scrub regex (line 62).
- repositories.js: add the `pushTokens` collection and indexes (TTL 120 days on `updatedAt`) and the `appCheckJti` collection (jti unique, TTL on `expiresAt`).

Env only:
- `ANDROID_APP_SHA256_FINGERPRINTS`: add the upload key SHA-256 and, after enrolment, the Play App Signing SHA-256. Never the debug key. For development, use `adb shell pm set-app-links --package me.parktag.app.debug 2 app.parktag.me` (or `pm set-app-links-user-selection --user cur --package <pkg> true app.parktag.me`).
- Railway: set `FCM_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_NUMBER` and `APPCHECK_APP_IDS` (release app id only).

Optional, not in v1:
- A deletedAt filter on `POST /api/owner/tags/:tagId/calls` (dashboard.js:1073-1077).
- An `X-Client: android` signInMethod label.
- Server-side notification preferences.
- Paginated activity.
- `tagId` on `requests[]`. The client resolves it from the token.

Not changing: CORS, owner Bearer tokens, OAuth for owners, new tag or activity endpoints, Play Billing.

---

## 10. Testing strategy

**Flutter API client** (`test/core/api_test.dart`, `MockClient`):
- The cookie is captured from Set-Cookie and replayed only to the API origin (scheme, host and port).
- No `Origin` or `Referer` header is ever sent.
- Success is decided by status: 200 `{keyId}` is success, and 404 `{error:"no_account"}` with no `ok` becomes an ApiError carrying the message.
- A 401 on vault/unlock while `/api/session` still returns an owner keeps the cookie. A 401 with `/api/session` returning null clears it.
- 429 becomes an `ApiError` carrying retry-after.
- A POST with no body sends `{}` with JSON content-type.
- `signOut()` calls `/api/auth/logout` before it wipes storage.
- Multipart upload carries the cookie, and the file part's Content-Type is one of the four allowed types.

**Parser** (`qr_parse_test.dart`):
- Accepts 12- and 64-character tokens on `/tag` and `/vehicle`, a trailing slash, and `?token=`.
- Rejects `http:`, `evil.com/tag/...`, `app.parktag.me.evil.com`, userinfo tricks, 11- and 65-character tokens, and non-alphanumeric characters.

**Bridge** (`web_bridge_test.dart`): the completion logic is a pure function `(cookie?, sessionRole?) -> finish|stay`. Cases:
- `/owner-verify` with no cookie stays.
- A cookie with a null session stays.
- A cookie with role owner finishes.

**Privacy** (`no_phone_test.dart`, `no_digital_sales_test.dart`):
- `ContactRequest.fromJson` ignores `phone`.
- `no_digital_sales_test.dart` greps `lib/` for the forbidden endpoint strings.

**Widget tests**, one per feature, with a MockClient-injected `ApiClient`:
- Scan:
  - Verify, then the message receipt.
  - The message body has optional `phone` only when the field is filled.
  - The call error map.
  - SOS on any non-2xx shows 112.
- Auth:
  - PIN success.
  - Google 404.
  - Send-otp 400 opens the bridge route.
  - Send-otp 500 shows "Get the code by SMS".
- Owner:
  - The switches call the right endpoints.
  - An activity row shows `•••• 1234`.
  - The callback error map by code (NO_PHONE links to Profile, and the server's 402 text never shows).
  - Add vehicle posts local-vehicle and shows 409.
  - The `?tag=` filter resolves through the token.
- More:
  - Membership shows no prices.
  - Delete account handles PASSWORD_REQUIRED.
- Vault:
  - 423 shows unlock.
  - The 5MB guard.
  - Unlock 401 keeps the session.
- Shop: create-order with `referralRefused` stops before Razorpay.

**Backend:** `npm test` (node --test). The new and updated test files are listed in section 9.

**Manual on device:**
- App Link from the system camera.
- Dual-SIM call routing.
- Razorpay UPI on a **release** build.
- Push in background, killed and foreground states, shown as heads-up.
- Bridge cookie capture for OTP, SMS and activation, including closing the bridge on the activation done step.
- FLAG_SECURE blocks screenshots.
- Google sign-in and native send-otp on an internal-track Play install.

## 11. Build / run commands

```bash
# P0 toolchain (once)
brew upgrade --cask flutter            # to 3.47.7
flutter config --jdk-dir=/opt/homebrew/opt/openjdk@17
flutter doctor --android-licenses
sdkmanager "system-images;android-36;google_apis_playstore;arm64-v8a"
avdmanager create avd -n pt36 -k "system-images;android-36;google_apis_playstore;arm64-v8a"
flutter emulators --launch pt36

# scaffold (unit U0)
cd /Users/girishsharma/Developer/parktag
flutter create --org me.parktag --project-name app --platforms android,ios,web app
cd app && flutter pub add http:1.6.0 http_parser:4.1.2 go_router:18.1.0 flutter_secure_storage:11.2.0 flutter_inappwebview:6.1.5 mobile_scanner:7.4.2 url_launcher:6.3.3 geolocator:14.1.1 firebase_core:5.0.0 firebase_messaging:17.0.0 firebase_app_check:0.5.0 google_sign_in:7.2.0 razorpay_flutter:1.4.7 image_picker:1.2.4 file_picker:13.1.0 qr_flutter:4.1.0

# dev
flutter run                                          # debug (me.parktag.app.debug) against production API
flutter run --dart-define=API=http://10.0.2.2:4000   # local backend (debug cleartext to 10.0.2.2 only)
adb shell pm set-app-links --package me.parktag.app.debug 2 app.parktag.me   # dev App Links without prod fingerprint
flutter test
flutter analyze
flutter build web                                    # occasional breakage check only

# release
flutter build appbundle --release             # needs android/key.properties -> upload keystore
keytool -list -v -keystore <upload keystore>  # verify SHA-256 matches assetlinks

# backend
cd /Users/girishsharma/Developer/parktag && npm test
```

`API` comes from `String.fromEnvironment('API', defaultValue: 'https://app.parktag.me')`. The cookie lock uses the scheme, host and port of `API`.

## 12. Future Flutter web

- Serve the build same-origin from `app.parktag.me` (for example under `/app/`). There is no CORS, and the CSRF Origin check accepts only APP_BASE_URL or the request host (src/backend/app.js:628-676).
- With `kIsWeb`, the ApiClient does not touch the Cookie header or secure storage. The browser carries the httpOnly cookie. The WebView bridge becomes a plain navigation.
- On web, send-otp uses the existing reCAPTCHA v3 via a small JS interop, and Razorpay uses checkout.js interop. Push is skipped at first.
- Keep `kIsWeb` branches at the call sites, with no abstraction layers.
- Keep the public scanner `/tag/:token` and `landing/` in vanilla HTML for speed. Swap the owner pages one route at a time.

## 13. Phased milestones

- **P0 Toolchain**
  - Flutter 3.47.7, JDK 17, licences, Play Store AVD.
  - Copy the upload keystore from the Windows machine to a secure location on the Mac.
  - Register the Firebase Android apps (`me.parktag.app` and `.debug`) and download `google-services.json`.
  - Create Android OAuth clients in GCP for the debug and upload certificates.
- **P1 Privacy (B1)**: ship the server phone mask, the welcome.js and callback-eligibility.js changes and the login.html attribute to production before any app build that shows Activity.
- **P2 Shell (U0, U1)**: scaffold, theme, router, ApiClient, PIN and Google sign-in, WebView bridge (Mobile OTP goes through it), onboarding and hub.
- **P3 Owner (U3, U4)**: Home, Tags, tag detail, Activity, More, delete account.
- **P4 Scan (U2)**: scanner, verify, message, call, SOS, location, activation (native path behind App Check, bridge fallback). No backend change.
- **P5 App Check (B3)**: deploy, enable the native OTP path, monitor send-otp failures.
- **P6 Push (B2, U7)**: backend, env, client.
- **P7 Vault (U5) and Shop (U6)**.
- **P8 Release**
  - Play App Signing enrolment.
  - Add the Play App Signing SHA-1 and SHA-256 to Firebase `parktag1` and to a Play-signing Android OAuth client.
  - Add the SHA-256 to `ANDROID_APP_SHA256_FINGERPRINTS`.
  - Link the GCP project under Play Console > App integrity and enable the Play Integrity API.
  - Fill in the Data Safety form, including the web deletion URL.
  - Internal testing track. Verify Google sign-in, native send-otp, App Links and Razorpay on the Play-installed build.
  - Production.
  - Retire the Bubblewrap TWA project.

## 14. Risks

- App Check is on the critical path for native sign-up. The bridge covers the gap, but reCAPTCHA v3 scores inside a WebView may be low. Measure in beta.
- If B1 ships late, Activity must stay hidden. The client also ignores `phone`.
- If the upload keystore is lost or mismatched, App Links verification breaks. If the Play App Signing key is missing from Firebase or GCP, Google sign-in and App Check fail only on Play installs. P8 verifies this on the internal track.
- On dual-SIM phones, a call from the other SIM fails to route (src/backend/routes/webhooks/exotel.js:74,144). The app shows a warning before dialling.
- Carrier NAT can share per-IP rate limits (src/backend/app.js:884-918). The app shows the 429 message and retry-after.
- Activity is capped at 10 rows (src/backend/routes/owner/dashboard.js:212-216). This is accepted for v1.
- The FlutterFire packages are 3 days old. Pin them, and roll back the whole release train if needed.
- R8 can strip Razorpay or other reflection-based SDK classes. Keep rules plus a release-build payment test cover this.