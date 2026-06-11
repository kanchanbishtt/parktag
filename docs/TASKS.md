# WaveTag Backend Execution Tracker

This file tracks execution work for `Backend-Gateway`.

Rules:

- keep entries implementation-specific
- every milestone must include a concrete manual verification step
- tick tasks only after the milestone verification step is complete

- add newly discovered execution tasks under the correct milestone
- do not use this file to track documentation-only work

Note:

- the repo still contains automated checks and existing tests
- this tracker is intentionally focused on build and manual verification steps for the user and the AI agent

## Milestones

- [x] M1. Backend QR issuance and owner-claim foundation
- [x] M2. Backend scanner resolve and contact-session foundation
- [x] M3. Provider integration foundation for Exotel call flow
- [x] M4. Fastify runtime foundation
- [ ] M5. Runtime safety: idempotency and abuse protection
- [ ] M6. Production persistence adapters
- [ ] M7. Public scanner HTTP surface completion
- [ ] M8. Masked messaging recovery
- [ ] M9. Owner and admin backend surface
- [ ] M10. Deployment and live provider validation

## M1. Backend QR Issuance and Owner-Claim Foundation

Category:
- backend core logic
- local persistence

Tasks:
- [x] Implement unique 12-character token generation
- [x] Implement one-time claim-code generation
- [x] Implement QR payload URL construction
- [x] Implement QR PNG rendering
- [x] Persist issued tags in the local development store
- [x] Implement owner-claim activation flow
- [x] Normalize owner phone numbers
- [x] Persist owner, vehicle, backup-contact, and SOS data in the local development store

Verification: 
- [x] Run `npm run generate`
- [x] Confirm a new `unclaimed` tag is written into `generated-qr-codes/dev-tag-store.json`
- [x] Run `npm run claim -- <token> <claimCode> <ownerPhone> <ownerDisplayName> <vehicleLabel> <plateNumber>`
- [x] Confirm the tag becomes `active` and related owner/vehicle data is written into the local store

## M2. Backend Scanner Resolve and Contact-Session Foundation

Category:
- backend core logic
- scanner flow

Tasks:
- [x] Implement scanner-safe resolve for `active` tags
- [x] Implement paused-tag non-actionable resolve behavior
- [x] Treat `unclaimed` and `revoked` tags as unavailable
- [x] Implement contact-session creation for `call` and `message`
- [x] Normalize scanner phone numbers
- [x] Persist private scanner sessions locally
- [x] Persist durable scanner interaction history locally

Verification:
- [x] Create a local `active` tag scenario and confirm resolve returns only scanner-safe fields
- [x] Confirm `paused` tags resolve with `availableActions: []`
- [x] Confirm `unclaimed` and `revoked` tags are unavailable
- [x] Create a contact session and confirm `scannerSessions` and `scannerInteractions` are written into the local store

## M3. Provider Integration Foundation for Exotel Call Flow

Category:
- provider integration
- backend orchestration

### M3.1 Provider Config and Client

Tasks:
- [x] Add server-only Exotel config loader
- [x] Add typed Exotel Connect Two Numbers client seam
- [x] Add provider request shaping and safe provider error mapping

### M3.2 Trigger Call

Tasks:
- [x] Add `call_attempt` domain types
- [x] Add local `call_attempt` repository support
- [x] Implement `trigger-call.ts`
- [x] Store provider correlation (`Call.Sid`)
- [x] Update private session state to `in_progress` on successful trigger

### M3.3 Webhook Handling

Tasks:
- [x] Implement narrow Exotel webhook processing
- [x] Reject malformed webhook payloads safely
- [x] Handle `completed` callbacks
- [x] Handle `answered` callbacks
- [x] Handle `busy` callbacks
- [x] Tolerate replayed terminal callbacks without breaking final state shape

### M3.4 Reconciliation

Tasks:
- [x] Implement `reconcile-exotel-call.ts`
- [x] Reconcile local `call_attempt` and private session state from provider result data
- [ ] Add real Exotel call-details reconciliation utility
- [ ] Decide whether reconciliation should be manual, route-triggered, or background-driven

Verification:
- [x] Trigger a local `call` session and confirm a new `callAttempt` is created
- [x] Simulate a `completed` webhook and confirm session and call attempt become terminal
- [x] Simulate an `answered` webhook and confirm session remains `in_progress`
- [x] Simulate a `busy` webhook and confirm session becomes `failed`
- [x] Replay a terminal webhook and confirm state shape remains stable
- [x] Run reconciliation for an existing `callAttempt` and confirm local state updates consistently

## M4. Fastify Runtime Foundation

Category:
- backend runtime
- HTTP transport
- deployment foundation

### M4.1 Server Runtime

Tasks:
- [x] Install Fastify
- [x] Add `build-server.ts`
- [x] Add `server.ts`
- [x] Mount `GET /health`
- [x] Mount `POST /api/session/:sessionId/call`
- [x] Mount `POST /api/provider/exotel/webhook`
- [x] Add `npm run dev`
- [x] Add `npm start`

### M4.2 Container Runtime

Tasks:
- [x] Add Dockerfile
- [x] Add `.dockerignore`

Verification:
- [x] Run `npm run dev`
- [x] Confirm `GET /health` returns success locally
- [x] Confirm `POST /api/session/:sessionId/call` returns the expected safe error for a missing session
- [x] Confirm malformed webhook requests to `POST /api/provider/exotel/webhook` return the expected safe error
- [ ] Build the container locally
- [ ] Run the container locally with `PORT=8080`
- [ ] Confirm `GET /health` works through the containerized runtime

