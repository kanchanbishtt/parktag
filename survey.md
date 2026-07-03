# ParkTag / WaveTag — Project Survey

> Generated: 2026-06-28
> Stack: Fastify + MongoDB Atlas + vanilla HTML/CSS/JS
> Deployment target: Render (render.yaml present; no Vercel config found yet)

---

## Login Credentials

### Demo Accounts (seed with `npm run seed:demo` or `POST /api/demo/seed`)

| Role  | Email                  | Password   |
|-------|------------------------|------------|
| Owner | `owner@wavetag.local`  | `demo1234` |
| Admin | `admin@wavetag.local`  | `demo1234` |

Demo phone number: `+910000000001`
Demo vehicle: `Demo Honda City` — plate `DL01AB1234`

> These accounts only exist after seeding. They are development-only (`dev_` collection prefix). Run `npm run seed:demo` each time you wipe the DB.

---

## Feature Status Map

### Working End-to-End

These features have a real frontend, real backend route, and real database work — confirmed complete.

| Feature | Frontend Page | Backend Route |
|---------|--------------|---------------|
| Scanner — verify vehicle (last 4 digits) | `index.html` | `POST /api/tags/:token/verify` |
| Scanner — call owner (Exotel) | `index.html` | `POST /api/contact-requests` |
| Scanner — WhatsApp alert to owner (Meta) | `index.html` | `POST /api/contact-requests` |
| Claim unclaimed tag | `index.html` (registration shell) | `POST /api/tags/:token/claim` |
| Owner self-registration | `register-owner.html` | `POST /api/register-owner` |
| Owner login — OTP via WhatsApp | `owner-login.html` | `POST /api/auth/send-otp` + `verify-otp` |
| Owner login — OTP via Email | `owner-login.html` | `POST /api/auth/send-otp` + `verify-otp` |
| Owner login — Google OAuth | `owner-login.html` | `GET /api/auth/google` → callback |
| Owner login — Firebase Phone Auth | `owner-login.html` | `POST /api/auth/firebase-phone/*` |
| Owner dashboard — view tags + requests | `owner.html` | `GET /api/owner/dashboard` |
| Owner — toggle tag active/inactive | `owner.html` | `POST /api/owner/tags/:tagId/status` |
| Owner — buy premium sticker (Razorpay) | `owner.html` | `POST /api/owner/tags/:tagId/purchase-order` + `purchase-verify` |
| Owner — request physical sticker print | `owner.html` | `POST /api/owner/tags/:tagId/request-sticker` |
| Password reset (email token) | `forgot-password.html` / `reset-password.html` | `POST /api/auth/forgot-password` + `reset-password` |
| Admin login | `admin.html` | `POST /api/auth/login` |
| Admin overview dashboard | `admin-overview.html` | `GET /api/admin/overview` |
| Admin — list/search all tags | `admin-etags.html` | `GET /api/admin/etags` |
| Admin — tag detail + contact logs | `admin-etags.html` | `GET /api/admin/etags/:tagId` |
| Admin — toggle tag status | `admin-etags.html` | `POST /api/admin/etags/:tagId/status` |
| Admin — issue unclaimed tag batch | `admin-issuance.html` | `POST /api/admin/tags/issue` |
| Admin — print queue (list, export, mark printed) | `admin-print-queue.html` | `GET/POST /api/admin/print-queue*` |
| Admin — owner monitoring | `admin-owners.html` | `GET /api/admin/owners` |
| Admin — activity log | `admin-activity.html` | `GET /api/admin/activity` |
| Admin — create new admin | `admin-admins.html` | `POST /api/admin/admins` |
| Demo seed | `verify.html` | `POST /api/demo/seed` |

---

### Fake / UI Exists But Not Working

These components have a visible frontend but will fail or silently do nothing at runtime.

