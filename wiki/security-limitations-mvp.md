# Security Limitations Accepted For The MVP (M6)

This note records the security boundaries that ParkTag's MVP **intentionally accepts**.
It is the write-up called for by TASKS.md M6. None of these are bugs — they are conscious
trade-offs for the demo/MVP stage, each with the reasoning and the upgrade path.

## What is already hardened (context)

Before the accepted limitations, the following are in place and verified:

- **Sessions:** opaque 192-bit id, `httpOnly`, `sameSite:lax`, `secure` in production,
  server-side store (`lib/auth/session.js`).
- **Authorization:** every protected route goes through `requireSession` → `401`/`403`;
  owner queries are scoped by `ownerId = session.userId`, tag ops keyed `{_id, ownerId}`.
- **Secrets:** no keys/URIs in client code — only publishable Razorpay/Google IDs reach the
  browser. `/api/runtime/status` returns only Boolean `*Configured` flags, never values.
- **Input validation:** whitelists, `/^\d{4}$/` plate-last-4 checks, required-field `400`s.
- **Messaging abuse:** WhatsApp bodies are server-built from a fixed base + reason whitelist;
  the finder can never author free text.

---

## Accepted limitation 1 — In-memory session store resets on restart

- **What:** sessions live in an in-process store, not MongoDB/Redis. A server restart or a
  new deploy **logs everyone out**.
- **Why accepted:** single-instance deployment for the MVP; no horizontal scaling yet.
  Avoids adding Redis, which `wiki/prototype-direction.md` explicitly defers.
- **Impact:** users re-authenticate after a deploy. No data loss — only session loss.
- **Upgrade path:** move the session store to MongoDB (or Redis) when running more than one
  instance. This is also the prerequisite for zero-downtime deploys.

## Accepted limitation 2 — No CSRF token beyond `sameSite:lax`

- **What:** CSRF protection relies on the session cookie's `sameSite:lax` attribute; there is
  no per-request CSRF token.
- **Why accepted:** `sameSite:lax` blocks cross-site cookie sending for the state-changing
  (POST/DELETE) requests that matter, which covers the realistic CSRF surface for this app.
- **Impact:** acceptable for the MVP; a determined attacker with a `GET`-based state change
  could bypass it, but the app has no state-changing `GET`s.
- **Upgrade path:** add a double-submit CSRF token (or `sameSite:strict` where the UX allows)
  before handling higher-value transactions at scale.

## Accepted limitation 3 — Rate limiting is coarse (per M9)

- **What:** rate limits are per-route and IP-based (contact / login / OTP buckets), not
  per-account or adaptive.
- **Why accepted:** stops casual abuse and OTP flooding for the MVP without a dedicated
  abuse-detection layer.
- **Impact:** a distributed attacker across many IPs is not fully mitigated.
- **Upgrade path:** per-account limits + provider-side (Meta/Exotel/Razorpay) abuse controls.

## Accepted limitation 4 — Shop create-order trusts the client amount (M15, OPEN)

- **What:** `POST /api/shop/create-order` currently trusts a client-supplied `amount`.
- **Why noted here:** this is the **one accepted limitation that is a real integrity hole**,
  tracked as **M15** and scheduled to be fixed (server-side `SHOP_PRODUCTS` catalog).
- **Impact:** a crafted request could create a Razorpay order for the wrong price. The owner
  premium-upgrade flow (`purchase-order`) is **already server-locked at ₹199** and is not
  affected.
- **Upgrade path:** M15 — resolve price from a server catalog by `productId`, ignore the
  client `amount`. See `PLAN.md` §17.

---

## Summary

| # | Limitation | Severity for MVP | Fix owner |
|---|-----------|------------------|-----------|
| 1 | In-memory sessions reset on restart | Low (re-login only) | Post-MVP (multi-instance) |
| 2 | No CSRF token beyond `sameSite:lax` | Low (no state-changing GETs) | Post-MVP |
| 3 | Coarse IP-based rate limits (M9) | Low–Medium | Post-MVP |
| 4 | Shop create-order trusts client amount | **Medium (money)** | **M15 (scheduled)** |

Limitations 1–3 are acceptable as-is for the MVP demo. Limitation 4 (M15) is the only one
with a committed near-term fix.
