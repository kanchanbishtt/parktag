# WaveTag Backend Domain Model

This document defines the canonical Phase 1 backend domain model for `Backend-Gateway`.

Its purpose is to make every backend component use the same business language, data boundaries, and lifecycle rules before deeper implementation work begins.

## 1. Why This File Exists

### What this is

This is the backend system model for WaveTag Phase 1.

It defines:

- the backend entities that exist
- why each entity exists
- what problem each entity solves
- how entities relate to each other
- which data is public, private, temporary, or persistent
- which backend flow depends on each entity

### Why this is needed

WaveTag backend is not a single CRUD app. It must support:

- anonymous scanner flows
- authenticated owner flows
- admin and operational visibility
- QR token lifecycle management
- PSTN-first two-leg communication
- temporary session storage with TTL
- strict PII protection
- future webhook-driven state changes

Without a canonical domain model, each API or service will start defining these concepts differently, which creates inconsistent behavior, privacy leaks, and expensive rework.

### What problem this solves

This file prevents:

- different meanings of `tag`, `session`, or `owner` in different parts of the backend
- mixing public scanner data with private owner routing data
- building database records that do not match API and provider needs
- unclear ownership of QR, owner, vehicle, and communication flows
- dashboard and admin reporting models diverging from the operational truth

### Why this is necessary now

This should be defined before building:

- QR generation and tag lifecycle
- Exotel orchestration
- owner dashboard APIs
- admin monitoring APIs
- real database adapters

Reason: all of those features depend on the same underlying entities and state transitions.

## 2. Phase 1 Modeling Principles

This domain model is intentionally lean.

It is not trying to predict every future feature. It is limited to the entities and rules needed for the Phase 1 WaveTag MVP described in the RFA.

Modeling principles:

- define only what Phase 1 needs
- separate persistent data from TTL session data
- separate public API shapes from private persistence shapes
- keep telephony and messaging attempts explicit
- make privacy boundaries visible in the model itself
- keep owner, scanner, and admin concerns distinct

## 3. Phase 1 System Flows Covered by This Model

This domain model must support these backend flows:

1. Scanner scans QR and resolves tag metadata.
2. Scanner creates a temporary session with phone number and chosen contact action.
3. System triggers a PSTN call bridge through Exotel.
4. If the call fails, system offers masked message recovery.
5. Owner manages active/inactive status and emergency profile from the dashboard.
6. Admin monitors sessions, provider outcomes, and operational status.
7. SOS flow reveals emergency-only data and may contact backup/family.

### 3.1 Flow Split: Contact vs SOS

Phase 1 has two different scanner-side backend paths:

- contact flows: `call` and `message`
  - require scanner phone entry
  - create a temporary `scanner_session`
  - create a durable `scanner_interaction` record for backend history and owner/tag relationship tracking
  - use Redis-backed TTL session state
- SOS flow: `sos`
  - is a read-only emergency disclosure path
  - does not require scanner phone entry
  - does not create a `scanner_session` just to reveal approved emergency information
  - may show designated emergency contact phone numbers as the only approved unmasked phone-number exception

## 4. Core Domain Entities

### 4.1 Owner

**What it is**

The registered person who controls one or more WaveTag-enabled vehicles.

**Why it is needed**

- ownership and control must be represented separately from the scanner
- owner dashboard access belongs to the vehicle owner, while operational monitoring access belongs to admin users
- owner contact and emergency profile must stay server-side

**Problem it solves**

It gives the backend a stable identity for permissions, vehicles, tags, and contact routing.

**Key fields**

- `ownerId`
- `primaryPhone`
- `displayLabel`
- `status`
- `authProviderId` or equivalent auth reference
- `createdAt`
- `updatedAt`

**Privacy level**

Private

**Phase 1 projection rule**

- `displayLabel` remains private to owner/admin contexts
- scanner-facing `ownerLabel` must use the fixed generic label `Vehicle Owner`

**Used by**

- owner dashboard
- tag routing
- session routing
- Exotel Leg B
- admin views

### 4.2 Vehicle

**What it is**

The real-world vehicle associated with an owner and a WaveTag.

**Why it is needed**

- the system exists to resolve vehicle-blocking incidents
- tag issuance and dashboard display need a vehicle anchor

**Problem it solves**

It separates vehicle identity from owner identity and allows future multi-vehicle ownership cleanly.

