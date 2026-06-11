# WaveTag Fastify + Cloud Run Runtime Guide

This file explains why WaveTag Phase 1 is moving to a Fastify runtime on Google Cloud Run, how that choice fits the current backend package, what changes are required, how to test the runtime locally, and what tradeoffs to keep in mind for future work.

It exists so the reasoning is explicit for both human contributors and future AI-assisted sessions.

## 1. Decision Summary

WaveTag Phase 1 should use:

- `Node.js` as the backend runtime
- `TypeScript` as the implementation language
- `Fastify` as the HTTP framework
- `Google Cloud Run` as the serverless container platform

This means:

- the backend runs as a real HTTP server process inside a container
- Google Cloud Run manages deployment, scaling, and request routing
- the service can still behave like a low-ops pay-for-usage backend
- the current business logic remains framework-independent and testable

This is not the same as a pure function-per-request FaaS design such as AWS Lambda handlers only.

## 2. Why This Choice Was Made

### 2.1 Product Fit

WaveTag Phase 1 does not run real-time media itself.

The backend mainly does:

1. resolve a QR token
2. create a short-lived private session
3. trigger Exotel
4. receive Exotel webhook callbacks
5. update private session and attempt state

Exotel handles the actual PSTN call bridge.

That means the backend is orchestration-heavy, not media-server-heavy.

### 2.2 Why Not a Permanent Self-Managed Server First

The project does not currently need:

- long-lived socket connections
- browser VoIP signaling
- media relays
- custom telephony infrastructure

So keeping a dedicated manually managed server running at all times adds operational cost without solving a real Phase 1 problem.

### 2.3 Why Not Pure FaaS First

Fastify works best when it can run as an actual HTTP server.

For this project, Cloud Run is a better match than pure FaaS because:

- Fastify can listen normally on `PORT`
- local development matches production more closely
- the server can handle multiple requests without a special adapter layer
- webhook endpoints and public API endpoints live in one backend process
- we keep the option to scale down without manually running infrastructure

### 2.4 Why Fastify Instead of Plain Node HTTP

Plain Node HTTP would work, but it would force us to build more plumbing manually:

- routing
- JSON parsing
- lifecycle hooks
- structured request/reply handling
- future middleware-style concerns

Fastify keeps the runtime thin while still giving the backend a real server model.

### 2.5 Why Fastify Instead of Express

Express would also work, but Fastify is a better fit here because:

- better TypeScript ergonomics
- cleaner plugin and lifecycle model
- strong performance without extra complexity
- simpler path if the backend grows into more endpoints later

## 3. What We Had Before Fastify

Before wiring the runtime, the backend package already contained:

- business services under `src/services`
- provider client/config code under `src/lib/exotel`
- local persistence seams under `src/lib/database`
- plain route-handler modules under `src/routes`
- direct tests for services and plain handlers

Important:

- the route-handler modules are plain TypeScript functions, not live HTTP endpoints
- they return safe `{ status, body }` shapes, which is useful for testing
- they are a transport seam, not the server itself

That existing split is good and should be preserved.

## 4. Target Runtime Architecture

The intended layering is:

1. `services/`
   Business rules and private orchestration
2. `routes/`
   Route-safe input/output mapping
3. `build-server.ts` or equivalent
   Fastify app construction and route registration
4. `server.ts`
   Runtime startup using `PORT` and `0.0.0.0`

This keeps the framework wiring thin.

### 4.1 Why This Layering Matters

It gives us:

- easy unit testing of services
- easy route testing without a deployed server
- easy Fastify integration
- easier future migration if the deployment target changes

## 5. Cloud Run Runtime Model

For Cloud Run, the backend should behave like a normal web server process inside a container.

Key runtime expectations:

- bind to `process.env.PORT` when present
- default to `8080` locally if `PORT` is absent
- listen on `0.0.0.0`, not only `localhost`
- keep startup deterministic and lightweight

This is the minimum shape Cloud Run expects from the service container.

## 6. Runtime Files and Changes

### 6.1 New Runtime Files

The package now has:

- `src/build-server.ts`
  Creates and returns a Fastify instance
- `src/server.ts`
  Starts the Fastify server for local use and Cloud Run

### 6.2 Route Registration

