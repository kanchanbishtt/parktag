# WaveTag Project Tasks

This file tracks repo-level implementation progress for the WaveTag MVP.

Rules:

- keep tasks tied to Phase 1 MVP scope
- keep items small and verifiable
- mark tasks complete only after code or behavior is verified
- prefer verification steps that can be checked through a simple UI when practical
- prefer minimal prototype stack choices over optimization-driven architecture
- use `docs/TASKS.md` for detailed backend execution work

## Milestones

- [x] M1. Confirm MVP scope and repo workflow
- [x] M2. Define the minimal end-to-end product slice
- [x] M3. Build a deployable backend server for the MVP demo
- [ ] M4. Implement the scanner-facing web flow
- [x] M5. Implement the authenticated owner and admin web flow
- [ ] M6. Harden web security and authorization boundaries
- [ ] M7. Verify telephony and fallback messaging behavior
- [ ] M8. Prepare deployment, demo, docs, and operator runbook
- [x] M9. Tiered rate limiting — per-route protection

## M1. Confirm MVP Scope And Repo Workflow

Tasks:

- [x] Read `INITIAL_PROMPT.md`
- [x] Read `docs/RFA_SPEC.md`
- [x] Create root `AGENTS.md`
- [x] Create root `TASKS.md`
- [x] Add the first wiki note capturing current project assumptions
- [x] Record the minimal-stack prototype direction in `wiki/`

Verification:

- [x] Confirm `AGENTS.md` exists at repo root
- [x] Confirm `TASKS.md` exists at repo root
- [x] Confirm a project note exists under `wiki/`

## M2. Define The Minimal End-To-End Product Slice

Tasks:

- [x] Lock the exact Phase 1 demo flow from scan to owner contact
- [x] Decide the minimum frontend and backend surfaces required
- [x] Decide the minimum authentication and authorization model for owner and admin access
- [x] Decide which flows must work on laptop browsers and which must work on mobile browsers
- [x] Decide the simplest hosting target for the backend server on a free or low-cost platform
- [x] Decide the minimum verification UI that can keep growing with the product
- [x] Lock the first demo slice to a UI-verifiable contact-request flow before live telephony
- [x] Create `PLAN.md` as the simpler prototype execution direction
- [x] Keep `PLAN.md` updated as prototype decisions change
- [x] Record that project application code should live under `src/`
- [x] Reuse the existing `src/backend/` and `src/frontend/` folders for project code
- [x] Choose `Fastify` for the backend server
- [x] Choose simple `HTML/CSS/JS` for the frontend
- [x] Choose `MongoDB` as the single prototype persistence approach
- [x] Choose `Render` as the primary app hosting target with `Heroku Eco` as fallback
- [x] Record deferred items explicitly so they do not leak into MVP work
- [x] Add a dedicated wiki note for the Milestone 2 demo slice decisions
- [x] Recognize two onboarding paths: admin-issued unclaimed tags and owner self-registration with QR delivery

Verification:

- [x] Confirm the chosen MVP flow is written down in `wiki/`
- [x] Confirm `PLAN.md` exists at repo root and captures the current prototype direction
- [x] Confirm `PLAN.md` records the chosen `Fastify + MongoDB + simple HTML/CSS/JS` stack
- [x] Confirm the wiki notes capture the current minimal-stack direction and open infrastructure questions
- [x] Confirm open ambiguities from `docs/RFA_SPEC.md` are either resolved or listed

## M3. Build A Deployable Backend Server For The MVP Demo

Tasks:

- [x] Keep backend execution aligned with `docs/TASKS.md`
- [x] Complete the remaining critical backend slice for the demo
- [x] Scaffold the `Fastify` backend under `src/backend/`
- [x] Expose the required HTTP routes for scanner, owner, and admin flows
- [x] Add authentication support for protected owner and admin routes
- [x] Add authorization checks so users can access only their own data and admins can access admin-only features
- [x] Add `MongoDB` connection and minimal data access for prototype entities
- [x] Prepare the backend server for deployment to Render
- [x] Deploy the current backend slice on Render and verify the hosted runtime
- [x] Keep the prototype backend on the chosen single `MongoDB` persistence path without Redis unless a verified need appears
- [x] Make backend slices easy to exercise from the simple verification UI
- [x] Verify backend routes and provider-safe behavior locally
- [x] Add root runtime files for Node.js execution and local environment setup
- [x] Add a simple frontend verification page served from `src/frontend/`
- [x] Resolve the current MongoDB Atlas runtime connection reset and verify successful ping
- [x] Add a demo seed flow for owner, admin, and tag setup
- [x] Expand the frontend verification page to exercise the first demo-flow routes
- [x] Verify the seeded first demo flow from public tag resolve to owner and admin visibility
- [x] Confirm `npm start` is the stable local verification path for the current backend slice
- [x] Add Render deployment configuration and a minimal deployment guide
- [x] Deploy the backend to Render and verify the public health endpoint
- [x] Resolve the Render-to-MongoDB Atlas TLS connection error so hosted runtime status is healthy
- [x] Separate local development collections from production collections by environment

