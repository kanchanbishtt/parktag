# WaveTag

WaveTag is a prototype for anonymous vehicle contact.

The current prototype stack is:

- `Fastify` backend
- simple `HTML/CSS/JS` frontend
- `MongoDB Atlas` as the database
- `Render` as the primary hosted target

## Prerequisites

- `Node.js` 22 or newer
- `npm`
- a working `MongoDB` connection string

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create a root `.env` file.

Use this shape:

```env
PORT=3000
APP_ENV=dev
MONGODB_URI=your-mongodb-connection-string
MONGODB_DB_NAME=wavetag
MONGODB_COLLECTION_PREFIX=dev_
EXOTEL_API_BASE_URL=https://api.in.exotel.com
EXOTEL_ACCOUNT_SID=your-exotel-account-sid
EXOTEL_API_KEY=your-exotel-api-key
EXOTEL_API_TOKEN=your-exotel-api-token
EXOTEL_CALLER_ID=your-exotel-virtual-number
EXOTEL_STATUS_CALLBACK_URL=https://your-public-host/api/provider/exotel/webhook
EXOTEL_WHATSAPP_FROM=your-exotel-whatsapp-enabled-number
```

## Dev vs Production Collections

Local development should use separate collections from production.

Default behavior after this change:

- local/dev mode uses collection prefix `dev_`
- production mode uses no prefix

Examples:

- local admins collection: `dev_admins`
- local owners collection: `dev_owners`
- local tags collection: `dev_tags`
- local contact requests collection: `dev_contact_requests`

- production admins collection: `admins`
- production owners collection: `owners`
- production tags collection: `tags`
- production contact requests collection: `contact_requests`

Recommended:

- keep `APP_ENV=dev` locally
- keep `MONGODB_COLLECTION_PREFIX=dev_` locally
- set `APP_ENV=production` on Render
- leave `MONGODB_COLLECTION_PREFIX` empty on Render unless you intentionally want a prefix

## Run Locally

Start the app with:

```bash
npm start
```

For watch mode during development:

```bash
npm run dev
```

Default local URL:

```text
http://127.0.0.1:3000
```

## Seed Demo Data

You can seed demo owner/admin/tag data in either of these ways.

API:

```bash
curl -X POST http://127.0.0.1:3000/api/demo/seed ^
  -H "content-type: application/json" ^
  -d "{}"
```

CLI:

```bash
npm run seed:demo
```

Regression visibility check:

```bash
npm run verify:admin-registration
```

Demo credentials after seed:

- owner: `owner@wavetag.local` / `demo1234`
- admin: `admin@wavetag.local` / `demo1234`

## Local Verification

### Basic Health

Open:

- `http://127.0.0.1:3000/api/health`
- `http://127.0.0.1:3000/api/runtime/status`

Expected:

- health returns `ok: true`
- runtime status shows `mongoConfigured: true`
- runtime status shows `connected: true`

### Verification Surface

Open:

- `http://127.0.0.1:3000/verify`

Use `/verify` to:

- seed demo data
- inspect runtime health
- inspect demo credentials
- inspect owner/admin dashboard APIs

### Scanner Flow

1. Seed demo data from `/verify`.
2. Copy the seeded tag token.
3. Open:

```text
http://127.0.0.1:3000/<token>
```

4. Verify the public scanner page:

- shows a masked vehicle number
- asks for phone number first
- then exposes `Call Owner` and `Send Message`

5. For unavailable tags, verify the page still allows `Send Message`.

### Backend Demo Flow

After seeding:

1. Open the scanner page with the seeded token.
2. Submit a call or message action.
3. Verify owner/admin state from `/verify`.

Important:

- current scanner actions create backend request records
- `Call Owner` now attempts Exotel voice if Exotel env vars are configured
- `Leave WhatsApp message` now attempts Exotel WhatsApp if Exotel env vars are configured
- if Exotel env vars are missing or invalid, those actions will fail with provider-safe errors

### Exotel Call Verification

For a direct live call test, set:

```env
WAVETAG_VERIFY_TOKEN=your-active-tag-token
WAVETAG_VERIFY_SCANNER_PHONE=your-scanner-phone-in-e164
```

Then run:

```bash
npm run verify:exotel-call
```

### Exotel WhatsApp Verification

For a direct WhatsApp test, set:

```env
WAVETAG_VERIFY_TOKEN=your-active-tag-token
WAVETAG_VERIFY_SCANNER_PHONE=your-scanner-phone-in-e164
WAVETAG_VERIFY_MESSAGE=your-test-message
```

Then run:

```bash
npm run verify:exotel-whatsapp
```

### Admin Registration Visibility

Run:

```bash
npm run verify:admin-registration
```

This verifies that:

- a newly self-registered owner is stored correctly
- the new owner is visible in admin overview data
- the new owner is visible in recent registrations
- the new owner shows at least one active tag in admin data

## Main Routes

Public:

- `/`
- `/:token`
- `/api/tags/:token`
- `/api/contact-requests`

Internal verification:

- `/verify`
- `/api/demo/seed`
- `/api/demo/credentials`

Protected:

- `/api/auth/login`
- `/api/auth/logout`
- `/api/session`
- `/api/owner/dashboard`
- `/api/owner/tags/:tagId/status`
- `/api/admin/overview`

## Deployment

For Render deployment, use:

- [render.yaml](/D:/Freelance/EditTree/WaveTag/render.yaml)
- [docs/RENDER_DEPLOY.md](/D:/Freelance/EditTree/WaveTag/docs/RENDER_DEPLOY.md)

## Current Status

- M1 complete
- M2 complete
- M3 complete
- M4 in progress

The public scanner UI exists, and provider/telephony wiring is partially active for Exotel-backed call and WhatsApp testing when the required env vars are configured.
