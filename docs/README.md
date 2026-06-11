# WaveTag Backend Gateway

This folder contains the WaveTag Phase 1 backend documentation set plus the currently implemented local backend building blocks for QR issuance, owner claim, scanner-safe resolve, contact-session creation, Exotel-triggered call setup, webhook reconciliation, plain route/webhook handlers, and a real Fastify runtime.

## Current Scope

- generate a unique 12-character WaveTag token
- generate a one-time owner claim code for that tag
- prevent token collisions against the current tag repository seam
- build a public QR payload URL from that token
- render a QR PNG data URL for printing or export
- persist local dev registration data for tags, owners, vehicles, backup contacts, and SOS profiles
- activate an `unclaimed` tag into an `active` owner-linked registration from the CLI
- resolve a token into scanner-safe public metadata for `active` and `paused` tags
- create a private contact session plus a durable scanner interaction history record for `call` and `message`
- validate server-only Exotel configuration and build typed Connect Two Numbers requests through a safe client seam
- trigger a scanner-safe PSTN call flow for a valid private `call` session while storing local `callAttempt` correlation state
- reconcile provider callback state for existing call attempts and private sessions
- expose plain route-handler modules for call-trigger and Exotel webhook processing that match the contract docs
- run a real Fastify server locally and in a Cloud Run-style container runtime

This folder does not currently expose owner/admin routes or Redis-backed session handling in code.

## Tech Stack

- **Language:** TypeScript
- **QR Rendering:** `qrcode`
- **Verification:** Node test runner, TypeScript, ESLint

## Current Project Structure

- `src/services/tag-issuance.ts`: internal token, claim-code, and QR issuance logic
- `src/services/owner-claim.ts`: first-time owner claim and local registration persistence logic
- `src/services/resolve-tag.ts`: scanner-safe resolve service over the local registration model
- `src/services/create-session.ts`: session creation service for `call` and `message`
- `src/services/trigger-call.ts`: Exotel-backed call trigger service for valid private `call` sessions
- `src/services/record-exotel-webhook.ts`: Exotel webhook processing service for callback-driven call/session state updates
- `src/services/reconcile-exotel-call.ts`: reconciliation utility for aligning local state with provider call results
- `src/services/tag-issuance.test.ts`: issuance, owner-claim, resolve, session-creation, and trigger-call service tests
- `src/lib/database/runtime-repository.ts`: runtime repository seam for future production persistence adapter selection
- `src/lib/exotel/config.ts`: server-only Exotel configuration loading and validation
- `src/lib/exotel/connect-client.ts`: typed Exotel Connect Two Numbers client seam
- `src/lib/exotel/connect-client.test.ts`: Exotel config normalization, request shaping, and provider error-mapping tests
- `src/routes/trigger-call-route.ts`: plain scanner-facing call-trigger route handler module
- `src/routes/exotel-webhook-route.ts`: plain Exotel webhook route handler module
- `src/build-server.ts`: Fastify app builder that mounts the implemented HTTP routes
- `src/server.ts`: runtime entrypoint for local use and Cloud Run-style execution
- `src/scripts/generate-tag-qr.ts`: CLI QR generation entry point
- `src/scripts/generate-tag-qr.test.ts`: CLI argument-resolution and QR-generation command tests
- `src/scripts/claim-tag.ts`: CLI claim and registration entry point
- `src/lib/database/tag-repository.ts`: local multi-entity dev store seam for tags, owners, vehicles, scanner sessions, scanner interactions, backup contacts, and SOS profiles
- `src/types/index.ts`: local backend entity types used by issuance and claim

## Getting Started

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run dev
npm run generate
npm run claim -- <token> <claimCode> <ownerPhone> <ownerDisplayName> <vehicleLabel> <plateNumber>
```

## QR Generator

From `Backend-Gateway/Backend`, the simplest command is:

```bash
npm run generate
```

Default behavior:

- uses `https://wavetag.example/t` unless `WAVETAG_PUBLIC_BASE_URL` is set
- writes the QR PNG to `./generated-qr-codes/generated-tag.png`
- prints the generated tag ID, token, claim code, and QR payload URL

Examples:

```bash
npm run generate -- https://wavetag.example/t
npm run generate -- https://wavetag.example/t ./generated-qr-codes/my-tag.png
npm run generate -- --public-base-url https://wavetag.example/t --out ./generated-qr-codes/my-tag.png
```

## Claim and Register

From `Backend-Gateway/Backend`, claim an `unclaimed` tag and create the related local owner registration records:

```bash
npm run claim -- <token> <claimCode> <ownerPhone> <ownerDisplayName> <vehicleLabel> <plateNumber>
```