Verification:

- [x] Run the relevant backend checks for the completed slice
- [x] Confirm the root milestone status matches `docs/TASKS.md`
- [x] Confirm the backend can run as a real hosted server target, not only as a local script or local-only service
- [x] Confirm the current backend slice can be exercised from the simple UI without developer-only steps where practical
- [x] Verify `GET /api/health` returns success locally
- [x] Verify `GET /api/runtime/status` returns the runtime stack and MongoDB configuration state locally
- [x] Verify the frontend verification page is served successfully from `/`
- [x] Verify `GET /api/runtime/status` reports MongoDB `connected: true` without runtime connection errors
- [x] Verify `POST /api/demo/seed` creates one owner, one admin, and one active tag
- [x] Verify `GET /api/tags/:token` returns the seeded public tag view
- [x] Verify `POST /api/contact-requests` creates a pending request for the seeded tag
- [x] Verify owner login plus `GET /api/owner/dashboard` returns the seeded tag and new request
- [x] Verify admin login plus `GET /api/admin/overview` returns the new request
- [x] Verify unauthenticated owner dashboard access is blocked
- [x] Verify owner sessions are blocked from admin-only routes
- [x] Verify owner tag-status update changes the stored and public tag status
- [x] Confirm Render deployment files exist in the repo
- [x] Verify deployed `GET /api/health` returns success on Render
- [x] Verify deployed `/` responds successfully on Render
- [x] Verify deployed `GET /api/runtime/status` reports MongoDB `connected: true` on Render
- [x] Verify deployed `POST /api/demo/seed` creates one owner, one admin, and one active tag
- [x] Verify deployed `GET /api/tags/:token` returns the seeded public tag view
- [x] Verify deployed `POST /api/contact-requests` creates a pending request for the seeded tag
- [x] Verify deployed owner login plus `GET /api/owner/dashboard` returns the seeded tag and new request
- [x] Verify deployed admin login plus `GET /api/admin/overview` returns the new request
- [x] Confirm the Render-hosted service passes the same health, runtime, and demo-flow checks

## M4. Implement The Scanner-Facing Web Flow

Mobile Demo Checklist:

- [x] Confirm the exact mobile-first routes required for the client demo
- [x] Treat `/:token` as the primary mobile QR-entry surface for the demo
- [x] Reshape the `/:token` active tag scanner flow into a guided two-step mobile flow
- [x] Polish the `/:token` unclaimed claim flow for mobile use
- [x] Polish the `/register-owner` flow for mobile use
- [x] Polish the `/owner` portal for mobile use
- [x] Make the scanner page open cleanly from a QR scan on a phone
- [x] Make Page 1 a short verification step instead of a raw long form
- [x] Make Page 1 confirm:
  - owner or car last 4 digits shown as confirmation
  - scanner phone number as the only input
- [x] Make Page 2 the owner-contact action hub
- [x] Keep the scanner flow phone-number-first, then action selection
- [x] Make the final user action surface mobile-first for:
  - `Call Owner`
  - `Leave WhatsApp Message`
- [ ] Keep the public and owner-facing mobile screens free of debug-style output
- [x] Keep the layout single-column, readable, and easy to tap on a phone
- [x] Keep the owner registration, QR claim, owner portal, and scanner contact flows understandable under demo conditions and fast scanning behavior
- [x] Keep the admin portal web/laptop-first for the current demo instead of forcing the same mobile treatment

Tasks:

