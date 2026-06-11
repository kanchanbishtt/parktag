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