| Component | Problem |
|-----------|---------|
| **Google login button** | Shows on `owner-login.html` even when `GOOGLE_CLIENT_ID` is not set — clicking it returns an error from the backend |
| **Firebase phone login** | Shows on `owner-login.html` even when `FIREBASE_API_KEY` / `FIREBASE_PROJECT_ID` are missing — returns 503 on attempt |
| **Buy sticker button** | Shows on owner dashboard even when Razorpay is not configured — clicking returns a 503 "Payments not configured" error |
| **Password reset email** | Sends success response to user even if the email never actually delivered (fire-and-forget, no delivery confirmation) |
| **Exotel SMS** | `triggerExotelSms()` exists in `lib/exotel.js` and env vars are defined, but it is **never called** — there is no UI path that sends an SMS |
| **Exotel webhook status write-back** | Webhook at `/api/provider/exotel/webhook` receives call results from Exotel but writes raw Exotel status strings (`completed`, `busy`) directly to `contactRequests.status` — clashes with internal model (`pending`, `provider_started`, `provider_failed`), breaking owner/admin status display |

---

### Features Still Needed (Not Implemented)

| Feature | Notes |
|---------|-------|
| **Mobile browser cross-device verification** | Scanner, owner portal, registration flows not yet manually verified on a real phone |
| **WhatsApp delivery status callbacks** | No webhook route to receive Meta delivery/read receipts — owner and admin never see if message was actually delivered |
| **Live Exotel call end-to-end test** | Call trigger code exists but has never been run against real Exotel credentials |
| **Exotel webhook status mapping** | Raw Exotel status strings must be mapped to internal model before writing to DB |
| **Exotel webhook ObjectId guard** | `new ObjectId(customField)` has no validation — bad webhook calls silently disappear |
| **Feature flags from runtime status** | Frontend should hide Google/Firebase/Razorpay UI when those integrations are not configured (check `/api/runtime/status`) |
| **Demo script** | No written end-to-end demo walkthrough for client/supervisor |
| **Operator runbook** | No setup + manual verification doc for handing off to another contributor |
| **Security hardening (M6)** | Full frontend + backend security review not done (XSS, data leakage, input validation audit) |
| **Exotel audit trail** | Admin action logs do not capture tag status changes or batch deletions |
| **Razorpay retry** | If a Razorpay order expires, owner must re-click with no guidance — no retry UX |
| **Deferred scanner features** | `Contact Local Authorities`, `Help`, vehicle image upload — intentionally deferred |
| **WhatsApp approved message template** | `sendMetaWhatsapp()` sends free-form text — only works inside a 24-hour WhatsApp window; needs an approved Meta template for cold outreach |
| **`parktag_login` OTP template approval** | OTP via WhatsApp uses a template named `parktag_login` — must be created and approved in Meta Business Manager |

---

## Configuration Left To Do

### Critical — App Will Not Start / Core Features Break

| Variable | Used For | Status |
|----------|---------|--------|
| `MONGODB_URI` | Database connection — everything | **Must set** |

### Important — Features Silently Disabled Without These

