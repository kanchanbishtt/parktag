# Membership: which tag it goes on

A membership is time on ONE premium tag (`tag.subscription`, see `subscription.js`).

- Only premium tags qualify. `call-access.js` and `vault.js` decide a free E-Tag's
  access before they look at any subscription, and activation only writes
  `subscription`, so a membership on an E-Tag would buy nothing.
- `GET /api/owner/membership` returns `tags`: the owner's live premium tags, oldest
  first, each with `coveredUntil` (null when not covered) and `trial` (inside the
  included year, nothing paid).
- `POST /api/owner/membership/create-order` takes `tagId`. Without it: one premium tag
  is chosen silently, several answer 400 `CHOOSE_TAG` with `choices`, none answers
  400 `NO_PREMIUM_TAG`. An E-Tag id answers `NOT_PREMIUM`; another account's tag is
  refused.
- The page shows a "Choose Your Vehicle" picker only for 2+ premium tags,
  preselecting the one whose cover ends first, and always sends the chosen `tagId`.
  With no premium tag the button is disabled and the note explains why.
