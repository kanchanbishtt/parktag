# ParkTag Design System

ParkTag is a **QR-based anonymous vehicle contact platform** for India. Every
vehicle gets a scannable **E-Tag** sticker. When a stranger scans it they can
reach the owner — by masked phone call or WhatsApp — without ever seeing the
owner's number. Owners manage their vehicles and tags from a dashboard; an
internal admin console issues, prints and monitors tag batches.

Product line: *"Smart Parking. Instant Connection."* · *"Scan. Connect. Resolve."*
Live at parktag.me · support@parktag.me · Noida, Uttar Pradesh.

## Surfaces this system covers

| Surface | Who uses it | State |
| --- | --- | --- |
| **Admin console** (`/admin/*`) | ParkTag operators, print vendor | Primary — full UI kit |
| **Owner app** (`/owner`, activation) | Vehicle owners | Full UI kit |
| Public scan / claim flow (`/:token`) | Strangers who scan a tag | Components built (plate, reason chips, contact buttons); **no kit yet** |
| Marketing site (Next.js `landing/`) | Prospects | Palette + voice captured; no kit |

## Sources

- GitHub: `github.com/girish8791/parktag` (branch `main`) — see `github.md`.
  - `src/frontend/styles/styles.css` — the real `.pt-*` design system (copied verbatim to `reference/product-styles.css` for cross-checking).
  - `src/frontend/pages/{admin,owner,scanner}/*.html` — the shipped screens.
  - `landing/app/*` — marketing site (Tailwind, same palette via `globals.css`).
  - `wiki/`, `docs/` — product and flow documentation (`page-flow-reference.md` is the best map).
- Logo SVG supplied by the ParkTag team (`assets/logo/parktag-wordmark.svg`).

Nothing here was invented from a screenshot: every colour, radius, shadow and
type size below is lifted from the CSS in that repo.

---

## CONTENT FUNDAMENTALS

**Voice: plain, short, privacy-first.** ParkTag is talking to a stranger who is
annoyed (a blocked driveway) or an owner who is worried (someone scanned my
car). Copy removes anxiety rather than selling.

- **Sentence case everywhere.** Headlines, buttons, labels. The only uppercase is
  the eyebrow/section-label style (800 weight, tracked).
- **Second person for owners, first person for scanners.** "Your ParkTag is now
  active…" · "Blocking my car".
- **Headlines are 2–5 words plus a full stop.** "Vehicle contact, done
  privately." · "Tag Activated" · "Platform snapshot" · "Unprinted tags".
- **Buttons are verb-first, 1–3 words.** "Open dashboard" · "Generate QR batch" ·
  "Export QRs" · "Mark printed" · "Set Active" · "Done".
- **Privacy is stated as a fact, not a promise.** "Number never shared, not even
  to us" · "No numbers shared, no hassle" · "Your number is stored encrypted".
- **Empty states are one sentence ending in "yet".** "No recent contact requests
  yet." · "No batch generated yet." · "No print queue loaded yet."
- **Explain the consequence next to the control.** "Owners who claim this batch
  get unlimited contact (no free-call limit)".
- **Never name the plumbing.** Owners read "masked call", never "Exotel" or
  "number-masking API".
- **No emoji in product UI.** (One decorative 🚗 exists on the internal hub page;
  do not extend the pattern.) No exclamation marks, no "Oops!", no jokes in
  error copy.
- **Indian conventions.** ₹ prices (Solo Tag ₹199, Duo Pack ₹349, Fleet on
  request), +91 phone prefix, DD Mmm YYYY dates, plates as "DL 8C AB 1234".

---

## VISUAL FOUNDATIONS

### Palette
One accent — **red #FF2700** — against **navy #03162D** ink on a warm neutral
**#F1F1F0** page. Red means *action, live, focus*. Navy means *identity and
chrome*. Everything else is grey.