**Key fields**

- `vehicleId`
- `ownerId`
- `plateNumber`
- `plateLastFour`
- `vehicleLabel`
- `status`
- `createdAt`
- `updatedAt`

**Privacy level**

Private internally, but `plateLastFour` and `vehicleLabel` may appear in scanner-safe responses

**Used by**

- tag display
- scanner-safe resolve response
- dashboard vehicle management

### 4.3 Tag

**What it is**

The backend record representing one QR-enabled WaveTag identity.

**Why it is needed**

- the QR code must resolve to an opaque token, not an owner or vehicle id
- owners need active/inactive control at tag level
- reissue, revoke, and pause logic belongs here

**Problem it solves**

It gives the system a secure indirection layer between public QR scans and private owner data.

**Key fields**

- `tagId`
- `token`
- `ownerId`
- `vehicleId`
- `status`
- `availableActions`
- `issuedAt`
- `activatedAt`
- `revokedAt`
- `createdAt`
- `updatedAt`

**Privacy level**

Mixed:

- `token`, `status`, `availableActions` participate in public flow
- owner and routing references remain private

**Used by**

- QR generation
- scanner resolve API
- owner dashboard active/inactive toggle
- session creation

### 4.4 Scanner Session

**What it is**

The temporary backend interaction record created when a scanner submits a phone number for a contact flow.

**Why it is needed**

- scanner identity must stay temporary and server-side
- Exotel and recovery flows need a common session anchor
- scanner actions have a privacy-limited lifetime
- Phase 1 contact routing must stay separate from read-only SOS disclosure

**Problem it solves**

It holds the private routing context needed for communication without exposing PII in the client.

**Key fields**

- `sessionId`
- `token`
- `tagId`
- `ownerId`
- `scannerPhone`
- `ownerPhone`
- `action`
- `status`
- `expiresAt`
- `createdAt`
- `lastUpdatedAt`

**Privacy level**

Private persistence record, with a scanner-safe public projection

**Used by**

- session create API
- call attempt creation
- message fallback
- status tracking
- admin monitoring

**Phase 1 rule**

- `scanner_session` exists for `call` and `message`
- read-only SOS disclosure does not create a `scanner_session`

### 4.5 Scanner Interaction

**What it is**

A durable backend history record of a scanner contacting a specific WaveTag owner through a specific tag.

**Why it is needed**

- scanner sessions expire, but the business may still need durable interaction history
- the backend should be able to answer which scanner number contacted which owner and tag
- future lead or outreach workflows must be kept separate from the short-lived live-routing session

**Problem it solves**

It creates a durable reference layer between a scanner phone number, the owner it contacted, the tag used, and the temporary live session that handled the actual call or message flow.

**Key fields**

- `interactionId`
- `sessionId`
- `token`
- `tagId`
- `ownerId`
- `scannerPhoneEncrypted`
- `scannerPhoneHash`
- `action`
- `marketingConsent`
- `marketingConsentAt`
- `marketingConsentSource`
- `createdAt`
- `lastContactedAt`

**Privacy level**

Private

**Used by**

- admin interaction history
- owner/contact analytics
- future scanner lead workflows only when explicit marketing consent exists
- support investigation and operational tracing

**Phase 1 rules**

- this record is durable and separate from the expiring `scanner_session`
- storing scanner phone history must not expose the phone number in scanner-facing or owner-facing public APIs by default
- future outreach must rely on a separate explicit consent flag, not on contact-flow participation alone

### 4.6 Call Attempt

**What it is**

A record of one telephony bridge attempt for a scanner session.

**Why it is needed**

- Exotel operations are asynchronous and provider-backed
- a session can have communication history beyond the initial request
- monitoring and retry logic depend on explicit attempt records

**Problem it solves**

It separates the session concept from telephony execution state.

**Key fields**

- `callAttemptId`
- `sessionId`
- `provider`
- `providerRequestId`
- `virtualNumber`
- `legAStatus`
- `legBStatus`
- `overallStatus`
- `startedAt`
- `endedAt`
- `failureReason`

**Privacy level**

Private

**Used by**

- Exotel orchestration
- webhook updates
- admin monitoring
- fallback decisions

### 4.7 Message Attempt

**What it is**

A record of one masked SMS or WhatsApp recovery action tied to a scanner session.

**Why it is needed**

- RFA requires a messaging fallback when the owner does not answer
- the system needs traceability separate from call attempts

