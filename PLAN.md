# WaveTag Prototype Plan

This file is the working execution plan for the WaveTag prototype.

If `PLAN.md` and `docs/RFA_SPEC.md` differ, use `PLAN.md` for prototype implementation decisions.

`docs/RFA_SPEC.md` remains reference context, but this file is the simpler build direction.

## 1. Prototype Goal

Build a working WaveTag prototype that can be demonstrated to a supervisor.

The prototype must:

- let a person scan a QR code and reach the correct web flow
- let a scanner contact a vehicle owner without seeing the owner's private number
- give the owner a simple authenticated dashboard
- give the admin a simple laptop-friendly control or verification view
- stay easy to deploy, easy to verify, and easy to keep building

## 2. Prototype Principles

- keep the tech stack minimal
- prefer one backend server over multi-service architecture
- avoid Redis and similar optimization-driven infrastructure for the prototype
- prefer simple HTML, CSS, and JavaScript for the frontend unless complexity proves otherwise
- keep verification UI-driven whenever practical
- prioritize readable code over clever architecture
- protect private phone numbers and sensitive owner data

## 3. Users

### Scanner

The scanner is a public user who scans a QR code from a phone.

Needs:

- no app install
- no account creation
- fast page load
- clear call-to-action
- privacy-safe contact flow

### Owner

The owner is the person who has registered the vehicle tag.

Needs:

- register as a new owner directly from the website
- claim or register a tag
- receive a QR code after registration
- download the QR code digitally or request a physical sticker from the company
- log in securely
- view vehicle or tag status
- switch the tag between active and inactive
- manage basic profile details needed for the prototype

### Admin

The admin is the operator verifying that the system works.

Needs:

- sign in from a laptop browser
- issue unclaimed tags and QR stickers for owners
- inspect key records or status
- verify tags, owners, and recent activity in a simple way

## 4. MVP Scope

### In Scope

- unique QR per tag
- one backend token per QR
- admin-issued unclaimed tag flow
- owner self-registration flow
- QR generation for issued or newly registered tags
- owner claim flow
- scanner landing page
- scanner action flow for contact
- owner authentication
- owner dashboard with active or inactive toggle
- admin authentication
- admin verification UI
- backend API for scanner, owner, and admin flows
- hosted deployment on a practical free or low-cost platform
- responsive browser support for mobile and laptop
- simple manual verification UI that grows with the project

### First Demo Slice

The first end-to-end demo slice should optimize for visible progress and simple verification.

It is:

1. Admin seeds or creates one owner, one tag, and one QR token.
2. Owner signs in and confirms the tag is active.
3. Scanner scans the QR on a mobile browser and opens the public tag page.
4. Scanner enters a phone number and submits a contact request.
5. Backend stores the request in MongoDB and returns a clear success state.
6. Owner dashboard shows the new request after refresh.
7. Admin dashboard shows the recent request for verification.

This first slice is intentionally UI-verifiable and does not depend on live telephony.

### Deferred Unless Needed

- Redis
- edge runtime optimization
- multi-store architecture
- live Exotel call bridging in the very first demo slice
- masked WhatsApp recovery in the very first demo slice
- SOS disclosure in the very first demo slice
- advanced rate limiting
- push notifications
- native mobile apps
- multi-language support
- advanced analytics
- production-grade scaling work

## 5. Minimal Tech Direction

Use the smallest stack that supports the prototype clearly.

Current direction:

- code location: keep application code under `src/`, with backend code in `src/backend/` and frontend code in `src/frontend/`
- backend: one deployable Node.js `Fastify` server in `src/backend/`
- frontend: simple HTML, CSS, and JavaScript in `src/frontend/`, served by the backend or alongside it
- persistence: `MongoDB` as the single prototype database
- auth: minimal but real server-side authentication for owner and admin users
- hosting target: `Railway` for the backend app and `MongoDB Atlas M0` for the initial prototype database
- telephony: Exotel for call bridging when that slice is reached
- business messaging: WhatsApp Business Platform Cloud API for owner-message delivery when that slice is reached

Avoid adding more infrastructure unless the prototype is blocked without it.

## 6. Product Flows