Two grey ramps coexist on purpose: owner/scanner surfaces use the warm
`#F1F1F0 / #E2E8F0` pair; the admin console uses a cooler, tighter
`#F8F9FA → #323232` ramp with `#E5E7EB` borders. Keep them apart — do not
introduce `#374151` text into an owner screen or `#495B7B` into the console.

Green (`#25D366`) is **WhatsApp identity**, not a status colour; `#047857` green
appears only on the "verified" badge. Quirk to preserve: **form success messages
are printed in the brand red**, not green.

### Type
**Metropolis** (primary/display) over **Google Sans** (secondary/UI); plate
numbers and tag IDs in **Courier New**. Headlines run 800–900 with negative
tracking (−0.02em to −0.06em); body is 400–600 at 0.85–0.95rem with 1.6 leading.
Nothing structural is lighter than 600. See the Type cards for the full ladder.

> ⚠ **Font substitution.** No Metropolis or Google Sans web files exist in the
> repo (the shipped pages actually load Inter from Google Fonts). `tokens/fonts.css`
> loads **Poppins** for Metropolis and **DM Sans** for Google Sans as the closest
> free stand-ins. Send the licensed `.woff2` files and this becomes exact.

### Backgrounds
Flat colour, never a gradient, on any page or card. Gradients are reserved for
exactly four places: the navy header, the registration hero, the plate chip, and
the light-blue activation shell (which also carries a soft red radial at the top).
No patterns, no textures, no noise.

### Cards, borders, radii
Owner-facing cards: white, 16–26px radius, a 1–1.5px hairline border, and a wide
navy-tinted shadow (`0 2px 8px + 0 12px 36px rgba(0,25,53,.11)`). Admin cards:
14px radius, 1px `#E5E7EB`, a single `0 1px 3px` shadow. Radius scales with
calm: 8px on console buttons → 26px on the activation card. Borders are 1.5px on
inputs and chips, 1px on containers.

### Interaction
- **Hover:** tint (chips, nav items go to `#FFE3DD`), darken (`#FF2700 → #D92200`),
  or `brightness(1.06)`. Contact buttons also lift `translateY(-1px)`.
- **Press:** scale down — `0.97` (admin) / `0.98` (owner). Never a colour change.
- **Focus:** red border plus a 3px `rgba(255,39,0,.15)` ring on scanner inputs;
  `2px solid #FF2700` outline with 2px offset on buttons and links.
- **Timing:** 120–150ms for colour and nav, 180ms on chips, 200ms on toggles,
  250ms on the progress bar. Easing is plain `ease`. No bounce, no spring, no
  entrance animation on load.
- **Loading:** a 3px red top progress bar, an 18px in-button spinner, and grey
  1.4s shimmer skeletons.

### Layout
Every surface has one fixed measure: 400px auth card, 420px owner dashboard,
460px activation, 480px public scan column, 560px admin form card, 1180px admin
table page. Admin chrome: 240px sticky sidebar + `28px 32px 48px` main padding.
Owner chrome: 64px sticky navy header, 280px drawer, fixed bottom bar. Groups are
laid out with grid/flex + `gap` — 8/10/12/14px inside cards, 12px between cards,
16–24px between sections.

### Transparency & blur
Only two uses: translucent white capsules (`rgba(255,255,255,0.72)`) on the
activation gradient, and translucent badges on the navy header. **No backdrop
blur anywhere.** Photography gets a navy bottom-up scrim instead of a blur.

### Imagery
Real Indian street photography of tags in use — warm, unstaged, never studio
renders or stock handshakes. Overlay a `linear-gradient(180deg, transparent 45%,
rgba(3,22,45,.72))` scrim and set the caption white/600/12px at bottom-left.
Only two photos exist today; **more imagery is the biggest asset gap.**

---

## ICONOGRAPHY

The product has **no icon library and no icon font**. Every glyph is an inline
SVG in the page markup: 24×24 viewBox, `fill="none"`, `stroke="currentColor"`,
`stroke-width="2"`, round caps and joins — a Feather/Lucide-shaped set drawn to
size in place. Rendered at 13–16px in chrome and badges, 16–18px in lists and
buttons, 22px inside 48px icon tiles.

