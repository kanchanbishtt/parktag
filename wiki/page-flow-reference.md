# Page And Flow Reference

This note explains what each main page and route is for in the current WaveTag prototype.

## Public Pages

### `/`

Main public entry page.

Purpose:

- scanner-facing landing page
- can also be reached from a QR token path when the token is missing or not attached yet in the URL flow

Expected behavior:

- public page only
- no owner/admin auth required

### `/:token`

Token-based public page for a specific WaveTag.

Purpose:

- public scan flow
- public claim flow for unclaimed tags

Expected behavior:

- if tag is `unclaimed`
  - show owner claim form
- if tag is `active`
  - show scanner contact flow
- if tag is unavailable
  - show unavailable state with message option if allowed

### `/register-owner`

Owner self-registration page.

Purpose:

- new owner creates an account directly
- new owner gets a QR code output
- new owner can request a physical sticker

Expected behavior:

- owner enters their own details
- owner enters vehicle number/details
- system creates owner + active tag
- QR output is shown

## Authenticated Pages

### `/owner`

Owner dashboard page.

Purpose:

- owner login
- owner sees their own tags
- owner can toggle active/inactive status
- owner can inspect recent requests

Expected behavior:

- only authenticated owner should access owner data
- owner should only see their own records

### `/admin`

Admin dashboard page.

Purpose:

- admin login
- monitor owners and credits
- issue unclaimed tags in batches
- review print queue
- monitor recent request activity

Expected behavior:

- only authenticated admin should access admin data
- admin issuance should not ask for owner personal details

### `/verify`

Internal verification page.

Purpose:

- runtime health
- seed demo setup
- inspect demo credentials
- basic internal checks

Expected behavior:

- not part of the normal public owner/scanner flow
- used mainly for testing and local verification

## Main API Routes

### `GET /api/health`

Purpose:

- confirms backend is running

### `GET /api/runtime/status`

Purpose:

- confirms runtime mode
- confirms MongoDB connection
- shows current collection prefix

### `POST /api/demo/seed`

Purpose:

- seeds demo owner/admin/tag data for the current environment

### `GET /api/demo/credentials`

Purpose:

- returns demo login credentials

### `GET /api/tags/:token`

Purpose:

- resolves a token into public tag state

Expected behavior:

- `unclaimed` tags return claimable state
- `active` tags return scanner-safe public info

### `POST /api/tags/:token/claim`

Purpose:

- owner claims an unclaimed tag

Expected behavior:

- creates owner record
- links tag to owner
- activates tag

### `POST /api/contact-requests`

Purpose:

- scanner creates a call/message request

Current behavior:

- creates backend request record
- provider-backed live telephony is not the current active flow

### `POST /api/register-owner`

Purpose:

- owner self-registration path

Expected behavior:

- creates owner account
- creates active owner-linked tag
- returns QR output

### `POST /api/auth/login`

Purpose:

- owner/admin login

### `POST /api/auth/logout`

Purpose:

- owner/admin logout

### `GET /api/owner/dashboard`

Purpose:

- owner dashboard data

### `POST /api/owner/tags/:tagId/status`

Purpose:

- owner toggles tag active/inactive status

### `GET /api/admin/overview`

Purpose:

- admin dashboard summary
- owner monitoring
- recent request visibility

### `POST /api/admin/tags/issue`

Purpose:

- admin issues one or more unclaimed tags in a batch

Expected behavior:

- stores batch number separately from vehicle number
- returns claim URLs / QR outputs

### `GET /api/admin/print-queue`

Purpose:

- lists unclaimed and unprinted tags
- used for printing-company handoff

## Quick Claimed Tag Check

To confirm a tag is fully claimed:

1. claim it from `/:token`
2. check `/owner`
3. check the same `/:token` again
4. check `GET /api/tags/:token`

Expected:

- tag is no longer claimable
- owner dashboard shows it
- public token page shows scanner flow instead of claim flow
