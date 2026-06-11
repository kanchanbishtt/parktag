# WaveTag Backend Gateway - Local Guide

This document is the backend-specific source of truth for AI-assisted work inside `Backend-Gateway`. It complements the root `GLOBAL_GUIDE.md` and `DEVELOPMENT_GUIDELINES.md` and applies to all backend planning, implementation, testing, and documentation in this folder.

## 1. Backend Role in WaveTag

`Backend-Gateway` is the backend working area for WaveTag Phase 1.

Its job is to:

- define and protect the backend contract model for Phase 1
- generate unique QR-linked tokens for physical WaveTag stickers
- keep identity mapping server-side
- prepare the backend building blocks that later flows will depend on
- protect all PII while supporting the `<3s` scan-to-ring target

It must not become a generic frontend app. The old Next.js scaffold has been intentionally removed from this folder so future backend work starts from the contract docs and the current backend service base, not from stale route code.

## 2. Project Context

WaveTag is a browser-native anonymous vehicle contact system for Delhi-NCR.

Full product Phase 1 flow:

1. A scanner scans a QR code on a vehicle.
2. The backend resolves the 12-character opaque token server-side.
3. The scanner submits their phone number and chooses an action.
4. The backend creates a temporary session and stores private routing data.
5. The backend triggers a PSTN bridge or masked messaging workflow without exposing real phone numbers.

## 3. Non-Negotiable Mandates

These rules take priority over convenience:

- **Privacy First:** Never expose owner phone numbers, scanner phone numbers, backup contact numbers, or internal owner identifiers to scanner-facing responses.
- **Server-Side Identity Mapping Only:** QR payloads and scanner clients must never decode owner identity directly.
- **PSTN-First for Phase 1:** Do not introduce WebRTC, browser VoIP, WebSocket call signalling, or any client-side calling path.
- **Zero-Friction Scanner Flow:** The backend must support a browser-native flow with no scanner login and no app install.
- **Latency Target:** Design for `<3s` from scanner action to call initiation.
- **Verification Required:** No backend change is complete without automated tests.

## 4. Authoritative Requirements from the RFA

Backend work in this folder must remain aligned with `RFA_Document/RFA_WaveTag_web_Application.md`.

The backend-specific requirements are:

- **R_NO_APP:** Scanner flows must work without app install or account creation.
- **R_PSTN:** Calls must be real PSTN calls, not internet calls.
- **R_PRIVACY:** Real phone numbers must remain hidden from both parties.
- **R_SPEED:** Call bridge initiation must target under 3 seconds.
- **R_RECOVERY:** If the call path fails, the system should support masked messaging recovery.
- **Server-Side Resolution:** Token resolution must stay in backend/edge logic only.
- **Session Expiry:** Temporary communication sessions must expire automatically, with a 30-minute default window unless an explicit approved change is made.

If a requested backend change conflicts with these constraints, stop and surface the conflict before coding.

### 4.1 Documentation Precedence

Use the backend documentation in this order:

1. Approved RFA requirements
2. `DOMAIN_MODEL.md`
3. `SCHEMA_AND_API_CONTRACTS.md`
4. `EXOTEL_CONNECT_INTEGRATION_GUIDE.md` for provider and telephony work
5. `LOCAL_GUIDE.md`
6. `STATUS.md`

Rule:

- if the current scaffold differs from the domain model or contract model, the documentation wins until an intentional documented change is made

## 5. Current Backend Scope

At the time of writing, this package currently includes:

- `src/services/tag-issuance.ts`
  Internal token issuance, one-time claim-code creation, and QR artifact building for unique physical WaveTag stickers.
- `src/services/owner-claim.ts`
  First-time owner claim and local registration persistence logic.
- `src/services/resolve-tag.ts`
  Scanner-safe resolve behavior for `active` and `paused` tags.
- `src/services/create-session.ts`
  Contact-session creation for `call` and `message`, including durable scanner interaction history.
- `src/services/trigger-call.ts`
  Exotel-backed call triggering for valid private `call` sessions.
- `src/services/record-exotel-webhook.ts`
  Narrow Exotel callback handling for provider-driven local state updates.
- `src/services/reconcile-exotel-call.ts`
  Provider-result reconciliation utility for call attempt and private session state.
- `src/lib/database/tag-repository.ts`
  Repository seam backed by a file-based local dev store, with in-memory seams still used for isolated tests.
- `src/lib/database/runtime-repository.ts`
  Runtime repository seam for future MongoDB and Redis adapter selection without rewriting service behavior.
- `src/lib/exotel/config.ts`
  Server-only Exotel configuration loading and validation.
- `src/lib/exotel/connect-client.ts`
  Typed Exotel Connect Two Numbers client seam with safe provider error handling.
- `src/routes/trigger-call-route.ts` and `src/routes/exotel-webhook-route.ts`
  Thin route-safe handler modules layered above services.
- `src/build-server.ts` and `src/server.ts`
  Fastify runtime entrypoints for local development and Cloud Run-style deployment.
- `src/scripts/generate-tag-qr.ts` and `src/scripts/claim-tag.ts`
  Local CLI entry points for generate and claim workflows.
