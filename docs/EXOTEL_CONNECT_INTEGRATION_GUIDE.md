# WaveTag Exotel Connect Integration Guide

This document defines how WaveTag Phase 1 should integrate Exotel Voice v1 `Connect Two Numbers` into the backend.

Its goal is to make the Exotel integration:

- contract-first
- privacy-safe
- testable
- aligned with the WaveTag PSTN-only Phase 1 architecture
- resistant to data leakage and common backend abuse paths

## 1. Scope

This guide covers:

- the exact Exotel API flow relevant to WaveTag
- the backend integration sequence for this repo
- required environment variables
- the route and service shape WaveTag should use
- safe persistence and webhook handling
- security rules to prevent PII leakage and provider abuse
- the lowest-cost testing path for a developer account

This guide does not replace:

- `RFA_Document/RFA_WaveTag_web_Application.md`
- `DOMAIN_MODEL.md`
- `SCHEMA_AND_API_CONTRACTS.md`

If this guide conflicts with those files, the contract docs and approved RFA still win.

## 2. Why Exotel Fits WaveTag

WaveTag Phase 1 requires:

- real PSTN calling
- browser-native scanner flow
- no WebRTC
- server-side identity mapping
- masked communication between scanner and owner

Exotel `Connect Two Numbers` matches that model because the backend can ask Exotel to:

1. dial the scanner first
2. dial the owner after the scanner answers
3. bridge both legs through an Exotel virtual number

This keeps the scanner and owner phone numbers server-side and out of scanner-facing responses.

## 3. Delhi-NCR Region Note

The user location being Delhi-NCR does not change the Exotel API contract.

What matters is the Exotel account region and number provisioning.

For India-hosted Exotel accounts, the documented Voice v1 base URL is:

```text
https://api.in.exotel.com
```

WaveTag should treat the API base URL as configuration and not hardcode user geography into request logic.

### 3.1 Exotel Product Choices for WaveTag

When creating or configuring the Exotel account for WaveTag Phase 1, the product choices should stay minimal.

Tick now:

- `Voice`
- `SMS`
- `WhatsApp`

Optional:

- `ExoVerify` only if owner OTP verification is planned soon

Do not request for Phase 1 right now:

- `AgentStream`
- `Browser Calling`
- `SMS Campaigns`
- `Call Campaigns`
- `Lead Assist`

Reason:

- WaveTag Phase 1 needs PSTN call bridging plus fallback messaging
- WaveTag Phase 1 explicitly rejects browser-based WebRTC calling
- campaign and lead products are not part of the scanner-to-owner incident flow

### 3.2 Account, KYC, and Trial Notes

These distinctions matter:

- having `API Key`, `API Token`, `Account SID`, or dashboard action options does not prove outbound voice API is fully enabled
- trial/manual outbound testing and outbound voice API access are not always treated the same way by Exotel support docs
- for Indian outbound calling, Exotel support docs indicate KYC may still be required before real outbound API calls are accepted

WaveTag working rule:

- local automated tests should never depend on live Exotel access
- real PSTN API testing should assume KYC and a valid `CallerId` / ExoPhone may be required
- if a real API test returns `403` KYC-related rejection, treat that as expected account-state behavior rather than an application bug

### 3.3 Trial Credits Note

Exotel trial credits are account balance for using Exotel services.

For WaveTag, those credits are mainly relevant to:

- voice call testing
- SMS testing
- any rented Exotel number or related usage billed through account balance

Credits do not change the backend integration design.

They only affect how much live provider testing can be done before recharge is needed.

## 4. Official Exotel Endpoints Relevant to WaveTag

### 4.1 Outbound Connect

Use:

```text
POST /v1/Accounts/{sid}/Calls/connect
```

Required form fields:

- `From`
- `To`
- `CallerId`

Recommended WaveTag fields:

