# Owner sessions: staying signed in

Decided 2026-10-08.

## The problem

Owners were asked to sign in again every time they closed the browser. The server kept an owner session for 7 days, but the cookie was a browser-session cookie unless "Remember me" was ticked, and that box existed only on the PIN form. WhatsApp OTP, Firebase SMS, Google and activation sign-ins never set it. On a phone, swiping the browser away or the OS reclaiming it ends a browser-session cookie, so most owners lost their session within the day.

## The rule

- Every owner sign-in sets a persistent cookie (`Max-Age` = 180 days). There is no "Remember me" box any more; a `rememberMe` sent by an old cached page is ignored.
- The server row decides when the session really ends: 30 days after its last use, never more than 180 days after sign-in.
- Each use slides `expiresAt` forward (`renewIfDue` in `lib/auth/session.js`), at most one write per session per day, fire-and-forget.
- Admin sessions are unchanged: 12 hours, browser-session cookie, no slide.
- A session row with no `createdAt` is never slid, because it has nothing to cap against.

## Why the cookie does not slide

The cookie is set once for the longest a session could last. Sliding only the server row means `readSession` never needs the reply, and the server stays the single place a session can be ended (logout, "Logout from all devices", PIN change, account deletion).

## Rollout note

Owners signed in before this deploy still hold browser-session cookies. Their server rows slide, but the cookie still ends with the browser once more. After their next sign-in, they stay signed in.

Tests: `src/backend/tests/owner-stay-signed-in.test.js`.
