# WaveTag Backend Status

This file is the working status tracker for `Backend-Gateway`.

Use it in every backend session to answer four questions quickly:

1. What is already built?
2. What is currently in progress?
3. What should be built next?
4. What changed and what was verified in recent sessions?

## Session Workflow

For each backend work session, follow this process:

1. Read `LOCAL_GUIDE.md`, this `STATUS.md`, and the relevant RFA requirements.
2. Read `EXOTEL_CONNECT_INTEGRATION_GUIDE.md` before any provider or telephony slice.
3. Review the `Current Status`, `In Progress`, and `Next Recommended Slice` sections below.
4. Make one small backend change at a time.
5. Add or update automated tests for that slice.
6. Run the relevant verification commands.
7. Update this file before ending the session.

## Update Rules

At the end of each backend session, update:

- `Current Status`
- `In Progress`
- `Next Recommended Slice`
- `Known Gaps / Risks`
- `Change Log`
- the end-of-day stakeholder update if the session closes the working day

This keeps the backend state visible without relying on memory across sessions.

## End-of-Day Stakeholder Update

At the end of each working day, prepare a short non-technical progress update for stakeholders.

This update should include:

- what was completed today in plain language
- the current rough completion percentage for:
  - backend progress
  - full Phase 1 product progress
- what is already working
- what comes next
- one short overall status sentence

Use this template:

```text
<DATE> - Project Update

Today we completed:
<plain-language summary of today’s completed work>

Current progress
- Backend development: <X% complete>
- Full Phase 1 product overall: <Y% complete>

What is already working
- <item>
- <item>
- <item>

What comes next
- <next item>
- <next item>
- <next item>

Overall status
<one short plain-language summary>
```

Current default phrasing baseline:

- Backend development: about `45% complete`
- Full Phase 1 product overall: about `25-30% complete`

Rule:

- adjust the percentages only when the actual backend/product state has materially changed
- keep the update understandable to a non-technical reader
- do not turn the update into a changelog or code dump

## Resume Context

Use this section as the quick handoff summary before resuming backend work.

**WaveTag backend context right now:**

- The backend already supports QR issuance, owner claim/registration, scanner-safe tag resolve, contact-session creation, Exotel-triggered call setup, and plain route/webhook handlers for the current package.
- Contact sessions currently exist as private live session records plus separate durable scanner interaction records, and valid `call` sessions can now create correlated local `call_attempt` records.
- The current runtime persistence seam is still a file-backed local dev store, not MongoDB or Redis.
- The backend docs are contract-first and must stay aligned to `DOMAIN_MODEL.md`, `SCHEMA_AND_API_CONTRACTS.md`, and `EXOTEL_CONNECT_INTEGRATION_GUIDE.md`.
- `FASTIFY_CLOUD_RUN_RUNTIME_GUIDE.md` now captures the reasoning, architecture, testing model, deployment shape, and current state of the Fastify + Cloud Run runtime.

**Exotel context right now:**

- WaveTag Phase 1 should use Exotel Voice v1 `Connect Two Numbers` for PSTN call bridging.
- Required Exotel product choices for this project are `Voice`, `SMS`, and `WhatsApp`.
- `ExoVerify` is optional only if owner OTP verification is added later.
- `Browser Calling`, `AgentStream`, `Lead Assist`, `SMS Campaigns`, and `Call Campaigns` are not needed for the current Phase 1 backend scope.
- Having Exotel API credentials available in the dashboard does not by itself prove outbound calling is enabled.
- Real outbound voice API testing may still require KYC and a valid Exotel `CallerId` / ExoPhone.
- Trial credits are useful for live provider testing only; they do not change the backend design or the local automated test strategy.

**What is already implemented for Exotel:**

