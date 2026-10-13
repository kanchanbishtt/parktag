# Attempt limits: reserve before comparing

One-time codes (5 attempts), the per-account sign-in lockout (10 failures), the
vault PIN and the login-PIN change check all take the attempt **before** the secret
is compared.

## Why

They used to read the count, run bcrypt (~100ms+), then write the failure. Every
guess in a parallel burst read the count before any of them had written, so a
burst sent from rotating addresses got as many comparisons as it had requests.

## How it works

- `verifyOtp` (`lib/auth/otp.js`): a conditional `$inc` on the token
  (`used: false`, attempts below 5) is the reservation; only five can match. A
  correct code is then marked used with a conditional update too, so the same
  code sent twice at once signs in once.
- `reserveLoginAttempt` (`lib/auth/login-lockout.js`) replaced `getLoginLock` +
  `recordLoginFailure`. One pipeline update counts the attempt and lands the lock
  on the tenth; it reads the row as it was before, and refuses if it was locked.
  A locked row is left untouched by a refused attempt. A success still calls
  `clearLoginFailures`, which deletes the row.
- Used by `/api/auth/login`, `/api/auth/admin/login`, `verifyVaultPin` and
  `verifyLoginPinForChange`.

## Spray lockout (distinct accounts per IP)

`reserveSprayAttempt` puts the identifier on the source's list before the check;
`releaseSprayAttempt` takes it off when the sign-in succeeds or the account lockout
refuses it. Twelve identifiers may be on the list. The attempt that would add a
thirteenth lands the 30-minute lock and is refused, so a burst gets twelve checks
and a successful sign-in never trips the lock.