- `CallType=trans`
- `StatusCallback=<backend webhook URL>`
- `StatusCallbackEvents[]=terminal`
- `StatusCallbackEvents[]=answered`
- `CustomField=<WaveTag callAttemptId or sessionId>`
- `WaitUrl=<optional scanner hold audio URL>`
- `TimeOut=<optional outbound timeout>`
- `TimeLimit=<optional max bridged duration>`
- `Record=<optional recording flag only if product/legal requirements approve it>`

### 4.2 Status Callback

Use Exotel status callbacks to receive asynchronous call-progress updates.

WaveTag should treat callback data as an update source for:

- call-attempt state
- session state
- reconciliation status

### 4.3 Call Details

Use the call details API as a reconciliation fallback when:

- the callback is delayed
- the callback is missing
- the callback payload is incomplete
- internal processing fails and retry/replay is needed

## 5. Exact WaveTag Integration Sequence

WaveTag should integrate Exotel in this order.

### Step 1. Create the WaveTag session first

Use the existing `create-session.ts` logic as the gate.

This means:

- token is normalized and validated first
- only `active` tags can proceed
- only `call` or `message` flows create contact sessions
- the scanner phone is normalized to Indian E.164
- a private live session is created
- a separate durable scanner interaction record is created

No Exotel API call should be attempted before the internal session exists.

### Step 2. Add a dedicated trigger-call service

Add a new backend service for the outbound provider request.

Recommended file:

```text
Backend-Gateway/Backend/src/services/trigger-call.ts
```

This service should:

1. accept `sessionId`
2. load the private session record
3. verify the session exists and is not expired
4. verify `action === "call"`
5. create a new internal `call_attempt` record with a local `callAttemptId`
6. send the Exotel `connect` request
7. store the returned Exotel `Call.Sid` as provider correlation data
8. return only a scanner-safe trigger result

This service must not return:

- scanner phone
- owner phone
- `CallerId`
- raw Exotel payloads
- Exotel auth details

### Step 3. Persist provider correlation state

WaveTag should persist enough provider metadata to support webhook correlation and manual reconciliation.

Minimum recommended fields for the first implementation slice:

- `callAttemptId`
- `sessionId`
- `provider: "exotel"`
- `providerRequestId` set to Exotel `Call.Sid`
- `virtualNumber` set to the configured `CallerId`
- `overallStatus`
- `legAStatus`
- `legBStatus`
- `startedAt`
- `endedAt`
- `failureReason`
- `customField`

### Step 4. Accept webhook updates on a dedicated provider route

Recommended route:

```text
POST /api/provider/exotel/webhook
```

This route should:

1. verify the request shape and provider origin using the approved validation method
2. parse only the fields required for correlation and status updates
3. map the payload to `call_attempt` and `scanner_session` updates
4. write a durable processing result
5. return a provider-compatible acknowledgement

This route must never echo sensitive request details back to the client.

### Step 5. Reconcile missing or delayed callbacks

Because provider callbacks may be delayed or lost, WaveTag should add a reconciliation step that can:

- fetch the latest call details by Exotel `Call.Sid`
- compare provider state against local state
- update the local `call_attempt` and `session` records

This can start as a manual admin/developer utility before becoming an automated job.

## 6. Recommended Route and Service Shape for This Repo

### 6.1 Public Scanner Route

The scanner-facing route should remain:

```text
POST /api/session/[sessionId]/call
```

Purpose:

- trigger telephony for an already-created private session whose action is `call`

Safe success shape:

```ts
interface TriggerCallRouteResponse {
  sessionId: string;
  status: "in_progress";
  callAttemptId: string;
}
```

Scanner-facing routes must not expose provider data or routing numbers.

### 6.2 Internal Service Boundary

Recommended service contract:

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

### 6.3 Provider Webhook Route

Recommended provider route:

```text
POST /api/provider/exotel/webhook
```

This is not a public product route.

It should be isolated from normal scanner and owner application routes and handled with stricter logging and validation rules.

## 7. Required Environment Variables

WaveTag should keep Exotel credentials and routing configuration entirely server-side.

Recommended env vars:

