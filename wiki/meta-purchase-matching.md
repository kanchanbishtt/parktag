# Meta purchase matching

Deployed 2026-09-18 to production, Railway deployment 626f5f19-a07a-4441-b89e-755cb764299b (SUCCESS). Live health and analytics bundle verified. Next real paid-order receipt still needs verification.

- Shared analytics bundle preserves `_fbc` from real `fbclid` and `_fbp` across parktag.me and app.parktag.me. Scanner and unconfigured surfaces do not write these cookies.
- New guest, authenticated and COD orders store `metaCheckoutContext`; unpaid checkout reuse refreshes context. COD placement does not newly fire Purchase; existing paid fulfilment triggers it.
- Paid fulfilment sends saved browser IP/UA, fbc/fbp, public checkout URL and hashed phone/email. Webhook metadata is never substituted for buyer metadata.
- Browser/server deduplication keeps `purchase:<orderNumber>`.
- CAPI verifies `events_received` and logs accepted/failed events with event ID and no raw identifiers. Accepted is receipt, not guaranteed campaign attribution. Sending remains best effort without retries.
- Verification: 39 focused tests passed; git diff --check passed. Use isolated test collection prefixes.
- Historical order PT-260917-00027 has GA4 first-user meta / paid, sales_india, peel. Do not fabricate its click ID or replay it as a current purchase.