- `src/types/index.ts`
  Backend domain and projection types for the currently implemented slices.

This package is still not feature-complete. The main remaining gaps are:

- stronger Exotel webhook validation beyond the currently accepted narrow payload shape
- production-grade provider reconciliation and idempotency
- production persistence adapters for MongoDB and Redis
- masked messaging recovery
- owner and admin backend APIs

## 6. Directory Intent

Use the current folder structure with these responsibilities:

- `src/services`
  Business logic and backend building blocks. This is the main home for gateway rules.
- `src/lib/database`
  Repository abstractions for local dev persistence and later production persistence seams.
- `src/lib/exotel`
  Server-only provider configuration and Exotel client logic.
- `src/routes`
  Thin route-safe input/output mapping layers that should stay lighter than services.
- `src`
  Runtime files such as `build-server.ts` and `server.ts` should stay thin and focused on HTTP wiring only.
- `src/scripts`
  Local CLI entry points for generating and claiming tags during development.
- `src/types`
  Shared backend domain contracts.

If a file mixes unrelated concerns in one place, that is usually the wrong direction.

## 7. Backend Design Rules

### 7.1 Keep Business Rules Centralized

Put backend rules in services, not scattered across route files.

Examples:

- token normalization
- token issuance
- collision checking
- public QR payload construction
- future claim and activation decisions

### 7.2 Preserve Clear Dependency Seams

Current seams such as `TagRepository` exist for a reason. Extend them rather than bypassing them with direct persistence calls inside services.

### 7.3 Prefer Explicit Domain Types

Use explicit TypeScript types for:

- private persistence records
- issuance inputs and outputs
- future public API payloads once those slices are reintroduced

Do not use `any`.

### 7.4 Keep Public and Private Data Separate

If a structure contains owner phone numbers, scanner phone numbers, or backup numbers, it is private and must stay server-side.

Public product responses should include only what the relevant actor needs, such as:

- token
- owner label
- vehicle label
- masked or abstracted state
- available actions
- session status
- expiry metadata where needed

Rule:

- use the explicit public projections defined in `SCHEMA_AND_API_CONTRACTS.md`
- do not add convenience fields to scanner-facing payloads unless the contract doc is updated first

### 7.5 Contract-First Development

Backend work in this folder must follow a contract-first workflow.

Rules:

- treat `SCHEMA_AND_API_CONTRACTS.md` as the implementation contract for public API behavior
- do not treat the current scaffold as the source of truth when it conflicts with the contract docs
- do not add or change route fields, error codes, status values, or public response shapes without documenting the contract change first
- if a requested change is still ambiguous at the contract level, clarify the contract before writing code
- when implementing a slice, verify exactly which contract sections that slice is satisfying

## 8. Security and Privacy Rules

### 8.1 Never Leak PII

Do not expose any of the following in scanner-facing responses, logs, thrown errors, or debug output:

- owner phone number
- scanner phone number
- backup contact phone number
- internal owner id
- raw persistence payloads

### 8.2 Error Messages Must Stay Safe

Errors returned from backend APIs must be actionable but privacy-safe.

Good:

- `The QR token is invalid or inactive.`
- `This WaveTag is temporarily unavailable.`
- `Unable to create a WaveTag session right now.`

Bad:

- anything containing a real phone number
- anything revealing whether a specific owner exists
- persistence or provider stack details in public responses

Rule:

- stable public error codes and default public messages must come from `SCHEMA_AND_API_CONTRACTS.md`, not ad hoc route-level decisions

### 8.3 Logging Discipline

If logging is introduced later:

- mask phone numbers before logging
- avoid logging full request bodies containing PII
- log provider correlation IDs, session IDs, and sanitized states instead of raw contact data

### 8.4 QR and Token Rules

- Tokens are opaque identifiers.
- Token format is currently enforced as a 12-character uppercase alphanumeric value.
- Never place owner identity, phone numbers, or vehicle registration details inside the QR payload.

## 9. Data and Infrastructure Expectations

Phase 1 target architecture from the RFA:

- **Token Mapping:** MongoDB Atlas
- **Session Cache:** Upstash Redis with TTL
- **Call Orchestration:** Exotel Connect Two Numbers API
- **Masked Messaging:** Exotel or approved equivalent
- **Runtime Style:** server-side backend services and future contract-driven APIs

Until external integrations are added:

- in-memory and file-backed development adapters are acceptable only as seams
- new logic must be written so those adapters can be replaced without rewriting service behavior

## 10. Testing and Verification Rules

These rules are mandatory in this folder:

- Every backend behavior change must add or update automated tests.
- Service logic should be tested directly.
- When route-level code is added back later, those routes should preserve stable error contracts.
- Before closing a task, run the relevant verification commands that exist in this package.

Current verification commands:

```bash
npm test
npm run typecheck
npm run lint
```

If a command fails because the environment is not installed or configured, document that clearly in the task outcome.

### 10.1 Manual Testing Stages

Manual testing is useful in this package, but it must be done in stages so expectations stay realistic.

