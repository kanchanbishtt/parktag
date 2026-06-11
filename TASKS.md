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

Verification:

- [ ] Confirm protected routes fail safely without authentication
- [ ] Confirm authenticated users cannot access another user's data
- [ ] Confirm admin-only routes are blocked for non-admin users
- [ ] Confirm the frontend does not expose secrets or unsafe debug data

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
- [ ] Track hosted backend, authentication, authorization, security, and cross-device browser support as first-class MVP work
- [ ] Make verification UI-driven wherever practical so the product stays easy to validate as it grows
- [ ] Simplify the prototype stack and remove Redis-style optimization assumptions from the working plan
- [x] Switch working direction to `PLAN.md` instead of revising `docs/RFA_SPEC.md`
- [x] Lock the chosen stack to `Fastify + MongoDB + simple HTML/CSS/JS`