- [x] Build the scan landing flow
- [x] Build the action selection flow for call and message in the current MVP slice
- [x] Keep the scanner UI simple HTML and JavaScript unless a stronger frontend stack becomes necessary
- [x] Keep the UI readable outdoors and minimal to use
- [x] Make the scanner flow work well in a local mobile browser after QR redirect
- [x] Make the scanner flow work in laptop browsers for testing and demo use
- [x] Keep the scanner UI usable as a progressive verification surface for later backend features
- [x] Move the internal verification tools to a dedicated `/verify` page
- [x] Decide that scanner enters phone number before choosing the action
- [x] Decide that current scanner actions are `Call Owner` and `Send Message`
- [x] Decide that `Send Message` should use a real textarea with a prefilled default message
- [x] Decide that the scanner page should show a masked vehicle number, not the full number
- [x] Decide that the call waiting state should say `Please wait while we connect you...`
- [x] Decide that the scanner UI direction should stay clean, readable, structured, and minimal
- [x] Decide to leave `Emergency Number` out of the current M4 slice
- [x] Decide to shape the scanner UI first, then wire the final backend behavior after
- [x] Confirm the public scanner URL shape (`/:token`)
- [x] Decide that unavailable tags should still allow `Send Message`
- [x] Finalize the default prefilled message text for the scanner message action
- [x] Confirm that the immediate demo priority is the mobile QR scan flow for tomorrow’s client presentation
- [x] Refine the current public mobile interface using the `docs/RFA_SPEC.md` user and owner workflow diagrams as the reference direction
- [x] Align the active scanner, unclaimed claim, owner registration, and owner portal screens to one consistent mobile-first interaction model
- [x] Prepare a mobile-first interface for the final user contact actions: `Call`, `SMS`, and `WhatsApp`
- [x] Narrow the current public token page to `Call` plus a WhatsApp-style message action and remove the separate unavailable-owner message box
- [ ] Keep the admin dashboard outside the mobile-first scope for now and treat it as the desktop/web operator surface
- [x] Tighten the scanner, owner registration, and owner portal copy and hierarchy so they read like mobile product flows instead of debug or operator screens
- [x] Reorganize the frontend into clearer `pages`, `scripts`, and `styles` folders so page assets are easier to navigate and maintain
- [x] Make all user-verification endpoints practically usable from mobile so the full MVP can be run and checked from a phone
- [x] Introduce a dedicated scanner verification step and a separate owner-contact action hub without collapsing them into one raw form again
- [x] Add a WhatsApp message template selector with custom-message editing that appears only after the message path is chosen
- [x] Make the call and WhatsApp action buttons create verifiable pending contact requests from the scanner flow
- [ ] Keep `Contact Local Authorities`, `Help`, and vehicle image upload recorded as deferred scanner features instead of current MVP behavior
- [x] Make claimed active tags open the landing shell first and only then open the owner-contact action shell
- [x] Make inactive tags open the owner registration shell instead of the scanner contact shell

Verification:

- [x] Manually verify the scanner flow from a browser
- [ ] Manually verify the scanner flow from a mobile-sized browser
- [ ] Manually verify the scanner flow from a laptop-sized browser
- [ ] Manually verify the unclaimed claim flow from a mobile-sized browser
- [ ] Manually verify the owner self-registration flow from a mobile-sized browser
- [ ] Manually verify the owner portal from a mobile-sized browser
- [ ] Manually verify Page 1 as the mobile verification step
- [ ] Manually verify Page 2 as the mobile action hub
- [ ] Manually verify the mobile action interface for `Call` and `Leave WhatsApp Message`
- [ ] Confirm no scanner view leaks owner private data
- [ ] Confirm the mobile-facing routes `/:token`, `/register-owner`, and `/owner` stay free of debug-style output
- [x] Verify the local scanner root page, `/register-owner`, `/owner`, and static assets respond correctly after the mobile-first UI pass
- [x] Verify `/verify` and the token route still respond correctly after the mobile-first UI pass
- [x] Verify active tokens resolve to contact-flow shell state and registration tokens resolve to registration-shell state locally
- [x] Verify active scanner actions create pending `call` and `whatsapp` contact requests locally

## M5. Implement The Authenticated Owner And Admin Web Flow

Tasks:

- [x] Build the owner claim or activation flow
- [x] Build the owner self-registration flow with QR delivery
- [x] Build the basic owner status toggle
- [x] Build the user-specific owner UI with authentication
- [x] Build the admin UI for laptop browser use
- [x] Keep the owner and admin UI minimal and demo-ready
- [x] Use owner and admin screens as simple verification surfaces for protected backend behavior
- [x] Ensure owner-specific screens return only the authenticated user's data
- [x] Ensure admin-specific screens are separate from scanner and owner surfaces
- [x] Start replacing the shared verification surface with dedicated owner and admin pages
- [x] Reduce `/verify` to internal runtime and seed tools instead of using it as the main owner/admin surface
- [x] Support an `unclaimed` tag state and a public claim form on the token page
- [x] Fix claim flow so unclaimed tags do not expose a masked vehicle number before claim
- [x] Fix claim flow so claimed tags show the correct masked vehicle number after claim
- [x] Build the admin/company QR issuance flow for physical unclaimed sticker handoff
- [x] Add QR generation or QR download flow for newly registered owners
- [x] Keep admin issuance separate from owner personal registration details
- [x] Support batch-based unclaimed tag issuance for sticker generation
- [x] Add a separate admin print queue for unclaimed unprinted tags
- [x] Refine the admin dashboard into a clearer monitoring and issuance surface for the client demo
- [x] Simplify the owner self-registration QR output surface for the client demo
- [x] Rework the admin area into a more dashboard-like sign-in and action experience
- [x] Simplify the owner registration flow so QR generation is easier to understand in the client demo
- [x] Refine the admin and owner onboarding pages for the client meeting flow
- [x] Align demo-seeded unclaimed tags with admin-issued print metadata for local consistency
- [x] Add clearer local admin setup and failure guidance in the admin page
- [x] Rework the admin page into a dashboard shell with a dedicated login screen, sidebar navigation, overview landing area, and sectioned operator panels
- [x] Split the admin operator surface into separate routes for overview, issuance, print queue, owner monitoring, and activity instead of keeping them on one page
- [x] Surface owner self-registrations clearly in admin overview, owner monitoring, and activity feeds
- [x] Add a repeatable regression check for owner self-registration visibility in admin data
- [x] Add a single internal hub page for opening admin, owner, registration, verify, and scanner flows