All 19 glyphs actually used were copied path-for-path into
`components/icons/Icon.jsx` (`PT_ICONS`) — nothing was redrawn. Colour comes from
`currentColor`; icons never carry their own fill. The only multi-colour marks are
the Google "G" in `GoogleButton` and the QR codes themselves.

Icons appear inside `IconTile` (rounded red-tint square) in owner UI, and bare in
admin nav, tables and buttons. Unicode arrows are used sparingly in links
("← Back to Admin"); emoji are not used.

**If you need a glyph that isn't in `PT_ICONS`:** take it from
[Lucide](https://lucide.dev) at 2px stroke — it matches the existing set — and
add it to `PT_ICONS` rather than inlining a one-off SVG.

---

## Index

| Path | What |
| --- | --- |
| `styles.css` | The only stylesheet consumers link — `@import`s the token files |
| `tokens/` | `fonts`, `colors`, `typography`, `spacing`, `radii`, `elevation`, `motion`, `base` |
| `guidelines/` | 23 specimen cards (Colors, Type, Spacing, Brand) shown in the Design System tab |
| `components/` | 34 React primitives, grouped by concern (below) |
| `ui_kits/admin-console/` | Operator console — 7 screens, click-through |
| `ui_kits/owner-app/` | Owner sign-in, tag activation, dashboard |
| Each kit's `index.html` | Dependency-free recreation (no React/CDN) so it previews offline; the sibling `.jsx` files are the React source consumers compose with |
| `assets/logo/` | Wordmark SVG + light-bg / dark-bg / checkout PNGs |
| `assets/stickers/` | Printed sticker artwork, bike-tag artwork |
| `assets/imagery/` | Product photography |
| `reference/product-styles.css` | Verbatim copy of the product CSS, for checking values |
| `SKILL.md` | Makes this folder usable as a Claude Code skill |

### Components

- **actions/** — `Button` (primary · activate · whatsapp · call · outline),
  `AdminButton` (primary · secondary · ghost · red), `IconButton`,
  `GoogleButton` + `OrDivider`
- **forms/** — `Field`, `Input` (owner · scanner · admin; plate · code formats),
  `PhoneInput`, `Select`, `Checkbox`, `ToggleRow`
- **data/** — `Card` (default · soft · premium), `AdminCard`, `StatCard`,
  `DetailRow`, `DataTable`
- **status/** — `Badge` (incl. 3 glass tones for the navy header), `Pill`,
  `StatusText`, `NoticeBanner`, `EmptyState`, `Skeleton`
- **navigation/** — `AppHeader`, `AdminSidebar`, `MenuDrawer` + `MenuItem`,
  `StepStrip`, `BottomBar`, `ProgressBar`
- **tag/** — `PlateDisplay`, `IconTile`, `ReasonChip`, `QrCard`, `StickerCard`,
  `SuccessCheck`
- **icons/** — `Icon` + `PT_ICONS`

### Intentional additions

The source ships CSS classes, not components, so the inventory above is a
faithful 1:1 mapping of the `.pt-*` families. Three wrappers have no single
class of their own:

1. **`Icon`** — wraps the inline SVG glyphs so they stop being copy-pasted.
2. **`GoogleButton` / `OrDivider`** — the identical inline-styled block appears
   on both the owner and admin login pages.
3. **`DataTable`** — the E-Tags page styles its `<table>` inline; this preserves
   those exact values as a reusable component.

### Known gaps

- No public scan/claim UI kit (components exist; say the word and it's a day's work).
- Each kit ships twice: a static `index.html` for previewing and `.jsx` screens
  for consuming. Changing a screen means changing both.
- Licensed Metropolis + Google Sans files (currently substituted).
- The sticker print sheet (4-up landscape A4) is not recreated — it lives in
  `admin/print-queue.html` and is print-only.
- Only two product photographs; no illustration set exists in the sources.