**Problem it solves**

It gives a dedicated domain object for message delivery, provider tracking, and recovery outcomes.

**Key fields**

- `messageAttemptId`
- `sessionId`
- `provider`
- `channel`
- `templateId` or message type
- `deliveryStatus`
- `sentAt`
- `deliveredAt`
- `failureReason`

**Privacy level**

Private

**Used by**

- recovery flow
- admin monitoring
- future owner history views

### 4.8 Backup Contact

**What it is**

A family or emergency contact associated with an owner for backup or SOS use.

**Why it is needed**

- the RFA explicitly includes family fallback and emergency contact support
- backup routing must not be mixed into public scanner responses

**Problem it solves**

It allows controlled disclosure and controlled routing in emergency or fallback contexts.

**Key fields**

- `backupContactId`
- `ownerId`
- `name`
- `phone`
- `relationship`
- `priority`
- `isEmergencyEnabled`
- `createdAt`
- `updatedAt`

**Privacy level**

Private, with controlled emergency-only exposure rules

**Used by**

- SOS flow
- call fallback logic
- owner dashboard management

### 4.9 SOS Profile

**What it is**

The owner’s emergency information made available only during SOS scenarios.

**Why it is needed**

- the RFA includes medical profile and family contact access for emergencies

**Problem it solves**

It creates an explicit boundary between standard parking/contact flow and emergency-only disclosure.

**Key fields**

- `ownerId`
- `bloodGroup`
- `allergies`
- `conditions`
- `notes`
- `emergencyDisclosureEnabled`
- `updatedAt`

**Privacy level**

Highly sensitive private data with SOS-only access

**Used by**

- SOS flow
- owner dashboard emergency configuration

### 4.10 Webhook Event

**What it is**

A normalized record of a provider callback event, primarily from Exotel.

This is an HTTP webhook concept, not a WebSocket concept.

**Why it is needed**

- provider state changes are asynchronous
- raw provider callbacks should not directly become business truth without traceability

This does not conflict with the RFA rejection of WebRTC and WebSocket-based call signalling. Webhooks are server-to-server HTTP callbacks and remain compatible with the Phase 1 PSTN architecture.

**Problem it solves**

It creates a durable audit trail and supports deterministic session and attempt state updates.

**Phase 1 implementation note**

Receiving Exotel webhook callbacks is strongly recommended once telephony orchestration is implemented.

A separate persisted `webhook_event` entity is useful for auditability and debugging, but it is not mandatory in the very first Exotel integration slice. A smaller Phase 1 implementation may update `call_attempt` and `scanner_session` directly from webhook callbacks and add dedicated `webhook_event` storage later if needed.

**Key fields**

- `webhookEventId`
- `provider`
- `providerEventId`
- `sessionId`
- `callAttemptId`
- `eventType`
- `receivedAt`
- `processedAt`
- `processingStatus`
- `rawPayloadReference`

**Privacy level**

Private

**Used by**

- webhook processing
- provider debugging
- audit and monitoring

### 4.11 Admin User

**What it is**

An internal operator identity used for system monitoring and support visibility.

**Why it is needed**

- admin monitoring is a separate concern from owner control
- internal access needs stronger permissions and clearer audit scope

**Problem it solves**

It separates product users from platform operators and prevents overloading the owner model with admin responsibilities.

**Key fields**

- `adminUserId`
- `email`
- `role`
- `status`
- `lastLoginAt`
- `createdAt`

**Privacy level**

Private

**Used by**

- admin dashboard
- operational reporting
- restricted system views

## 5. Supporting Value Objects and Enums

These are not full entities but they must be consistent across the backend.

### 5.1 Gateway Action

Values:

- `call`
- `message`
- `sos`

Gateway action is the full scanner menu. Session-backed contact flows use a narrower subset.

### 5.1.1 Contact Gateway Action

Values:

- `call`
- `message`

### 5.2 Tag Status

Phase 1 values:

- `unclaimed`
- `active`
- `paused`
- `revoked`

### 5.3 Session Status

Phase 1 values:

- `created`
- `in_progress`
- `completed`
- `failed`
- `expired`
- `closed`

Rule:

- `scanner_session.status` stays generic across contact flows
- telephony leg progress belongs in `call_attempt`, not in `scanner_session.status`

### 5.4 Communication Channel

Values:

