# The owner's backup number

Owner's rules, 2026-10-05: one backup number per owner (not per vehicle), saved
without a code, used by the calling flow only, and asked for on the owner
dashboard rather than during activation.

## What it does

When a scanner places a masked call and the owner's own phone does not answer,
Exotel rings the backup number next. The scanner stays on the same call.

- `register-call` snapshots `owner.backupMobile` onto the call route as
  `pendingCalls.backupPhone`, so a number changed mid-call cannot redirect a
  ring already in flight.
- Dial Whom (`routes/webhooks/exotel.js`) returns `owner,backup` instead of the
  owner alone. Exotel's Connect applet accepts a comma-separated list from the
  Dial Whom URL and dials the legs in order.
- The status callback compares `DialWhomNumber` with the route's snapshot and
  stores `contactRequests.answeredOn` as `primary` or `backup`; the dashboard
  activity reads "Answered on backup".
- The Emergency call targets the next of kin and carries no backup.

## What Exotel does with the two numbers

From Exotel's own documentation of the Connect applet (checked 2026-10-05): the
Dial Whom URL may return comma-separated numbers; the response must be
`text/plain`, HTTP 200, the numbers and nothing else; and Exotel attempts them
**one by one until someone picks up or all attempts are exhausted**. No change
to the applet is needed for the list to be dialled in order.

The applet has an option, **"Fetch Numbers after every call attempt"**. With
it on, Exotel calls the Dial Whom URL again after each attempt, carrying the
previous leg's result as `DialCallStatus` (and the number as
`DialWhomNumber`). The webhook counts the asks per route (`dialRequests`) so
that a route with a backup answers: first ask → `owner,backup`; a later ask
after the owner did not answer → `backup` only; after anyone answered, or
after the backup has been tried → empty. Nothing rings twice whichever way the
option is set. A route with no backup answers the owner on every ask, exactly
as before.

Still worth doing in the Exotel dashboard, because nothing in the repo can see
it: check the per-attempt **ring time** on that applet (Exotel does not
document a default), so the scanner is not left listening to ringing for a
minute before the backup is tried, and place one real test call to a tag whose
owner has a backup set.

Sources: Exotel Support, "Working with Connect Applet (Dial Whom)"
(support.exotel.com/support/solutions/articles/3000088074); Exotel developer
docs, Connect applet (developer.exotel.com/applet).

## Where it lives

- Store: `owners.backupMobile` (E.164) and `owners.backupMobileUpdatedAt`.
- API: `POST /api/owner/backup-mobile` `{ mobile }`, `DELETE
  /api/owner/backup-mobile`. The dashboard payload carries
  `owner.backupMobile`. Server checks: a real Indian mobile, not the owner's
  own number, the usual owner write rate limit. No OTP, by decision.
- UI: the menu → User Info, directly under Phone Number, where the owner's
  other profile facts live; the same row on the vehicle page's User Info. The
  overview stays about the vehicles (owner's call after seeing it there
  first). Unset: "Not set", a Recommended tag, the input in place, and a
  count badge on the menu button and on the User Info row (a plain dot was
  too weak next to the vehicle-number dot). Set: the number in the same face
  as the Phone Number row, with Change and Remove. Nothing is shown to
  scanners.

## Why no per-vehicle backup

The backup is about the owner's reachability, not the vehicle's. A family with
two cars and one phone wants the same second number on both. A per-tag
override can be added later without touching the route shape: Dial Whom
already reads the route, not the owner.