Verification:

- [x] Manually verify owner claim on an unclaimed tag
- [x] Manually verify owner self-registration produces a claimable or active owner QR output
- [x] Manually verify active or inactive status changes affect scanner behavior
- [x] Manually verify owner login and access isolation
- [x] Manually verify admin login and admin-only access from a laptop browser
- [x] Manually verify `/verify` still works as the internal runtime and seed surface
- [x] Manually verify admin-issued unclaimed tag flow produces a QR/sticker-ready token
- [x] Manually verify admin-issued unclaimed tag flow does not ask for owner personal details
- [x] Manually verify batch issuance produces the requested number of unclaimed tags under one batch number
- [x] Manually verify the print queue lists unclaimed unprinted tags for printing-company handoff
- [x] Verify a newly self-registered owner and tag become visible in admin overview and owner-monitoring data
- [x] Run the automated admin-registration visibility regression check successfully

## M6. Harden Web Security And Authorization Boundaries

Tasks:

- [ ] Review the frontend for common web security risks before demo use
- [ ] Avoid exposing secrets, private identifiers, or sensitive routing data in client code
- [ ] Add secure session handling or token handling for authenticated flows
- [ ] Add server-side authorization checks for every protected route
- [ ] Review input validation for scanner, owner, and admin inputs
- [ ] Keep verification and debug UI simple without exposing unsafe internal data
- [ ] Document any remaining security limitations that are acceptable for the MVP demo
- [x] Block Google Sign-In from auto-creating a new owner account when the Gmail is not already registered — all three handlers (`/callback`, `/credential`, `/popup`) in `routes/auth/google.js` now return `no_account` error instead of inserting a new owner document
- [x] Show a clear error message on the login page when Google Sign-In fails with `no_account` — "No ParkTag account found for this Google account. Please register first."

Verification:

- [ ] Confirm protected routes fail safely without authentication
- [ ] Confirm authenticated users cannot access another user's data
- [ ] Confirm admin-only routes are blocked for non-admin users
- [ ] Confirm the frontend does not expose secrets or unsafe debug data
- [ ] Sign in with a Google account that has NO matching owner in MongoDB → login is blocked, error message "No ParkTag account found for this Google account. Please register first." is shown on the login page
- [ ] Sign in with a Google account whose email matches an existing owner in MongoDB → login succeeds, redirected to `/owner-welcome`
- [ ] Sign in with a Google account that has no matching owner via the One Tap flow → same `no_account` error shown inline
- [ ] Sign in with a Google account that has no matching owner via the redirect flow (`/api/auth/google`) → redirected to `/owner-login?error=no_account` with the correct error message

## M7. Verify Telephony And Fallback Messaging Behavior

Message Delivery Checklist:

- [ ] Confirm the exact Exotel call and message flow and privacy rules
- [ ] Record the required Exotel setup values from the approved project docs
- [ ] Define the backend env vars for Exotel:
- [x] Define the backend env vars for Exotel:
  - `EXOTEL_API_BASE_URL`
  - `EXOTEL_ACCOUNT_SID`
  - `EXOTEL_API_KEY`
  - `EXOTEL_API_TOKEN`
  - `EXOTEL_CALLER_ID`
  - `EXOTEL_STATUS_CALLBACK_URL`
  - `EXOTEL_WHATSAPP_FROM`
- [ ] Define the backend persistence shape for outbound call and message attempts and provider status
- [ ] Add Exotel-backed scanner call triggering from the existing scanner flow
- [x] Add Exotel-backed scanner message sending from the existing scanner flow
- [x] Add a provider webhook route for Exotel status callbacks
- [ ] Update stored provider status from Exotel callbacks
- [x] Verify the local/dev Exotel flow without polluting production data
- [ ] Verify live Exotel call and message delivery to a controlled owner/scanner test pair
- [ ] Verify Exotel failure states stay privacy-safe and understandable

Legacy WhatsApp-only checklist:

