# WaveTag Agent Guide

This file defines the working rules for AI agents and contributors in this repository.

## Project Goal

WaveTag is an MVP for anonymous vehicle contact.

The Phase 1 goal is simple:

- let a public scanner contact a car owner quickly
- keep the owner's private phone number hidden
- keep the stack minimal
- keep the code readable
- produce a working demo that can be verified and shown to a supervisor

Primary product context lives in `docs/RFA_SPEC.md`.
Primary prototype execution direction lives in `PLAN.md`.

## Working Principles

- follow the `karpathy-principles` skill behavior
- prefer the smallest working change over broad refactors
- do not add complexity unless the requirement clearly needs it
- prefer prototype choices with fewer moving parts over production-style architecture
- keep contracts and implementation aligned
- verify each completed slice with a concrete command or manual check
- prefer verification through a simple UI when practical, so progress stays easy to inspect and demo

## Source Of Truth

Use these files in this order:

1. `INITIAL_PROMPT.md`
2. `PLAN.md`
3. `TASKS.md`
4. `docs/RFA_SPEC.md`
5. relevant supporting docs under `docs/`

If the docs disagree, update the repo docs to remove ambiguity before building more code.
For prototype execution decisions, `PLAN.md` wins over `docs/RFA_SPEC.md` unless the user says otherwise.

## Progress Tracking

Project progress must be tracked in the root `TASKS.md`.

Rules:

- update `TASKS.md` when a milestone starts, completes, or changes meaningfully
- keep `TASKS.md` updated during execution, not only at the end
- keep entries concrete and implementation-oriented
- only mark items complete after verification
- add newly discovered tasks to `TASKS.md` as soon as they are identified
- if a task is completed along with side work discovered during implementation, record that side work in `TASKS.md` too
- use `docs/TASKS.md` as the detailed backend execution tracker when backend work is in scope

## Wiki Usage

Use the `wiki/` folder as a living knowledge base.

Add notes there when you discover:

- clarified product decisions
- corrected assumptions
- implementation constraints
- provider integration findings
- test or deployment lessons worth preserving

Prefer short focused documents over large mixed notes.

## Build Style

- default to minimal architecture
- prefer one deployable backend server and the fewest supporting services needed for the prototype
- keep all application code under the repo `src/` folder
- reuse `src/backend/` for backend code and `src/frontend/` for frontend code unless the user explicitly chooses a different structure
- prefer explicit code over generic abstractions
- keep scanner-facing responses privacy-safe
- treat telephony, privacy, and tag-state behavior as high-risk areas
- do not build deferred Phase 2 features unless explicitly requested
- keep building a simple verification-friendly UI as the project evolves, instead of relying only on backend-only checks
- avoid optimization-driven infrastructure such as Redis or multi-store designs unless a verified prototype need appears

## Current Execution Expectation

The next useful work should stay inside the Phase 1 MVP boundary:

- scanner contact flow
- owner claim and status control
- privacy-safe backend behavior
- provider-backed call and recovery messaging
- demo-ready verification

---

# Analytics Tracking — Mixpanel (owner dashboard only)

This project uses **Mixpanel** for owner-dashboard product analytics — retention and engagement, not the marketing funnel. Do not introduce another analytics tool for this purpose without explicit instruction.

The marketing/checkout funnel (GA4 + Meta Pixel/CAPI) is a separate system: `src/backend/assets/analytics.js` / `ptTrack()`. Do not route Mixpanel events through it, and do not route `ptTrack` events into Mixpanel — they answer different questions and mixing their vocabularies is the "one event, two meanings" anti-pattern.

## Tech Stack