```text
EXOTEL_API_BASE_URL=https://api.in.exotel.com
EXOTEL_ACCOUNT_SID=<account sid>
EXOTEL_API_KEY=<api key>
EXOTEL_API_TOKEN=<api token>
EXOTEL_CALLER_ID=<approved Exotel virtual number>
EXOTEL_STATUS_CALLBACK_URL=<public webhook endpoint>
EXOTEL_WAIT_URL=<optional audio URL>
EXOTEL_DEFAULT_TIMEOUT_SECONDS=<optional>
EXOTEL_DEFAULT_TIME_LIMIT_SECONDS=<optional>
```

Rules:

- never expose these values to browser code
- never prefix them as public frontend env vars
- never log `EXOTEL_API_TOKEN`
- never serialize env-derived auth config into route responses or thrown public errors

## 8. Security Rules for the Exotel Slice

This section is mandatory for implementation.

### 8.1 No PII in Scanner-Facing Responses

Do not expose any of the following in scanner-facing APIs:

- owner phone
- scanner phone
- backup contact phone
- full plate number
- owner display name
- Exotel virtual number
- raw webhook payloads
- provider request IDs unless specifically needed for internal admin tools only

WaveTag scanner responses should stay limited to the public contracts defined in `SCHEMA_AND_API_CONTRACTS.md`.

### 8.2 No Secrets in Logs

Never log:

- `Authorization` headers
- Exotel API token
- full outbound request bodies containing phone numbers
- full inbound webhook payloads if they contain phone numbers

If logging is required, log only:

- `sessionId`
- `callAttemptId`
- masked provider correlation IDs
- sanitized status values
- sanitized error categories

### 8.3 Treat Webhooks as Untrusted Input

Even though the request comes from a provider path, do not trust it by default.

Webhook handling must:

- validate expected fields
- reject malformed requests
- avoid dynamic field passthrough into logs or DB writes
- correlate only through known IDs
- ignore unexpected properties

### 8.4 Never Trust Client-Supplied Telephony Data

The scanner client must never be allowed to supply:

- owner phone
- `CallerId`
- provider base URL
- provider status values
- provider request IDs

The backend must derive all routing data from server-side session and owner records only.

### 8.5 Restrict Abuse Paths

The Exotel call trigger route is a cost-incurring path and must be treated as abuse-sensitive.

Before production rollout, add:

- tag/session expiry enforcement
- one active call flow per session
- duplicate trigger protection
- idempotency checks for repeated scanner taps
- basic per-tag and per-session throttling
- provider timeout handling

Phase 1 may defer broad anti-spam logic, but it must not allow unlimited repeated call triggers for the same live session.

### 8.6 Keep Encryption and Hashing Server-Side

The current local dev store uses placeholder encryption and hashing seams.

Before production:

- replace base64 placeholder storage with real encryption for private phone storage
- keep a one-way hash for scanner lookup/dedup use cases
- store encryption keys outside the repo

### 8.7 Public Errors Must Stay Generic

Do not leak provider internals through public errors.

Good:

- `Unable to start the call right now.`

Bad:

- raw Exotel response text
- leg-level routing failures with phone references
- DNS, auth, or provider account configuration details

## 9. Recommended Data Model Additions

The current code already has:

- private scanner session state
- durable scanner interaction state

The Exotel slice should add the next private records:

- `call_attempts`
- optional `webhook_events`

Minimum `call_attempt` fields for the first slice:

```ts
interface CallAttemptDocument {
  callAttemptId: string;
  sessionId: string;
  provider: "exotel";
  providerRequestId: string | null;
  virtualNumber: string | null;
  legAStatus: string;
  legBStatus: string;
  overallStatus: string;
  startedAt: string;
  endedAt: string | null;
  failureReason: string | null;
}
```

## 10. Recommended Status Mapping

WaveTag should keep generic session state separate from provider leg state.

Recommended rule:

- `scanner_session.status` remains high-level
- leg-level Exotel progress belongs in `call_attempt`

Suggested WaveTag mapping:

