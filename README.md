# ParkTag

**ParkTag** is a QR-based *anonymous vehicle contact* platform. Every vehicle gets a
scannable **E-Tag** (a QR sticker). When someone scans it, they can reach the owner —
by masked phone call or WhatsApp — **without ever seeing the owner's number**. Owners
manage their vehicles from a dashboard; an admin console issues and prints tag batches.

> The internal npm package is still named `wavetag` (the project's original codename).
> `WaveTag` / `wavetag` in code, seed data, and collection names refers to ParkTag.

---

## Live app

Production runs at **[app.parktag.me](https://app.parktag.me)**. Operable surfaces:

| Surface       | Link                                                                    | Who it's for                          |
|---------------|-------------------------------------------------------------------------|---------------------------------------|
| Scanner       | `https://app.parktag.me/tag/<token>`                                    | Finders — opens by scanning a tag QR  |
| Owner sign-in | [app.parktag.me/owner-login](https://app.parktag.me/owner-login)        | Vehicle owners                        |
| Owner sign-up | [app.parktag.me/register-owner](https://app.parktag.me/register-owner)  | New owners                            |
| Admin console | [app.parktag.me/admin](https://app.parktag.me/admin)                    | Operators (issue + print tag batches) |
| Health check  | [app.parktag.me/api/health](https://app.parktag.me/api/health)          | Uptime probe                          |

> The scanner opens from a real tag QR, so it needs a live `<token>` — there's no
> fixed scanner URL. Owner and admin surfaces require sign-in.

---

## Table of Contents

1. [Live app](#live-app)
2. [How it works](#how-it-works)
3. [Tech stack](#tech-stack)
4. [Repository layout](#repository-layout)
5. [Core domain concepts](#core-domain-concepts)
6. [Prerequisites](#prerequisites)
7. [Local setup](#local-setup)
8. [Environment variables](#environment-variables)
9. [Dev vs production collections](#dev-vs-production-collections)
10. [Running the app](#running-the-app)
11. [Seeding demo data](#seeding-demo-data)
12. [Verifying locally](#verifying-locally)
13. [The three surfaces & their routes](#the-three-surfaces--their-routes)
14. [Integrations](#integrations)
15. [Deployment](#deployment)
16. [Contributing workflow](#contributing-workflow)
17. [Project status](#project-status)

---

## How it works

```
 Finder scans QR ──▶ /tag/<token>  (public scanner page)
                         │
                         ├─ enters their phone number
                         │
             ┌───────────┴───────────┐
             ▼                        ▼
        Call Owner               Send Message
   (Exotel masked call)     (Meta WhatsApp to owner)
             │                        │
             ▼                        ▼
   Both connect through a virtual number / template message —
   the owner's real number is never revealed to the finder.
```

- **Finders** land on a public page, verify with their own phone, and choose an action.
- **Owners** register vehicles, generate E-Tags, and (optionally) upgrade to the official
  physical sticker for unlimited contact.
- **Admins** issue tag batches, run a print queue, and monitor owners/activity.

---

## Tech stack

| Layer        | Choice                                                              |
|--------------|--------------------------------------------------------------------|
| Backend      | [Fastify 5](https://fastify.dev/) (ESM, Node ≥ 20)                  |
| Frontend     | Vanilla **HTML/CSS/JS**, multi-page, served statically by Fastify  |
| Database     | **MongoDB** (Atlas in prod, local `mongod` in dev)                 |
| Calls        | **Exotel** — inbound "Dial-Whom" masked call bridging              |
| Messaging    | **Meta WhatsApp Cloud API** (Graph API `v19.0`)                    |
| Payments     | **Razorpay** (shop premium tags, server-locked rate list)          |
| Auth         | Server-side sessions (cookie), password + OTP + **Google OAuth**   |
| Email/OTP    | `nodemailer` (SMTP)                                                 |
| QR           | `qrcode` (data-URL QR generation)                                  |
| Hosting      | **Railway** → `https://app.parktag.me` (Render config also present) |

Key libraries: `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`,
`@fastify/static`, `bcryptjs`, `mongodb`, `razorpay`.

---

## Repository layout

```
ParkTag/
├── src/
│   ├── backend/
│   │   ├── server.js            # entry point — binds 0.0.0.0:PORT
│   │   ├── app.js               # builds Fastify app, registers routes + page handlers
│   │   ├── lib/
│   │   │   ├── auth/            # session.js, auth.js (requireSession), security.js
│   │   │   ├── core/            # tag-issuance.js, contact-actions.js (domain logic)
│   │   │   ├── db/              # mongo.js (connection), repositories.js (collections)
│   │   │   ├── integrations/    # exotel.js, meta.js (WhatsApp), payments.js
│   │   │   └── env.js           # single source of truth for all env vars
│   │   ├── routes/
│   │   │   ├── public/          # scanner + contact APIs
│   │   │   ├── owner/           # dashboard.js, registration.js
│   │   │   ├── admin/           # issuance, print queue, owners, e-tags, activity
│   │   │   ├── auth/            # credentials, otp, google, password-reset
│   │   │   ├── shop/            # Razorpay order/verify
│   │   │   ├── webhooks/        # exotel.js (Dial-Whom + status), meta.js (WhatsApp)
│   │   │   └── system/          # runtime status, demo seed
│   │   └── scripts/             # seed-demo, verify-* one-off scripts
│   └── frontend/
│       ├── pages/
│       │   ├── scanner/         # public scanner + verify
│       │   ├── owner/           # login, register, verify, welcome (dashboard), vehicle-detail…
│       │   └── admin/           # overview, issuance, print-queue, owners, etags, activity, admins
│       ├── scripts/             # page-scoped JS (owner/, admin/, scanner/)
│       ├── styles/              # shared CSS
│       └── images/              # logos, sticker assets
├── docs/                        # RFA_SPEC, DOMAIN_MODEL, SCHEMA_AND_API_CONTRACTS, deploy guides
├── PLAN.md                      # living design/decision log
├── TASKS.md                     # milestone tracker (M1…M17)
└── render.yaml                  # legacy Render deploy config
```

---

## Core domain concepts

**Tag lifecycle**

```
unclaimed ──(owner claims / self-registers)──▶ active ⇄ inactive ──(soft delete)──▶ deletedAt set
```

- `ownerId == null` → **unclaimed**, lives in the admin **Print Queue**.
- `ownerId != null` → a real **E-Tag** owned by someone.
- Delete is **soft**: sets `deletedAt` + `status:"inactive"`; the row is filtered out of every
  owner/admin query but never hard-deleted (data preserved).

**Free contact vs premium**

- Every E-Tag includes **one free masked contact** (`freeContactUsed:false` at creation) —
  a **one-contact free trial**.
- After it's used, the server blocks further contact with **`402 FREE_USED`** —
  the gate is `freeContactUsed && !premium`.
- **Premium** (`premium:true`) bypasses the gate → unlimited contact. Premium is granted by:
  - the owner **buying a premium tag through the shop** (rate list, ₹299+): a paid shop
    order **mints a new premium tag** for that vehicle and **soft-removes the spent free
    tag** (M18 — the old in-place ₹199 upgrade is retired), or
  - an admin issuing a **premium batch**.
- **Download E-Tag** and E-Tag info are shown only for **premium** tags; non-premium
  (trial) tags show neither.

**Pricing**

All prices are in **INR** and are **server-authoritative** — the browser only sends a
`productId`; the amount charged is resolved on the server (never trusted from the client).
Premium is bought from the shop catalog below (the standalone ₹199 per-tag upgrade was
removed in M18).

*Shop catalog* — new physical tags, from the owner dashboard shop (`SHOP_PRODUCTS` in
`lib/integrations/payments.js`):

| `productId` | Product                       | Price | MRP  |
|-------------|-------------------------------|-------|------|
| `pt-car-1`  | ParkTag Car Tag (Pack of 1)   | ₹299  | ₹499 |
| `pt-car-2`  | ParkTag Car Tag (Pack of 2)   | ₹499  | ₹799 |
| `pt-bike-1` | ParkTag Bike Tag              | ₹299  | ₹399 |
| `pt-combo`  | ParkTag Combo Pack (Car+Bike) | ₹499  | ₹899 |

> Changing a shop price means editing `SHOP_PRODUCTS` (the charged amount) **and** the
> `PRODUCTS` list in `frontend/pages/owner/welcome.html` (the displayed price). The MRP is
> display-only. See [Project status](#project-status) → M15 for how the amount is locked.

**Contact flow (privacy-preserving)**

- **Call** — `POST /api/tags/:token/register-call` stores a pending record; the finder dials a
  virtual Exotel number, and the `GET /api/exotel/dial-whom` webhook resolves who to connect to.
  Neither party sees the other's number. (Owner→finder callback works the same way.)
- **Message** — the WhatsApp body is **built entirely server-side** from a fixed base + a
  whitelist of reasons; the finder can never author free text that reaches the owner.

See `docs/DOMAIN_MODEL.md` and `docs/SCHEMA_AND_API_CONTRACTS.md` for full detail.

---

## Prerequisites

- **Node.js ≥ 20** and `npm`
- A **MongoDB** connection string (local `mongod` is fine for dev)
- *(Optional, for live features)* Exotel, Meta WhatsApp, Razorpay, Google OAuth, and SMTP
  credentials. The app runs without them — those actions just fail with provider-safe errors.

---

## Local setup

```bash
npm install
```

Then create a root `.env` (see the next section), and run `npm start`.

---
<!-- 
## Environment variables

Create a `.env` at the repo root. Everything is read in one place — `src/backend/lib/env.js`.

```env
# ── Core ─────────────────────────────────────────────
PORT=3000
APP_ENV=dev                       # dev | production
APP_BASE_URL=http://localhost:3000
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=parktag
MONGODB_COLLECTION_PREFIX=dev_    # dev_ locally; set prod_ (or empty) in production

# ── Calls: Exotel ────────────────────────────────────
EXOTEL_API_BASE_URL=https://api.in.exotel.com
EXOTEL_ACCOUNT_SID=
EXOTEL_API_KEY=
EXOTEL_API_TOKEN=
EXOTEL_CALLER_ID=                 # the virtual ExoPhone number
EXOTEL_STATUS_CALLBACK_URL=https://<public-host>/api/provider/exotel/webhook

# ── Messaging: Meta WhatsApp Cloud API ───────────────
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_ACCESS_TOKEN=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=   # any random string; must match the value set in Meta

# ── Payments: Razorpay ───────────────────────────────
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

# ── Auth: Google OAuth ───────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://127.0.0.1:3000/api/auth/google/callback

# ── Email / OTP (SMTP) ───────────────────────────────
EMAIL_SMTP_HOST=
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=
EMAIL_SMTP_PASS=
EMAIL_FROM=noreply@parktag.me

# ── Misc ─────────────────────────────────────────────
SUPER_ADMIN_BOOTSTRAP_KEY=        # one-time admin bootstrap (legacy)
```

> **Keep host/port consistent.** If you change `PORT`, update `APP_BASE_URL` and
> `GOOGLE_CALLBACK_URL` to match — Google OAuth requires the callback URL to be
> whitelisted exactly in the Google Cloud Console.

Only `MONGODB_URI` is truly required to boot. Provider blocks are optional; missing creds
make just that feature unavailable.

--- -->

## Dev vs production collections

Dev and prod share one database but are isolated by a **collection prefix**
(`MONGODB_COLLECTION_PREFIX`), so local testing never touches production data.

| Mode        | `APP_ENV`    | Prefix (default)     | Example collection |
|-------------|--------------|----------------------|--------------------|
| Local dev   | `dev`        | `dev_`               | `dev_tags`         |
| Production  | `production` | `""` (set `prod_`)   | `prod_tags`        |

- Locally: keep `APP_ENV=dev` and `MONGODB_COLLECTION_PREFIX=dev_`.
- In production: set `APP_ENV=production` and set `MONGODB_COLLECTION_PREFIX=prod_`
  (production explicitly uses the `prod_` prefix on Atlas).

---

## Running the app

```bash
npm start        # node src/backend/server.js
npm run dev      # nodemon watch mode
```

Default local URL (with `PORT=3000`):

```text
http://127.0.0.1:3000
```

The server binds `0.0.0.0:PORT` so it's reachable from a phone on the same network
(handy for testing the mobile scanner flow).

---

## Seeding demo data

Creates one owner, one admin, and one active tag.

```bash
npm run seed:demo
# or via API:
curl -X POST http://127.0.0.1:3000/api/demo/seed -H "content-type: application/json" -d "{}"
```

<!-- Demo credentials after seeding:

- **Owner:** `owner@wavetag.local` / `demo1234`
- **Admin:** `admin@wavetag.local` / `demo1234` -->

---

## Verifying locally

### Health

- `http://127.0.0.1:3000/api/health` → `ok: true`
- `http://127.0.0.1:3000/api/runtime/status` → `mongoConfigured: true`, `connected: true`
  (this endpoint reports only Boolean `*Configured` flags — never secret values)

### Internal verification hub

- `http://127.0.0.1:3000/verify` — seed data, inspect runtime/credentials, poke owner/admin APIs.
- `http://127.0.0.1:3000/hub` — quick links into every surface (scanner, owner, admin, verify).

### Scanner flow

1. Seed demo data, copy the seeded tag token.
2. Open `http://127.0.0.1:3000/tag/<token>`.
3. Confirm the page shows a **masked** vehicle number, asks for a phone number first,
   then exposes **Call Owner** and **Send Message**.

### One-off verification scripts

```bash
npm run verify:admin-registration   # owner self-registration is visible in admin data
npm run verify:exotel-call          # live Exotel call test (needs Exotel creds)
npm run verify:exotel-whatsapp      # Exotel WhatsApp send helper test
```

For the Exotel scripts, set:

```env
WAVETAG_VERIFY_TOKEN=<active-tag-token>
WAVETAG_VERIFY_SCANNER_PHONE=<scanner-phone-in-e164>
WAVETAG_VERIFY_MESSAGE=<test-message>   # whatsapp script only
```

> **Note:** the **production messaging path is Meta WhatsApp**, not Exotel. The
> `verify:exotel-whatsapp` script exercises the legacy Exotel send helper, which still
> exists in `lib/integrations/exotel.js` but is off the active scanner path.

---

## The three surfaces & their routes

### Public / scanner

| Route                              | Purpose                                   |
|------------------------------------|-------------------------------------------|
| `GET /` , `/tag/:token`, `/vehicle/:token` | Public scanner page (HTML)         |
| `GET /api/tags/:token`             | Public tag view (masked, contact state)   |
| `POST /api/tags/:token/verify`     | Verify last-4 of plate                     |
| `POST /api/contact-requests`       | Create a call/WhatsApp contact request     |
| `POST /api/tags/:token/register-call` | Register a masked call (Dial-Whom)      |

### Owner

| Route                                  | Purpose                              |
|----------------------------------------|--------------------------------------|
| `GET /owner-login`, `/register-owner`, `/owner-verify`, `/owner-welcome`, `/owner-vehicle-detail` | Owner pages |
| `GET /api/owner/dashboard`             | Owner's vehicles, requests, activity |
| `POST /api/owner/local-vehicle`        | Add a vehicle → real E-Tag (idempotent, 409 on dup) |
| `POST /api/owner/mobile`               | Save owner phone                     |
| `POST /api/shop/create-order` / `verify-payment` | Razorpay shop checkout; a paid order with `replaceTagId` mints a premium tag + removes the free tag (M18) |
| `POST /api/owner/tags/:tagId/status`   | Activate / deactivate                |
| `DELETE /api/owner/tags/:tagId`        | Soft-delete a vehicle                |
| `POST /api/owner/callback/register-call` | Owner → finder callback            |

### Admin (desktop-first operator console)

| Route                                  | Purpose                              |
|----------------------------------------|--------------------------------------|
| `GET /admin`, `/admin/overview`, `/admin/issuance`, `/admin/print-queue`, `/admin/owners`, `/admin/etags`, `/admin/activity`, `/admin/admins` | Admin pages |
| `GET /api/admin/overview`              | Counts + recent activity/registrations |
| `POST /api/admin/tags/issue`           | Issue an unclaimed tag batch (premium toggle) |
| `GET /api/admin/print-queue`           | To-print / printed tabs (`?printed=1`) |
| `GET /api/admin/print-queue/export`    | Full-page E-Tag print sheet          |
| `GET /api/admin/etags`, `/owners`, `/activity`, `/admins` | Monitoring + admin management |

### Auth, shop, webhooks, system

- **Auth:** `POST /api/auth/login`, `/logout`, `/session`; OTP (`/api/auth/send-otp`, …);
  Google (`/api/auth/google`, `/callback`); password reset.
- **Shop:** `POST /api/shop/create-order`, `/api/shop/verify-payment`.
- **Webhooks:** `POST /api/provider/exotel/webhook`, `GET /api/exotel/dial-whom`,
  `GET|POST /api/provider/meta/webhook`.
- **System:** `GET /api/health`, `/api/runtime/status`, `POST /api/demo/seed`.

**Authorization:** protected routes go through `requireSession(app, role)`
(`lib/auth/auth.js`) — `401` when unauthenticated, `403` on role mismatch. Owner routes
scope every query by `ownerId = session.userId`, so a user can only ever touch their own data.

---

## Integrations

- **Exotel (calls)** — inbound "Connect-to-Flow": the finder/owner dials a virtual ExoPhone,
  and `GET /api/exotel/dial-whom` returns the party to connect. Status callbacks
  (duration, result, recording) land at `/api/provider/exotel/webhook`. See
  `docs/EXOTEL_CONNECT_INTEGRATION_GUIDE.md`.
- **Meta WhatsApp (messaging)** — `lib/integrations/meta.js` sends server-built messages via
  the Graph API. Delivery status (`sent/delivered/read/failed`) is received at
  `/api/provider/meta/webhook`; the `GET` handler answers Meta's `hub.challenge` verification.
- **Razorpay (payments)** — `lib/integrations/payments.js`; the shop checkout is
  **server-locked** — the shop resolves prices from a `SHOP_PRODUCTS` catalog by `productId`
  and re-checks the order at verify time (M15). A paid order carrying `replaceTagId` mints a
  new premium tag and soft-removes the spent free tag (M18).
- **Google OAuth** — sign-in never auto-creates an account; unknown Gmails get a `no_account`
  error. Callback/JS-origins must be whitelisted in the Google Cloud Console.

---

## Deployment

Production runs on **Railway** at `https://app.parktag.me`.

1. Push to the deployment branch.
2. Set every production env var in the Railway dashboard (see
   [Environment variables](#environment-variables)) — with `APP_ENV=production`,
   `MONGODB_COLLECTION_PREFIX=prod_`, and `APP_BASE_URL=https://app.parktag.me`.
3. Point provider webhooks/redirects at the public host:
   - Exotel Dial-Whom → `https://app.parktag.me/api/exotel/dial-whom`
   - Exotel status → `https://app.parktag.me/api/provider/exotel/webhook`
   - Meta WhatsApp webhook → `https://app.parktag.me/api/provider/meta/webhook`
   - Google callback → `https://app.parktag.me/api/auth/google/callback`

A legacy [`render.yaml`](./render.yaml) + [`docs/RENDER_DEPLOY.md`](./docs/RENDER_DEPLOY.md)
are kept for the alternative Render target.

---

## Contributing workflow

- **Plan first.** `PLAN.md` is the living design log; `TASKS.md` tracks milestones (M1…M17)
  with per-item checkboxes. Update them as you work — a task is only checked when the code
  or behavior is verified.
- **Branch** off `main` for changes; open a PR against `main`.
- **Match the surrounding code.** The frontend is deliberately framework-free vanilla JS —
  keep new code in the same idiom, naming, and comment density as its neighbors.
- **Sanity-check before committing:**

  ```bash
  node --check src/backend/<file>.js     # syntax-check edited JS
  npm start                              # boot and smoke-test the affected flow
  ```

- **Commits/pushes only when asked.** Don't commit or push unless the change owner
  explicitly says to.
- **Reference docs:** `docs/RFA_SPEC.md` (spec), `docs/DOMAIN_MODEL.md`,
  `docs/SCHEMA_AND_API_CONTRACTS.md`, `docs/LOCAL_GUIDE.md`.

---

## Project status

MVP is essentially feature-complete and verified. Milestone tracker: `TASKS.md`.

- ✅ **M1–M18** — backend, scanner/owner/admin flows, Exotel calls, Meta WhatsApp
  messaging, owner vehicle management, server-locked shop pricing, print-queue split,
  security-boundary hardening, and the free-trial → buy-premium-via-shop model (a paid shop
  order mints a new premium tag and removes the spent free tag) — all implemented; M18 needs
  a live browser checkout to fully verify.
<!-- - ✅ **M15** — shop payment amounts are locked server-side: `/api/shop/create-order`
  resolves the price from a server catalog (`SHOP_PRODUCTS` in `payments.js`) by `productId`
  and ignores any client `amount`. Orders are persisted to `shop_orders`, and
  `verify-payment` re-checks the paid order against the catalog price before granting —
  a valid signature on an unknown or mispriced order is rejected. -->
- 📝 **Pending — owner dashboard banner carousel (M14):** the carousel still shows placeholder
  slides; real content/artwork is outstanding.