The current implemented routes are:

- `POST /api/session/:sessionId/call`
- `POST /api/provider/exotel/webhook`
- `GET /health`

### 6.3 Scripts

The package now has scripts for:

- starting the server locally
- starting the server in Cloud Run
- testing the Fastify runtime

### 6.4 Dependencies

The package now uses `fastify`.

### 6.5 Deployment Files

The package now includes:

- `Dockerfile`
- `.dockerignore`

These are needed for Cloud Run container deployment.

## 7. Local Testing Model

The runtime must be testable locally in three useful ways.

### 7.1 Direct Service Tests

Already present:

- service logic tested without running an HTTP server

This should stay in place.

### 7.2 Fastify Integration Tests

Use Fastify injection tests to verify:

- endpoint registration
- request validation
- response status codes
- scanner-safe/public-safe payloads
- webhook handler behavior

This gives near-real route testing without opening a real port.

### 7.3 Manual Local Server Testing

Run the backend locally and hit it with:

- browser
- `curl`
- Postman/Insomnia

This should work before any Cloud Run deployment.

## 8. Local Development Expectations

Local runtime testing should work normally.

That means:

- the Fastify server should start on `localhost:8080` by default
- local env vars should still drive Exotel config
- local route testing should not require Cloud Run

Cloud Run should feel like deployment of the same app, not a different application model.

## 9. Production and Serverless Tradeoffs

### 9.1 Benefits

- low operational overhead
- container-based deployment
- can scale with usage
- no need to manually keep a VM/server running
- easier to reason about than provider-specific function adapters

### 9.2 Risks

- cold starts still exist at the platform level
- local file-backed storage is not valid for production
- webhook idempotency and replay handling become more important
- future DB and cache clients must be Cloud Run-safe

### 9.3 What Must Change Before Production

The following are still required before production:

- replace file-backed store with MongoDB and Redis adapters
- add stronger webhook validation and reconciliation
- add provider abuse protection and idempotency checks
- wire secrets through Cloud Run environment or secret manager
- add structured logging

## 10. Why We Are Not Rewriting the Services

The current service and handler split is already good enough to preserve.

We should not rewrite:

- `trigger-call.ts`
- `record-exotel-webhook.ts`
- current route-handler contracts

unless Fastify wiring exposes a real mismatch.

The correct approach is:

- keep business logic intact
- add a thin Fastify transport layer
- test the real endpoints

This minimizes drift and keeps the code auditable.

## 11. Current Recommendation for Future Work

After Fastify is wired in, the next backend steps should be:

1. webhook hardening beyond the narrow accepted payload shape
2. callback reconciliation for delayed or missing provider updates
3. production persistence adapters
4. runtime deployment assets for Cloud Run
5. final HTTP route expansion for scanner resolve and session creation if needed

## 12. Rule for Future Sessions

When working on the Fastify + Cloud Run runtime:

- do not collapse business logic into Fastify route files
- keep public route responses scanner-safe and privacy-safe
- keep all provider credentials and routing data server-side
- preserve direct service tests even after Fastify route tests are added
- treat Cloud Run as the deployment target, not as permission to weaken backend contracts

## 13. Current Repo State

The current backend package now contains:

- `src/build-server.ts`
  Fastify app builder
- `src/server.ts`
  runtime startup entrypoint
- mounted endpoints for:
  - `GET /health`
  - `POST /api/session/:sessionId/call`
  - `POST /api/provider/exotel/webhook`
- `Dockerfile`
  container runtime entry for Cloud Run-style deployment
- `.dockerignore`
  container build exclusions
- Fastify route exposure tests using `app.inject()`

The remaining runtime work is no longer “add Fastify.” That part is done.

The next runtime-focused work is:

- harden webhook validation and reconciliation
- add more HTTP routes when the underlying services are ready
- replace file-backed persistence for production

## 14. Definition of Done for This Runtime Migration

The Fastify + Cloud Run runtime slice is only complete when:

- Fastify is installed
- the backend exposes real mounted endpoints for the implemented routes
- the server starts locally
- the server is shaped correctly for Cloud Run (`PORT`, `0.0.0.0`)
- route-level tests pass
- existing service tests still pass
- docs and status files are updated
