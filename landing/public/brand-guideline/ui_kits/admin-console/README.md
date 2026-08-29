# UI kit — ParkTag admin console

Recreation of the operator console at `/admin/*` in `girish8791/parktag`
(`src/frontend/pages/admin/*.html` + the `.pt-admin-*` block of
`src/frontend/styles/styles.css`). Open `index.html`.

## Screens

| Screen | Source page | Notes |
| --- | --- | --- |
| Overview | `admin/overview.html` | Stat row + two feeds |
| E-Tags | `admin/etags.html` | Live search, status filter, show-deleted |
| Batch Issuance | `admin/issuance.html` | Generates a batch of tag codes on submit |
| Print Queue | `admin/print-queue.html` | To Print / Printed tabs, "Mark printed" moves rows |
| Owners | `admin/owners.html` | Table (product renders rows from JS; table is the intended shape) |
| Activity Feed | `admin/activity.html` | Registration + request feeds |
| Admin Management | `admin/admins.html` | Invite form + current admins |

## What is interactive

Sidebar navigation, E-Tags search/filter, issuance form → generated batch,
print-queue tabs and "Mark printed", overview cross-links. Everything else is
static; there is no backend.

## Deviations from the shipped product, on purpose

- The real `etags.html` is a standalone page with its own inline CSS and a
  "Back to Admin" link. Here it lives inside the shared sidebar shell, because
  the sidebar already links to it — the toolbar and table match the original.
- Admin login (`admin/index.html`, incl. "Continue with Google") is not in this
  kit; it is the same auth card pattern as the owner kit.
- The QR export print sheet (4-up landscape A4) is not recreated. It is
  print-only and its markup is in `admin/print-queue.html`.

## How it renders

`index.html` is a **dependency-free recreation** — no React, no CDN, no build
step — so it previews anywhere, online or off. The `.jsx` files next to it
(`AdminShell`, `OverviewScreen`, …) are the React source for consumers and
compose the primitives in `components/`; keep the two in step when you change a
screen.
