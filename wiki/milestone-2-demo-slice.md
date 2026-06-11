# Milestone 2 Demo Slice

This note locks the prototype decisions needed to complete Milestone 2.

## First Demo Slice

The first demo slice is intentionally simpler than the full RFA vision.

The first slice is:

1. Admin seeds one owner account, one active tag, and one QR token.
2. Owner signs in and sees the tag in the dashboard.
3. Scanner scans the QR and opens the public tag page in a mobile browser.
4. Scanner enters a phone number and submits a contact request.
5. Backend stores the contact request in MongoDB.
6. Owner refreshes the dashboard and sees the new request.
7. Admin can verify the same request from the admin dashboard.

This keeps the first end-to-end flow easy to verify through the UI before live telephony is added.

## Minimum Frontend Surfaces

- public tag page
- owner claim page
- owner login page
- owner dashboard page
- admin login page
- admin dashboard page

## Minimum Backend Surfaces

- token resolve endpoint
- owner claim endpoint
- login, logout, and session endpoints
- contact-request creation endpoint
- owner dashboard endpoint
- owner tag-status update endpoint
- admin overview endpoint

## Auth And Authorization Model

- scanner routes are public
- owner and admin use authenticated browser sessions
- sessions use HTTP-only cookies
- owner routes are restricted to the signed-in owner's own data
- admin routes are restricted to admin users only
- the first admin account can be seeded manually

## Device Support Matrix

- scanner: mobile-first, laptop-compatible for testing
- owner: mobile and laptop supported
- admin: laptop-first

## Hosting Decision

- app hosting target: `Render`
- database hosting target: `MongoDB Atlas M0`
- fallback app host: `Heroku Eco` if Render blocks the prototype

## Deferred From The First Demo Slice

- live Exotel call bridge
- masked SMS and WhatsApp recovery
- SOS disclosure
- PWA install polish
- rate limiting and abuse controls beyond basic safe handling

## RFA Ambiguities Resolved For The Prototype

- the prototype does not follow the RFA's heavier architecture assumptions such as Edge runtime or Redis
- the first demo slice proves contact-request flow before telephony
- responsive web pages are required now; PWA polish is not required for the first demo slice
- admin-seeded data is allowed for the first demo slice to reduce setup friction