- `Backend-Gateway/Docs/EXOTEL_CONNECT_INTEGRATION_GUIDE.md` exists and captures the integration plan, security rules, testing notes, and account assumptions.
- `Backend-Gateway/Backend/src/lib/exotel/config.ts` loads and validates server-only Exotel configuration.
- `Backend-Gateway/Backend/src/lib/exotel/connect-client.ts` builds and sends the `Connect Two Numbers` request through a typed client seam with safe error handling.
- `Backend-Gateway/Backend/src/services/trigger-call.ts` now validates private `call` sessions, creates local `call_attempt` records, stores Exotel correlation data, and updates private session state.
- `Backend-Gateway/Backend/src/services/record-exotel-webhook.ts` now validates a narrow Exotel callback shape and updates local `call_attempt` plus private session state.
- `Backend-Gateway/Backend/src/services/reconcile-exotel-call.ts` now reconciles local call attempt and private session state from provider call details.
- `Backend-Gateway/Backend/src/routes/trigger-call-route.ts` and `Backend-Gateway/Backend/src/routes/exotel-webhook-route.ts` now expose contract-safe plain handler modules for the current package.
- `Backend-Gateway/Backend/src/build-server.ts` and `Backend-Gateway/Backend/src/server.ts` now expose the implemented routes through a real Fastify runtime.
- `Backend-Gateway/Backend/src/lib/database/runtime-repository.ts` now exists as the runtime seam where future MongoDB and Redis adapters can replace the file-backed store.
- Automated tests already cover Exotel config normalization, request-body shaping, Basic Auth creation, safe provider rejection mapping, invalid-response rejection, direct trigger-call service behavior, route-safe trigger responses, webhook state updates, reconciliation behavior, and Fastify route exposure.

**What is not implemented yet for Exotel:**

- no provider abuse-protection or idempotency logic yet
- no production persistence adapters for the live runtime yet

**Exact next slice to resume with:**

1. add provider abuse protection and idempotency checks around trigger-call and webhook processing
2. replace the file-backed live runtime persistence with MongoDB and Redis adapters
3. expand the HTTP route surface for scanner resolve and session creation on top of the Fastify runtime

**Verification baseline for the last completed slice:**

- `npm test`
- `npm run typecheck`
- `npm run lint`

All three passed for the webhook hardening and reconciliation slice on `2026-06-03`.

## Current Status

**Project Phase:** Phase 1 backend QR issuance and owner-registration foundation

**Current Backend State:**

- A standalone backend package now exists in `Backend-Gateway/Backend`.
- Internal tag issuance utilities exist for unique token generation, one-time claim-code creation, and QR artifact creation.
- The backend package can now generate a token, claim code, QR payload URL, and QR PNG file from the CLI.
- A file-backed local multi-entity repository now persists `owners`, `vehicles`, `tags`, `backupContacts`, and `sosProfiles` in `generated-qr-codes/dev-tag-store.json` so generate and claim work across separate commands.
- The owner-claim flow now acts as a minimal owner-registration slice: it validates the claim code, normalizes owner and backup-contact phone numbers, stores private owner and vehicle data separately, and activates an `unclaimed` tag into `active`.
- A scanner-safe resolve service now returns public metadata for `active` and `paused` tags while treating `unclaimed` and `revoked` tags as unavailable.
- A session-creation service now creates a private live session plus a separate durable scanner interaction history record for valid `call` and `message` flows.
- The repository seam now supports local `call_attempt` persistence plus private session lookup and private session status updates needed for telephony orchestration.
- The in-memory repository seam still exists for isolated testing, but the default runtime repository is now the file-backed dev store.
- `README.md` now includes an explicit manual generate -> inspect store -> claim -> inspect store verification flow for the local registration slice.
- Backend-specific `LOCAL_GUIDE.md` is aligned to the RFA and current gateway scope.
- `README.md` is now reduced to the actual remaining package scope and `STATUS.md` is the backend session tracker.
- `DOMAIN_MODEL.md` now defines the canonical Phase 1 backend entity model, relationships, states, storage boundaries, and privacy boundaries.
- `SCHEMA_AND_API_CONTRACTS.md` now defines the contract-first MongoDB, Redis, route, service, and projection shapes derived from the domain model.
- The backend documentation set is now aligned on the contact-flow versus SOS-flow split, paused-tag resolve behavior, revoked-tag unavailability, and generic session status semantics.
- The backend docs now explicitly require a contract-first implementation workflow before scaffold behavior can be treated as correct.
- `EXOTEL_CONNECT_INTEGRATION_GUIDE.md` now defines the WaveTag-specific Exotel integration flow, security rules, env vars, testing path, and implementation order for the next provider slice.
- A server-only Exotel configuration loader and typed `Connect Two Numbers` client seam now exist in the backend package and are covered by automated tests.
- A `trigger-call.ts` service now validates existing `call` sessions, creates local `call_attempt` records, stores Exotel `Call.Sid` correlation data, updates private session state to `in_progress`, and keeps the trigger result scanner-safe.
- Plain route-handler modules now exist for scanner-side call triggering and Exotel webhook intake, and `record-exotel-webhook.ts` now updates local `call_attempt` plus private session state from accepted callbacks.
- A real Fastify runtime now mounts `GET /health`, `POST /api/session/:sessionId/call`, and `POST /api/provider/exotel/webhook`, and the backend package now includes `dev`/`start` scripts plus container assets for Cloud Run-style deployment.
- `reconcile-exotel-call.ts` now reconciles provider call results into local call-attempt and private session state, and `runtime-repository.ts` now exists as the adapter seam for future production persistence wiring.