- [x] Confirm that the MVP message delivery path had previously been reduced to `WhatsApp` and not `SMS`
- [ ] Confirm the exact owner/scanner WhatsApp message flow and privacy rules
- [ ] Record the required WhatsApp Business Platform setup values from the official Meta docs
- [ ] Define the backend env vars for the WhatsApp Cloud API:
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_BUSINESS_ACCOUNT_ID`
  - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  - `WHATSAPP_GRAPH_API_VERSION`
- [ ] Define the backend persistence shape for outbound WhatsApp message attempts and delivery status
- [ ] Define the approved WhatsApp message template or freeform body to use in the scanner flow
- [ ] Add a scanner-facing backend route that creates a WhatsApp message request
- [ ] Add WhatsApp Cloud API sending from the backend using the official send-message contract
- [ ] Store the sent WhatsApp attempt and immediate API response safely without leaking private data
- [ ] Add a webhook verification route for WhatsApp webhook setup
- [ ] Add a WhatsApp webhook receive route for message-status callbacks
- [ ] Update stored message-attempt status from webhook callbacks such as accepted, delivered, read, or failed
- [ ] Add owner-side visibility for received WhatsApp message requests in the owner dashboard
- [ ] Add admin-side visibility for WhatsApp attempts and delivery state
- [ ] Verify the local/dev WhatsApp flow without polluting production data
- [ ] Verify live WhatsApp delivery to a controlled owner/scanner test pair
- [ ] Verify WhatsApp failure states stay privacy-safe and understandable

Tasks:

- [x] Re-evaluate provider/telephony integration after the current client-demo flow is complete
- [ ] Validate the Exotel-backed call path
- [x] Validate the Exotel-backed message path
- [ ] Replace the current placeholder action flow with Exotel-backed provider behavior
- [ ] Record Exotel implementation assumptions and real-world constraints in `wiki/`

Verification:

- [ ] Confirm a scanner action can trigger the expected provider flow
- [ ] Confirm the scanner `Send Message` action can trigger the expected WhatsApp provider flow
- [ ] Confirm WhatsApp webhook verification succeeds against the deployed backend
- [ ] Confirm WhatsApp delivery or failure updates appear in owner and admin surfaces
- [ ] Confirm failure states remain privacy-safe and understandable

## M8. Prepare Deployment, Demo, Docs, And Operator Runbook

Tasks:

- [x] Deploy the backend server to Render
- [x] Confirm the frontend can be opened from both mobile and laptop browsers against the deployed backend
- [x] Confirm the same simple UI can continue being used for manual verification after deployment
- [x] Add a root README for local setup, running, and verification
- [ ] Write a short demo script
- [ ] Write the setup and manual verification steps needed for a supervisor demo
- [ ] Summarize current working features, known gaps, and risks

Verification:

- [x] Confirm the deployed backend responds from the public internet
- [x] Confirm a QR-driven mobile browser flow can reach the deployed experience
- [x] Confirm a laptop browser can be used for admin verification
- [ ] Run through the demo script once end to end
- [ ] Confirm the repo has enough instructions for another contributor to reproduce the demo

## M9. Tiered Rate Limiting — Per-Route Protection

Tasks:

- [x] Raise global limit in `app.js` → `max: 200, timeWindow: "1 minute"` (was 60)
- [x] Add `config: { rateLimit: { max: 5, timeWindow: "1 minute" } }` to `POST /api/contact-requests` in `routes/public/index.js`
- [x] Add `config: { rateLimit: { max: 10, timeWindow: "1 minute" } }` to `POST /api/tags/:token/verify` in `routes/public/index.js`
- [x] Add `config: { rateLimit: { max: 10, timeWindow: "1 minute" } }` to `POST /api/auth/login` in `routes/auth/credentials.js`
- [x] Add `config: { rateLimit: { max: 5, timeWindow: "1 minute" } }` to `POST /api/auth/send-otp` in `routes/auth/otp.js`
- [x] Add `config: { rateLimit: { max: 5, timeWindow: "1 minute" } }` to `POST /api/auth/forgot-password` in `routes/auth/password-reset.js`

Verification:

- [x] Click rapidly through all 7 admin navbar sections → no rate limit error
- [x] Scanner flow: verify plate → submit contact request → succeeds
- [ ] Submit 6th contact request within 1 min → blocked with `Too many requests`
- [ ] Submit 11th login attempt within 1 min → blocked with `Too many requests`
- [ ] Submit 6th OTP request within 1 min → blocked before any OTP is sent
- [x] `GET /api/health` and `GET /api/runtime/status` respond normally throughout

## M10. Owner Password Registration Path (Testing / Client Decision Pending)

> Added for internal testing. Client will decide whether to keep OTP-only or offer password as an alternative login method after confirming with the team.

Tasks:

- [x] Add `POST /api/owner/set-password` route in `routes/owner/dashboard.js` — requires owner session, min 8 chars, hashes and stores password
- [x] Add "Set a password" step to `/owner-verify` page — shown automatically after OTP verification when `isNewUser === true`
- [x] Add "Save & continue" button that calls `POST /api/owner/set-password` then redirects to `/owner-welcome`
- [x] Add "Skip for now" button to bypass password and go straight to `/owner-welcome`
- [x] Keep "Know your password? Sign in" option on `/owner-verify` for existing password holders (e.g. seeded demo owner)

Verification:

- [ ] Register a new owner via OTP → password step appears automatically after verification
- [ ] Set a password → redirected to `/owner-welcome` successfully
- [ ] Skip password → redirected to `/owner-welcome` without error
- [ ] Sign out → go to `/owner-verify` → "Know your password? Sign in" → enter the password set above → logs in successfully
- [ ] Confirm existing OTP-only owners (no password) are unaffected

## M11. Owner Vehicle Management & Data Integrity

Tasks:

- [x] Add `DELETE /api/owner/tags/:tagId` route — soft delete sets `deletedAt` + `status: "inactive"` so the tag is invisible to all owner and admin queries
- [x] Add "Remove Vehicle" button to the MORE tab on `/owner-vehicle-detail` — shows a confirmation dialog before deleting
- [x] Handle localStorage-only vehicles in the remove flow — clears both the user-scoped key and `pt_pending_vehicles` without hitting the API
- [x] Fix admin dashboard endpoint (`/api/admin/dashboard`) — `ownerTags` now filters `deletedAt` tags so owner tag and active counts are accurate
- [x] Fix admin owners endpoint (`/api/admin/owners`) — same `deletedAt` filter applied so the owner list tag counts are accurate
- [x] Add `syncLocalVehicles()` to `welcome.js` — fires silently after dashboard load, POSTs each localStorage-only vehicle to `/api/owner/local-vehicle`, removes from localStorage on success, then re-fetches dashboard and re-renders the grid with real tokens and QR codes
- [x] Document new vehicle tag allocation and free contact policy in `PLAN.md` section 13

Verification:

- [x] Add a vehicle via `/register-owner` → appears on dashboard with real `PT-XXXXXXXX` tag id (not `DEMO-` prefix) after auto-sync
- [x] Open a vehicle on dashboard → MORE tab → "Remove Vehicle" → confirm → vehicle disappears from dashboard
- [x] Remove a vehicle → refresh admin dashboard → owner tag count decreases correctly (no longer counts deleted tag)
- [ ] Simulate a failed API save during registration (temporarily break the route) → vehicle lands in localStorage → open dashboard → vehicle auto-syncs and gets a real token without any user action
- [ ] Remove a vehicle → check MongoDB directly → confirm `deletedAt` is set and `status` is `"inactive"` (data preserved, not hard-deleted)
- [ ] Owner dashboard never shows a vehicle with `deletedAt` set (soft-deleted tag is fully invisible to owner)

## M12. New Vehicle Registration Flow — End-to-End

Covers the complete flow when an existing owner adds a new vehicle, from the registration page through to a live active tag on the dashboard.

### Step 1 — Owner fills the registration form (`/register-owner`)

- [x] Owner selects vehicle type and enters plate number
- [x] Plate is validated against Indian format (`DL 01 AB 1234`) before the vehicle is added to the in-page list
- [x] Bicycle frame numbers are accepted with a relaxed 3-char minimum instead of the plate regex
- [x] Duplicate plates are rejected (checked against both in-page list and localStorage)
- [x] Owner enters a mobile number (pre-filled and read-only if already saved on the account)
- [x] Submitting with an unfilled type/plate in the input fields auto-adds the vehicle before proceeding

### Step 2 — E-Tag popup and save

- [x] On submit, the E-Tag popup appears showing a printable QR sticker for the first vehicle
- [x] "Download E-Tag" → calls `saveVehicles()` which POSTs each vehicle to `POST /api/owner/local-vehicle` → creates a real tag in MongoDB with `status: "active"`, `freeContactUsed: false`, `premium: false`
- [x] "Skip" → same `saveVehicles()` call, no print dialog
- [x] If the API call fails (network drop etc.) → `savePendingVehicles()` stores the vehicle in `localStorage` as a fallback
- [x] `POST /api/owner/local-vehicle` is idempotent — re-adding the same plate returns `409` and reuses the existing tag (never duplicates)

### Step 3 — Dashboard load and auto-sync

- [x] Owner lands on `/owner-welcome` after registration
- [x] Dashboard fetches `/api/owner/dashboard` → returns all active (non-deleted) tags for this owner
- [x] If any vehicles are localStorage-only (API save failed in step 2), `syncLocalVehicles()` fires silently in the background
- [x] `syncLocalVehicles()` retries `POST /api/owner/local-vehicle` for each localStorage vehicle → on success removes it from localStorage and re-renders the grid with the real tag data
- [x] New vehicle appears on the dashboard with a real `PT-XXXXXXXX` tag id and a scannable QR code

### Step 4 — Tag lifecycle after registration

- [x] New tag starts with `freeContactUsed: false` — one free masked contact is available immediately
- [x] `contactAvailable` on the public tag page reflects `premium OR NOT freeContactUsed`
- [x] After the first scanner contact is made, the backend sets `freeContactUsed: true` — subsequent contact attempts return `402 FREE_USED`
- [x] Owner must purchase the official physical sticker (premium) to unlock unlimited contact for that vehicle
- [x] Each vehicle has its own independent free contact slot — adding a new vehicle never affects other vehicles

### Verification

- [x] Register a new vehicle as an existing owner → vehicle appears on dashboard with real tag id (not `DEMO-` prefix)
- [x] Same plate registered twice → second attempt returns 409, only one tag exists in DB
- [x] Two different vehicles registered → each gets its own independent tag and QR
- [ ] Simulate API failure during registration → vehicle lands in localStorage → open dashboard → vehicle auto-syncs silently and real token appears without any manual action
- [ ] Scan the new vehicle QR as a public user → contact succeeds → `freeContactUsed` becomes `true`
- [ ] Try a second contact on the same tag → page shows `contactAvailable: false`, server returns `402 FREE_USED`
- [ ] Purchase premium on the tag → second contact now succeeds (premium bypasses `freeContactUsed` gate)
- [ ] Admin dashboard shows correct tag count for the owner after adding the new vehicle

## M13. Exotel Inbound Call Flow (Connect-to-Flow)

> Replaces the old two-leg outbound call. Scanner now dials the owner themselves via a virtual Exotel number. Backend provides a "Dial Whom" webhook that Exotel hits to resolve the correct owner number dynamically. The same architecture also powers the owner callback flow — owner dials the same virtual number to reach the scanner.

### Architecture decision
- [x] Remove reliance on `triggerExotelCall` outbound API for the call action — removed from `lib/core/contact-actions.js`; backend no longer initiates the call
- [x] Reuse `EXOTEL_CALLER_ID` as the virtual number — removed `EXOTEL_VIRTUAL_NUMBER` from `lib/env.js`; all routes now read `env.exotelCallerId` for the virtual number returned to the frontend
- [x] Use a unified `pendingCalls` schema with `callerPhone` (who dials the virtual number) and `targetPhone` (who Exotel connects them to) — works for both directions

### Backend — pending call schema (both directions)

Both `register-call` and owner callback store the same shape:

```
{
  callerPhone:  <who dials the virtual number>,
  targetPhone:  <who Exotel should connect to>,
  token:        <tag token>,
  ownerId:      <ObjectId>,
  type:         "scanner_to_owner" | "owner_to_scanner",
  requestId:    <contactRequest ObjectId, set for owner_to_scanner>,
  consumed:     false,
  expiresAt:    <now + 10 min>   ← TTL index auto-deletes this
}
```

Dial Whom always looks up by `callerPhone` — no special casing needed.

### Backend — scanner call registration (public)
- [x] Add `POST /api/tags/:token/register-call` route in `routes/public/index.js` — checks `freeContactUsed` gate, resolves token → owner phone, stores `{ callerPhone: scannerPhone, targetPhone: ownerPhone, type: "scanner_to_owner" }` in `pendingCalls`, returns `{ ok: true, virtualNumber }`
- [x] Add rate limit `max: 5, timeWindow: "1 minute"` to `POST /api/tags/:token/register-call`
- [x] Add MongoDB TTL index on `pendingCalls.expiresAt` so undialled records auto-delete after 10 minutes
- [x] Create contact request record at registration time and set `freeContactUsed: true` on the tag
- [x] Mark pending call record `consumed: true` after Dial Whom lookup to prevent same record routing two calls

### Backend — owner callback registration (authenticated)
- [x] Add `POST /api/owner/callback/register-call` route in `routes/owner/dashboard.js` — requires owner session
- [x] Get `ownerPhone` from session → `owners` collection (`owner.mobile`) — no phone input from the owner
- [x] Block with `402` if `owner.mobile` is not set — prompt owner to add phone first
- [x] Query `contactRequests` for the most recent record for this `ownerId` where `phone` exists and `createdAt >= now - 60min`
- [x] Return `410 CALLBACK_WINDOW_EXPIRED` if no contact request exists within the 60-minute window
- [x] Store `{ callerPhone: ownerPhone, targetPhone: scannerPhone, type: "owner_to_scanner", requestId }` in `pendingCalls`
- [x] Return `{ ok: true, virtualNumber }` — same virtual number as scanner flow

### Backend — Dial Whom webhook
- [x] Add `GET /api/exotel/dial-whom` public endpoint in `routes/webhooks/exotel.js` — reads `CallFrom` query param (A-party from Exotel), looks up unconsumed `pendingCalls` record by `callerPhone`, returns `targetPhone` as plain text
- [x] Exotel Dial Whom response format confirmed: plain text phone number, HTTP 200; non-200 or empty = busy tone
- [x] Return a safe fallback (HTTP 404 + empty body) if no pending record matches the incoming caller number
- [x] Log unmatched Dial Whom hits for debugging without writing phone numbers to logs

### Backend — status callback update
- [x] Update `routes/webhooks/exotel.js` to handle inbound call status events — links by `providerRequestId` (CallSid stored at Dial Whom time) when no `CustomField` is present

### Frontend — scanner call button
- [x] Replace current call trigger (`POST /api/contact-requests` with `action: "call"`) with two-step flow: 1) `POST /api/tags/:token/register-call` → 2) open `tel:<virtualNumber>` on success
- [x] Remove "waiting for a call back" UI state — scanner is making the call, not receiving one
- [x] Show the virtual number visibly on screen as a fallback in case `tel:` link does not auto-open the dialer
- [x] Add a "Tap to Call" button that re-opens `tel:<virtualNumber>` after register-call succeeds
- [x] Handle `register-call` API failure gracefully — show clear error, do not open dialer
- [x] Scanner phone number field remains required — it is the Dial Whom lookup key

### Frontend — owner callback button (dashboard)
- [x] Add a "Call Back" button on each contact request card in the owner dashboard (only shown when `phone` is present on the request)
- [x] Button calls `POST /api/owner/callback/register-call` (no body — phone comes from owner's profile)
- [x] On success, open `tel:<virtualNumber>` — same native dialer flow as scanner
- [x] If `owner.mobile` is not set, show inline prompt "Add your phone number to enable callback"
- [x] Show `410` response as "Window expired — no recent contact within 60 min"
- [x] Button enters loading state while awaiting the API response — never open dialer before success

### Exotel App Bazaar — manual configuration (one-time)
- [ ] Create a Passthru app in App Bazaar with Dial Whom URL → `GET https://<deployed-domain>/api/exotel/dial-whom`
- [ ] Set StatusCallback URL → `POST https://<deployed-domain>/api/provider/exotel/webhook` (already live)
- [ ] Assign an ExoPhone virtual number to this Passthru app — copy the number into `EXOTEL_VIRTUAL_NUMBER` env var
- [ ] Test the App Bazaar flow in sandbox mode before going live