Example:

```bash
npm run claim -- AJXL9TTFTL3P LM9TZ4N9 9876543210 "Krishna Singh" "Silver Honda City" DL8CAQ5521 --backup-contact-name "Anita Singh" --backup-contact-phone 9810012345 --backup-contact-relationship Spouse --blood-group O+
```

The local dev store is written to:

```text
./generated-qr-codes/dev-tag-store.json
```

The current dev-store schema contains:

- `owners`
- `vehicles`
- `tags`
- `scannerSessions`
- `scannerInteractions`
- `callAttempts`
- `backupContacts`
- `sosProfiles`

## Scanner-Safe Resolve

The backend now includes a direct resolve service for scanner-safe metadata.

Current resolve rules:

- `active` tag -> returns scanner-safe metadata and allowed actions
- `paused` tag -> returns scanner-safe metadata with `availableActions: []`
- `unclaimed` tag -> treated as unavailable for scanner-safe resolve
- `revoked` tag -> treated as unavailable for scanner-safe resolve

Scanner-safe resolve data may include only:

- `token`
- `ownerLabel`
- `vehicleLabel`
- `plateLastFour`
- `status`
- `availableActions`

The scanner-facing `ownerLabel` remains the fixed public value:

```text
Vehicle Owner
```

Private values such as owner name, phone numbers, full plate number, backup contacts, and SOS details remain server-side.

## Session Creation

The backend now includes a direct session-creation service for contact flows.

Current session rules:

- only `call` and `message` create sessions
- only `active` tags can create sessions
- `paused`, `unclaimed`, and `revoked` tags must not create sessions
- scanner phone numbers are normalized to Indian E.164 format
- one private live session record is created
- one separate durable scanner interaction history record is created

The live private session is for short-lived routing state.

The durable scanner interaction record is for:

- owner/tag interaction history
- admin support traceability
- future lead workflows only when explicit marketing consent exists

## Call Trigger

The backend now includes a direct trigger-call service for private `call` sessions.

Current trigger-call rules:

- only an existing session with `action: "call"` can trigger telephony
- expired, completed, failed, or closed sessions must not trigger telephony
- one local `callAttempt` record is created before provider correlation is stored
- a successful provider request updates the private session status to `in_progress`
- scanner-facing trigger results expose only `sessionId`, `callAttemptId`, and the high-level trigger status

## Exotel Foundation

The backend now includes the server-only Exotel groundwork plus the first trigger-call slice.

Current Exotel support:

- `src/lib/exotel/config.ts` validates required env vars and normalizes safe server-only configuration
- `src/lib/exotel/connect-client.ts` builds the Exotel Connect Two Numbers request and maps provider failures to safe backend errors
- `src/services/trigger-call.ts` validates the private session, creates a local `callAttempt`, sends the provider request, stores provider correlation data, and updates the private session status
- `src/services/record-exotel-webhook.ts` validates a narrow Exotel callback shape and updates local `callAttempt` plus private session state
- `src/services/reconcile-exotel-call.ts` reconciles local call/session state from provider call details when needed
- `src/routes/trigger-call-route.ts` and `src/routes/exotel-webhook-route.ts` expose contract-safe plain handler modules for the current package
- `src/build-server.ts` and `src/server.ts` now expose those handlers through a real Fastify server runtime
- `src/lib/database/runtime-repository.ts` provides the runtime seam where future MongoDB and Redis adapters can replace the file-backed store
- automated tests cover config normalization, request-body shaping, Basic Auth handling, invalid response rejection, direct trigger-call service behavior, webhook state updates, reconciliation behavior, and Fastify route exposure

Still not implemented:

- callback hardening beyond the narrow accepted payload shape
- production-grade provider reconciliation and idempotency
- owner/admin HTTP route surface

## Fastify Runtime

The backend now includes a real Fastify runtime for local development and Cloud Run-style deployment.

Current runtime endpoints:

- `GET /health`
- `POST /api/session/:sessionId/call`
- `POST /api/provider/exotel/webhook`

Current runtime commands:

- `npm run dev`
- `npm start`

Current deployment assets:

- `Backend-Gateway/Backend/Dockerfile`
- `Backend-Gateway/Backend/.dockerignore`

## Manual Test Flow

Use this section when you want to test the current local registration workflow end-to-end and understand what is changing in the store.

### 1. Start in the backend package

Run all commands from:

```text
Backend-Gateway/Backend
```

### 2. Generate a fresh tag

```bash
npm run generate
```

What this does:

