# The two switches on a tag

Owner's rule, 2026-10-05. Both live under Tags & Calls on the vehicle detail
page and in the dashboard's settings drawer, and both are fields on the tag,
not browser memory.

## Tag Active → `status`

The master switch. Off writes `status: "inactive"` through
`POST /api/owner/tags/:tagId/status` and closes every channel:

- `/verify`, `/api/contact-requests`, `register-call` and
  `register-emergency-call` all refuse (404 "Tag not found or not active").
- `/api/tags/:token` withholds the masked plate, the caller number and the SOS
  flag; the scanner page says the tag is inactive and offers reactivation.
- The owner link stays, so a paused sticker cannot be claimed by someone else.

## Calls Active → `callsPaused`

The finer switch. Off writes `callsPaused: true` through
`POST /api/owner/tags/:tagId/calls` (`{ active: false }`) and retires the masked
owner call **only**:

- `register-call` refuses with 409 `CALLS_PAUSED` before anything is written.
- The WhatsApp alert and the Emergency call are deliberately not gated by it.
- `/api/tags/:token` and `/verify` carry `callsPaused` so the scanner page shows
  the Private Call tile as off from the start, with its own note, while the
  WhatsApp tile and SOS stay live.

Stored inverted so that tags created before the field exist read as calls on
with no backfill.

## The WhatsApp tile had to be revived for this to hold

Pausing calls disables the Private Call tile from the moment the page loads.
Until 2026-10-05 that tile was the only way into plate verification: the
WhatsApp tile's reason step was gated on `messageAlwaysOn`, which is the
server's answer from `/verify` and so is still `false` on a fresh scan. The
tile had been dead on every fresh scan since 2026-10-01 (#296), in production
too. `openReasonStep` now gates on that flag only once a grant exists; before
verification it opens the reason step, which still leads through the plate
check. Only ever tap Private Call to verify is no longer the hidden rule.

## Why the detail page used to lie

Until 2026-10-05 the vehicle detail page's switches only wrote localStorage.
An owner could switch Tag Active off there and the dashboard, the print sheet
and every scanner kept treating the tag as active. Only the dashboard drawer's
switch reached the server. Both pages now post to the same endpoints and seed
from the dashboard payload.

## Testing locally

- `src/backend/tests/calls-active-switch.test.js` covers the endpoint, the three
  scanner routes under each switch, and ownership.
- The suite refuses to run against the `dev_` prefix: use
  `MONGODB_COLLECTION_PREFIX=test_ npm test`.
- The server stamps script URLs with a hash of the asset tree at boot and serves
  them as immutable. After editing a frontend script, restart the server, or the
  browser keeps the old file.
