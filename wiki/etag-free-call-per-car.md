# E-Tag free call is per car, not per tag record

Deleting a vehicle soft-deletes its tag (`deletedAt`). Adding the same plate back
used to mint a new E-Tag with `freeContactUsed: false`: a fresh free call for a car
that had already spent one.

`createEtagForVehicle` (`lib/core/tag-issuance.js`) now starts a new E-Tag from the
most-spent free-call state of any earlier tag the same owner had for the same plate:

- deleted or live, plate compared without spaces or dashes ("DL 01 AB 1234" is
  "DL01AB1234");
- copies `freeContactsSpent`, `freeContactAllowance` (door hangers), and when spent
  `freeContactUsed`, `freeContactUsedAt` and `trialEndedNotice` (so the owner is
  not told twice);
- premium tags are skipped: register-call stamps `freeContactUsed` on them too,
  where it does not mean a spent trial.

Still fresh: a different plate, an untouched earlier tag, and another account
adding the plate (a sold car).

## Deleting the whole account

Account deletion hard-deletes the tags, so `rememberSpentFreeCalls` runs first. Per
car whose free call was touched it stores `HMAC(identity|plate)` for the mobile and
the e-mail, plus the free-call counters, in `spent_free_calls`, expiring after a
year. No plate, number or e-mail is kept. A new account on the same mobile or e-mail
adding that plate starts from the remembered state. The HMAC key is
`FREE_CALL_HASH_KEY`, falling back to `META_APP_SECRET`; changing it only forgets
the records.