| Detail | Value |
|---|---|
| **Tracking method** | **Server-side only.** No browser SDK, no client script. |
| **Why server-side, not client** | Two of the four event families have no browser to fire from at all (a scan is a stranger at someone else's windscreen; a call connecting is an Exotel webhook). The other two already round-trip through an authenticated `/api/owner/*` handler that holds the owner's real database id — the same id `/api/session` and `/api/owner/dashboard` deliberately withhold from the browser (see the `_id` comment in `routes/owner/dashboard.js`). Tracking client-side would have required exposing that id to a page script, which is a security regression this codebase has explicitly avoided elsewhere. |
| **Integration module** | `src/backend/lib/integrations/mixpanel.js` — mirrors `meta-capi.js`'s pattern: best-effort, never throws, no-ops when unconfigured. |
| **Ingestion endpoint** | `POST https://api.mixpanel.com/track` (project-token auth only). Upgrade to `/import` + a service-account secret is a reasonable next step if historical backfill or stricter delivery guarantees are ever needed. |
| **CDP** | None. |
| **Consent gating** | Not implemented — ParkTag ships within India only (Amazon.in, INR, Indian addresses); no EU/CA users. Revisit if that ever changes. |
| **Project token location** | `.env` → `MIXPANEL_TOKEN`, read via `env.mixpanelToken` (`src/backend/lib/env.js`). |

## Identity

There is no `identify()` / `reset()` lifecycle here — that's a client-SDK concept for merging an anonymous pre-login user into a known one. Every event fires server-side, after auth, with the owner's stable database id (`request.session.userId`, stringified) passed directly as `distinct_id`. There is no anonymous state to merge.

**Do not** add a client-side Mixpanel SDK to fetch or expose the owner id for this purpose — see the security note above.

## Tracking Plan

| Event | Trigger | Key Properties | File |
|---|---|---|---|
| `owner_signed_in` | Any owner session created (credential, mobile OTP, Google, post-registration) | — | `src/backend/lib/auth/session.js` → `createSession()` |
| `tag_scanned` | A claimed tag's public page is loaded | `vehicle_type` | `src/backend/routes/public/index.js` → `GET /api/tags/:token` |
| `contact_action` | A scanner successfully reaches the owner (call, emergency call, or WhatsApp) | `method` (`call` / `emergency_call` / `message`) | `routes/public/index.js` (`register-call`, `register-emergency-call`), `lib/core/contact-actions.js` |
| `masked_call_connected` | Exotel reports the call as actually answered | `call_duration`, `call_type` | `src/backend/routes/webhooks/exotel.js` |
| `tag_status_changed` | Owner pauses/reactivates a tag | `status` | `routes/owner/dashboard.js` → `POST /api/owner/tags/:tagId/status` |
| `emergency_contact_updated` | Owner sets/changes the SOS contact | — | `routes/owner/dashboard.js` → `POST .../emergency-contact` |
| `tag_deactivated` | Owner deletes/deactivates a vehicle | — | `routes/owner/dashboard.js` → `DELETE /api/owner/tags/:tagId` |
| `membership_renewed` | Razorpay payment verified for a membership order | `plan_id`, `months`, `amount` | `routes/owner/membership.js` → `verify-payment` |

## How to Add a New Mixpanel Event

1. Check the table above first — reuse an existing event/property name if one already fits.
2. Name it `snake_case`, past tense: `object_verb`.
3. Call `sendMixpanelEventBestEffort(logger, env, { eventName, distinctId, properties })` from `lib/integrations/mixpanel.js`, **after** the action has actually succeeded (after the DB write / provider confirmation), not before.
4. `distinctId` must be the owner's `ownerId` (stringified), sourced server-side from `request.session.userId` or the record's stored `ownerId` field — never accept a distinct_id from client input.
5. Never include PII in properties (no phone numbers, plates, emails, tokens).
6. Update the table above.
7. Verify in Mixpanel Live View before considering it done.

## What Not to Do

- Do not add a client-side Mixpanel SDK — see Identity above for why.
- Do not route these events through `ptTrack`/`analytics.js`, or vice versa — different vocabularies, different destinations.
- Do not track PII as properties.
- Do not hardcode the project token — read `env.mixpanelToken`.
- Do not fire an event before the action it represents has actually succeeded.
