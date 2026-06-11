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
- hosting target: `Render` for the backend app and `MongoDB Atlas M0` for the initial prototype database
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

## 7. Security Direction

For the prototype, keep security simple but real.

### Auth Model

- scanner routes stay public and unauthenticated
- owner users sign in with a server-managed account created during claim or setup
- admin signs in with a seeded admin account
- authenticated browser sessions use secure HTTP-only cookies
- backend authorization is role-based: `owner` and `admin`
- owner routes must be restricted to the signed-in owner's own records only

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
- primary deployment target: `Render`
- primary database target: `MongoDB Atlas M0`
- fallback app host if needed: `Heroku Eco`
- keep deployment simple
- avoid architecture choices that require multiple managed services for the first prototype
- make the deployed app usable from a QR-driven mobile browser flow

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

## 12. Living Document Rule

Keep this file updated as the prototype direction changes.

If a task reveals a better simpler path:

- update `PLAN.md`
- update `TASKS.md`
- record side tasks or newly discovered work immediately