**Not Yet Implemented:**

- Owner-authenticated profile editing and tag-status management after initial claim
- Additional HTTP route surface for scanner resolve, session creation, and owner/admin flows
- Masked SMS and WhatsApp recovery flow
- Persistent MongoDB Atlas tag, owner, vehicle, backup-contact, and SOS-profile storage
- Owner dashboard backend APIs
- Admin monitoring backend APIs
- Production-grade auth and role enforcement

## In Progress

- The backend is now at a verified local QR issuance, owner-registration, scanner-safe resolve, contact-session, Exotel trigger-call, plain route/webhook-handler, and Fastify runtime stage.
- The next provider slice should add idempotency and abuse protection, then replace the file-backed runtime persistence with production adapters.

## Next Recommended Slice

The next backend step should be:

**Add idempotency and production persistence on top of the verified webhook and Fastify runtime foundation**

This should cover:

- add idempotency and duplicate-trigger protection for trigger-call and webhook processing
- add rate and abuse protection around provider-costing routes
- replace the file-backed live runtime persistence with MongoDB and Redis-backed adapters
- keep scanner-facing and provider-facing handler responses free of routing numbers or raw provider payloads
- cover the persistence and idempotency slice with direct tests before broader product expansion

Why this comes next:

- QR issuance, first-time owner registration, scanner-safe resolve, and contact-session creation now work end-to-end locally
- the live session boundary, durable scanner-history boundary, local `call_attempt` boundary, plain handler boundaries, and Fastify runtime boundaries now exist and are tested
- the Exotel config/client foundation, trigger-call service, narrow webhook-processing path, and real local HTTP runtime now exist and are tested without requiring live provider calls
- the next useful work is idempotency and production persistence, not first-pass server wiring
- the Exotel guide already defines the required env model, provider correlation fields, callback handling rules, and no-leak constraints for that next slice

## Delivery Roadmap

Recommended backend build order:

1. Harden Exotel webhook handling and add callback reconciliation.
2. Implement masked messaging fallback flows.
3. Replace the local file-backed dev store with real MongoDB-backed persistent adapters.
4. Implement owner dashboard APIs.
5. Implement admin monitoring APIs.
6. Add hardening layers such as rate limiting, retries, and operational reporting.

## Known Gaps / Risks

- The backend currently has no real provider integration, no Redis-backed session flow, and no webhook flow.
- The frontend applications are intentionally not being treated as the source of truth right now; the RFA is the current product contract.
- Future backend code work should be reviewed section-by-section against `SCHEMA_AND_API_CONTRACTS.md`, not against historical scaffold behavior.
- The current owner-registration flow is still CLI-driven and local-dev-only; it is not yet exposed through owner-authenticated backend APIs.
- The current default persistence seam is a file-backed local dev store under `generated-qr-codes`, not durable production storage.
- The current Fastify runtime is in place, but production persistence, stronger webhook validation, and broader HTTP surface area are still absent.
- The current scanner interaction implementation uses a local dev encryption/hash seam and still needs production-grade key management and persistence adapters.
- The Exotel integration now has a tested config/client seam, a tested `trigger-call.ts` service, a tested narrow webhook-processing path, and a tested reconciliation utility, but stronger idempotency, abuse protection, and production persistence are not implemented yet.

