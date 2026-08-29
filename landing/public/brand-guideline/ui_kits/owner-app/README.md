# UI kit — ParkTag owner app

Recreation of the owner-facing web app at `/owner` and the tag-activation flow
(`src/frontend/pages/owner/login.html`, `dashboard.html`, and the
`.pt-activate-*` / `.pt-*-premium` styles in `src/frontend/styles/styles.css`).
Open `index.html`; the pill in the bottom-right switches screens.

## Screens

| Screen | Source page | Notes |
| --- | --- | --- |
| Sign in | `owner/login.html` | Three real steps: identifier → code → password, plus Google |
| Activate | premium activation styles + `register.html` | Gradient shell, sticker preview, step strip, consent panel |
| Dashboard | `owner/dashboard.html` | QR, vehicle details, tag controls, what's next, requests |

## What is interactive

Sign-in advances through its steps; "Verify"/"Sign in"/Google all land on the
dashboard. Activation requires the consent checkbox before the button enables.
The dashboard drawer opens, and Set Active / Set Inactive flips the header badge
and the status line.

## Not recreated

Forgot/reset password, e-mail verification, and `welcome.html` (a 130 KB
one-off marketing/onboarding page). The QR is the product's 180x180 placeholder
box — no code is generated here.

## How it renders

`index.html` is a **dependency-free recreation** — no React, no CDN, no build
step. The `.jsx` files beside it (`LoginScreen`, `ActivateScreen`,
`DashboardScreen`) are the React source for consumers, built from the primitives
in `components/`; keep the two in step.
