# WaveTag Backend Schema and API Contracts

This document derives the Phase 1 backend persistence shapes and API contracts from `DOMAIN_MODEL.md`.

It exists to lock the contract layer before implementation work continues.

## 1. Scope

This file defines:

- MongoDB document shapes for persistent backend entities
- Redis shapes for TTL-backed scanner sessions and lookup helpers
- route-level request and response contracts
- service input and output contracts
- public vs private projections
- validation and error contract rules

This file does not define:

- frontend component behavior
- provider-specific payload minutiae
- auth implementation details
- deployment configuration

## 2. Contract Rules

- All IDs are opaque strings generated server-side.
- `token` is the only scanner-visible identifier for a tag.
- Scanner-facing `ownerLabel` must always be the fixed literal `Vehicle Owner`; private owner display naming stays server-side.
- Scanner-facing contracts must never expose phone numbers, internal owner IDs, auth references, or raw provider payloads.
- Route contracts must be thinner than service contracts. Route handlers only accept validated input, call services, and return public projections.
- MongoDB documents hold durable business state.
- Redis holds short-lived interaction state and lookup helpers only.
- Redis is the live operational store for active session state, not the long-term reporting source for admin history.
- Redis-backed session creation applies only to contact flows. Read-only SOS disclosure does not require scanner phone entry or Redis session creation.
- `call` and `message` are contact flows. `sos` is a separate disclosure-only flow in Phase 1.
- A paused tag may still resolve into a non-actionable public projection. A revoked tag should be treated as unavailable in scanner-facing flows.

### 2.1 Contract-First Working Rule

This file is the implementation contract for the Phase 1 backend.

Working rules:

- no backend code should invent a new public field, error code, status value, or route behavior unless this file is updated first
- if the current scaffold differs from this contract, the contract wins until an intentional documented change is approved
- route handlers should only enforce request-shape parsing and response mapping; business rules belong in services
- public responses, public errors, and public logs must be reviewed against the privacy rules in this file before they are considered valid
- every implementation slice should be small enough to verify directly against one or more sections of this contract

Phase 1 behavior lock:

- `GET /api/resolve/[token]` returns scanner-safe metadata only
- `POST /api/session/create` is only for `call` and `message`
- `GET /api/sos/[token]` is the SOS-only disclosure path
- `ownerLabel` is always `Vehicle Owner`
- paused tags may resolve but must not expose actionable contact options
- revoked tags must be treated as unavailable in scanner-facing flows
- contact-flow sessions are temporary, private, and TTL-backed

## 3. Canonical Scalars and Enums

### 3.1 Scalar Rules

- `token`: uppercase alphanumeric string matching `^[A-Z0-9]{12}$`
- `phoneE164`: string in E.164 format, Phase 1 normalized to Indian mobile numbers such as `+919876543210`
- `timestamp`: ISO 8601 UTC string at the contract boundary
- `id`: opaque non-empty string

### 3.2 Enums

```ts
type GatewayAction = "call" | "message" | "sos";

type ContactGatewayAction = Extract<GatewayAction, "call" | "message">;

type TagStatus = "unclaimed" | "active" | "paused" | "revoked";

type SessionStatus =
  | "created"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired"
  | "closed";

type CallAttemptStatus =
  | "queued"
  | "dialing_leg_a"
  | "leg_a_answered"
  | "dialing_leg_b"
  | "connected"
  | "no_answer"
  | "busy"
  | "failed"
  | "completed";

type MessageAttemptStatus = "queued" | "sent" | "delivered" | "failed";

type CommunicationChannel = "pstn_call" | "sms" | "whatsapp";
```

## 4. MongoDB Persistent Schemas

Collection naming should stay explicit and pluralized:

- `owners`
- `vehicles`
- `tags`
- `scanner_interactions`
- `backup_contacts`
- `sos_profiles`
- `call_attempts`
- `message_attempts`
- `webhook_events`
- `admin_users`

### 4.1 Owner Document

```ts
interface OwnerDocument {
  _id: string;
  ownerId: string;
  primaryPhone: string;
  displayLabel: string;
  status: "active" | "paused" | "disabled";
  authProviderId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Indexes:

- unique `ownerId`
- unique sparse `authProviderId`
- index `status`

Privacy:

- private only

### 4.2 Vehicle Document

```ts
interface VehicleDocument {
  _id: string;
  vehicleId: string;
  ownerId: string;
  plateNumber: string;
  plateLastFour: string;
  vehicleLabel: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}