## M5. Runtime Safety: Idempotency and Abuse Protection

Category:
- backend runtime safety
- provider-cost protection

### M5.1 Trigger Idempotency

Tasks:
- [x] Block duplicate live call triggers for the same session
- [ ] Add duplicate-trigger protection across broader provider state combinations
- [ ] Add idempotency handling for repeated scanner taps against the same active flow

### M5.2 Webhook Replay and Re-entry Safety

Tasks:
- [x] Tolerate replayed terminal callbacks
- [ ] Add explicit replay guard beyond terminal replay tolerance
- [ ] Add handling for repeated non-terminal callback re-entry

### M5.3 Abuse Controls

Tasks:
- [ ] Add per-session throttling
- [ ] Add per-tag throttling
- [ ] Add provider-cost route abuse protection
- [ ] Add request-level rate limiting after persistence adapters exist

Verification:
- [x] Trigger the same live session twice and confirm the second trigger is blocked
- [x] Replay the same terminal webhook and confirm state does not regress
- [ ] Repeat non-terminal callbacks and confirm state transitions are idempotent
- [ ] Confirm abuse-control behavior manually once throttling/rate limits are implemented

## M6. Production Persistence Adapters

Category:
- persistence
- infrastructure integration

### M6.1 Adapter Boundaries

Tasks:
- [x] Add `runtime-repository.ts`
- [ ] Add MongoDB-backed durable repository implementation
- [ ] Add Redis-backed active-session repository implementation
- [ ] Finalize durable-vs-TTL adapter boundaries

### M6.2 Migration Off File-Backed Runtime Storage

Tasks:
- [ ] Replace file-backed live runtime storage for tags
- [ ] Replace file-backed live runtime storage for owners
- [ ] Replace file-backed live runtime storage for vehicles
- [ ] Replace file-backed live runtime storage for backup contacts
- [ ] Replace file-backed live runtime storage for SOS profiles
- [ ] Replace file-backed live runtime storage for scanner interactions
- [ ] Replace file-backed live runtime storage for call attempts
- [ ] Preserve local development ergonomics after adapter switch
- [ ] Keep in-memory seams for isolated logic validation

Verification:
- [ ] Start the runtime against production-style adapters locally
- [ ] Confirm tag/session/call-attempt writes land in the correct durable or TTL store
- [ ] Confirm the runtime still supports local manual flow checks after the adapter switch

## M7. Public Scanner HTTP Surface Completion

Category:
- public backend API
- scanner flow

Tasks:
- [ ] Add scanner resolve HTTP route on the Fastify runtime
- [ ] Add session creation HTTP route on the Fastify runtime
- [ ] Add session outcome/status route
- [ ] Add SOS disclosure route if Phase 1 still requires it
- [ ] Keep all scanner-facing responses aligned with the backend contract

Verification:
- [ ] Resolve a valid tag through HTTP and confirm only scanner-safe fields are returned
- [ ] Create a session through HTTP and confirm the local/private state is updated
- [ ] Fetch a session outcome through HTTP and confirm the response remains scanner-safe
- [ ] Verify all unavailable/error conditions return the intended safe envelopes

## M8. Masked Messaging Recovery

Category:
- provider integration
- fallback flow

Tasks:
- [ ] Define message-attempt persistence model in code
- [ ] Implement `trigger-message` service
- [ ] Add scanner-facing message recovery route
- [ ] Integrate SMS/WhatsApp provider flow
- [ ] Add message delivery status tracking

Verification:
- [ ] Trigger a message recovery flow manually
- [ ] Confirm local/private state reflects message attempt creation
- [ ] Confirm scanner-facing responses remain safe and minimal

## M9. Owner and Admin Backend Surface

Category:
- owner backend API
- admin backend API
- auth

Tasks:
- [ ] Add owner tag-status update API
- [ ] Add owner profile editing API
- [ ] Add backup contact management APIs
- [ ] Add SOS profile management APIs
- [ ] Add admin monitoring APIs
- [ ] Add admin interaction/session visibility APIs
- [ ] Add auth and role enforcement for owner/admin surfaces

Verification:
- [ ] Validate owner route behavior with authenticated owner test accounts
- [ ] Validate admin route behavior with authenticated admin test accounts
- [ ] Confirm no scanner-safe routes leak owner/admin-only data

## M10. Production Deployment and Live Provider Validation

Category:
- deployment
- live provider validation

### M10.1 Runtime and Config

Tasks:
- [x] Local Fastify runtime works
- [x] Container runtime artifacts exist
- [ ] Validate container locally with `PORT=8080`
- [ ] Wire Cloud Run deployment config
- [ ] Configure production environment variables

### M10.2 Live Provider Validation

Tasks:
- [ ] Connect real Exotel callback URL
- [ ] Run controlled real-number PSTN validation
- [ ] Record newly discovered execution work back into this tracker

Verification:
- [ ] Confirm deployed runtime starts correctly
- [ ] Confirm deployed health route works
- [ ] Confirm live trigger-call path reaches Exotel
- [ ] Confirm live callback path updates local state correctly
- [ ] Confirm controlled real-number PSTN flow works end to end

## Current Focus

- [ ] Implement production persistence adapters for MongoDB and Redis
- [ ] Add broader idempotency and abuse protection