### Flow A: Scanner Contact Flow

1. Scanner scans QR code.
2. Backend resolves the token and tag state.
3. If the tag is active, open a guided mobile-first scanner flow instead of a raw single-form page.
4. If the tag is unclaimed, open the owner registration shell first.
5. If the tag is inactive, also open the owner registration shell first.
6. If the tag is already claimed and active, open a guided mobile-first scanner flow.
7. Page 1 is a short landing or verification shell.
8. Page 1 should show the owner or car last 4 digits as the visible vehicle confirmation.
9. Page 1 should ask only for the scanner's phone number before moving forward.
10. Page 2 is the owner contact action hub.
11. Page 2 should use large, clear action buttons and minimal text.
12. Current scanner action-hub options in the MVP are:
   - `Call Owner`
   - `Leave WhatsApp Message`
13. `Leave WhatsApp Message` in the MVP means a WhatsApp-backed owner message flow, not SMS.
14. The scanner page should show a masked vehicle number such as `####8251`, not the full number.
15. The call action should show a waiting or popup state such as `You will be receiving a call sooner`.
16. The scanner UI should stay clean, readable, structured, and minimal-utility in style.
17. Backend handles the selected contact path without exposing the owner's private number.
18. Future scanner ideas such as `Contact Local Authorities`, `Help`, or vehicle image upload should be recorded as deferred and should not be treated as current MVP behavior.

### Flow B: Owner Claim Flow

1. Owner opens the tag URL for an unclaimed tag.
2. Owner completes claim or registration.
3. Backend links the tag to the owner.
4. Owner can sign in and manage the tag from the dashboard.

### Flow C: Owner Self-Registration Flow

1. A new owner opens the registration page directly.
2. Owner creates an account and enters vehicle details.
3. Backend creates a new owner-linked tag and token.
4. Backend generates a QR output for the owner.
5. Owner can download the QR or request a physical sticker from the company.

### Flow D: Owner Control Flow

1. Owner signs in.
2. Owner opens the dashboard.
3. Owner views tag or vehicle state.
4. Owner toggles active or inactive status.

### Flow E: Admin Issuance Flow

1. Admin signs in on a laptop browser.
2. Admin creates or issues one or more unclaimed tags in a batch.
3. Admin enters batch metadata, not owner personal details.
4. Backend generates QR output and claim URLs for those tags.
5. Admin uses that output for physical sticker handoff to the owner.

### Flow F: Admin Print Queue Flow

1. Admin opens the print queue.
2. Admin sees unclaimed and unprinted tags grouped by issuance data.
3. Admin shares that list with the printing company.

### Flow G: Admin Verification Flow

1. Admin signs in on a laptop browser.
2. Admin opens a simple verification view.
3. Admin can inspect prototype-safe operational data.

### Flow H: WhatsApp Recovery Messaging Flow

1. Scanner opens an active or unavailable tag flow and enters a phone number.
2. Scanner chooses the message path and writes a short recovery message.
3. Backend validates the request and stores a privacy-safe outbound message attempt.
4. Backend sends the message through the WhatsApp Business Platform Cloud API.
5. Backend records the immediate API response and later delivery or failure updates from the webhook.
6. Owner and admin dashboards show message-attempt state without exposing unsafe internal secrets.

### Flow I: Owner Callback Flow

