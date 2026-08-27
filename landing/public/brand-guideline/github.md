repo: girish8791/parktag
branch: main
path: src/frontend, landing/app, wiki, docs

## Last sync

date: 2026-07-30T11:56:00Z
tree: 991ffad578c9

### Updated in this project

- Built the ParkTag design system from the repo: tokens, 34 components, 23 specimen cards.
- Admin console UI kit recreated from `src/frontend/pages/admin/*`.
- Owner app UI kit recreated from `src/frontend/pages/owner/{login,dashboard}.html` + activation styles.
- Copied logo, sticker and photography assets out of `src/frontend/images` and `landing/public`.

## Screen map

| Screen / artefact | Built from |
| --- | --- |
| `tokens/*.css` | `src/frontend/styles/styles.css`, `landing/app/globals.css` |
| `components/*` | `.pt-*` classes in `src/frontend/styles/styles.css` + inline SVGs in the pages |
| `ui_kits/admin-console` (Overview, E-Tags, Issuance, Print Queue, Owners, Activity, Admins) | `src/frontend/pages/admin/{overview,etags,issuance,print-queue,owners,activity,admins}.html` |
| `ui_kits/owner-app` (Sign in, Activate, Dashboard) | `src/frontend/pages/owner/{login,dashboard}.html`, `.pt-activate-*` styles |
| `guidelines/brand-*` | `landing/public/final-sticker.png`, `tag-scan.jpg`, `src/frontend/images/*logo*` |
| Voice / content rules | `landing/app/page.tsx`, `about`, `contact`, admin + owner page copy |