- `pstn_call`
- `sms`
- `whatsapp`

## 6. Entity Relationships

The canonical relationships are:

- one `owner` can have many `vehicles`
- one `owner` can have many `tags`
- one `vehicle` should have one active current `tag` in Phase 1
- one `tag` belongs to one `owner`
- one `tag` belongs to one `vehicle`
- one `owner` can have many `backup_contacts`
- one `owner` can have one `sos_profile`
- one `owner` can have many `scanner_interactions`
- one `scanner_session` belongs to one `tag`
- one `scanner_session` belongs to one `owner`
- one `scanner_session` should have one primary `scanner_interaction` record in Phase 1
- one `tag` can have many `scanner_interactions`
- one `scanner_session` can have many `call_attempts`
- one `scanner_session` can have many `message_attempts`
- one `call_attempt` can have many `webhook_events`

## 7. Storage Placement

### 7.1 Persistent Storage: MongoDB Atlas

Use persistent storage for:

- `owner`
- `vehicle`
- `tag`
- `scanner_interaction`
- `backup_contact`
- `sos_profile`
- `admin_user`
- durable `call_attempt`
- durable `message_attempt`
- durable `webhook_event`

**Why**

These records represent business state, configuration, or audit history that must survive beyond a short interaction window.

### 7.2 TTL / Short-Lived Storage: Upstash Redis

Use TTL-backed storage for:

- active `scanner_session`
- session lookup helpers
- short-lived call orchestration state
- temporary rate/protection counters if added later

**Why**

Scanner interactions are temporary and latency-sensitive. Redis is a better fit for fast expiry-based session handling.

Redis in this system is an active-session operational store, not the long-term reporting source for admin views.

## 8. Public vs Private Data Boundaries

This is a core privacy rule of the system.

### 8.1 Scanner-Safe Public Projection

Scanner-facing responses may include:

- `token`
- `ownerLabel`
- `vehicleLabel`
- `plateLastFour`
- `availableActions`
- public session status
- masked scanner confirmations
- general unavailable/failure messages

Phase 1 rule:

- `ownerLabel` is the fixed generic string `Vehicle Owner`

### 8.2 Private Server-Only Data

These must remain server-side only:

- `ownerPhone`
- `scannerPhone`
- `scannerPhoneEncrypted`
- `scannerPhoneHash`
- `backupContact.phone`
- internal ids and auth references
- raw provider payloads
- direct owner identity data not approved for scanner view
- full plate number unless explicitly required and approved
- medical and emergency notes outside SOS path

### 8.3 Emergency-Only Data

These must be disclosed only within the SOS flow:

- medical profile details
- designated family or emergency contact details
- designated family or emergency contact phone numbers may be shown unmasked as an explicit SOS-only exception

## 9. State Models

### 9.1 Tag State

Phase 1 tag lifecycle:

- `unclaimed`
  Tag was issued internally, has a valid token and QR, and is waiting for the first owner claim flow. Scanner contact actions are not available yet. The backend must require a server-side claim proof check before activation.
- `active`
  Scanner actions allowed according to `availableActions`
- `paused`
  Scanner resolve may still succeed with scanner-safe metadata, but `availableActions` must be empty and session creation is blocked
- `revoked`
  Token is no longer usable and scanner-facing resolve may return unavailable instead of a normal resolved projection

Dashboard mapping rule:

- `unclaimed` has no owner dashboard presence yet because no owner has successfully claimed the tag
- owner-facing dashboard `Inactive` maps to backend tag state `paused`
- owner-facing dashboard `Active` maps to backend tag state `active`

### 9.1.1 Owner Claim Proof Model

Phase 1 owner claim must stay minimal, server-side, and privacy-safe.

Approved Phase 1 proof model:

- each issued tag record starts in `unclaimed`
- internal/admin issuance creates a one-time claim code and stores only its hashed form server-side
- the private claim code is delivered with the physical tag fulfillment/admin issuance flow, not embedded in the QR payload
- first owner scan opens the claim flow for the unclaimed token
- activation requires both the scanned token and the matching claim code
- after successful claim, the tag becomes `active` and the stored claim proof is cleared

Reason:

- this keeps the public QR opaque
- it avoids exposing owner identity or secret claim material in the QR itself
- it provides a minimal Phase 1 proof step before public scanner flows are reintroduced

### 9.2 Scanner Session State