1. A scanner contacts the owner (contact request is stored in `contactRequests` with the scanner's phone).
2. Owner opens the dashboard and sees the contact request with a "Call Back" button.
3. Owner taps "Call Back" — no phone input required. Owner's phone comes from `owner.mobile` on their profile.
4. Frontend calls `POST /api/owner/callback/register-call` (authenticated). No body needed.
5. Backend checks that a contact request for this owner exists with `createdAt >= now - 60min`. If not, returns `410 CALLBACK_WINDOW_EXPIRED`.
6. Backend picks the **most recent** contact request within the 60-minute window as the callback target.
7. Backend stores a pending call record `{ callerPhone: toE164(ownerPhone), targetPhone: scannerPhone, type: "owner_to_scanner", expiresAt: +10min }`.
8. Backend returns `{ virtualNumber }` — the same shared Exotel ExoPhone (`08047284348`) used by the scanner flow.
9. Frontend opens `tel:<virtualNumber>` — native phone dialer with the virtual number pre-filled.
10. Owner dials. Exotel receives the call with owner's phone as the A-party in trunk-prefix format (`0XXXXXXXXXX`).
11. Exotel hits `GET /api/exotel/dial-whom?CallFrom=0<ownerDigits>`.
12. `toE164("0XXXXXXXXXX")` → `+91XXXXXXXXXX` — matches `callerPhone` stored in step 7.
13. Backend looks up `pendingCalls` by `callerPhone` → returns `toE164(targetPhone)` (scanner's phone in E.164). Marks record `consumed: true`.
14. Exotel bridges the call: owner ↔ scanner. Neither side sees the other's real number.

#### Known behaviours and constraints

- Exotel sends `CallFrom` in trunk-prefix format (`08XXXXXXXXXX`, 11 digits with leading `0`). The `toE164()` function in `exotel.js` handles this: strips the leading `0` and prepends `+91`.
- `targetPhone` may be stored without country code in MongoDB (e.g. `7017737354`). Always pass through `toE164()` before returning to Exotel to guarantee E.164 format.
- The dial-whom endpoint always returns HTTP 200 (empty body when no match). This is required so Exotel's App Bazaar URL validation passes — a 404 causes Exotel to reject the URL configuration.
- Owner must have `mobile` saved on their profile. Without it the backend returns `402 NO_PHONE` and the UI shows a prompt to add their phone number before callback is available.

#### 60-minute window rules

- The window is measured from the scanner's `contactRequest.createdAt`, not from when the owner opens the dashboard.
- If multiple scanners contact the owner within the window, the callback always targets the **most recent** one.
- After 60 minutes with no new contact, the "Call Back" button returns `410` and the UI shows a "window has passed" message.
- When a new scanner contacts the owner, the 60-minute window resets to that scanner's contact time.

#### Unified pendingCalls schema

Both the scanner flow and the owner callback flow write to the same `pendingCalls` collection with the same shape:

```
{
  callerPhone:  <whoever dials the virtual number>,
  targetPhone:  <whoever Exotel connects them to>,
  token:        <tag token>,
  ownerId:      <ObjectId>,
  type:         "scanner_to_owner" | "owner_to_scanner",
  requestId:    <contactRequest ObjectId — set only for owner_to_scanner>,
  consumed:     false,
  expiresAt:    <now + 10 min>
}
```

The `GET /api/exotel/dial-whom` webhook always looks up by `callerPhone = CallFrom`. No special casing is needed for direction — the schema handles both cases identically.

## 7. Security Direction

For the prototype, keep security simple but real.

### Auth Model

- scanner routes stay public and unauthenticated
- owner users sign in with a server-managed account created during claim or setup
- admin signs in with a seeded admin account
- authenticated browser sessions use secure HTTP-only cookies
- backend authorization is role-based: `owner` and `admin`
- owner routes must be restricted to the signed-in owner's own records only
- Google Sign-In is login-only — it never auto-creates a new owner account; if no owner exists with the Google email, login is rejected with a clear error message ("No ParkTag account found for this Google account. Please register first.")

Rules:

- do not expose owner private phone numbers in public pages
- do not expose secrets in frontend code
- keep scanner routes public only where required
- require authentication for owner and admin pages
- require authorization checks on protected backend routes
- validate all input on the server
- keep debug and verification UI free of unsafe internal data
- keep WhatsApp access tokens, phone number IDs, and webhook verification secrets on the server only

## 8. UI Direction

The UI should be simple and continue growing with the project.

Rules:

- scanner flow must work well on mobile browsers
- owner flow must work on mobile and laptop browsers
- admin flow must work well on laptop browsers
- scanner flow is mobile-first and laptop-compatible for testing
- admin flow is laptop-first and mobile support is not a first-slice priority
- all core flows should stay easy to verify manually through the UI
- avoid over-designed frontend architecture for the prototype

### Minimum UI Surfaces

- public tag page for scanner or owner-claim entry based on tag state
- scanner verification page as the first guided mobile step
- scanner action hub page as the second guided mobile step
- owner self-registration page
- owner login page
- owner dashboard page
- admin login page
- admin dashboard page
- admin tag issuance page
- admin print queue page or print queue section
- WhatsApp message-attempt visibility in owner and admin surfaces when the messaging slice is active

### Minimum Backend Surfaces

- token resolve route
- owner claim route
- owner self-registration route
- auth login, logout, and session routes
- contact-request creation route
- WhatsApp message-request creation route
- WhatsApp status-webhook route
- owner dashboard data route
- owner tag-status update route
- admin overview route
- admin tag issuance route
- QR generation or QR asset delivery route
- admin print queue route

### Deferred Scanner UX Feature

Do not implement this in the current MVP:

- scanner-side `Contact Local Authorities` action
- scanner-side `Help` action
- scanner-side vehicle image upload

If kept in planning or tracker docs, record it only as a deferred feature.

## 9. Deployment Direction

The prototype needs a real hosted backend.

Current direction:

- choose a practical free or low-cost platform
- primary deployment target: `Railway` (migrated from Render)
- primary database target: `MongoDB Atlas M0`
- keep deployment simple
- avoid architecture choices that require multiple managed services for the first prototype
- make the deployed app usable from a QR-driven mobile browser flow

### 9.1 Scaling Plan — Multi-Server Rate Limiting

**Current state (single server):**
The rate limiter (`@fastify/rate-limit`) stores counters in Node.js process memory. On a single Railway instance this works correctly — every request hits the same process, counters are accurate.

**The problem when scaling to 2+ servers:**
Railway (and any platform) can run multiple instances of the same service for load balancing. When that happens, each server has its own in-memory counter. A user making 60 requests could have them split across Server A (30 requests) and Server B (30 requests) — both think the user is within limit. The rate limiter silently stops working.

The same problem also applies to:
- In-memory session store (`app.decorate("sessions", new Map())`) — a user's session only exists on the server that created it; the next request might hit a different server and see no session
- In-memory OAuth state store (`app.decorate("oauthStates", new Map())`)

**Action plan — what to do before scaling:**

Step 1 — Add Redis to Railway
- Provision a Railway Redis plugin (one click in the Railway dashboard)
- Railway injects `REDIS_URL` automatically as an environment variable
- Verify: `REDIS_URL` appears in Railway service variables

Step 2 — Replace in-memory rate limit store with Redis
- Install `@fastify/rate-limit` Redis store adapter: `npm install @fastify/rate-limit ioredis`
- Update `app.js` rate limit registration:
  ```js
  import Redis from "ioredis";
  const redis = env.redisUrl ? new Redis(env.redisUrl) : null;

  await app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: "1 minute",
    redis,                        // null = falls back to in-memory (single server safe)
    errorResponseBuilder: () => ({ ok: false, error: "Too many requests. Please slow down." })
  });
  ```
- Verify: deploy 2 instances on Railway, hammer one instance past the limit, confirm the second instance also blocks (counters are shared)

Step 3 — Replace in-memory session store with Redis
- Replace `app.decorate("sessions", new Map())` with a Redis-backed session map
- Replace `app.decorate("oauthStates", new Map())` with Redis keys with a short TTL
- Verify: log in on one server instance, make an authenticated request that routes to a different instance, confirm session is still valid

Step 4 — Add `REDIS_URL` to env schema
- Update `lib/env.js` to read `REDIS_URL` (optional — falls back gracefully on single-server dev)
- Verify: app starts without Redis locally (no `REDIS_URL` set), rate limiting still works via in-memory fallback

**Verification checklist (before going multi-server):**
- [ ] `REDIS_URL` present in Railway environment variables
- [ ] Rate limit counters survive across server restarts (Redis persists them)
- [ ] Authenticated session survives a request routed to a different instance
- [ ] OAuth state token survives a callback routed to a different instance than the one that created it
- [ ] App starts and runs correctly locally without `REDIS_URL` (in-memory fallback)

**When to do this:**
Not needed for the prototype or early production. Do this before Railway auto-scaling is enabled or before manually adding a second instance. A single Railway instance handles hundreds of concurrent users without needing this.

## 10. Verification Strategy

Prefer verification through the UI whenever practical.

Each completed slice should ideally be checkable by:

- opening a page in a browser
- performing a simple action
- seeing a clear result

Backend-only verification is still allowed where necessary, but it should not be the default if a simple UI can verify the same slice.

## 11. Working Order

Build in this order:

1. lock the prototype flows and minimal stack
2. implement the deployable backend server
3. implement the scanner UI
4. implement owner auth and dashboard UI
5. implement admin auth and verification UI
6. harden security boundaries
7. validate telephony and WhatsApp recovery behavior
8. deploy and rehearse the demo

## 13. New Vehicle Registration & Tag Allocation Policy

When an existing owner registers an additional vehicle, the system follows the same tag allocation flow as first-time registration. Each vehicle always gets exactly one real E-Tag.

### How it works

1. Owner visits `/register-owner` and enters a new vehicle type and plate number.
2. On submit, the backend calls `createEtagForVehicle()` which creates a new tag document in MongoDB with:
   - a unique 256-bit secure token
   - `status: "active"`
   - `freeContactUsed: false`
   - `premium: false`
   - `purchaseStatus: "none"`
3. The new tag appears immediately on the owner dashboard alongside any existing vehicles.
4. If the API save fails during registration (network error etc.), the vehicle is temporarily stored in `localStorage` and auto-synced to the database on the next dashboard load.

### Free contact rule (per vehicle, per tag)

Each E-Tag includes **one free masked contact**:

- A scanner scans the QR and contacts the owner → `freeContactUsed` is set to `true`.
- The next scanner who tries to contact gets blocked with a `402 FREE_USED` response.
- The contact page shows `contactAvailable: false` for that tag.
- The owner must purchase the official physical sticker (premium upgrade) to unlock unlimited contact for that vehicle.
- Purchasing premium sets `premium: true` on the tag, which bypasses the `freeContactUsed` gate permanently.

### Key rule

This applies **per vehicle**. Each additional vehicle the owner registers gets its own fresh `freeContactUsed: false` — the free contact is not shared or carried over from other vehicles. Adding a new vehicle always starts a new free contact slot for that vehicle.

## 14. Exotel Requirements for M13 Inbound Call Flow

> Everything Exotel-related needed to make the Call Owner and Owner Callback features work. Nothing here is code — it is account setup, dashboard config, and env vars.

---

### 14.1 Exotel Account Prerequisites

| Requirement | Details |
|---|---|
| Active Exotel account | Must be a paid/activated account — sandbox alone is not enough for live calls |
| At least one ExoPhone number | This becomes the shared virtual number that both scanner and owner dial |
| App Bazaar access | Needed to create and configure the Passthru app |
| API credentials | Already in use for WhatsApp — same `ACCOUNT_SID`, `API_KEY`, `API_TOKEN` |

---

### 14.2 App Bazaar — Passthru App Configuration (one-time)

Navigate to: **Exotel Dashboard → App Bazaar → Passthru**

Create a new Passthru app and fill in:

| Field | Value |
|---|---|
| **App Name** | `ParkTag Inbound Router` (or any label) |
| **Dial Whom URL** | `https://app.parktag.me/api/exotel/dial-whom` |
| **Dial Whom Method** | `GET` |
| **Time Limit** | `40` (max call duration in seconds — adjust as needed) |
| **Time Out** | `20` (ring timeout before giving up) |
| **Record Call** | Optional — enable if call recordings are needed |
| **StatusCallback URL** | `https://app.parktag.me/api/provider/exotel/webhook` |
| **StatusCallback Method** | `POST` |

After saving, go to: **Exotel Dashboard → Numbers → ExoPhones**

- Pick any available ExoPhone number
- Assign it to the Passthru app created above
- Copy the number — this becomes `EXOTEL_VIRTUAL_NUMBER`

---

### 14.3 Environment Variables

| Variable | Where it comes from | Purpose |
|---|---|---|
| `EXOTEL_CALLER_ID` | The ExoPhone assigned to the Passthru app (already set) | Returned to frontend so scanner/owner knows what number to dial — also used as the virtual number for inbound routing |
| `EXOTEL_ACCOUNT_SID` | Exotel Dashboard → Settings | Already present — used for API auth |
| `EXOTEL_API_KEY` | Exotel Dashboard → Settings | Already present — used for API auth |
| `EXOTEL_API_TOKEN` | Exotel Dashboard → Settings | Already present — used for API auth |
| `EXOTEL_STATUS_CALLBACK_URL` | Set to `https://app.parktag.me/api/provider/exotel/webhook` | Already present — receives call status events |

> No new env vars needed. `EXOTEL_CALLER_ID` doubles as the virtual number. `EXOTEL_VIRTUAL_NUMBER` was removed — do not add it.

---

### 14.4 What Exotel Sends to the Dial Whom Endpoint

When a caller dials the virtual number, Exotel makes:

```
GET /api/exotel/dial-whom
  ?CallSid=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  &CallFrom=+919876543210          ← A-party (the person who dialled)
  &CallTo=0xxxxxxxxxx              ← the virtual number that was dialled
  &Direction=inbound
  &AccountSid=<your-account-sid>
```

The backend reads `CallFrom` as the lookup key into `pendingCalls.callerPhone`.

---

### 14.5 What the Dial Whom Endpoint Must Return

Exotel expects a plain-text phone number in the response body (E.164 or 10-digit Indian format). No JSON, no XML.

```
+919999999999
```

HTTP status must be `200`. Any non-200 or empty body causes Exotel to play a busy tone to the caller.

---

### 14.6 What Exotel Sends to the Status Callback

After the call ends (or fails), Exotel POST-s to `EXOTEL_STATUS_CALLBACK_URL`:

```
POST /api/provider/exotel/webhook
  CallSid=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  CallStatus=completed              ← or no-answer, busy, failed
  DialCallStatus=completed
  ConversationDuration=45           ← seconds
  RecordingUrl=https://...          ← if recording was enabled
  Direction=inbound
```

This endpoint already exists and updates the matching `contactRequests` record via `CustomField`. For inbound calls, the link is via `CallSid` stored on the pending call record.

---

### 14.7 Testing Before Going Live

1. Use Exotel's **sandbox/test mode** in App Bazaar to simulate an inbound call and confirm the Dial Whom URL returns the correct number.
2. Dial the virtual number from a real phone — confirm the native dialer opens and Exotel bridges the call.
3. Let the call complete — confirm the `contactRequests` record is updated with `callResult` and `callDuration` from the status callback.

---

## 15. Google OAuth Configuration

### 15.1 Why this matters

The popup-based Google Sign-In flow requires the requesting origin to be explicitly whitelisted in Google Cloud Console. Without it, the popup opens and the user selects their account, but Google silently drops the auth code — `handlePopupCode` never fires and nothing happens on the page (no error, no redirect).

### 15.2 Authorized JavaScript Origins

Navigate to: **Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID**

Under **Authorized JavaScript origins**, add all origins that serve the login page:

| Origin | Purpose |
|---|---|
| `https://app.parktag.me` | Production |
| `http://localhost:4000` | Local dev |
| `http://127.0.0.1:4000` | Local dev (alternate) |

### 15.3 Authorized Redirect URIs

Under **Authorized redirect URIs**, ensure all of these are present:

| URI | Purpose |
|---|---|
| `https://app.parktag.me/api/auth/google/callback` | Production redirect flow |
| `http://localhost:4000/api/auth/google/callback` | Local dev redirect flow |
| `postmessage` | Popup code exchange (required for `ux_mode: "popup"`) |

> `postmessage` is a special value required for popup-based OAuth code flows. Without it the server-side token exchange at `/api/auth/google/popup` returns `redirect_uri_mismatch` from Google.

### 15.4 Railway environment variables

All three must be set:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID from Console |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret from Console |
| `GOOGLE_CALLBACK_URL` | `https://app.parktag.me/api/auth/google/callback` |

### 15.5 How the login page selects a flow

1. On page load, the frontend fetches `GET /api/auth/google/config` to get `clientId`.
2. If `GOOGLE_CLIENT_ID` is set in Railway → all Google routes are registered → popup flow is used.
3. If `GOOGLE_CLIENT_ID` is missing → routes are not registered → button falls back to `window.location.href = "/api/auth/google"` (redirect flow).
4. Both flows require the Console config above. The popup flow additionally requires the JS origin to be whitelisted.

### 15.6 Propagation delay

Google Cloud Console changes take **2–5 minutes** to propagate globally. Saving and testing immediately may still fail. Wait, then retry.

---

## 16. Open Questions for Client

These are unresolved product decisions that need a client answer before implementation can be finalised. Each item describes the current behaviour, the ambiguity, and the options.

---

### Q1 — Which dashboard toggles need a real backend?

**Current behaviour:**
Only the Tag Active toggle saves to the server (`POST /api/owner/tags/:tagId/status`). All other toggles in the burger menu save only to the device's localStorage:
- Calls Active
- Call Masking (disable/enable number masking)
- Push Notifications
- Email Alerts
- WhatsApp Alerts
- Location Access

**Problem:** If the owner opens the dashboard on a different phone or clears their browser, all these settings are lost silently.

**Question:** Which of the above toggles must save to the server (persist across devices)? For those that do, does a backend API already exist, or does it need to be built?

---

### Q2 — Contact Requests section: what should it look like and where does it go?

**Current behaviour:**
The dashboard API already returns a `requests` array — the last 10 scanner contact attempts (who called, when, which vehicle, call result). This data is fetched but nothing on the dashboard displays it. A contact requests UI was built once and reverted.

**Question:**
- Should recent contact attempts be visible on the owner dashboard? If yes, where — as a section below the vehicle grid, a separate tab, inside the notice board sidebar, or as a notification panel behind the bell icon?
- What fields should each row show? (e.g. date/time, masked scanner number, vehicle plate, call result, callback button)
- Should the "Call Back" button be part of this section (as per Flow I in §6)?

---

### Q3 — Shop vs Premium Upgrade: are these two separate products?

**Current behaviour:**
There are two separate payment flows:
1. **Shop tab** (`/api/shop/*`) — sells physical ParkTag stickers delivered by post. Products: Car Tag ₹399, Bike Tag ₹349, Combo ₹699. Does not change any existing tag's `premium` field.
2. **Vehicle-detail Premium button** (`/api/owner/tags/:tagId/purchase-*`) — upgrades a specific existing digital tag for ₹199. Sets `premium: true` on that tag, enabling unlimited masked contact.

**Question:**
- Are these genuinely two separate products (physical sticker = new hardware; ₹199 upgrade = digital unlock for an existing tag)?
- Or should buying from the shop also mark the matching registered vehicle's tag as premium?
- What happens if an owner buys the physical sticker but already has the vehicle registered digitally — do they need to pay the ₹199 separately to unlock unlimited contact, or does the physical sticker purchase cover it?

---

### Q4 — SOS Emergency Contact: should it save to the server?

**Current behaviour:**
The emergency contact phone number entered in the burger menu (and on the vehicle-detail page) is stored only in the browser's localStorage keyed by vehicle plate number. If the owner logs in from a different device or clears storage, the SOS number is gone.

**Question:**
- Should the SOS number be saved to the backend (on the tag or owner document) so it persists across devices and can be shown to scanners in an emergency?
- If yes, does a backend field and API endpoint already exist for this, or does it need to be added?

---

### Q5 — Notification bell: what should it open?

**Current behaviour:**
The bell icon in the dashboard header is a non-functional button. Nothing happens when tapped.

**Options:**
1. Open a slide-down panel showing recent contact requests (same data as Q2 above).
2. Open a notification preferences screen (Push, Email, WhatsApp settings).
3. Show a badge count of unread scan events and open a list of those events.
4. Defer — keep it non-functional for now.

**Question:** Which of the above should the bell do, and is there a priority order if multiple are wanted eventually?

---

## 12. Living Document Rule

Keep this file updated as the prototype direction changes.

If a task reveals a better simpler path:

- update `PLAN.md`
- update `TASKS.md`
- record side tasks or newly discovered work immediately
