# Owner login via WhatsApp or SMS

WhatsApp remains the default. The owner login page offers SMS via the existing Firebase REST send/verify routes. Firebase RecaptchaVerifier provisions its project-specific challenge; the client sends the token to our backend so shared destination OTP budgets and IP limits apply. Resends stay on the active challenge channel and use a fresh CAPTCHA. Backend owner resolution is shared with WhatsApp.

## Primary Firebase configuration

On September 18, 2026, Girish chose parktag1 under contact@edittree.in as the primary Firebase project. It is on Blaze, Phone sign-in is enabled, app.parktag.me is already authorized, and SMS region policy allows India only.

The production FIREBASE_API_KEY already matched parktag1's current rotated browser key, but FIREBASE_PROJECT_ID incorrectly said parktag-449be. Only the project ID needs changing; retain the current key. The SDK snippet in Firebase settings still displayed an expired old key, so do not copy that snippet blindly. The current production key passed a read-only Identity Toolkit reCAPTCHA configuration check.

The separate parktag-449be project belongs to biz.edittree@gmail.com and remains intact on Spark. No Firestore, Storage or Firebase UID dependencies were found in app source; owners, tags and sessions use MongoDB. No Firebase users are deleted or migrated by this change.

## Verification

Focused tests mock Firebase requests and use a disposable MongoDB prefix. Cover WhatsApp/SMS routing, resend failure, email regression, invalid OTP rejection, owner reuse and send-budget charging. Real handset delivery still requires an explicit test by an account holder. Do not solve a CAPTCHA or send a real OTP automatically during UI verification.

Release: PR #253 merged with explicit owner override after all CI checks passed. Railway e93c90a2-7c36-49ef-a1ab-80d23dc824a0 succeeded at 434e06a. Live health, parktag1 config and both login options verified. 28 local targeted tests passed. Real handset delivery remains untested.