- initial successful trigger request -> session `in_progress`, call attempt `queued`
- scanner leg answered -> call attempt `leg_a_answered`
- owner leg dialing -> call attempt `dialing_leg_b`
- both legs bridged -> call attempt `connected`
- no answer or busy -> call attempt terminal failure state
- completed bridge -> call attempt `completed`, session `completed`
- provider failure -> call attempt `failed`, session `failed`

## 11. Low-Cost Developer Testing Path

WaveTag should use a two-layer testing strategy.

### 11.1 Local No-Cost Testing

Use a fake Exotel client in automated tests.

This should verify:

- only `call` sessions can trigger telephony
- expired sessions are blocked
- provider request payload shape is correct
- raw provider data is not exposed publicly
- provider errors map to safe backend errors
- call-attempt state is created before and after provider calls

This gives the main verification loop without spending money.

### 11.2 Real Exotel Testing With a Developer Account

For real PSTN testing:

1. create or use your own Exotel account
2. verify your mobile number in the Exotel account
3. complete KYC on the same account if Exotel requires it for outbound API use
4. confirm your account has a valid `CallerId` / ExoPhone usable with the Connect API
5. test first with your own numbers only

Recommended real test sequence:

1. scanner phone = your verified number
2. owner phone = your second number or another verified controlled number
3. trigger one backend session
4. trigger the Exotel call
5. inspect:
   - local `sessionId`
   - local `callAttemptId`
   - Exotel `Call.Sid`
   - webhook processing result
   - reconciled final call status

Important:

- Delhi-NCR as your physical location does not remove KYC or caller-ID requirements
- whether a trial setup is sufficient depends on the actual Exotel account state and provisioned caller ID
- do not design the production backend assuming unrestricted free outbound calling

## 12. Implementation Order for WaveTag

Follow this order:

1. add Exotel env handling
2. add typed Exotel client wrapper
3. add `call_attempt` types and repository seam
4. add `trigger-call.ts` service with tests using a fake Exotel client
5. add scanner-facing `POST /api/session/[sessionId]/call`
6. add `POST /api/provider/exotel/webhook`
7. add call-details reconciliation utility
8. replace local dev seams with Redis and Mongo-backed adapters

This order keeps the work verifiable and prevents route work from outrunning the service contract.

## 13. Minimum Safe Coding Rules for Implementation

When the Exotel slice is implemented in code:

- validate all route input at the boundary
- never build provider URLs from client input
- centralize Basic Auth construction in one server-only module
- centralize provider payload shaping in one service/client module
- use short request timeouts and explicit error mapping
- add automated tests before any real provider wiring is considered done
- keep documentation synchronized if any route field, status mapping, or provider rule changes

## 14. Source Links

Official docs used for this guide:

- Connect Two Numbers: `https://developer.exotel.com/docs/voice-v1/api-reference/connect-two-numbers`
- Status Callback: `https://developer.exotel.com/docs/voice-v1/api-reference/status-callback`
- Call Details: `https://developer.exotel.com/docs/voice-v1/api-reference/call-details`
- API settings / account SID / token lookup: `https://support.exotel.com/support/solutions/articles/3000023019-how-to-%20Find-my-api-key-api-token-account-sid-and-subdomain-`
- Trial outbound calling: `https://support.exotel.com/support/solutions/articles/110606-trial-accounts-how-do-i-test-outbound-calling-`
- KYC docs: `https://support.exotel.com/support/solutions/articles/35760-where-do-i-upload-my-kyc-verification-docs-and-what-documents-qualify-for-kyc-`
- Phone verification: `https://support.exotel.com/support/solutions/articles/104361-unverified-number-how-to-verify-my-number-`
- Outbound calling note: `https://support.exotel.com/support/solutions/articles/35123-how-do-i-make-outbound-calls-via`
- Trial account overview: `https://support.exotel.com/support/solutions/articles/35109-what-is-a-trial-account-`
- Credits and validity: `https://support.exotel.com/support/solutions/articles/3000099510-what-is-the-difference-between-top-up-validity-and-upgrade-while-making-the-payment-`
- Zero-balance behavior: `https://support.exotel.com/support/solutions/articles/109409-what-happens-when-my-exotel-credit-balance-becomes-zero-negative-`