- creates one new `unclaimed` tag record
- generates a one-time claim code for that tag
- writes the QR PNG to `./generated-qr-codes/generated-tag.png`
- stores the local dev data in `./generated-qr-codes/dev-tag-store.json`

What the command prints:

- `Tag ID`
- `Token`
- `Claim Code`
- `QR URL`

### 3. Inspect the local store after generate

```powershell
Get-Content '.\generated-qr-codes\dev-tag-store.json' -Raw
```

Expected result after `generate`:

- `tags` contains one new record
- that tag has:
  - `status: "unclaimed"`
  - `ownerId: null`
  - `vehicleId: null`
  - `claimCodeHash`, `claimCodeSalt`, and `claimCodeIssuedAt` populated
- `owners` is still empty
- `vehicles` is still empty
- `backupContacts` is still empty
- `sosProfiles` is still empty

### 4. Claim and register the tag

Use the exact `Token` and `Claim Code` printed by `npm run generate`.

Minimal example:

```bash
npm run claim -- <TOKEN> <CLAIM_CODE> 9876543210 "Krishna Singh" "Silver Honda City" DL8CAQ5521
```

Example with optional backup-contact and SOS data:

```bash
npm run claim -- <TOKEN> <CLAIM_CODE> 9876543210 "Krishna Singh" "Silver Honda City" DL8CAQ5521 --backup-contact-name "Anita Singh" --backup-contact-phone 9810012345 --backup-contact-relationship Spouse --blood-group O+
```

What this does:

- validates the token and claim code
- creates an `owner` record
- creates a `vehicle` record
- optionally creates `backupContacts`
- creates an `sosProfile`
- updates the existing tag from `unclaimed` to `active`

### 5. Inspect the local store after claim

```powershell
Get-Content '.\generated-qr-codes\dev-tag-store.json' -Raw
```

Expected result after `claim`:

- `tags[0]` now has:
  - non-null `ownerId`
  - non-null `vehicleId`
  - `status: "active"`
  - cleared `claimCodeHash`, `claimCodeSalt`, and `claimCodeIssuedAt`
- `owners` contains one owner record with:
  - `displayLabel`
  - `primaryPhone`
- `vehicles` contains one vehicle record with:
  - `plateNumber`
  - `plateLastFour`
  - `vehicleLabel`
- `backupContacts` contains one record if you passed the optional backup-contact arguments
- `sosProfiles` contains one record

### 6. What belongs where

- `tags`
  - token lifecycle and active/paused/unclaimed state
- `owners`
  - private owner identity such as name and phone
- `vehicles`
  - full plate number and vehicle label
- `backupContacts`
  - family or emergency contact records
- `sosProfiles`
  - blood group and other emergency profile data
- `scannerSessions`
  - short-lived live routing state for `call` and `message`
- `scannerInteractions`
  - durable scanner-number history linked to `sessionId`, `tagId`, `ownerId`, and `token`
- `callAttempts`
  - provider correlation and telephony-attempt state for `call` sessions

### 7. Validation notes

- owner and backup-contact phone numbers are normalized to Indian E.164 format
- scanner phone numbers are normalized to Indian E.164 format
- full plate number is stored privately
- `plateLastFour` is derived from the full plate number
- scanner-facing `ownerLabel` is still intended to remain the fixed public value `Vehicle Owner`
- scanner-safe resolve treats `unclaimed` and `revoked` tags as unavailable
- session creation stores scanner numbers in two separate ways:
  - raw normalized phone inside the private live session
  - production-shaped encrypted/hash fields inside the durable scanner interaction history record
- trigger-call creates a local `callAttempt`, stores Exotel `Call.Sid` correlation data, and promotes the private session to `in_progress` on success

## Working Files

- `LOCAL_GUIDE.md`: backend rules, architecture constraints, and implementation standards
- `STATUS.md`: current backend status, roadmap, risks, and changelog/session log
- `DOMAIN_MODEL.md`: canonical backend entity model and privacy boundaries
- `SCHEMA_AND_API_CONTRACTS.md`: MongoDB, Redis, API, service, and projection contracts derived from the domain model
- `EXOTEL_CONNECT_INTEGRATION_GUIDE.md`: WaveTag-specific Exotel Voice v1 integration, security rules, testing path, and implementation order
- `FASTIFY_CLOUD_RUN_RUNTIME_GUIDE.md`: why Fastify + Cloud Run was chosen, how the runtime should be wired, and how local/Cloud Run testing should work

## Cleanup Note

The old Next.js gateway scaffold has been removed from this folder on purpose. If future backend slices need public APIs again, they should be reintroduced from the contract docs, not by reviving old scaffold code.