Phase 1 session lifecycle:

- `created`
  Session was created and private routing data stored
- `in_progress`
  The selected flow is actively being processed
- `completed`
  The selected flow reached its intended successful outcome
- `failed`
  The selected flow failed
- `expired`
  TTL elapsed
- `closed`
  Flow was intentionally terminated or dismissed after handling

Modeling rule:

- `scanner_session.status` stays generic across `call`, `message`, and `sos`
- call-specific detail belongs in `call_attempt`
- message-specific detail belongs in `message_attempt`
- SOS-specific disclosure behavior belongs in the SOS flow, not in action-specific session status values

### 9.3 Call Attempt State

Suggested Phase 1 attempt lifecycle:

- `queued`
- `dialing_leg_a`
- `leg_a_answered`
- `dialing_leg_b`
- `connected`
- `no_answer`
- `busy`
- `failed`
- `completed`

### 9.4 Message Attempt State

Suggested Phase 1 lifecycle:

- `queued`
- `sent`
- `delivered`
- `failed`

## 10. Flow-to-Entity Mapping

### 10.1 QR Resolve Flow

Uses:

- `tag`
- `vehicle`
- `owner`

Returns:

- scanner-safe projection only
- for `paused` tags, this may still be a successful non-actionable projection
- for `revoked` tags, scanner-facing resolution may return unavailable instead of a normal projection

### 10.2 Contact Session Create Flow

Uses:

- `tag`
- `owner`
- `scanner_session`
- `scanner_interaction`

Creates:

- `scanner_session`
- `scanner_interaction`

Phase 1 rule:

- this flow applies only to `call` and `message`
- SOS disclosure does not use this session-creation path

### 10.3 Exotel Call Flow

Uses:

- `scanner_session`
- `call_attempt`
- `webhook_event`

Updates:

- session state
- call attempt state

### 10.4 Messaging Recovery Flow

Uses:

- `scanner_session`
- `message_attempt`

### 10.5 Owner Dashboard Flow

Uses:

- `owner`
- `vehicle`
- `tag`
- `backup_contact`
- `sos_profile`

### 10.6 Admin Monitoring Flow

Uses:

- `scanner_interaction`
- `scanner_session`
- `call_attempt`
- `message_attempt`
- `webhook_event`
- `admin_user`

Operational visibility rule:

- admin monitoring should cover live active sessions plus short historical summaries
- historical summaries should come from durable attempt/event records, not raw Redis session internals after TTL expiry

## 11. Minimal Phase 1 API Surface Implied by This Model

This model suggests the following backend groups:

- public scanner APIs
- owner-authenticated dashboard APIs
- admin-authenticated monitoring APIs
- provider webhook APIs

Examples:

- resolve tag
- create session
- trigger call
- trigger message recovery
- fetch session outcome
- update tag active/inactive status
- manage backup contacts
- manage SOS profile
- inspect session and provider outcomes

## 12. Current Repo Alignment

The current backend scaffold already partially reflects this model through:

- `PrivateTagRecord`
- `ResolvedTag`
- `GatewaySessionRecord`
- `GatewaySession`
- `GatewayAction`
- `TagStatus`
- `GatewaySessionStatus`

What is still missing in code:

- explicit `owner` model
- explicit `vehicle` model
- explicit `scanner_interaction` model
- explicit `call_attempt` model
- explicit `message_attempt` model
- explicit `backup_contact` model
- explicit `sos_profile` model
- explicit `webhook_event` model
- explicit `admin_user` model

## 13. Decisions Locked by This Model

The following decisions should now be treated as baseline assumptions unless the RFA changes:

- QR payloads resolve to opaque tokens, not direct identity data
- tag resolution remains server-side only
- owner routing data remains private
- scanner sessions are temporary and TTL-based
- scanner interaction history may be durable, but must stay private and referenceable by owner/tag/session
- telephony attempts are explicit first-class records
- message fallback is a separate first-class record
- emergency disclosure is isolated from the normal parking-contact flow
- owner and admin access are distinct backend concerns

## 14. What Comes Next

Now that the domain model exists, the next backend steps should use it to define:

1. exact persistent schemas and Redis session shapes
2. route and service contracts
3. Exotel call orchestration contracts
4. owner dashboard API contracts
5. admin monitoring API contracts

This means the next implementation step should not jump straight to arbitrary endpoints. It should derive contracts from this model.
