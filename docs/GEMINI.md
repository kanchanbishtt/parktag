# WaveTag Backend Optimization & Engineering Guidelines

This document captures identified code optimizations and engineering standards for the `Backend-Gateway` package. Adhering to these rules is mandatory for maintaining the <3s scan-to-ring latency target and ensuring system integrity.

## 1. Fastify Runtime Optimizations

### 1.1 Schema-Based Validation
*   **Guideline:** Every HTTP route in `build-server.ts` MUST have a corresponding JSON Schema for `params`, `body`, and `querystring`.
*   **Why:** Fastify uses Ajv to compile these schemas into high-performance validation functions. This catches malformed data at the boundary and prevents it from reaching the service layer.
*   **Action:** Transition from manual casting (`as { sessionId?: string }`) to schema-enforced types.

### 1.2 Idiomatic Response Handling
*   **Guideline:** Avoid manual response helpers like `sendRouteResponse`. Use the native Fastify `reply` object or return the body directly.
*   **Why:** Reduces boilerplate and follows framework best practices.

## 2. Service & Logic Optimizations

### 2.1 Owner Status Verification
*   **Guideline:** Always verify the `owner.status` in addition to the `tag.status` before allowing session creation or telephony triggers.
*   **Why:** A tag might be 'active', but the owner account could be 'disabled' or 'paused' due to administrative reasons.

### 2.2 Error Transparency (No PII Leakage)
*   **Guideline:** When catching provider (Exotel) errors, log the raw error message using the Fastify logger (Pino) but throw a generic, safe `TagIssuanceError` to the client.
*   **Why:** Ensures developers can debug "Insufficient Balance" or "KYC Pending" while keeping the public API response safe.

## 3. Persistence & Performance

### 3.1 Repository "Batching" (Atomic Operations)
*   **Guideline:** For operations involving multiple state changes (e.g., creating an attempt AND updating a session), use a single repository method that can be implemented as a transaction in MongoDB.
*   **Why:** Reduces the number of round-trips to the database and prevents "partial failures" (orphan records). This is critical for the <3s latency target.

### 3.2 Runtime Repository Seams
*   **Guideline:** New services must use the `runtime-repository.ts` seam to ensure they are compatible with both the local file-store and the future MongoDB/Redis adapters.

## 4. Webhook & Provider Hardening

### 4.1 Idempotency
*   **Guideline:** Webhook processing MUST be idempotent. Check the current status of the `callAttempt` before applying an update to avoid redundant writes or race conditions.
*   **Why:** Providers may send the same callback multiple times.

### 4.2 Reconciliation Logic
*   **Guideline:** Use the `reconcile-exotel-call.ts` utility to resolve sessions that remain in a "hanging" state due to missed webhooks.
