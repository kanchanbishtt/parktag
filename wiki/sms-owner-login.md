# Owner login via WhatsApp or SMS

WhatsApp remains the default. The owner login page offers SMS via the existing Firebase REST send/verify routes. Firebase RecaptchaVerifier provisions its project-specific challenge; the client sends the token to our backend so shared destination OTP budgets and IP limits apply. Resends stay on the active challenge channel and use a fresh CAPTCHA. Backend owner resolution is shared with WhatsApp.

## Primary Firebase configuration

On September 18, 2026, Girish chose parktag1 under contact@edittree.in as the primary Firebase project. It is on Blaze, Phone sign-in is enabled, app.parktag.me is already authorized, and SMS region policy allows India only.

The production FIREBASE_API_KEY already matched parktag1's current rotated browser key, but FIREBASE_PROJECT_ID incorrectly said parktag-449be. Only the project ID needs changing; retain the current key. The SDK snippet in Firebase settings still displayed an expired old key, so do not copy that snippet blindly. The current production key passed a read-only Identity Toolkit reCAPTCHA configuration check.

The separate parktag-449be project belongs to biz.edittree@gmail.com and remains intact on Spark. No Firestore, Storage or Firebase UID dependencies were found in app source; owners, tags and sessions use MongoDB. No Firebase users are deleted or migrated by this change.

## Verification

Focused tests mock Firebase requests and use a disposable MongoDB prefix. Cover WhatsApp/SMS routing, resend failure, email regression, invalid OTP rejection, owner reuse and send-budget charging. Real handset delivery still requires an explicit test by an account holder. Do not solve a CAPTCHA or send a real OTP automatically during UI verification.

On September 21, 2026, live testing exposed a coupling bug: the backend charged
the shared destination budget and ten-minute SMS window before Firebase replied,
but retained both after a definite Firebase rejection. Several rejected SMS
attempts could therefore block WhatsApp too. Pending sends are now distinct,
confirmed only after Firebase accepts them, and definite rejections roll back
both reservations. The login page also exposes SMS immediately if WhatsApp
sending fails instead of hiding the fallback behind WhatsApp success.

Release: PR #253 merged with explicit owner override after all CI checks passed. Railway e93c90a2-7c36-49ef-a1ab-80d23dc824a0 succeeded at 434e06a. Live health, parktag1 config and both login options verified. 28 local targeted tests passed. Real handset delivery remains untested.

## The 10-minute window must survive a reload (2026-09-30)

The server enforces one SMS per number per 10 minutes (`reserveSmsWindow`, a
TTL'd `sms-window:<number>` document). The page mirrors that as a countdown,
but any page-only copy of the window is lost on reload — and the person who
never received their first SMS is exactly the one who reloads. Two rules follow:

- The page stores the window in `localStorage` under `pt_sms_window`, keyed to
  the number, and re-reads it whenever a number is entered. A different number
  is not held to it; the server is per-number anyway.
- The server is the source of truth. Its 429 carries `retryAfter` (seconds) and
  a `Retry-After` header, and the page starts its countdown from that. Never
  show a "wait" error for SMS without also starting the timer.