#### Stage 1. Local Runtime and Error Contract Checks

Use this stage immediately when the Fastify runtime or route layer changes.

Current commands:

```bash
npm run dev
```

Useful checks:

- `GET /health`
- malformed `POST /api/provider/exotel/webhook`
- missing-session `POST /api/session/:sessionId/call`

What this stage proves:

- the server starts locally
- the mounted routes exist
- safe public error envelopes are correct
- the Fastify runtime wiring matches the contract

What this stage does not prove:

- real provider behavior
- production persistence behavior
- retry or idempotency hardening

#### Stage 2. Local Realistic State-Transition Checks

Use this stage when session, trigger-call, or webhook state logic changes.

Current local commands:

```bash
npm run generate
npm run claim -- <token> <claimCode> <ownerPhone> <ownerDisplayName> <vehicleLabel> <plateNumber>
```

Useful checks:

- inspect `generated-qr-codes/dev-tag-store.json`
- create a valid contact session
- trigger the call path
- simulate an Exotel webhook callback
- inspect resulting `scannerSessions`, `scannerInteractions`, and `callAttempts`

What this stage proves:

- local state transitions behave as expected
- scanner-safe and provider-safe route/service behavior is coherent
- the file-backed local development seam is good enough for backend workflow validation

What this stage does not prove:

- MongoDB behavior
- Redis TTL behavior
- production replay handling

#### Stage 3. Container-Local Checks

Use this stage once the runtime or deployment packaging changes.

Useful checks:

- build the backend container image
- run the container locally with `PORT=8080`
- repeat health, trigger-call, and webhook checks against the running container

What this stage proves:

- the runtime packaging works
- `PORT` handling and `0.0.0.0` binding work
- the container shape is compatible with Cloud Run-style execution

#### Stage 4. Real Provider and Deployed Checks

Use this stage only after:

- webhook handling is hardened enough for real provider traffic
- production persistence is in place
- deployment configuration is ready

Useful checks:

- deploy the backend
- configure real Exotel environment variables
- point the Exotel callback URL at the deployed backend
- run controlled calls between verified numbers only

What this stage proves:

- real provider integration works end to end
- deployed callback handling works
- Cloud Run-style runtime behavior matches expectations

Rule:

- treat Stage 1 and Stage 2 as required for normal backend development
- treat Stage 3 as required whenever runtime packaging changes
- do not treat Stage 4 as meaningful until provider hardening and production persistence are ready

## 11. Implementation Priorities

When extending the backend, prefer this order unless the task explicitly says otherwise:

1. Harden Exotel webhook handling beyond the currently accepted narrow payload shape and enforce idempotent callback processing.
2. Add masked messaging recovery flow.
3. Replace the file-backed local dev store with MongoDB and Redis adapters that follow the contract model.
4. Add owner-side status controls and related backend state transitions.
5. Add owner and admin backend APIs.
6. Add deployment hardening such as idempotency, throttling, structured logging, and secret management.

This order matches the Phase 1 value chain and keeps the scanner-critical path first.

## 12. Explicitly Rejected in This Folder

Do not implement these in `Backend-Gateway` unless the architecture is formally changed:

- WebRTC calling
- browser-based VoIP flows
- WebSocket signalling for call setup
- client-side token resolution
- app-install-dependent scanner flows
- social login or scanner account creation
- exposing real owner identity to the scanner
- reviving removed scaffold code as a shortcut instead of rebuilding from the contract docs

## 13. Collaboration Workflow for Backend Tasks

Before making backend code changes:

1. Read this `LOCAL_GUIDE.md`.
2. Read the relevant backend files directly.
3. Read `EXOTEL_CONNECT_INTEGRATION_GUIDE.md` if the slice touches telephony, provider callbacks, or Exotel configuration.
4. Cross-check the request against the RFA if the requirement touches privacy, telephony, sessions, or scope.
5. State a concrete plan with exact files, assumptions, and verification steps.
6. Implement one small verified slice at a time.

While working:

- use minimal, surgical edits
- avoid unrelated refactors
- update documentation if architecture or behavior changes

If a backend request is ambiguous, do not guess. Surface the ambiguity first.

## 14. Known Reality Gaps

Be aware of the current repo state:

- The package now supports QR issuance, owner claim/registration, scanner-safe resolve, contact-session creation, Exotel-triggered call setup, webhook reconciliation, plain route/webhook handlers, and a real Fastify runtime, but not the full gateway flow.
- Persistence still uses a file-backed local dev store by default, with in-memory seams used for isolated tests.
- Production persistence adapters, broader webhook hardening, stronger idempotency, and masked messaging recovery are still absent in code.

Treat these as active cleanup targets only when they are directly relevant to the task at hand. Do not perform broad cleanup without a specific reason.

## 15. Definition of Done for Backend Changes

A backend task in this folder is only complete when:

- the code change matches WaveTag Phase 1 architecture
- privacy constraints remain intact
- the affected behavior is covered by automated tests
- relevant checks are run or any blockers are explicitly reported
- docs are updated if the backend architecture or workflow changed

If any of those are missing, the task is not done.
