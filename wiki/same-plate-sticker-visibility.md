# Multiple stickers on the same vehicle

The initial same-plate report was corrected by the user: the missing batch-002
premium stickers belong to DIFFERENT vehicles on the SAME phone number.
The display bug below is independently verified, but does not explain that
incident. Production ownership/activation records still need investigation.

`src/frontend/scripts/owner/welcome.js` used plate-number deduplication in both
the initial dashboard load and the refresh after legacy vehicle synchronization.
It kept the first tag and discarded all later tags with that plate, even though
each had a different database ID and QR token. The server's dashboard already
returns all non-deleted tags belonging to the signed-in owner. This is a display
bug, not a one-premium-tag-per-mobile restriction.

Both paths now use `dashboardTags`, which preserves distinct server tag IDs.
Plate matching only reconciles browser-stored legacy vehicle placeholders with
server records. Cards show sticker serials to distinguish tags for one vehicle;
detail navigation and download actions continue using each tag's own ID.

Verification used real local MongoDB with disposable test collections: an owner
with one premium tag activated ten more premium stickers from Batch-002 on the
same plate, using both domestic and +91 phone formats. Fresh OTP login returned
all eleven tags, and the corrected frontend retained all eleven. Another owner's
same-plate tag stayed excluded. The identity suite passed 10 tests and frontend
reconciliation suite passed 3. JavaScript syntax and diff whitespace checks passed.
Commands (PowerShell, from repo root):

```powershell
$env:MONGODB_COLLECTION_PREFIX='test_premium_visibility_'
node --test --test-isolation=none src/backend/tests/one-number-one-account.test.js
node --test --test-isolation=none src/backend/tests/dashboard-multiple-tags.test.js
```

The no-isolation option avoids this workspace's child-process spawn restriction.
Production customer records were not inspected: the configured connection is
local MongoDB, not the production database. No production data was changed.
Deploy the frontend fix, then reload the owner's dashboard. Already activated
tags hidden by this filter require no migration or reactivation. The existing
asset-content hash changes with this release so refreshed pages fetch updated JS.
Production deployment and customer-specific verification remain outstanding.