| Variable(s) | Feature Affected | What Breaks |
|-------------|-----------------|-------------|
| `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID` | Masked voice calls | "Call Owner" fails for every scanner |
| `EXOTEL_STATUS_CALLBACK_URL` | Exotel call result write-back | Webhook never fires; call status stays `pending` forever |
| `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN` | WhatsApp alerts + WhatsApp OTP login | Scanner WhatsApp action fails; WhatsApp login method broken |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Premium sticker purchase | Buy button returns 503 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Google OAuth login | Google login button errors on click |
| `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID` | Firebase phone login | Phone login returns 503 |
| `EMAIL_SMTP_HOST`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASS`, `EMAIL_FROM` | Password reset emails + email OTP | Emails never arrive (no crash, silent failure) |

### Optional / Dev Only

| Variable | Purpose |
|----------|---------|
| `MONGODB_COLLECTION_PREFIX` | Set to `dev_` locally to separate from prod data |
| `APP_ENV` | `dev` locally, `production` on server |
| `PORT` | Defaults to `3000` |
| `MONGODB_DB_NAME` | Defaults to `wavetag` |
| `EXOTEL_SMS_SENDER_ID`, `EXOTEL_SMS_DLT_ENTITY_ID`, `EXOTEL_SMS_TEMPLATE_ID` | Exotel SMS — defined but SMS is dead code, not wired to UI |

---

## Integration Status

| Integration | Purpose | Code Complete | Env Vars Set | Live Tested | Notes |
|-------------|---------|:---:|:---:|:---:|-------|
| **MongoDB Atlas** | Database | Yes | Yes | Yes | Working in prod |
| **Exotel — Voice Call** | Masked call scanner→owner | Yes | No | No | Needs real creds + live test |
| **Exotel — WhatsApp** | WhatsApp via Exotel (old path) | Partial | No | No | Superseded by Meta path |
| **Exotel — SMS** | SMS alerts | Dead code | No | No | Never wired to UI |
| **Meta WhatsApp** | WhatsApp scanner alerts + OTP login | Yes | No | No | Needs approved template for cold outreach |
| **Razorpay** | Physical sticker payment | Yes | No | No | Flow complete; needs live keys |
| **Gmail SMTP** | Password reset + OTP email | Yes | No | No | Fire-and-forget; silent on failure |
| **Google OAuth2** | Social login | Yes | No | No | Button shows even when unconfigured |
| **Firebase Phone Auth** | Phone number login | Yes | No | No | Returns 503 when unconfigured |

---

## Exotel Code Issues — Found June 2026 (from WaveTag repo inspection)

These 4 bugs were identified by code inspection. All are open and not yet fixed in either repo.

**Issue 1 — Webhook writes raw Exotel status strings to `contactRequests`**
- `routes/provider.js` takes `body.CallStatus` (e.g. `completed`, `in-progress`, `busy`, `no-answer`) and writes it directly to `contactRequests.status`
- Internal model uses `pending`, `provider_started`, `provider_failed` — the two sets clash and break status display in owner/admin views
- Fix: add a `mapExotelStatus(callStatus)` helper, use mapped value for `status`, keep raw Exotel value in `providerWebhookStatus`
- [ ] Add status mapping helper in `routes/provider.js`
- [ ] Replace direct status write with mapped value
- [ ] Verify: POST test webhook with `CallStatus=completed` → `contactRequests.status` becomes an internal value, `providerWebhookStatus` still holds `completed`

**Issue 2 — Webhook has no ObjectId guard on `CustomField`**
- `new ObjectId(customField)` is called with no prior validation
- A malformed or missing `CustomField` causes a silent throw swallowed by `.catch(() => null)` with no log
- Fix: guard that `customField` is a 24-character hex string before calling `new ObjectId()`; log a warning when guard fails
- [ ] Add hex-string guard before `new ObjectId()`
- [ ] Log a warning on guard failure
- [ ] Verify: POST webhook with missing `CustomField` → server log shows a warning

**Issue 3 — Exotel call trigger path not live-tested end to end**
- `lib/contact-actions.js` calls `triggerExotelCall()` for `action === "call"` but has never been run against real Exotel credentials
- [ ] Set `WAVETAG_VERIFY_TOKEN`, `WAVETAG_VERIFY_SCANNER_PHONE`, and all `EXOTEL_*` env vars
- [ ] Run `npm run verify:exotel-call` against local server
- [ ] Verify: response is `{ ok: true, request: { status: "provider_started" } }` with non-null `providerRequestId`, and the scanner phone rings

**Issue 4 — No separate `call_attempts` collection**
- All provider state (Call.Sid, leg statuses, failure reasons) stored in `contactRequests`, mixing scanner intent with provider execution — makes webhook correlation harder
- [ ] Decide: add a `call_attempts` collection, or document keeping `contactRequests` for the prototype
- [ ] Keep webhook handler + contact-actions consistent with the decision

---

## What Is Built (Implemented)

### Milestones: M1 M2 M3 M5 complete — M4 mostly done — M6 M7 M8 open

#### Backend

- Fastify 5 server with helmet, rate-limit, cookie, static plugins
- MongoDB Atlas with TTL index auto-setup + dev/prod collection separation
- 30+ API routes across public, owner, and admin surfaces
- In-memory session store (`wavetag_session` cookie, 7-day TTL)
- Password hashing with bcrypt (12 rounds); legacy SHA-256 auto-upgraded on login
- Per-IP scanner lockout after 3 failed plate verifications (15-min cooldown)
- Soft-delete pattern for tags (audit trail preserved)
- Render deployment config (`render.yaml`) with `/api/health` check

#### Frontend (19 HTML pages)

- Public scanner — two-step mobile-first flow (verify → action hub)
- Owner portal — dashboard, vehicle detail, sticker purchase
- Admin portal — overview, tags, issuance, print queue, owners, activity, admins (desktop-first)
- Auth pages — login, register, forgot/reset password, OTP verify
- Internal — `verify.html` (dev/seed/health), `hub.html` (dev nav)

#### Database Collections

`admins`, `owners`, `tags`, `contact_requests`, `password_reset_tokens`, `otp_tokens`, `verification_sessions`

---

## What Is NOT Done (Remaining Work)

### M4 — Scanner Flow (in progress, mostly done)
- [ ] Remove debug-style output from public/owner-facing mobile screens
- [ ] Manual cross-device verification (mobile browser) not completed
- [ ] `Contact Local Authorities`, `Help`, vehicle image upload — intentionally deferred

### M6 — Security Hardening (not started)
- [ ] Frontend security review (XSS, data leakage)
- [ ] Confirm no secrets exposed in client code
- [ ] Input validation audit for scanner, owner, admin inputs
- [ ] Document remaining security limitations acceptable for MVP

### M7 — Telephony (partially done)
- [ ] Live Exotel call end-to-end test with real numbers
- [ ] Exotel webhook status mapping (Issue 1 above)
- [ ] Exotel webhook ObjectId guard (Issue 2 above)
- [ ] WhatsApp delivery/failure webhook from Meta
- [ ] Decide and lock approved WhatsApp message template

### M8 — Deployment / Docs (partially done)
- [ ] Write demo script
- [ ] Write operator runbook
- [ ] Full end-to-end demo run

---

## Known Issues / Technical Debt

| Area | Issue |
|------|-------|
| Sessions | In-memory only — lost on server restart |
| OAuth state | In-memory — could grow unbounded if purge fails |
| Rate limiting | Global 60 req/min — not per-user or per-IP |
| Phone format | Assumes Indian numbers (+91) everywhere |
| WhatsApp outreach | Free-form text only works in 24-hr window; needs approved template |
| Demo routes | `/api/demo/*` must be disabled in production |
| Email failure | Password reset emails fire-and-forget; user gets success even if email fails |
| No monitoring | No alerting for failed provider calls |

---

## Quick Start (Local)

```bash
npm install
# create .env from shape in README.md
npm start
# open http://127.0.0.1:3000

npm run seed:demo                    # seed demo owner + admin + tags
npm run verify:admin-registration    # regression check
npm run verify:exotel-call           # live Exotel call test (set env vars first)
npm run verify:exotel-whatsapp       # live Exotel WhatsApp test
```

---

## Directory Tree (Post-Refactor)

```
ParkTag/
├── render.yaml                        # Render deployment (build + start commands, health check)
├── package.json
├── TASKS.md
├── survey.md
└── src/
    ├── backend/
    │   ├── app.js                     # Fastify app factory — mounts all routes + pages
    │   ├── server.js                  # Entry point (calls buildApp, starts listen)
    │   ├── lib/
    │   │   ├── env.js                 # Loads + validates all environment variables
    │   │   ├── demo-data.js           # Demo seed (creates dev owner, admin, tags)
    │   │   ├── auth/
    │   │   │   ├── auth.js            # requireSession guard, toObjectId, session helpers
    │   │   │   ├── security.js        # Hashing, secure tokens, IP/plate helpers, minutesFromNow
    │   │   │   ├── session.js         # In-memory cookie session store (read/write/destroy)
    │   │   │   ├── otp.js             # OTP generation, send (WhatsApp/email), verify
    │   │   │   └── password-reset.js  # Forgot-password token flow
    │   │   ├── db/
    │   │   │   ├── mongo.js           # MongoDB Atlas connection + close
    │   │   │   └── repositories.js    # Collection accessors + TTL index setup
    │   │   ├── core/
    │   │   │   ├── tag-issuance.js    # Tag creation, VEHICLE_LABELS, etagIdFor, QR URLs
    │   │   │   ├── contact-actions.js # Exotel/Meta dispatch + contactRequests write
    │   │   │   └── qr-output.js       # QR code → data URL (scan + print sizes)
    │   │   └── integrations/
    │   │       ├── email.js           # Gmail SMTP (password reset + OTP)
    │   │       ├── exotel.js          # Exotel masked call + WhatsApp send
    │   │       ├── meta.js            # Meta WhatsApp Cloud API send
    │   │       └── payments.js        # Razorpay order create + signature verify (timing-safe)
    │   ├── routes/
    │   │   ├── admin/
    │   │   │   └── index.js           # Admin API — etags, overview, issuance, print queue, admins
    │   │   ├── auth/
    │   │   │   ├── credentials.js     # POST /api/auth/login + /logout
    │   │   │   ├── otp.js             # POST /api/auth/send-otp + /verify-otp
    │   │   │   ├── google.js          # GET /api/auth/google + /callback
    │   │   │   ├── firebase.js        # POST /api/auth/firebase-phone/*
    │   │   │   └── password-reset.js  # POST /api/auth/forgot-password + /reset-password
    │   │   ├── owner/
    │   │   │   ├── dashboard.js       # Owner dashboard, tags, purchase-order, sticker request
    │   │   │   └── registration.js    # POST /api/register-owner
    │   │   ├── public/
    │   │   │   └── index.js           # GET /api/tags/:token, verify, claim, contact-requests
    │   │   ├── shop/
    │   │   │   └── index.js           # Generic shop — Razorpay key, create-order, verify-payment
    │   │   ├── system/
    │   │   │   ├── demo.js            # GET /api/demo/credentials, POST /api/demo/seed
    │   │   │   └── runtime.js         # GET /api/health, /api/runtime/status
    │   │   └── webhooks/
    │   │       └── exotel.js          # POST /api/provider/exotel/webhook
    │   └── scripts/
    │       └── seed-demo.js           # CLI: node src/backend/scripts/seed-demo.js
    └── frontend/
        ├── pages/
        │   ├── scanner/
        │   │   ├── index.html         # Public QR scan — verify plate → call/WhatsApp owner
        │   │   └── verify.html        # Dev health/seed/verify page
        │   ├── owner/
        │   │   ├── login.html         # Owner login (password, OTP, Google, Firebase)
        │   │   ├── welcome.html       # Owner vehicle overview + add vehicle
        │   │   ├── vehicle-detail.html # Single vehicle: QR, sticker buy, toggle status
        │   │   ├── dashboard.html     # Owner dashboard shell (legacy; routes go to welcome)
        │   │   ├── register.html      # Owner self-registration
        │   │   ├── verify.html        # OTP entry page
        │   │   ├── forgot-password.html
        │   │   └── reset-password.html
        │   ├── admin/
        │   │   ├── index.html         # Admin login
        │   │   ├── overview.html      # Admin dashboard — counts + recent activity
        │   │   ├── etags.html         # Tag list, search, detail, status toggle
        │   │   ├── issuance.html      # Issue unclaimed tag batches
        │   │   ├── print-queue.html   # Print queue — list, mark printed, export
        │   │   ├── owners.html        # Owner monitoring
        │   │   ├── activity.html      # Full contact request log
        │   │   └── admins.html        # Admin user management
        │   └── hub.html               # Internal dev navigation hub
        ├── scripts/
        │   ├── scanner/
        │   │   ├── app.js             # Scanner page JS (verify + action hub)
        │   │   └── verify.js          # Dev verify page JS
        │   ├── owner/
        │   │   ├── login.js           # Owner login + auth method switching
        │   │   ├── welcome.js         # Vehicle overview, add vehicle
        │   │   ├── vehicle-detail.js  # Vehicle detail + Razorpay purchase flow
        │   │   ├── register.js        # Self-registration form
        │   │   ├── verify.js          # OTP entry
        │   │   ├── forgot-password.js
        │   │   └── reset-password.js
        │   ├── admin/
        │   │   ├── index.js           # Admin multi-page JS (router + all admin views)
        │   │   └── etags.js           # Tag detail panel JS
        │   ├── hub.js                 # Dev hub navigation JS
        │   └── ux-feedback.js         # Shared toast / feedback utilities
        └── styles/
            └── styles.css             # Global stylesheet (all pages)
```