## Change Log

| Date | Session Focus | Changes | Verification | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-28 | Backend documentation alignment | Replaced `LOCAL_GUIDE.md` with a backend-specific guide aligned to the RFA and current gateway scaffold. Moved workflow and tracking responsibilities out of `README.md` into `STATUS.md`. | Documentation review against `src/services/gateway.ts`, route handlers, and RFA. | Backend work should now start from `LOCAL_GUIDE.md` and `STATUS.md`. |
| 2026-05-28 | Canonical backend modeling | Added `DOMAIN_MODEL.md` defining the lean Phase 1 backend entities, relationships, state models, storage placement, privacy boundaries, and flow mapping. Updated `STATUS.md` to use the domain model as the next design anchor. | Verified against `src/types/index.ts`, `src/services/gateway.ts`, and backend-relevant RFA sections. | Next step should derive MongoDB, Redis, and API contracts from this domain model. |
| 2026-05-29 | Contract-first backend design | Added `SCHEMA_AND_API_CONTRACTS.md` to define MongoDB document shapes, Redis session shapes, route and service contracts, stable error codes, validation rules, and public/private projections from the domain model. Updated `README.md` and `STATUS.md` to make the contract doc part of the backend workflow. | Documentation review against `LOCAL_GUIDE.md`, `STATUS.md`, `DOMAIN_MODEL.md`, and backend-relevant RFA constraints. | Next step should align gateway validation and error behavior to these contracts before persistence adapters or provider integrations are implemented. |
| 2026-05-29 | Backend building-block gap closure | Aligned `DOMAIN_MODEL.md`, `SCHEMA_AND_API_CONTRACTS.md`, `LOCAL_GUIDE.md`, and `STATUS.md` on contact-flow versus SOS behavior, paused versus revoked tag handling, session status semantics, documentation precedence, missing route/service contracts, and stable error/message guidance. | Cross-review of the four backend docs against the approved RFA and existing scaffold boundaries. | The next step remains code alignment, but the documentation source of truth is now internally consistent. |
| 2026-05-30 | Contract-first workflow lock | Added explicit contract-first implementation rules to `SCHEMA_AND_API_CONTRACTS.md` and `LOCAL_GUIDE.md`, and updated `STATUS.md` to require section-by-section review against the contract docs before scaffold behavior is trusted. | Documentation review across the aligned backend doc set. | Future backend slices should now start from the contract sections they implement, not from the existing code shape. |
| 2026-05-30 | Internal tag issuance utility | Added `src/services/tag-issuance.ts` and tests to generate collision-checked 12-character tokens, build public QR payload URLs, and render QR PNG data URLs for unique physical WaveTag stickers. Updated package test script and `STATUS.md`. | `npm test`, `npm run typecheck`, `npm run lint` after implementation. | This is an internal building block only; admin issuance routes and owner claim flow still need separate contract and implementation slices. |
| 2026-05-30 | Backend scope cleanup | Removed the old Next.js/frontend scaffold, gateway routes, and stale gateway/session code so `Backend-Gateway` now contains only the backend docs plus the minimal token/QR issuance building block and its support seam. Updated package metadata, README, and status tracking to match the reduced scope. | `npm test`, `npm run typecheck`, `npm run lint` after cleanup. | The next clean slice should start from owner claim / activation design instead of trying to reuse the removed scaffold. |
| 2026-05-30 | ESM package declaration cleanup | Added `"type": "module"` to `package.json` so the remaining TypeScript test and service files run without the Node module-type warning. Removed a duplicated status bullet. | `npm test`, `npm run typecheck`, `npm run lint` after the package update. | The reduced package is now cleaner and should run without the earlier Node module-mode warning. |
| 2026-05-30 | Runnable backend package repair | Repaired the standalone backend package under `Backend-Gateway/Backend` by moving source files into the proper `src/...` layout, fixing imports, and adding a CLI script to generate a token and write a QR PNG file. | `npm test`, `npm run typecheck`, `npm run lint`, and `npm run generate:qr -- https://wavetag.example/t .\\generated-qr-codes\\generated-tag.png` in `Backend-Gateway/Backend`. | The backend is now runnable for QR issuance; the next slice should focus on owner claim / activation design and persistence. |
| 2026-05-30 | QR generator usability cleanup | Added a simpler `npm run generate` alias, made the CLI write `./generated-qr-codes/generated-tag.png` by default, and added CLI argument-resolution tests plus README instructions for the simpler workflow. | `npm test`, `npm run typecheck`, `npm run lint`, and `npm run generate` in `Backend-Gateway/Backend`. | The QR utility now works with a single command and no longer appears broken when `--out` is omitted. |
| 2026-05-30 | QR output folder rename | Renamed the default QR artifact folder from `tmp` to `generated-qr-codes` so the output path reflects its real purpose more clearly. Updated tests and docs to match the new artifact location. | `npm test`, `npm run typecheck`, `npm run lint`, and `npm run generate` in `Backend-Gateway/Backend`. | Future generated QR PNGs now go into a clearer artifact directory by default. |
| 2026-05-30 | Clean package structure verification | Confirmed the stale top-level `lib`, `services`, and `types` folders under `Backend-Gateway/Backend` are removed, leaving the active package rooted cleanly under `src/` plus generated artifacts. Re-verified QR generation against the cleaned structure. | `npm run generate`, `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | Verified QR generation still works and writes to `generated-qr-codes/generated-tag.png` after the package-structure cleanup. |
| 2026-05-30 | Minimal owner-claim activation slice | Added first-time owner claim activation with one-time claim-code validation, normalized owner phone handling, a CLI claim flow, and file-backed local tag persistence so generated `unclaimed` tags and claimed `active` tags survive across separate commands. Updated tests to cover unclaimed-tag persistence, successful claim activation, and invalid claim-code rejection. | `npm run generate`, manual inspection of `generated-qr-codes/dev-tag-store.json`, `npm run claim -- <token> <claimCode> 9876543210 "Silver Honda City" 5521`, manual inspection of `generated-qr-codes/dev-tag-store.json`, `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | This is still a local dev persistence slice; explicit owner, vehicle, backup-contact, and SOS-profile models are the next clean expansion. |
| 2026-05-31 | Local owner-registration persistence slice | Expanded the local dev persistence model from tag-only storage into explicit `owners`, `vehicles`, `tags`, `backupContacts`, and `sosProfiles`. Updated owner claim into a minimal owner-registration flow that stores private owner display name, full plate number, optional backup contacts, and SOS data while keeping scanner-facing identity rules unchanged. Refreshed the CLI, tests, and README manual verification instructions to match the new registration payload. | `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | The next clean slice is scanner-safe resolve behavior against the new local registration model. |
| 2026-05-31 | Scanner-safe resolve slice | Added a direct resolve service that validates the token format, returns scanner-safe public metadata for `active` and `paused` tags, and treats `unclaimed` and `revoked` tags as unavailable. Extended tests to cover active, paused, invalid-format, missing-tag, unclaimed, and revoked resolve outcomes. Updated README and STATUS to document the resolve behavior. | `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | The next clean slice is temporary contact-session creation for `call` and `message`. |
| 2026-05-31 | Scanner interaction history design update | Updated `DOMAIN_MODEL.md`, `SCHEMA_AND_API_CONTRACTS.md`, and `STATUS.md` so scanner phone history is modeled as a separate durable `scanner_interaction` record linked to `sessionId`, `tagId`, `ownerId`, and `token`, instead of being kept only inside an expiring session. Documented that future outreach must remain separate from interaction history and should rely on explicit consent fields. | Documentation review across the aligned backend doc set. | The next clean slice is now session creation plus durable scanner interaction storage. |
| 2026-05-31 | Contact-session creation slice | Added a direct session-creation service for `call` and `message` that validates active tags, normalizes scanner phone numbers, creates a private live session record, and writes a separate durable scanner interaction history record. Extended the local dev store to include `scannerSessions` and `scannerInteractions`, added direct tests for valid and invalid session flows, and updated README/STATUS to document the new session boundary. | `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | The next clean slice is Exotel call trigger flow on top of the verified session model. |
| 2026-05-31 | End-of-day update workflow note | Added an explicit end-of-day stakeholder update rule and template to `STATUS.md` so daily closes include a short non-technical progress summary with percentages, working features, and next steps. | Documentation update only. | Use the stored percentage baseline unless the actual project state materially changes. |
| 2026-06-02 | Exotel provider integration planning | Added `EXOTEL_CONNECT_INTEGRATION_GUIDE.md` to define the WaveTag-specific Exotel Connect integration flow, env vars, trigger-call/webhook design, low-cost testing path, and privacy/security rules. Updated `README.md` and `STATUS.md` so provider work starts from that guide. | Documentation review against the current backend session model, `SCHEMA_AND_API_CONTRACTS.md`, and the official Exotel Voice v1 docs. | The next clean slice remains the Exotel call trigger implementation, now with an explicit provider-security blueprint. |
| 2026-06-02 | Exotel client foundation slice | Added a server-only Exotel config loader and typed `Connect Two Numbers` client seam under `src/lib/exotel`, updated the test script, and covered config normalization, request shaping, Basic Auth handling, safe provider-error mapping, and invalid-response rejection with automated tests. | `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | The next clean slice is `call_attempt` persistence plus `trigger-call.ts` using the new client seam. |
| 2026-06-02 | Exotel trigger-call slice | Added `call_attempt` types plus repository support for local `call_attempt` persistence, private session lookup, and private session status updates. Implemented `src/services/trigger-call.ts` to validate `call` sessions, create local `call_attempt` records, send the Exotel connect request through the existing client seam, store Exotel `Call.Sid` correlation data, and update the private session to `in_progress`. Extended direct service tests to cover happy-path call triggering plus missing-session, expired-session, wrong-action, and provider-failure cases. | `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | The next clean slice is the public call-trigger route plus Exotel webhook handling and reconciliation. |
| 2026-06-02 | Exotel route and webhook-handler slice | Added plain route-handler modules for scanner-side call triggering and Exotel webhook intake under `src/routes`, plus `src/services/record-exotel-webhook.ts` for callback-driven state updates. Extended the repository seam with provider-request lookup and webhook-driven `call_attempt` updates, and added direct tests for scanner-safe route responses, completed-call webhook reconciliation, and malformed webhook rejection. | `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | The next clean slice is webhook hardening plus callback reconciliation and eventual framework-bound route wiring. |
| 2026-06-03 | Fastify runtime wiring slice | Installed Fastify, added `src/build-server.ts` and `src/server.ts`, mounted `GET /health`, `POST /api/session/:sessionId/call`, and `POST /api/provider/exotel/webhook`, added `dev` and `start` scripts, and added `Dockerfile` plus `.dockerignore` for Cloud Run-style deployment. Extended tests with Fastify `app.inject()` coverage for the mounted routes. | `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | The next clean slice is webhook hardening, callback reconciliation, and production persistence for the live runtime. |
| 2026-06-03 | Webhook hardening and reconciliation slice | Expanded Exotel webhook status handling to cover additional callback states, added `reconcile-exotel-call.ts` for provider-result reconciliation, and introduced `runtime-repository.ts` as the adapter seam for future MongoDB and Redis runtime persistence. Extended direct tests for answered and busy callbacks, malformed callback rejection, reconciliation behavior, and kept the Fastify runtime green. | `npm test`, `npm run typecheck`, and `npm run lint` in `Backend-Gateway/Backend`. | The next clean slice is idempotency and production persistence for the live runtime. |