### Verification — scanner → owner
- [ ] Scanner enters phone, clicks "Call Owner" → `register-call` returns virtual number → native dialer opens with virtual number pre-filled
- [ ] Scanner dials virtual number → Exotel hits `GET /api/exotel/dial-whom` with scanner's number → backend returns correct owner phone
- [ ] Call connects: scanner ↔ owner, neither sees the other's real number (both see Exotel's masked number)
- [ ] Contact request record is created in DB immediately when scanner clicks Call (before they even dial)
- [ ] `freeContactUsed` is `true` on the tag immediately after `register-call` succeeds
- [ ] Pending call record is consumed after Dial Whom lookup — same scanner number cannot route a second call with the same record
- [ ] Stale pending call (registered but never dialled) → auto-deleted by TTL index after 10 minutes
- [ ] Second call attempt on same tag where `freeContactUsed: true` → `register-call` returns `402 FREE_USED` before dialer opens
- [ ] Premium tag with `freeContactUsed: true` → `register-call` still succeeds and opens dialer (premium bypasses gate permanently)
- [ ] Unmatched Dial Whom hit (no pending record) → safe fallback response, no crash, no phone number in logs
- [ ] Admin dashboard shows contact request with correct action (`call`) and updated status after call completes

### Verification — owner → scanner callback
- [ ] Scanner contacts owner → "Call Back" button appears on that contact request in the owner dashboard
- [ ] Owner taps "Call Back" within 60 minutes → `register-call` succeeds → native dialer opens with virtual number pre-filled
- [ ] Owner dials virtual number → Exotel hits Dial Whom with owner's phone → backend returns scanner's phone → call bridges correctly
- [ ] Owner taps "Call Back" after 60 minutes → `410 CALLBACK_WINDOW_EXPIRED` → UI shows "window has passed" message, dialer does not open
- [ ] Second scanner contacts owner at 2:30pm, first scanner contacted at 2:00pm → "Call Back" at 2:45pm connects to the second (most recent) scanner
- [ ] Owner has no `mobile` set → "Call Back" button disabled with prompt to add phone number
- [ ] Callback pendingCalls record is consumed after Dial Whom — owner cannot route two calls from one registration

## Current Focus

- [x] Establish root workflow and tracking files
- [x] Write the first wiki note
- [x] Define the minimum demo slice before broader implementation
- [x] Start Milestone 3 with root runtime scaffolding and backend package setup
- [x] Scaffold the first runnable Milestone 3 backend slice
- [x] Verify the first demo-flow backend slice end to end against MongoDB Atlas
- [x] Verify the hosted demo-flow backend slice end to end on Render
- [x] Start replacing the combined debug page with a real scanner-facing public entry point
- [x] Start replacing the shared verify page responsibilities with dedicated owner/admin surfaces
- [x] Switch working direction to `PLAN.md` instead of revising `docs/RFA_SPEC.md`
- [x] Lock the chosen stack to `Fastify + MongoDB + simple HTML/CSS/JS`
- [ ] Track hosted backend, authentication, authorization, security, and cross-device browser support as first-class MVP work
- [ ] Make verification UI-driven wherever practical so the product stays easy to validate as it grows
- [ ] Simplify the prototype stack and remove Redis-style optimization assumptions from the working plan
