# Developer Brief - ParkTag (WaveTag)

Use this doc to onboard your developer, understand the codebase state, and assign the right work.

---

## Quick Tech Overview

| Layer | What it is |
|---|---|
| Backend | Node.js + Fastify, lives in `src/backend/` |
| Frontend | Plain HTML + CSS + JS, lives in `src/frontend/pages/` |
| Database | MongoDB Atlas (one collection per entity: owners, tags, admins, contact_requests) |
| Hosting | Render (backend), MongoDB Atlas M0 (free tier) |
| Telephony | Exotel (call bridging + WhatsApp messages) |
| Sessions | In-memory Map on the server process (not persisted) |
| Passwords | SHA-256 hash (no salt) |

---

## Questions to Ask Your Developer

### 1. Understand What Is Done

- Can you walk me through the scanner flow end to end, from QR scan to a contact request being stored in MongoDB?
- Can you show me the owner dashboard and explain what data it reads from the backend?
- Can you show me what happens when a scanner taps "Call Owner" - what does the backend actually do step by step?
- Is the Exotel call bridging fully wired and tested, or is it still half-done?
- Is the WhatsApp message path using Exotel or Meta's Cloud API right now? (the code references both)
- Have you tested any of this from a real phone, not just the browser on your laptop?

### 2. Understand the Gaps

- The `/:token` route was renamed to `/vehicle/:token` in the backend. Does the QR sticker URL actually match this? If a QR was printed with `/:token`, it will break.
- Sessions are stored in a plain `Map()` on the server. What happens when Render restarts the server - do all owners get logged out?
- Passwords are hashed with plain SHA-256 and no salt. Are you comfortable with that for the current MVP, and do you know it needs to be fixed before any real users sign up?
- Are there any MongoDB indexes on the `token` field in the tags collection? Without an index, every QR scan does a full collection scan.
- Is there any rate limiting on the `/api/contact-requests` route? Right now anyone can flood the owner with calls.
- The admin `/api/admin/overview` route fetches ALL owners, ALL tags, and the last 20 requests in a single call with no pagination. What is the plan when there are 500+ tags?
- Are the scanner pages protected from showing private data? Specifically, does the public `GET /api/tags/:token` response ever return the owner's phone number?

### 3. Understand the Code Quality

- Is there input validation (length limits, format checks) on the phone number and message fields in the scanner flow?
- Are there any automated tests, or is everything verified manually through the browser?
- Are the Exotel credentials stored only in environment variables and never logged or returned in API responses?
- Is there a `.env` file checked into the repo with real secrets? (check `.gitignore` to confirm it is excluded)

---

## What to Ask Her to Do (Optimization Tasks)

These are prioritized from most urgent to nice-to-have.

### Priority 1 - Fix Before Real Users

**1. Fix the password hashing**
The current code uses `crypto.createHash("sha256")` with no salt. This is insecure.
Ask her to replace it with `bcrypt` or Node's built-in `crypto.scrypt`.
File: `src/backend/lib/security.js`

**2. Add MongoDB indexes**
There is no evidence of indexes on the `token` field. Every QR scan currently does a full scan of the tags collection.
Ask her to add:
- `{ token: 1 }` unique index on the `tags` collection
- `{ email: 1 }` unique index on `owners` and `admins` collections
- `{ ownerId: 1 }` index on `tags` for the owner dashboard query
- `{ token: 1, createdAt: -1 }` index on `contact_requests` for the activity feed

**3. Fix session persistence**
Sessions are stored in `app.sessions` which is a plain in-memory `Map`. Every server restart (Render auto-restarts every deploy) wipes all sessions. Owners get silently logged out.
Ask her to move sessions to MongoDB or add a short-lived signed JWT cookie as a simple replacement.
File: `src/backend/lib/session.js`

**4. Add rate limiting on the contact-request route**
Right now anyone can hit `POST /api/contact-requests` in a loop and spam calls to the owner.
Ask her to add basic rate limiting per scanner phone number using Fastify's built-in rate limit plugin (`@fastify/rate-limit`).
File: `src/backend/routes/public.js`

**5. Confirm the QR token URL shape**
The backend serves the scanner page at `/vehicle/:token` but the TASKS file refers to `/:token`. If any stickers were already printed with the old URL, they are broken.
Ask her to check which URL format the QR codes actually encode and make sure the backend and the printed URL match.

---

### Priority 2 - Code Quality and Completeness

**6. Clarify which WhatsApp provider is active**
The code has two WhatsApp paths: Exotel WhatsApp (`src/backend/lib/exotel.js`) and Meta Cloud API (`src/backend/lib/meta.js`). The `contact-actions.js` file references `sendMetaWhatsapp` for messages but the README says Exotel WhatsApp.
Ask her to pick one, remove the dead code, and document which provider handles what in the README.

**7. Add basic input validation**
The phone field on the scanner page accepts any string. Ask her to add:
- Phone number format validation (10-digit Indian number or E.164)
- Message length cap (e.g., 500 characters max) before it hits the provider
- Reject empty or whitespace-only messages on the server, not just the frontend

**8. Remove debug output from public pages**
TASKS.md has an open item to keep public and owner-facing screens free of debug-style output. Ask her to confirm no `console.log`, raw API response, or internal field names are shown to the scanner or owner.

**9. Add a health check to the Exotel connection on startup**
Currently if Exotel env vars are wrong the error only surfaces when a scanner tries to call. Ask her to log a clear warning at server startup if Exotel vars are missing or malformed.

**10. Paginate the admin overview API**
`GET /api/admin/overview` fetches every owner, every tag, and 20 contact requests in one shot with in-memory `.filter()` and `.map()` joins. This will degrade as data grows.
Ask her to:
- Add limit/skip or cursor-based pagination on owners and tags
- Move the join logic to a MongoDB aggregation pipeline instead of doing it in JS

---

### Priority 3 - Demo and UX Polish

**11. Complete mobile verification**
TASKS.md has several open verification items under M4:
- Scanner flow from a real mobile browser
- Unclaimed claim flow from mobile
- Owner self-registration from mobile
- Owner portal from mobile
Ask her to run through each of these on an actual phone (not browser devtools emulation) and fix anything that breaks.

**12. Write the demo script**
M8 has an open task for a short demo script. Ask her to write a step-by-step walkthrough of the exact demo flow (admin seeds data, owner logs in, scanner scans QR, call is placed) so you can rehearse it before showing a supervisor.

**13. Add a session cookie `Secure` flag for production**
The session cookie is set with `httpOnly: true` and `sameSite: lax` but no `secure: true` flag. On Render (HTTPS), the cookie should be marked secure so browsers only send it over HTTPS.
File: `src/backend/lib/session.js`, line 44.

---

## What Is Already Working (Do Not Break)

- Seeded demo flow: `npm run seed:demo` creates one owner, admin, and active tag
- Health check: `GET /api/health` and `GET /api/runtime/status`
- Scanner page: resolves a tag by token and shows masked plate number
- Contact request creation: stores call and message requests in MongoDB
- Owner dashboard: login, session, tag status toggle
- Admin dashboard: overview, issuance, print queue, owners list, activity feed
- Render + MongoDB Atlas deployment is live

---

## One-Sentence Summary for Your Developer

> Fix password hashing, add MongoDB indexes, fix in-memory sessions, add rate limiting on the contact route, verify the QR URL shape, then clean up the two-provider WhatsApp confusion - everything else can follow after those six things are done.
