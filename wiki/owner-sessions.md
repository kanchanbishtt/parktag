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

## After a password reset (2026-10-16)

A reset is the standard answer to "someone else may be in my account", so the route treats it as a credential change, not a password edit:

- Every session the account had is revoked through `revokeSessionsForUser()` in the route (Mongo rows plus this instance's cache). Other replicas drop their cached copy within the 30-second re-check.
- The device that opened the emailed link is signed in on the spot with a brand-new session id (`owner_signed_in`, method `password_reset`), same 30-day idle and 180-day cap as any sign-in. It is sent to the dashboard, not back to the sign-in screen.
- Every unused reset link for that address is burnt, not only the one used.
- The owner gets "Your ParkTag password was changed" with a button to reset again, which is the undo for a reset they did not make.
- Changing the password while signed in (settings) is a different path and keeps the current session; that is what `revokeOtherSessionsForUser()` is for, as the login PIN screen already does.