```

Indexes:

- unique `vehicleId`
- index `ownerId`
- unique optional `plateNumber` only if business rules require global uniqueness later

Privacy:

- `plateNumber` private
- `plateLastFour` and `vehicleLabel` may be used in scanner-safe projections

### 4.3 Tag Document

```ts
interface TagDocument {
  _id: string;
  tagId: string;
  token: string;
  ownerId: string | null;
  vehicleId: string | null;
  status: TagStatus;
  availableActions: GatewayAction[];
  claimCodeHash: string | null;
  claimCodeSalt: string | null;
  claimCodeIssuedAt: string | null;
  issuedAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Indexes:

- unique `tagId`
- unique `token`
- index `ownerId`
- index `vehicleId`

Contract note:

- `unclaimed` means the QR/token pair has been issued but no owner has completed first-time claim yet.
- `unclaimed` tags must not be returned as normal scanner-contact resolve results.
- `availableActions` is the configured action set for an active tag.
- Successful public resolve responses must return `[]` when `status` is `paused`.
- `revoked` tags should be treated as unavailable in scanner-facing resolve and session-creation flows.

### 4.4 Backup Contact Document

```ts
interface BackupContactDocument {
  _id: string;
  backupContactId: string;
  ownerId: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  isEmergencyEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

Indexes:

- unique `backupContactId`
- index `ownerId`
- compound index `ownerId, priority`

Privacy:

- private
- emergency-only exposure by controlled projection

### 4.5 Scanner Interaction Document

```ts
interface ScannerInteractionDocument {
  _id: string;
  interactionId: string;
  sessionId: string;
  token: string;
  tagId: string;
  ownerId: string;
  scannerPhoneEncrypted: string;
  scannerPhoneHash: string;
  action: ContactGatewayAction;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
  marketingConsentSource: "scanner_web_form" | null;
  createdAt: string;
  lastContactedAt: string | null;
}
```

Indexes:

- unique `interactionId`
- unique `sessionId`
- index `token`
- index `tagId`
- index `ownerId`
- index `scannerPhoneHash`
- compound index `ownerId, createdAt`

Privacy:

- private
- `scannerPhoneEncrypted` and `scannerPhoneHash` must never be returned from scanner-facing or default owner-facing public APIs

Contract notes:

- this document is durable and separate from the TTL-backed live `scanner_session`
- it exists for `call` and `message` flows only
- it provides the durable reference for which scanner contacted which owner and tag
- marketing contact must depend on `marketingConsent`, not on interaction history alone

### 4.6 SOS Profile Document

```ts
interface SosProfileDocument {
  _id: string;
  ownerId: string;
  bloodGroup: string | null;
  allergies: string[];
  conditions: string[];
  notes: string | null;
  emergencyDisclosureEnabled: boolean;
  updatedAt: string;
}
```

Indexes:

- unique `ownerId`

Privacy:

- highly sensitive private data
- only exposed in SOS flow when `emergencyDisclosureEnabled` is true

### 4.7 Call Attempt Document

```ts
interface CallAttemptDocument {
  _id: string;
  callAttemptId: string;
  sessionId: string;
  provider: "exotel";
  providerRequestId: string | null;
  virtualNumber: string | null;
  legAStatus: string;
  legBStatus: string;
  overallStatus: CallAttemptStatus;
  startedAt: string;
  endedAt: string | null;
  failureReason: string | null;
}
```

Indexes:

- unique `callAttemptId`
- index `sessionId`
- index `providerRequestId`
- compound index `sessionId, startedAt`

Privacy:

- private
- `virtualNumber` is provider/ops data, not scanner-facing

### 4.8 Message Attempt Document

```ts
interface MessageAttemptDocument {
  _id: string;
  messageAttemptId: string;
  sessionId: string;
  provider: "exotel" | "approved_equivalent";
  channel: Extract<CommunicationChannel, "sms" | "whatsapp">;
  templateId: string | null;
  deliveryStatus: MessageAttemptStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
}
```

Indexes:

- unique `messageAttemptId`
- index `sessionId`
- compound index `sessionId, channel, sentAt`

Privacy:

- private

### 4.9 Webhook Event Document

```ts
interface WebhookEventDocument {
  _id: string;
  webhookEventId: string;
  provider: "exotel";
  providerEventId: string | null;
  sessionId: string | null;
  callAttemptId: string | null;
  eventType: string;
  receivedAt: string;
  processedAt: string | null;
  processingStatus: "received" | "processed" | "failed";
  rawPayloadReference: string | null;
}
```

Indexes:

- unique `webhookEventId`
- index `providerEventId`
- index `sessionId`
- index `callAttemptId`

Privacy:

- private
- raw provider payload must not be returned from product APIs

### 4.10 Admin User Document

```ts
interface AdminUserDocument {
  _id: string;
  adminUserId: string;
  email: string;
  role: "support" | "ops" | "admin";
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
}
```

Indexes:

- unique `adminUserId`
- unique `email`
- index `status`

Privacy:

- private

## 5. Redis TTL Schemas

Redis is reserved for active session state and fast lookup helpers. Default TTL is `1800` seconds unless an approved product change updates the session window.

Historical admin summaries must be derived from durable interaction, attempt, and event records, not from Redis keys after session expiry.

Phase 1 rule:

- Redis session state applies to `call` and `message` routing flows
- viewing SOS disclosure alone does not create a Redis session

### 5.1 Primary Session Record

Key:

- `scanner_session:{sessionId}`

Value:

```ts
interface ScannerSessionRedisRecord {
  sessionId: string;
  token: string;
  tagId: string;
  ownerId: string;
  scannerPhone: string;
  ownerPhone: string;
  action: ContactGatewayAction;
  status: SessionStatus;
  expiresAt: string;
  createdAt: string;
  lastUpdatedAt: string;
}
```

Rules:

- full private routing context is allowed here because this is server-only
- TTL must be set on write and refreshed only when the business flow explicitly requires it
- this record must not be treated as the durable source for admin history after expiry
- durable owner/tag scanner-history must live in `scanner_interactions`, not only in this Redis record
- this record exists for `call` and `message` contact flows, not for read-only SOS disclosure

### 5.2 Session Lookup by Provider Request

Key:

- `provider_request:exotel:{providerRequestId}`

Value:

```ts
interface ProviderRequestLookup {
  sessionId: string;
  callAttemptId: string;
  expiresAt: string;
}
```

Rules:

- used by webhook processing to map callbacks quickly
- TTL should not exceed the parent session TTL by default

### 5.3 Active Session by Tag Helper

Key:

- `active_tag_session:{tagId}`

Value:

```ts
interface ActiveTagSessionLookup {
  sessionId: string;
  status: SessionStatus;
  expiresAt: string;
}
```

Rules:

- optional helper for preventing duplicate active flows for the same tag
- if implemented, the lifecycle must match the scanner session lifecycle exactly

## 6. Public and Private Projections

### 6.1 Scanner-Safe Resolved Tag Projection

```ts
interface ResolvedTagPublic {
  token: string;
  ownerLabel: "Vehicle Owner";
  vehicleLabel: string | null;
  plateLastFour: string | null;
  status: Extract<TagStatus, "active" | "paused">;
  availableActions: GatewayAction[];
}
```

Rules:

- `ownerLabel` is always the fixed generic value `Vehicle Owner`
- `availableActions` must already be filtered for scanner use
- when `status` is `paused`, `availableActions` must be `[]`
- `revoked` is not returned from a successful public resolve response
- owner phone, vehicle plate number, owner ID, and auth references are never present

### 6.2 Scanner-Safe Session Projection

```ts
interface ScannerSessionPublic {
  sessionId: string;
  token: string;
  action: ContactGatewayAction;
  status: SessionStatus;
  expiresAt: string;
  createdAt: string;
}
```

Rules:

- this projection exists only for contact-flow sessions
- scanner phone, owner phone, owner ID, tag ID, and provider metadata are never present

### 6.3 Emergency-Only SOS Projection

```ts
interface SosPublicEmergencyProjection {
  bloodGroup: string | null;
  allergies: string[];
  conditions: string[];
  notes: string | null;
  familyContacts: Array<{
    name: string;
    relationship: string;
    phone: string;
  }>;
}
```

Rules:

- only returned from SOS-specific backend flows
- `familyContacts[].phone` is intentionally unmasked for designated emergency contacts in the SOS flow
- never returned from standard resolve or standard session APIs
- this SOS disclosure is the only approved exception to the normal phone-number masking rule
- read-only SOS disclosure does not require `scannerPhone` or session creation

## 7. Route-Level API Contracts

All public APIs must use the same safe error envelope:

```ts
interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
```

### 7.1 `GET /api/resolve/[token]`

Purpose:

- resolve a QR token into scanner-safe metadata only

Success `200`:

```ts
type ResolveRouteResponse = ResolvedTagPublic;
```

Safe failures:

- `400 INVALID_TOKEN_FORMAT`
- `404 TAG_NOT_FOUND`
- `409 TAG_UNAVAILABLE`

Failure examples:

```json
{
  "error": {
    "code": "INVALID_TOKEN_FORMAT",
    "message": "The QR token is invalid or inactive."
  }
}
```

Route rules:

- active tags return a normal actionable projection
- paused tags may still return `200` with `status: "paused"` and `availableActions: []`
- revoked tags should return `409 TAG_UNAVAILABLE` instead of a normal resolved projection

### 7.2 `POST /api/session/create`

Request `201` target:

```ts
interface CreateSessionRouteRequest {
  token: string;
  scannerPhone: string;
  action: ContactGatewayAction;
}
```

Success `201`:

```ts
type CreateSessionRouteResponse = ScannerSessionPublic;
```

Safe failures:

- `400 INVALID_REQUEST`
- `400 INVALID_PHONE`
- `404 TAG_NOT_FOUND`
- `409 TAG_UNAVAILABLE`
- `409 ACTION_NOT_ALLOWED`
- `503 SESSION_CREATE_FAILED`

Route rules:

- this route is only for `call` and `message`
- `sos` must not be accepted through this route
- a successful response returns only the scanner-safe session projection

### 7.3 Planned Phase 1 Public Routes

These are not necessarily implemented yet, but this contract model assumes they will exist:

#### `GET /api/sos/[token]`

Purpose:

- fetch SOS-only emergency disclosure data for a valid token

Success:

```ts
type GetSosRouteResponse = SosPublicEmergencyProjection;
```

Safe failures:

- `400 INVALID_TOKEN_FORMAT`
- `404 TAG_NOT_FOUND`
- `403 SOS_DISCLOSURE_DISABLED`

Route rules:

- this is a read-only disclosure route
- this route does not require `scannerPhone`
- this route does not create a Redis session
- this route must never return standard owner phone data outside the designated SOS disclosure contract

#### `POST /api/session/[sessionId]/call`

Purpose:

- trigger PSTN call orchestration for a session whose action is `call`

Success:

```ts
interface TriggerCallRouteResponse {
  sessionId: string;
  status: "in_progress";
  callAttemptId: string;
}
```

Safe failures:

- `404 SESSION_NOT_FOUND`
- `409 ACTION_NOT_ALLOWED`
- `410 SESSION_EXPIRED`
- `503 CALL_TRIGGER_FAILED`

Route rules:

- only valid for a session whose `action` is `call`
- expired, closed, failed, or completed sessions must not trigger telephony
- scanner-facing responses must not expose provider payloads or routing numbers

#### `POST /api/session/[sessionId]/message`

Purpose:

- trigger masked SMS or WhatsApp recovery for a session whose action is `message`

Request:

```ts
interface TriggerMessageRouteRequest {
  channel: "sms" | "whatsapp";
  messageBody?: string;
}
```

Success:

```ts
interface TriggerMessageRouteResponse {
  sessionId: string;
  messageAttemptId: string;
  deliveryStatus: "queued" | "sent";
}
```

Safe failures:

- `400 INVALID_REQUEST`
- `404 SESSION_NOT_FOUND`
- `409 ACTION_NOT_ALLOWED`
- `410 SESSION_EXPIRED`
- `503 MESSAGE_TRIGGER_FAILED`

Route rules:

- only valid for a session whose `action` is `message`
- `channel` must be `sms` or `whatsapp`
- expired, closed, failed, or completed sessions must not trigger message delivery

#### `GET /api/session/[sessionId]`

Purpose:

- fetch a scanner-safe session outcome without revealing private routing data

Success:

```ts
interface GetSessionRouteResponse extends ScannerSessionPublic {
  canRetryCall: boolean;
  canSendMessage: boolean;
}
```

Safe failures:

- `404 SESSION_NOT_FOUND`
- `410 SESSION_EXPIRED`

Route rules:

- returns scanner-safe session state only
- must never expose scanner phone, owner phone, or provider payloads

### 7.4 Planned Provider Route

#### `POST /api/provider/exotel/webhook`

Purpose:

- receive Exotel HTTP callbacks and update call/session state

Route rules:

- authenticate provider request using the approved provider validation method
- return provider-compatible acknowledgement
- never surface raw provider failure details publicly

Failure handling:

- reject invalid provider authentication or malformed payloads with `400 PROVIDER_WEBHOOK_REJECTED`
- internal processing failures should be logged privately and mapped to a provider-compatible non-success response without exposing internal details

## 8. Service Contracts

Services are allowed to handle private inputs and private outputs. Route handlers must project them into public responses.

### 8.1 Resolve Tag Service

```ts
interface ResolveTagServiceInput {
  rawToken: string;
}

interface ResolveTagServiceOutput {
  resolvedTag: ResolvedTagPublic;
}
```

### 8.2 Resolve SOS Disclosure Service

```ts
interface ResolveSosDisclosureServiceInput {
  rawToken: string;
}

interface ResolveSosDisclosureServiceOutput {
  sosDisclosure: SosPublicEmergencyProjection;
}
```

### 8.3 Create Session Service

```ts
interface CreateSessionServiceInput {
  token: string;
  scannerPhone: string;
  action: ContactGatewayAction;
  marketingConsent?: boolean;
}

interface CreateSessionServiceOutput {
  publicSession: ScannerSessionPublic;
  privateSession: ScannerSessionRedisRecord;
  scannerInteraction: ScannerInteractionDocument;
}
```

### 8.3A Claim Tag Service

```ts
interface ClaimTagServiceBackupContactInput {
  name: string;
  phone: string;
  relationship: string;
  isEmergencyEnabled?: boolean;
}

interface ClaimTagServiceSosProfileInput {
  bloodGroup?: string | null;
  allergies?: string[];
  conditions?: string[];
  notes?: string | null;
  emergencyDisclosureEnabled?: boolean;
}

interface ClaimTagServiceInput {
  token: string;
  claimCode: string;
  ownerPhone: string;
  ownerDisplayName: string;
  vehicleLabel: string;
  plateNumber: string;
  backupContacts?: ClaimTagServiceBackupContactInput[];
  sosProfile?: ClaimTagServiceSosProfileInput;
}

interface ClaimTagServiceOutput {
  tagId: string;
  token: string;
  ownerId: string;
  vehicleId: string;
  status: "active";
  activatedAt: string;
}
```

### 8.4 Trigger Call Service

```ts
interface TriggerCallServiceInput {
  sessionId: string;
}

interface TriggerCallServiceOutput {
  sessionId: string;
  callAttemptId: string;
  status: "in_progress";
  provider: "exotel";
}
```

### 8.5 Record Webhook Service

```ts
interface RecordWebhookServiceInput {
  provider: "exotel";
  payload: unknown;
}

interface RecordWebhookServiceOutput {
  sessionId: string | null;
  callAttemptId: string | null;
  processingStatus: "processed" | "failed";
}
```

### 8.6 Trigger Message Recovery Service

```ts
interface TriggerMessageRecoveryServiceInput {
  sessionId: string;
  channel: "sms" | "whatsapp";
  messageBody?: string;
}

interface TriggerMessageRecoveryServiceOutput {
  sessionId: string;
  messageAttemptId: string;
  deliveryStatus: "queued" | "sent";
}
```

### 8.7 Get Session Service

```ts
interface GetSessionServiceInput {
  sessionId: string;
}

interface GetSessionServiceOutput {
  session: GetSessionRouteResponse;
}
```

### 8.8 Owner Tag Status Service

```ts
interface UpdateTagStatusServiceInput {
  ownerId: string;
  tagId: string;
  status: Extract<TagStatus, "active" | "paused">;
}

interface UpdateTagStatusServiceOutput {
  tagId: string;
  status: Extract<TagStatus, "active" | "paused">;
  updatedAt: string;
}
```

## 9. Validation Rules

### 9.1 Token Validation

- trim whitespace
- uppercase before lookup
- reject unless it matches `^[A-Z0-9]{12}$`

### 9.2 Phone Validation

- applies to contact flows only
- accept scanner phone input with spaces, hyphens, and optional `+91` or leading `0`
- normalize to Indian mobile E.164
- after normalization, the local mobile number must be exactly 10 digits and start with `6`, `7`, `8`, or `9`
- reject if the result is not a valid Indian mobile number
- viewing SOS disclosure alone does not require phone validation
- if durable scanner interaction history is stored, store the normalized phone in encrypted form plus a separate hashed form for lookup and deduplication

### 9.3 Action Validation

- session creation action must be one of `call` or `message`
- action must be allowed by the resolved active tag
- unclaimed, paused, or revoked tags must not allow session creation
- SOS disclosure is a separate flow and does not require session creation or scanner phone entry just to view emergency information

### 9.4 Expiry Validation

- scanner sessions default to 30 minutes
- `expiresAt` must be computed server-side only
- expired sessions must not trigger telephony or messaging actions

## 10. Stable Error Codes

The backend should converge on these privacy-safe error codes:

- `INVALID_TOKEN_FORMAT`
- `TAG_NOT_FOUND`
- `TAG_UNAVAILABLE`
- `INVALID_REQUEST`
- `INVALID_PHONE`
- `ACTION_NOT_ALLOWED`
- `SOS_DISCLOSURE_DISABLED`
- `SESSION_NOT_FOUND`
- `SESSION_EXPIRED`
- `SESSION_CREATE_FAILED`
- `CALL_TRIGGER_FAILED`
- `MESSAGE_TRIGGER_FAILED`
- `PROVIDER_WEBHOOK_REJECTED`
- `INTERNAL_ERROR`

Rule:

- public messages stay generic and actionable
- internal logs may retain correlation IDs but must still mask all phone numbers
- durable scanner interaction storage must not be treated as implied marketing consent

### 10.1 Recommended Public Error Mapping

| Code | Typical HTTP Status | Recommended Public Message |
| --- | --- | --- |
| `INVALID_TOKEN_FORMAT` | `400` | `The QR token is invalid or inactive.` |
| `TAG_NOT_FOUND` | `404` | `The QR token is invalid or inactive.` |
| `TAG_UNAVAILABLE` | `409` | `This WaveTag is temporarily unavailable.` |
| `INVALID_REQUEST` | `400` | `The request is missing required fields or contains unsupported values.` |
| `INVALID_PHONE` | `400` | `Enter a valid Indian mobile number.` |
| `ACTION_NOT_ALLOWED` | `409` | `This action is not available for the scanned WaveTag.` |
| `SOS_DISCLOSURE_DISABLED` | `403` | `Emergency information is not available for this WaveTag.` |
| `SESSION_NOT_FOUND` | `404` | `This WaveTag session could not be found.` |
| `SESSION_EXPIRED` | `410` | `This WaveTag session has expired.` |
| `SESSION_CREATE_FAILED` | `503` | `Unable to create a WaveTag session right now.` |
| `CALL_TRIGGER_FAILED` | `503` | `Unable to start the call right now.` |
| `MESSAGE_TRIGGER_FAILED` | `503` | `Unable to send the message right now.` |
| `PROVIDER_WEBHOOK_REJECTED` | `400` | `The provider webhook request was rejected.` |
| `INTERNAL_ERROR` | `500` | `Something went wrong. Please try again.` |

## 11. Recommended Next Implementation Order

Now that these contracts are defined, the next backend implementation slices should be:

1. encode the enums, document shapes, and public/private projections as TypeScript contracts
2. implement session creation with both TTL-backed private session state and durable `scanner_interaction` history
3. harden route validation and stable error mapping to match this document
4. replace in-memory persistence seams with MongoDB and Redis adapters that honor these shapes
5. implement Exotel call orchestration and webhook mapping against `call_attempt`, `scanner_interaction`, and session contracts

This keeps implementation contract-driven instead of scaffold-driven.
