# Different vehicles on one mobile number

## Final verification requested by user

The 17 identity/activation tests were rerun successfully. A separate real local
MongoDB diagnostic then seeded an already-split identity: the canonical mobile
owner held one premium tag, and a ten-digit-mobile sibling held ten premium tags
for different vehicles. Fresh phone OTP login succeeded, but the API and frontend
list showed only ONE of the eleven tags. The diagnostic confirmed
`existingSplitRecovered: false`. All diagnostic fixtures were removed afterwards.

Therefore the code prevents the reproduced new split but does NOT repair an
existing split. No claim of full customer resolution is justified before actual
production ownership inspection, any necessary recovery, deployment and verification.

The user corrected the initial report: the missing premium stickers belong to
different vehicles, all activated with the same phone number. The separate
same-plate frontend bug does not explain this incident.

## Reproduced defect

Activation called `resolveOwnerByVerifiedMobile`, which searched `mobile` only
in canonical +91 form. Its fallback searched legacy `phone` only when `mobile`
was empty. An existing owner with a ten-digit `mobile` was therefore missed,
and activation created a second owner holding the +91 spelling. The unique
mobile index permits those two different strings. Tags became split by owner ID.
Firebase also had its own unsorted alias lookup, so it could choose a different
account from activation/OTP when both spellings existed.

The real MongoDB regression reproduced two owners instead of one before the
change. With the change, an original premium tag and ten batch-002 premium tags
for different plates remain on one owner and survive fresh OTP login.

## Change and limits

Further review found PIN/password login had a separate oldest-first mobile-or-
phone query. It could select an older alias owner while OTP selected the canonical
owner. It now shares the mobile resolver too. The resolver uses one aggregation
query on both hits and misses, ranking canonical mobile, legacy mobile spellings,
then (for secret login only) a phone-only legacy account. An HTTP regression
verifies PIN and OTP login return the same tag set with historical duplicates.
All 18 identity/activation tests passed after this change.

Production connection setup was attempted with user authorization. GitHub and
Railway device login flows were initiated, but account-holder approval is still
required. GitHub authentication subsequently completed as kanchanbishtt, with
push permission on girish8791/parktag. Railway authentication is still pending.
No production records have been changed and no release has been deployed.

Additional authentication suites passed: OTP storage/resend, account-deletion
reauthentication, login security, login PIN, and login low findings. The hash-timing
check in login-hardening failed under concurrent CPU-heavy suites and passed when
rerun alone; the remaining 11 hardening tests passed. After the shared PIN resolver
change, the 18 identity/activation and 28 PIN tests both passed again.

`findOwnerByMobile` prefers an existing canonical mobile account, otherwise
selects a historical spelling deterministically. OTP verification and activation
use it; Firebase now uses the same resolver, including the credentialed legacy
phone conflict guard, and recovers a duplicate-insert race. Indian domestic
aliases are restricted to Indian numbers to avoid cross-country identity matches.

Existing historical duplicate accounts are not merged automatically. Sharing
an unverified contact phone does not prove that all records belong to one person.
Canonical-first selection stabilizes login, but does not recover tags already
attached to another owner. Production record inspection remains required.

87 relevant tests passed: 17 one-number/activation tests, 11 account-identity
tests, 59 phone-normalisation/frontend tests. Real-database tests used disposable
local collections. No production repair or deployment has been performed.

## Read-only production diagnosis

Run in the correctly configured production environment:

```text
node src/backend/scripts/audit-tag-ownership.js --plate=UP16BM8251 --batch=Batch-002
```

The report shows tag IDs, printed serials, activation/deletion status, owner IDs,
and matching owner IDs for the reference vehicle's phone. It omits QR tokens and
phone/email values. Compare the missing serials with the mobile-resolved owner.
If tags are still unclaimed, or have been deleted/reset, investigate those states
instead of assuming an identity split. If ownership is split, establish which
accounts belong to the customer before transferring private records. The local
report is empty; the workspace database is not production.
