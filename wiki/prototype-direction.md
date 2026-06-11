# Prototype Direction

This note captures the current repo-level direction for the WaveTag prototype.

## Current Decision

The prototype should use the smallest practical tech stack.

This means:

- use one deployable backend server for the MVP
- avoid Redis and similar optimization-driven infrastructure for the prototype
- prefer a single persistence approach until a real blocker proves otherwise
- keep the frontend simple and browser-based
- keep the UI usable on both mobile and laptop browsers
- keep owner and admin authentication real but minimal
- keep manual verification easy through the UI as the product evolves

## Chosen Stack

The current prototype stack is:

- `Fastify` backend in `src/backend/`
- simple `HTML/CSS/JS` frontend in `src/frontend/`
- `MongoDB` as the single prototype database
- `Render` as the primary backend hosting target
- `MongoDB Atlas M0` as the initial hosted database target

## What This Means For The Existing Spec

`docs/RFA_SPEC.md` currently includes architecture assumptions that are heavier than the prototype needs.

We are not revising that file right now.

Instead, `PLAN.md` is the active prototype direction file.

For the prototype, treat the following as optional or future-facing unless they are clearly required:

- Edge runtime assumptions
- Redis session infrastructure
- multi-store architecture
- optimization-first deployment choices

## Remaining Open Questions

- whether masked messaging remains in the first demo slice or becomes a follow-up slice

## Follow-Up Work

- keep `PLAN.md` as the active simpler direction for prototype execution
- keep `TASKS.md` aligned if the prototype stack changes again
