# WaveTag Project Tasks

This file tracks repo-level implementation progress for the WaveTag MVP.

Rules:

- keep tasks tied to Phase 1 MVP scope
- keep items small and verifiable
- mark tasks complete only after code or behavior is verified
- prefer verification steps that can be checked through a simple UI when practical
- prefer minimal prototype stack choices over optimization-driven architecture
- use `docs/TASKS.md` for detailed backend execution work

## Milestones

### /get first screen (Meta review, Oct 2026)
- [x] Lead with the problem: headline "Someone blocking your car? They scan. You get the message." The first gallery slide is the real windscreen photo (cropped 3:2 around the tag, preloaded as the LCP image); the flat artwork moved to slide two.
- [x] One decision: Premium and lifetime-alert chips removed from the hero (still under "Why a ParkTag"); a cash-on-delivery chip shows only when the catalogue says the hero pack takes it; sold-out packs fold under "Coming back soon" (waitlist taps still counted).
- [x] Trust next to the button: "7-day replacement" and "One-time purchase", an "Ask us on WhatsApp" link (`ask_whatsapp_click`), "ParkTag is made by EditTree" in the footer.
- [x] Restyled to the Stitch "ParkTag Direct Trust" tokens (navy, red conversion button, slate microcopy at 4.7:1 instead of 3.2:1, pill buttons, bar shadow). Inter kept: Manrope and Plus Jakarta Sans are not self-hosted and a third-party font request would undo the page-speed work.
- [x] Verify: `get-card-tap.test.js` (new "first decision" block), `get-page-speed.test.js` (hero pin moved to the windscreen photo), every DB-free test that touches `/get`, and a phone-width pass in the browser.
- [x] Checkout sheet (`owner/address-step.js`, shared by `/get`, `/shop`, `/direct` and the dashboard) rebuilt to the Stitch "Complete your order" layout: mobile with a +91 box, then payment, then address, numbered by CSS counters so a hidden payment step takes no number; a price breakdown (list price, discount, free delivery, Cash on Delivery fee, total) derived from the same numbers as the header; the amount on the red pill button ("Continue to pay · ₹399"); slate-50 fields; "1 year Premium" dropped from the terms row. Pincode already autofills city and state. Verify: `checkout-sheet-steps.test.js` plus the sheet's existing tests (`cod-address-tap`, `checkout-survives-reload`, `checkout-marketing-consent`, `referral-checkout-page`, `shop-sold-out`).
- [x] `/get` "How it works" is now three picture cards (real sticking photo, real windscreen photo, a drawn phone diagram) and sits under "Sound familiar?" instead of at the foot of the page.
- [x] Checkout sheet extras: the clear dashboard plate can be ticked inside the sheet (total, breakdown and button follow it; the answer comes back with the address and decides `addOnId`); colour-coded breakdown (discount red, free delivery green); a delivery strip ("Shipped with Delhivery, track any time") and a privacy line under the mobile number; order thumbnail and coupon-style offer.
- [x] `/get` hero rebuilt to the Stitch "Hero B" sections: the hook "Never write your phone number on a car window again." (no paragraph under it), three promise pills, a showcase card (hazard strip, real windscreen photo, artwork and pack tiles), a price card (pack and saving from the catalogue, free delivery, "Get your ParkTag now", "See how it works", payment and replacement lines) and a "Paper note vs ParkTag" comparison. The photo carousel and its script are gone. Left out of the mock on purpose: "10,000+ delivered", "4.9/5 (2,400+ reviews)", ₹799 MRP, "express" delivery and the generated testimonial portraits.
- [ ] Not done here, and deliberately: the Stitch mock's "UPI prepaid benefit -₹20" (a discount the backend does not charge), "GST Invoice", "BlueDart & Delhivery" and "express dispatch" claims, and the "we test your masked alert" line. Each needs a decision or a fact first. Early phone capture for abandoned-cart recovery is also left out: the sheet's own rule is that nothing personal leaves it before the button is pressed.
- [ ] Not done here: Meta-side fixes (optimise on Initiate Checkout, placements, edit freeze); customer reviews and photos (none exist yet to show); `get-page-speed`, `storefront-deep-link`, `app-delivery` and `netbanking-form-action` need MongoDB and were not run in this worktree.

### Website offers: same price for new visitors and existing customers
- [x] Admin → Promo Codes: "Auto-apply on the website" switch (`autoApply`), shown as a "Website offer" pill. It refuses single-use, phone-bound and hand-over codes, and an API token cannot switch it on. LAUNCH100 gets the switch on boot if it has never had it (`commerce-defaults.js`).
- [x] `resolveCheckoutPromo()` / `readWebsiteOffers()` (`lib/core/promo-codes.js`): one code per order. A valid typed code replaces the website offer, otherwise the best website offer for the pack applies. Used by guest create-order (`/shop`, `/get`), owner create-order and owner place-cod. `/direct` sends `listPrice: true` and keeps list price. The catalogue and `/api/shop/pricing` serve `offers` per pack with `payableByQuantity`; `launchOffer` is kept for the landing site.
- [x] `/shop` and `/get` read `offers` and no longer send the code (the server applies it). `/get`'s quantity total uses the server's per-quantity price.
- [x] Dashboard shop: promo-code box in the pack step (checked with `/api/shop/promo/check` `context: "dashboard"`, re-checked when the pack changes, Remove). It is sent to create-order / place-cod. Refused codes say why, and the website offer still applies.
- [x] Landing: Solo and Duo prices, the Duo COD line, "Starting at" and the FAQ's COD and plate answers come from the catalogue. Stale "₹529 COD, offer online-only" and "₹30 COD fee" copy removed. Header menu no longer hard-codes "₹299".
- [x] Verify: `website-offer-parity.test.js` (18). 73 shop/checkout/promo/admin suites (786 of 795 pass; the 4 failures are the known baseline). Headless Chrome: `/shop`, `/get`, dashboard (code box: bad code, valid code with Enter, Remove, pack switch re-check, ₹349 order created), a second offer on Pack of 1 reaching all three, admin pill + switch (13 checks). Landing via `next dev` against the local app: hero, cards, COD line, FAQ and "Starting at" all from the catalogue, no page errors. `wiki/website-offers.md`.
- [ ] Deploy the landing site (`landing/`) along with the app, or its COD line and FAQ keep the old figures.

### Launch offer: one price on every storefront
- [x] Reported on live: the landing page says "Duo Pack · ₹399" but the shop charged ₹499. Cause: `/shop` sends a signed-in owner to the dashboard shop, which had a hard-coded price list, and its `create-order` / `place-cod` never applied LAUNCH100 (₹499 online, ₹548 COD instead of ₹399 / ₹448).
- [x] `readLaunchOffer()` builds `launchOffer` for both `/api/shop/public-catalogue` (landing, /shop, /get) and `/api/shop/pricing` (dashboard). Owner `create-order` and `place-cod` apply the code on the server (`ownerLaunchPromo()`), store `promoCode` / `promoDiscountPaise` / `mrpPaise` like guest orders, and COD consumes the code. A stale unpaid order without the code is no longer reused.
- [x] Dashboard shop: Duo card, product sheet and pack step show ₹399 with MRP ₹499 and "LAUNCH100 applied"; COD ₹448; the grid waits for server prices instead of flashing the local table.
- [x] Verify: `launch-offer-parity.test.js` (now `website-offer-parity.test.js`) (8: same offer as the landing page, online charge + verify-payment, COD = offer + fee, Pack of 1 untouched, stale order not reused, revoking removes it everywhere, page reads the offer); fails 6/8 on the old code. 51 shop/checkout/COD/promo suites (627 pass; the 4 failures are the known baseline). Headless Chrome via `/shop?sku=pt-car-2` signed in, phone and desktop (22 checks). `wiki/launch-offer-pricing.md` (now `wiki/website-offers.md`).

### Scan page refresh: no raw errors for visitors
- [x] Reported on live: refreshing a vehicle's contact page showed `{"message":"Route GET:/vehicle not found",...}`. Root cause: after the tag loads, `pt-analytics.js` rewrites the address bar to bare `/vehicle` (keeping the tag token away from the Meta Pixel), and no route served that path, so every refresh hit Fastify's default JSON 404. It only happens on `*.parktag.me` with the Pixel configured, so it never showed locally.
- [x] `GET /vehicle` and `GET /tag` serve the scan page. `scanner/app.js` keeps the token in the tab's sessionStorage and uses it when the URL has none. With no token at all it asks the visitor to scan the sticker again. Share sends `/tag/<token>`.
- [x] `setNotFoundHandler`: any unknown page in a browser gets `pages/not-found.html` (ParkTag "page not found"). The API, assets and webhooks keep the same JSON 404.
- [x] Verify: `scan-page-refresh.test.js` (5; fails on main); `activation-token-survives-analytics.test.js` updated for `resolveTagToken()`; full suite (only the known baseline fails). Headless Chrome, running the exact `replaceState` production runs: main shows the JSON on refresh, the fix brings the same vehicle back twice, a fresh tab shows "Scan the sticker again", and an unknown page shows the ParkTag 404 (8/8). `wiki/scan-page-refresh.md`.

### Admin Orders page
- [x] No admin screen showed an order with its amount, address and payment mode together. New page `/admin/orders` (sidebar: Management → Orders, on every admin page): Sales (paid or placed COD), Abandoned (created, never paid), Ours (the team's test orders), All; newest first, 50 a page; search by order number, buyer name, phone in any spelling, city, pincode, AWB or payment id.
- [x] Each row: order number, channel, product × quantity, stickers activated of capacity; buyer and full address; amount in rupees with how it was paid (Paid online / Cash on delivery with the fee noted / COD paid online later with the COD figure / Paid by UPI for a hand sale / Not paid); delivery state with AWB linked to tracking. Details: price breakdown, payment id, paid at, promo and referral discounts, add-ons, email, account, campaign, note.
- [x] Nothing recomputed: amounts and breakdown from `orderBreakdown`, address from `addressLine`, delivery state from the Activations page's `deliveryStateOf` (now exported), capacity from `capacityOf`. Read scope on API tokens; MCP `parktag_orders`.
- [x] Verify: `admin-orders.test.js` (7: admin-only, paid online with promo/AWB/campaign, COD / COD-prepaid / delivered / handed over / abandoned, ours and deleted, search in seven spellings, paging, and a real COD order placed through `/api/shop/place-cod` read back with the amount, address and mode the checkout wrote); 58 token/activations/overview/read-path/hardening/pricing/tracking tests; headless Chrome with six seeded orders (15 checks), desktop and phone.

### Admin Tag Reports page
- [x] A scanner's "Report wrong info" submission (`POST /api/tags/:token/report` → `tag_reports`) was stored and never read back. New admin page `/admin/tag-reports` (sidebar: Monitoring → Tag Reports, on every admin page) lists reports open-first with the reason, free text, the reported sticker (plate, serial, state) and its owner, and the reporter to call back (tel + WhatsApp).
- [x] `GET /api/admin/tag-reports?status=open|resolved|all&q=&page=` (100 a page; search by plate, serial, reporter name/number or text) and `POST /api/admin/tag-reports/:id/status` { status, note } recording who, when and a note; reopen keeps the note; nothing is ever deleted.
- [x] Overview: "Open tag reports" tile under Needs attention (`summary.reports.open`). API tokens: read scope for the list, ops scope for status. MCP: `parktag_tag_reports` (read, fenced) and `parktag_resolve_tag_report` (ops).
- [x] Verify: `admin-tag-reports.test.js` (4: admin-only, public form → MongoDB → admin page with sticker and owner, views + search, resolve/reopen + overview count); 40 token/overview/hardening/report-form tests; headless Chrome end to end on the local server (13 checks).

### Activation queue: what "sold, not activated" means
- [x] Overview tile counts only orders with nothing live; multi-packs with some stickers live are counted apart ("N more packs are partly activated") and wear a green "1 of 2 live" badge on the Activations page.
- [x] Reseller orders (`channel: "reseller"`) are left out of the reminder queue and counted in a note: their stickers are activated by the reseller's customers on their own numbers, so the queue can never see them as done.
- [x] A sale recorded by hand (`record-manual-order.mjs`) now looks back for stickers already activated on that phone and links them, up to the pack size (`backlinkOrder`).
- [x] A buyer who activated on another number: each queue row suggests unlinked activations that could be theirs (same name, same email, or a plate from the delivery state, activated after the order), with the reasons; "Link to this order" (`POST /api/admin/activations/:id/link`) ties one by hand with the same one-slot-per-sticker guard as the automatic link.
- [x] Verify: `admin-activations.test.js` (12, four new), overview summary, linking and reconciliation suites; headless Chrome over the overview tile and the Activations page (8 checks).
- [x] Overview audit of the other tiles against production: Unprinted, Printed awaiting claim, Unsold premium stock, Batches and Site visitors reconcile. Owners, Customer tags, Premium/E-Tag activated and Contact requests counted the team's own test stickers, accounts and calls as customers (8 of 21 "customer tags" were ours).
- [x] `internalScope()` (`lib/core/internal-orders.js`): our tags (internal flag, Batch-002, or owner on `INTERNAL_TEST_PHONES`), accounts and the contact requests against them are left out of the customer figures and reported apart ("N ours" in the tile subtitle); the Tags and Owners pages still list them, marked "Ours".
- [x] "Failed contacts" now counts a call the provider could not place (status `failed` / `callOutcome: failed`, as the Exotel webhook writes it) as well as a refused message (`provider_failed`).
- [ ] Production: every call on the Activity feed sits at "connecting"/"initiated" because the Exotel flow sends no status callback to `/api/provider/exotel/webhook`; until that applet setting is made, call outcomes and failed calls stay invisible. Also confirm `INTERNAL_TEST_PHONES` is set on Railway, or only Batch-002 is treated as ours.
- [x] Verify: `admin-overview-internal.test.js` (2 new), 49 admin/internal suites; headless Chrome over the overview, Tags and Owners pages with an internal phone configured (9 checks).

### Owner backup number
- [x] One backup number per owner (`owners.backupMobile`), saved without a code through `POST /api/owner/backup-mobile`, removed with `DELETE`; refuses non-Indian mobiles and the owner's own number.
- [x] Snapshot it onto the call route at `register-call` (`pendingCalls.backupPhone`); Dial Whom hands Exotel `owner,backup` so the Connect applet rings them in order. Emergency calls unchanged.
- [x] Record which leg answered (`contactRequests.answeredOn` from `DialWhomNumber`) and show "Answered on backup" in the owner's activity.
- [x] Menu → User Info (dashboard and vehicle page): a "Backup Number" row under Phone Number with the input in place while unset (Recommended tag, an Instagram-style count badge on the menu button and on the User Info row); shows the number with Change and Remove once set, in the same face as the Phone Number row. Not on the overview and not asked during activation (owner's decisions).
- [x] Verify: `backup-number.test.js` (endpoint, Dial Whom with and without a backup, snapshot survives removal, Emergency unaffected, answered-on-backup) and a headless Chrome pass over the dashboard card.
- [x] Confirm against Exotel's Connect applet documentation that a comma-separated Dial Whom response is dialled one by one; make Dial Whom attempt-aware (`pendingCalls.dialRequests`) so a re-fetch after a failed leg offers the backup only and nothing after an answer. Verified end to end against a running server with Exotel-shaped requests (15 checks).
- [ ] Exotel dashboard: check the Connect applet's per-attempt ring time (not documented by Exotel), then place one real test call to a tag whose owner has a backup. Nothing in the repo can see the applet setting.

### Owner tag switches (Tag Active, Calls Active)
- [x] Wire the vehicle detail page's Tag Active switch to `POST /api/owner/tags/:tagId/status` (it only wrote localStorage, so the dashboard and scanner kept treating the tag as active).
- [x] Add `callsPaused` on the tag and `POST /api/owner/tags/:tagId/calls`; `register-call` refuses with 409 `CALLS_PAUSED`, while the WhatsApp alert and the Emergency call carry on.
- [x] Surface `callsPaused` on `/api/tags/:token`, `/verify` and the owner dashboard; the scanner page retires the Private Call tile with its own note; both owner pages seed and save the switch through the server.
- [x] Verify: `calls-active-switch.test.js` (owner endpoint, the three scanner routes, Tag Active off) and a headless check of the vehicle detail switches.
- [x] Fix the scanner's WhatsApp tile, dead on every fresh scan since 1 Oct 2026 (the reason step was gated on `messageAlwaysOn`, which only arrives with `/verify`); it now leads into the plate check before verification and honours the server's answer after. Covered in `scanner-locked-panel.test.js`.
- [x] Verify end to end in headless Chrome against the local server (28 checks): both switches on both owner pages, the dashboard pill and count, the scanner page fresh and stale (tap after the owner paused: `/verify` reports the pause, `register-call` 409, tile retires with no row written), the WhatsApp entry on a paused tag, Tag Active off and on.

### Admin sticker designer
- [x] Add `/admin/sticker-designer`: a Fabric.js layer editor (text, shapes, lines, image and SVG upload, layers with show/hide, lock, reorder, rename, delete, undo/redo, preview) with the QR and serial as fixed per-tag placeholders.
- [x] Store designs (`sticker_designs`), validate layout and artwork server-side, allow one live design (unique index), and serve artwork admin-only under a sandbox CSP.
- [x] Print the live design from Print Queue → Export QRs and `/admin/sticker/:token`; fall back to the original artwork when none is live.
- [x] Verify in a browser: create, edit, save, publish, preview, single-sticker page and Print Queue export; 7 backend tests pass.
- [ ] Decide whether the owner pages' sticker picture (`welcome.html`, `vehicle-detail.html`) should follow the live design.

### Car door hanger campaign
- [x] Let an E-Tag carry more than one free contact (`freeContactAllowance`, counted in `freeContactsSpent`; `freeContactUsed` still means locked).
- [x] Spend free contacts atomically in both register-call and contact-requests, and reset the counter when demo stock is deactivated.
- [x] Show the remaining free contacts in the owner dashboard and vehicle detail copy.
- [x] Add the 4.5x11 door hanger print template and `scripts/print-doorhangers.js` (one real unclaimed tag per hanger, 2 free contacts).
- [x] Add a "Door hanger PDF" button to Admin → Print Queue (renders the Figma design with each ticked tag's QR and stamps 2 free contacts).
- [ ] Print Batch 003 (Door-lock campaign 2026, 1000 car tags) on hangers from the Print Queue and send the PDF to the printer.

### Paid acquisition conversion repair
- [x] Verify the production app serves configured GA4 and Meta Pixel tracking.
- [x] Verify production has Meta Conversions API and Razorpay webhook secrets configured.
- [x] Make the hero's ₹499 offer explicit as the two-tag Duo Pack.
- [x] Deep-link Solo and Duo pricing actions to the matching shop packs.
- [x] Remove the storefront's unsourced 4.8 rating until real review data exists.
- [x] Add the selected pack, price, delivery, replacement and payment reassurance before the guest address form.
- [x] Add the admin-controlled LAUNCH100 offer, auto-apply it to the Duo Pack, and show MRP ₹499 / offer ₹399 consistently.
- [x] Separate lifetime WhatsApp scan notifications from paid Premium features across the landing site and membership screen.
- [x] Add the optional, admin-priced Clear Dashboard Plate checkout add-on using real product photos.
- [x] Add transparent included-vs-Premium comparison and FAQ copy without publishing an unverified competitor trial length.
- [x] Deploy the landing and app storefront changes, then verify the live funnel.
- [ ] Change Meta optimisation from View Content to Purchase after explicit publish confirmation.

### Dashboard load regression after premium ownership fix
- [x] Reproduce successful dashboard responses being replaced by an error because `localOnly` was undefined.
- [x] Restore pending-vehicle migration selection and verify complete load/card rendering with 2 and 11 premium tags, with and without pending vehicles (7 tests pass).
- [ ] Deploy follow-up correction and verify the affected owner's live dashboard.

- [ ] Investigate corrected report: different vehicle plates on one mobile number. Verify identity resolution and inspect production ownership before declaring the incident resolved; same-plate display fix alone is insufficient.
- [x] Final verification: rerun 17 identity tests; independently confirm an already-split 11-tag identity still displays only 1 tag after OTP login. Historical recovery remains unresolved, not covered by the preventive fix.
- [x] Reproduce legacy domestic-mobile account splitting during different-vehicle activation; share canonical-first, legacy-aware mobile resolution across OTP, activation and Firebase. Verify 87 relevant tests; prepare read-only ownership audit.
- [x] Align phone-and-PIN login with the same resolver in one database query; verify 18 identity/activation tests including PIN/OTP tag-set consistency.
- [ ] Complete GitHub/Railway device-login authentication initiated with the user's authorization; production repair and deployment await account-holder sign-in approval.

- [x] Fix dashboard hiding distinct activated stickers with the same plate; initial load and refresh share ID-based reconciliation, cards show sticker serials, and 13 focused tests pass (including ten batch-002 activations plus an existing premium tag followed by fresh mobile login).
- [ ] Deploy the same-plate sticker visibility fix and verify the affected customer's production dashboard (only local MongoDB is configured in this workspace).

- [x] M1. Confirm MVP scope and repo workflow
- [x] M2. Define the minimal end-to-end product slice
- [x] M3. Build a deployable backend server for the MVP demo
- [x] M4. Implement the scanner-facing web flow
- [x] M5. Implement the authenticated owner and admin web flow
- [x] M6. Harden web security and authorization boundaries (auth/isolation/secrets/session all code-verified; only the limitations write-up remains)
- [x] M7. Verify telephony and fallback messaging behavior (calls + Meta WhatsApp verified live; `wiki/` write-up done)
- [x] M8. Prepare deployment, demo, docs, and operator runbook (README = full contributor guide; flows + payment gateway verified live; demo script descoped)
- [x] M9. Tiered rate limiting — per-route protection
- [x] M15. Lock shop payment amounts server-side (server catalog resolves price by `productId`; client `amount` no longer trusted; Step 5 order-persistence + verify-time amount re-check done; live curl checks pass — only the real browser checkout remains as a manual step)
- [x] M16. Per-vehicle official sticker upgrade & gated download on My Vehicles cards (₹199 in-place upgrade **superseded by M18**)
- [x] M17. Print queue split (to-print vs printed) & delete safeguards
- [x] M18. Free-trial → buy-premium-via-shop & tag replacement (₹199 in-place upgrade retired; paid shop order mints a new premium tag + removes the spent free tag) — code complete; live browser checkout pending
- [x] M19. ₹20 paid callback for premium tags after the free 10-minute window (replaces the E-Tag ₹20 pass) — code complete and suite-verified; live Razorpay + Exotel run pending

## M1. Confirm MVP Scope And Repo Workflow

Tasks:

- [x] Read `INITIAL_PROMPT.md`
- [x] Read `docs/RFA_SPEC.md`
- [x] Create root `AGENTS.md`
- [x] Create root `TASKS.md`
- [x] Add the first wiki note capturing current project assumptions
- [x] Record the minimal-stack prototype direction in `wiki/`

Verification:

- [x] Confirm `AGENTS.md` exists at repo root
- [x] Confirm `TASKS.md` exists at repo root
- [x] Confirm a project note exists under `wiki/`

## M2. Define The Minimal End-To-End Product Slice

Tasks:

- [x] Lock the exact Phase 1 demo flow from scan to owner contact
- [x] Decide the minimum frontend and backend surfaces required
- [x] Decide the minimum authentication and authorization model for owner and admin access
- [x] Decide which flows must work on laptop browsers and which must work on mobile browsers
- [x] Decide the simplest hosting target for the backend server on a free or low-cost platform
- [x] Decide the minimum verification UI that can keep growing with the product
- [x] Lock the first demo slice to a UI-verifiable contact-request flow before live telephony
- [x] Create `PLAN.md` as the simpler prototype execution direction
- [x] Keep `PLAN.md` updated as prototype decisions change
- [x] Record that project application code should live under `src/`
- [x] Reuse the existing `src/backend/` and `src/frontend/` folders for project code
- [x] Choose `Fastify` for the backend server
- [x] Choose simple `HTML/CSS/JS` for the frontend
- [x] Choose `MongoDB` as the single prototype persistence approach
- [x] Choose `Render` as the primary app hosting target with `Heroku Eco` as fallback
- [x] Record deferred items explicitly so they do not leak into MVP work
- [x] Add a dedicated wiki note for the Milestone 2 demo slice decisions
- [x] Recognize two onboarding paths: admin-issued unclaimed tags and owner self-registration with QR delivery

Verification:

- [x] Confirm the chosen MVP flow is written down in `wiki/`
- [x] Confirm `PLAN.md` exists at repo root and captures the current prototype direction
- [x] Confirm `PLAN.md` records the chosen `Fastify + MongoDB + simple HTML/CSS/JS` stack
- [x] Confirm the wiki notes capture the current minimal-stack direction and open infrastructure questions
- [x] Confirm open ambiguities from `docs/RFA_SPEC.md` are either resolved or listed

## M3. Build A Deployable Backend Server For The MVP Demo

Tasks:

- [x] Keep backend execution aligned with `docs/TASKS.md`
- [x] Complete the remaining critical backend slice for the demo
- [x] Scaffold the `Fastify` backend under `src/backend/`
- [x] Expose the required HTTP routes for scanner, owner, and admin flows
- [x] Add authentication support for protected owner and admin routes
- [x] Add authorization checks so users can access only their own data and admins can access admin-only features
- [x] Add `MongoDB` connection and minimal data access for prototype entities
- [x] Prepare the backend server for deployment to Render
- [x] Deploy the current backend slice on Render and verify the hosted runtime
- [x] Keep the prototype backend on the chosen single `MongoDB` persistence path without Redis unless a verified need appears
- [x] Make backend slices easy to exercise from the simple verification UI
- [x] Verify backend routes and provider-safe behavior locally
- [x] Add root runtime files for Node.js execution and local environment setup
- [x] Add a simple frontend verification page served from `src/frontend/`
- [x] Resolve the current MongoDB Atlas runtime connection reset and verify successful ping
- [x] Add a demo seed flow for owner, admin, and tag setup
- [x] Expand the frontend verification page to exercise the first demo-flow routes
- [x] Verify the seeded first demo flow from public tag resolve to owner and admin visibility
- [x] Confirm `npm start` is the stable local verification path for the current backend slice
- [x] Add Render deployment configuration and a minimal deployment guide
- [x] Deploy the backend to Render and verify the public health endpoint
- [x] Resolve the Render-to-MongoDB Atlas TLS connection error so hosted runtime status is healthy
- [x] Separate local development collections from production collections by environment

Verification:

- [x] Run the relevant backend checks for the completed slice
- [x] Confirm the root milestone status matches `docs/TASKS.md`
- [x] Confirm the backend can run as a real hosted server target, not only as a local script or local-only service
- [x] Confirm the current backend slice can be exercised from the simple UI without developer-only steps where practical
- [x] Verify `GET /api/health` returns success locally
- [x] Verify `GET /api/runtime/status` returns the runtime stack and MongoDB configuration state locally
- [x] Verify the frontend verification page is served successfully from `/`
- [x] Verify `GET /api/runtime/status` reports MongoDB `connected: true` without runtime connection errors
- [x] Verify `POST /api/demo/seed` creates one owner, one admin, and one active tag
- [x] Verify `GET /api/tags/:token` returns the seeded public tag view
- [x] Verify `POST /api/contact-requests` creates a pending request for the seeded tag
- [x] Verify owner login plus `GET /api/owner/dashboard` returns the seeded tag and new request
- [x] Verify admin login plus `GET /api/admin/overview` returns the new request
- [x] Verify unauthenticated owner dashboard access is blocked
- [x] Verify owner sessions are blocked from admin-only routes
- [x] Verify owner tag-status update changes the stored and public tag status
- [x] Confirm Render deployment files exist in the repo
- [x] Verify deployed `GET /api/health` returns success on Render
- [x] Verify deployed `/` responds successfully on Render
- [x] Verify deployed `GET /api/runtime/status` reports MongoDB `connected: true` on Render
- [x] Verify deployed `POST /api/demo/seed` creates one owner, one admin, and one active tag
- [x] Verify deployed `GET /api/tags/:token` returns the seeded public tag view
- [x] Verify deployed `POST /api/contact-requests` creates a pending request for the seeded tag
- [x] Verify deployed owner login plus `GET /api/owner/dashboard` returns the seeded tag and new request
- [x] Verify deployed admin login plus `GET /api/admin/overview` returns the new request
- [x] Confirm the Render-hosted service passes the same health, runtime, and demo-flow checks

## M4. Implement The Scanner-Facing Web Flow

Mobile Demo Checklist:

- [x] Confirm the exact mobile-first routes required for the client demo
- [x] Treat `/:token` as the primary mobile QR-entry surface for the demo
- [x] Reshape the `/:token` active tag scanner flow into a guided two-step mobile flow
- [x] Polish the `/:token` unclaimed claim flow for mobile use
- [x] Polish the `/register-owner` flow for mobile use
- [x] Polish the `/owner` portal for mobile use
- [x] Make the scanner page open cleanly from a QR scan on a phone
- [x] Make Page 1 a short verification step instead of a raw long form
- [x] Make Page 1 confirm:
  - owner or car last 4 digits shown as confirmation
  - scanner phone number as the only input
- [x] Make Page 2 the owner-contact action hub
- [x] Keep the scanner flow phone-number-first, then action selection
- [x] Make the final user action surface mobile-first for:
  - `Call Owner`
  - `Leave WhatsApp Message`
- [x] Keep the public and owner-facing mobile screens free of debug-style output
- [x] Keep the layout single-column, readable, and easy to tap on a phone
- [x] Keep the owner registration, QR claim, owner portal, and scanner contact flows understandable under demo conditions and fast scanning behavior
- [x] Keep the admin portal web/laptop-first for the current demo instead of forcing the same mobile treatment

Tasks:

- [x] Build the scan landing flow
- [x] Build the action selection flow for call and message in the current MVP slice
- [x] Keep the scanner UI simple HTML and JavaScript unless a stronger frontend stack becomes necessary
- [x] Keep the UI readable outdoors and minimal to use
- [x] Make the scanner flow work well in a local mobile browser after QR redirect
- [x] Make the scanner flow work in laptop browsers for testing and demo use
- [x] Keep the scanner UI usable as a progressive verification surface for later backend features
- [x] Move the internal verification tools to a dedicated `/verify` page
- [x] Decide that scanner enters phone number before choosing the action
- [x] Decide that current scanner actions are `Call Owner` and `Send Message`
- [x] Decide that `Send Message` should use a real textarea with a prefilled default message
- [x] Decide that the scanner page should show a masked vehicle number, not the full number
- [x] Decide that the call waiting state should say `Please wait while we connect you...`
- [x] Decide that the scanner UI direction should stay clean, readable, structured, and minimal
- [x] Decide to leave `Emergency Number` out of the current M4 slice
- [x] Decide to shape the scanner UI first, then wire the final backend behavior after
- [x] Confirm the public scanner URL shape (`/:token`)
- [x] Decide that unavailable tags should still allow `Send Message`
- [x] Finalize the default prefilled message text for the scanner message action
- [x] Confirm that the immediate demo priority is the mobile QR scan flow for tomorrow’s client presentation
- [x] Refine the current public mobile interface using the `docs/RFA_SPEC.md` user and owner workflow diagrams as the reference direction
- [x] Align the active scanner, unclaimed claim, owner registration, and owner portal screens to one consistent mobile-first interaction model
- [x] Prepare a mobile-first interface for the final user contact actions: `Call`, `SMS`, and `WhatsApp`
- [x] Narrow the current public token page to `Call` plus a WhatsApp-style message action and remove the separate unavailable-owner message box
- [x] Keep the admin dashboard outside the mobile-first scope for now and treat it as the desktop/web operator surface
- [x] Tighten the scanner, owner registration, and owner portal copy and hierarchy so they read like mobile product flows instead of debug or operator screens
- [x] Reorganize the frontend into clearer `pages`, `scripts`, and `styles` folders so page assets are easier to navigate and maintain
- [x] Make all user-verification endpoints practically usable from mobile so the full MVP can be run and checked from a phone
- [x] Introduce a dedicated scanner verification step and a separate owner-contact action hub without collapsing them into one raw form again
- [x] Add a WhatsApp message template selector with custom-message editing that appears only after the message path is chosen
- [x] Make the call and WhatsApp action buttons create verifiable pending contact requests from the scanner flow
- [x] Keep `Contact Local Authorities`, `Help`, and vehicle image upload recorded as deferred scanner features instead of current MVP behavior
- [x] Make claimed active tags open the landing shell first and only then open the owner-contact action shell
- [x] Make inactive tags open the owner registration shell instead of the scanner contact shell

Verification:

- [x] Manually verify the scanner flow from a browser
- [x] Manually verify the scanner flow from a mobile-sized browser
- [x] Manually verify the scanner flow from a laptop-sized browser
- [x] Manually verify the unclaimed claim flow from a mobile-sized browser
- [x] Manually verify the owner self-registration flow from a mobile-sized browser
- [x] Manually verify the owner portal from a mobile-sized browser
- [x] Manually verify Page 1 as the mobile verification step
- [x] Manually verify Page 2 as the mobile action hub
- [x] Manually verify the mobile action interface for `Call` and `Leave WhatsApp Message`
- [x] Confirm no scanner view leaks owner private data
- [x] Confirm the mobile-facing routes `/:token`, `/register-owner`, and `/owner` stay free of debug-style output
- [x] Verify the local scanner root page, `/register-owner`, `/owner`, and static assets respond correctly after the mobile-first UI pass
- [x] Verify `/verify` and the token route still respond correctly after the mobile-first UI pass
- [x] Verify active tokens resolve to contact-flow shell state and registration tokens resolve to registration-shell state locally
- [x] Verify active scanner actions create pending `call` and `whatsapp` contact requests locally

## M5. Implement The Authenticated Owner And Admin Web Flow

Tasks:

- [x] Build the owner claim or activation flow
- [x] Build the owner self-registration flow with QR delivery
- [x] Build the basic owner status toggle
- [x] Build the user-specific owner UI with authentication
- [x] Build the admin UI for laptop browser use
- [x] Keep the owner and admin UI minimal and demo-ready
- [x] Use owner and admin screens as simple verification surfaces for protected backend behavior
- [x] Ensure owner-specific screens return only the authenticated user's data
- [x] Ensure admin-specific screens are separate from scanner and owner surfaces
- [x] Start replacing the shared verification surface with dedicated owner and admin pages
- [x] Reduce `/verify` to internal runtime and seed tools instead of using it as the main owner/admin surface
- [x] Support an `unclaimed` tag state and a public claim form on the token page
- [x] Fix claim flow so unclaimed tags do not expose a masked vehicle number before claim
- [x] Fix claim flow so claimed tags show the correct masked vehicle number after claim
- [x] Build the admin/company QR issuance flow for physical unclaimed sticker handoff
- [x] Add QR generation or QR download flow for newly registered owners
- [x] Keep admin issuance separate from owner personal registration details
- [x] Support batch-based unclaimed tag issuance for sticker generation
- [x] Add a separate admin print queue for unclaimed unprinted tags
- [x] Refine the admin dashboard into a clearer monitoring and issuance surface for the client demo
- [x] Simplify the owner self-registration QR output surface for the client demo
- [x] Rework the admin area into a more dashboard-like sign-in and action experience
- [x] Simplify the owner registration flow so QR generation is easier to understand in the client demo
- [x] Refine the admin and owner onboarding pages for the client meeting flow
- [x] Align demo-seeded unclaimed tags with admin-issued print metadata for local consistency
- [x] Add clearer local admin setup and failure guidance in the admin page
- [x] Rework the admin page into a dashboard shell with a dedicated login screen, sidebar navigation, overview landing area, and sectioned operator panels
- [x] Split the admin operator surface into separate routes for overview, issuance, print queue, owner monitoring, and activity instead of keeping them on one page
- [x] Surface owner self-registrations clearly in admin overview, owner monitoring, and activity feeds
- [x] Add a repeatable regression check for owner self-registration visibility in admin data
- [x] Add a single internal hub page for opening admin, owner, registration, verify, and scanner flows

Verification:

- [x] Manually verify owner claim on an unclaimed tag
- [x] Manually verify owner self-registration produces a claimable or active owner QR output
- [x] Manually verify active or inactive status changes affect scanner behavior
- [x] Manually verify owner login and access isolation
- [x] Manually verify admin login and admin-only access from a laptop browser
- [x] Manually verify `/verify` still works as the internal runtime and seed surface
- [x] Manually verify admin-issued unclaimed tag flow produces a QR/sticker-ready token
- [x] Manually verify admin-issued unclaimed tag flow does not ask for owner personal details
- [x] Manually verify batch issuance produces the requested number of unclaimed tags under one batch number
- [x] Manually verify the print queue lists unclaimed unprinted tags for printing-company handoff
- [x] Verify a newly self-registered owner and tag become visible in admin overview and owner-monitoring data
- [x] Run the automated admin-registration visibility regression check successfully

## M6. Harden Web Security And Authorization Boundaries

Tasks:

- [x] Review the frontend for common web security risks before demo use (secrets scan + session review — code-verified)
- [x] Avoid exposing secrets, private identifiers, or sensitive routing data in client code (no hardcoded keys/URIs; only Razorpay/Google publishable IDs)
- [x] Add secure session handling or token handling for authenticated flows (`session.js`: opaque 192-bit id, `httpOnly`, `sameSite:lax`, `secure` in prod, server-side store)
- [x] Add server-side authorization checks for every protected route (`requireSession` → 401/403; owner 11/11 + admin 17/17 routes guarded)
- [x] Review input validation for scanner, owner, and admin inputs (whitelists, `/^\d{4}$/`, required-field 400s)
- [x] Keep verification and debug UI simple without exposing unsafe internal data (`/api/runtime/status` returns only Boolean `*Configured` flags, never secret values)
- [x] Document any remaining security limitations that are acceptable for the MVP demo (in-memory session store resets on restart; no CSRF token beyond `sameSite:lax`; rate limits per M9) — written up in `wiki/security-limitations-mvp.md`
- [x] Block Google Sign-In from auto-creating a new owner account when the Gmail is not already registered — all three handlers (`/callback`, `/credential`, `/popup`) in `routes/auth/google.js` now return `no_account` error instead of inserting a new owner document
- [x] Show a clear error message on the login page when Google Sign-In fails with `no_account` — "No ParkTag account found for this Google account. Please register first."

### Google OAuth Console Configuration (one-time setup)

> Root cause: popup fires and user selects account but `handlePopupCode` never fires — Google silently drops the auth code when the requesting origin is not whitelisted. See `PLAN.md` section 15 for full context.

- [x] Open Google Cloud Console → APIs & Services → Credentials → click your OAuth 2.0 Client ID
- [x] Under **Authorized JavaScript origins** → confirm or add:
  - `https://app.parktag.me`
  - `http://localhost:4000`
  - `http://127.0.0.1:4000`
- [x] Under **Authorized redirect URIs** → confirm or add:
  - `https://app.parktag.me/api/auth/google/callback`
  - `http://localhost:4000/api/auth/google/callback`
  - `postmessage` ← required for the popup code exchange; without this the token exchange returns `redirect_uri_mismatch`
- [x] Click **Save** and wait 2–5 minutes for Google to propagate the change
- [x] Confirm Railway has all three vars set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL=https://app.parktag.me/api/auth/google/callback`

Verification:

- [x] Confirm protected routes fail safely without authentication (`requireSession` → 401 when no session)
- [x] Confirm authenticated users cannot access another user's data (owner queries scoped by `ownerId = session.userId`; tag ops keyed `{_id, ownerId}`)
- [x] Confirm admin-only routes are blocked for non-admin users (role gate → 403 when `session.role !== "admin"`)
- [x] Confirm the frontend does not expose secrets or unsafe debug data
- [x] Sign in with a Google account whose email matches an existing owner in MongoDB → popup opens → select account → redirected to `/owner-welcome` automatically (no error, no manual step)
- [x] Sign in with a Google account that has NO matching owner in MongoDB → popup closes → error "No ParkTag account found for this Google account. Please register first." appears on login page
- [x] Sign in with a Google account that has no matching owner via the One Tap flow → same `no_account` error shown inline
- [x] Sign in with a Google account that has no matching owner via the redirect flow (`/api/auth/google`) → redirected to `/owner-login?error=no_account` with the correct error message

## M7. Verify Telephony And Fallback Messaging Behavior

> **Implementation pivot (post-M13):** messaging is delivered via the **Meta WhatsApp
> Cloud API** (`lib/integrations/meta.js`), NOT Exotel. **Exotel is calls-only** and the
> scanner→owner / owner→scanner call bridging was re-architected as the inbound Dial-Whom
> flow in **M13** (the old outbound `triggerExotelCall` trigger is retired). The old
> Exotel client (`lib/integrations/exotel.js`, with `sendExotelSms` / `sendExotelMessage`)
> was imported by nothing and was removed on 2026-10-14 (audit item 15). Items below are
> reconciled to that reality: code-verified ✅, and live-delivery / provider-console /
> `wiki/` docs left open.

### Calls — Exotel (see M13 for the full inbound flow)

- [x] Confirm the exact Exotel call flow and privacy rules (masked bridging via virtual number — M13)
- [x] Define the backend env vars for Exotel (`EXOTEL_API_BASE_URL` and `EXOTEL_STATUS_CALLBACK_URL` were removed in audit item 15; nothing read them):
  - `EXOTEL_API_BASE_URL`
  - `EXOTEL_ACCOUNT_SID`
  - `EXOTEL_API_KEY`
  - `EXOTEL_API_TOKEN`
  - `EXOTEL_CALLER_ID`
  - `EXOTEL_STATUS_CALLBACK_URL`
- [x] Define the backend persistence shape for call attempts + provider status (`contactRequests`: `provider`, `providerRequestId`, `providerWebhookStatus`, `callResult`, `callDuration`, `recordingUrl`, `status`)
- [x] ~~Add Exotel-backed *outbound* scanner call triggering~~ → **superseded by M13** inbound Dial-Whom bridging (`POST /api/tags/:token/register-call` + `GET /api/exotel/dial-whom`)
- [x] Add a provider webhook route for Exotel status callbacks (`POST /api/provider/exotel/webhook`, `routes/webhooks/exotel.js`)
- [x] Update stored provider status from Exotel callbacks (webhook maps duration/result/recording, links by `CustomField` or `CallSid`)
- [x] Verify the local/dev Exotel flow without polluting production data
- [x] Validate the Exotel call path live (verified end-to-end in M13, scanner→owner and owner→scanner)
- [x] Keep Exotel failure states privacy-safe (numbers masked in call logs: `maskPhone` in `routes/webhooks/exotel.js`)

### Messaging — Meta WhatsApp Cloud API (active path)

- [x] Confirm that the MVP message delivery path is `WhatsApp` and not `SMS`
- [x] Confirm the exact owner/scanner WhatsApp message flow and privacy rules — message is **server-built** (`contact-actions.js` `WHATSAPP_BASE_MESSAGE` + whitelisted `REASON_LABELS`); scanner can never author free text
- [x] Define the backend env vars for the WhatsApp Cloud API (`env.js:49-52`):
  - `META_WHATSAPP_PHONE_NUMBER_ID`
  - `META_WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_BUSINESS_ACCOUNT_ID`
  - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  - *(Graph API version pinned to `v19.0` in `meta.js`; no separate env var)*
- [x] Define the backend persistence shape for outbound WhatsApp attempts + delivery status (`contactRequests` — shared with calls)
- [x] Define the server-built WhatsApp message body used in the scanner flow (fixed base + reason whitelist)
- [x] Add a scanner-facing backend route that creates a WhatsApp message request (`POST /api/contact-requests`, `action:"message"`, `messageChannel:"whatsapp"`)
- [x] Add WhatsApp Cloud API sending from the backend (`sendMetaWhatsapp`, official Graph `/messages` contract)
- [x] Store the sent WhatsApp attempt + API response safely (`providerRequestId` = wamid; masked error detail)
- [x] Add a webhook verification route (`GET /api/provider/meta/webhook` echoes `hub.challenge` on `hub.verify_token` match)
- [x] Add a WhatsApp webhook receive route (`POST /api/provider/meta/webhook`)
- [x] Update stored message-attempt status from webhook callbacks — `sent / delivered / read / failed` mapped onto `contactRequests` by wamid
- [x] Add owner-side visibility for message requests in the owner dashboard (`dashboard.js:87-94` returns `action / messageChannel / message / status`)
- [x] Add admin-side visibility for WhatsApp attempts + delivery state (admin overview surfaces `messageChannel` + `providerWebhookStatus`)
- [x] Record the required WhatsApp Business Platform / Meta App setup values from the official Meta docs (provider-console config)
- [x] Verify live WhatsApp delivery to a controlled owner/scanner test pair (verified — approved Meta template + real numbers)
- [x] Confirm WhatsApp webhook verification succeeds against the deployed backend (live handshake with Meta)

Tasks:

- [x] Re-evaluate provider/telephony integration after the client-demo flow (calls → Exotel inbound, messaging → Meta WhatsApp)
- [x] Validate the Exotel-backed call path (M13 + re-verified live)
- [x] Validate the WhatsApp message path (Meta Cloud API — code-verified)
- [x] Replace the placeholder action flow with real provider behavior (Exotel calls + Meta WhatsApp; no placeholder remains)
- [x] Record Exotel + Meta WhatsApp implementation assumptions and real-world constraints in `wiki/` — `wiki/telephony-messaging-assumptions.md`

Verification:

- [x] Confirm a scanner action can trigger the expected provider flow (call → register-call/Dial-Whom; message → Meta send)
- [x] Confirm the scanner `Send Message` action triggers the WhatsApp provider flow (code-verified)
- [x] Confirm WhatsApp delivery/failure updates appear in owner and admin surfaces (code-verified)
- [x] Confirm failure states remain privacy-safe (server-built messages + phone/detail masking)
- [x] Confirm live WhatsApp delivery + webhook status round-trip on the deployed backend (verified live)

## M8. Prepare Deployment, Demo, Docs, And Operator Runbook

Tasks:

- [x] Deploy the backend server to Render
- [x] Confirm the frontend can be opened from both mobile and laptop browsers against the deployed backend
- [x] Confirm the same simple UI can continue being used for manual verification after deployment
- [x] Add a root README for local setup, running, and verification (rewritten as a full contributor guide)
- [x] ~~Write a short demo script~~ — descoped: owner verified all flows live (scan → call → WhatsApp → payment); no separate script required
- [x] Write the setup and manual verification steps needed for a supervisor demo — covered by README §Local setup / §Running / §Verifying locally / §Seeding
- [x] Summarize current working features, known gaps, and risks — README §Project status (working milestones + open gaps: M15 amount lock, in-memory session store resets on restart)

Verification:

- [x] Confirm the deployed backend responds from the public internet
- [x] Confirm a QR-driven mobile browser flow can reach the deployed experience
- [x] Confirm a laptop browser can be used for admin verification
- [x] Run through the demo flow once end to end — verified live by owner (call + WhatsApp + payment)
- [x] Confirm the repo has enough instructions for another contributor to reproduce the demo — README contributor guide
- [x] Payment gateway (Razorpay) verified without the dashboard — signature verify accepts valid / rejects tampered; test-mode order creation returns ₹199 (19900 paise, INR); real-key HMAC round-trip passes

## M9. Tiered Rate Limiting — Per-Route Protection

Tasks:

- [x] Raise global limit in `app.js` → `max: 200, timeWindow: "1 minute"` (was 60)
- [x] Add `config: { rateLimit: { max: 5, timeWindow: "1 minute" } }` to `POST /api/contact-requests` in `routes/public/index.js`
- [x] Add `config: { rateLimit: { max: 10, timeWindow: "1 minute" } }` to `POST /api/tags/:token/verify` in `routes/public/index.js`
- [x] Add `config: { rateLimit: { max: 10, timeWindow: "1 minute" } }` to `POST /api/auth/login` in `routes/auth/credentials.js`
- [x] Add `config: { rateLimit: { max: 5, timeWindow: "1 minute" } }` to `POST /api/auth/send-otp` in `routes/auth/otp.js`
- [x] Add `config: { rateLimit: { max: 5, timeWindow: "1 minute" } }` to `POST /api/auth/forgot-password` in `routes/auth/password-reset.js`

Verification:

- [x] Click rapidly through all 7 admin navbar sections → no rate limit error
- [x] Scanner flow: verify plate → submit contact request → succeeds
- [ ] Submit 6th contact request within 1 min → blocked with `Too many requests`
- [ ] Submit 11th login attempt within 1 min → blocked with `Too many requests`
- [ ] Submit 6th OTP request within 1 min → blocked before any OTP is sent
- [x] `GET /api/health` and `GET /api/runtime/status` respond normally throughout

## M10. Owner Password Registration Path (Testing / Client Decision Pending)

> Added for internal testing. Client will decide whether to keep OTP-only or offer password as an alternative login method after confirming with the team.

Tasks:

- [x] Add `POST /api/owner/set-password` route in `routes/owner/dashboard.js` — requires owner session, min 8 chars, hashes and stores password
- [x] Add "Set a password" step to `/owner-verify` page — shown automatically after OTP verification when `isNewUser === true`
- [x] Add "Save & continue" button that calls `POST /api/owner/set-password` then redirects to `/owner-welcome`
- [x] Add "Skip for now" button to bypass password and go straight to `/owner-welcome`
- [x] Keep "Know your password? Sign in" option on `/owner-verify` for existing password holders (e.g. seeded demo owner)

Verification:

- [ ] Register a new owner via OTP → password step appears automatically after verification
- [ ] Set a password → redirected to `/owner-welcome` successfully
- [ ] Skip password → redirected to `/owner-welcome` without error
- [ ] Sign out → go to `/owner-verify` → "Know your password? Sign in" → enter the password set above → logs in successfully
- [ ] Confirm existing OTP-only owners (no password) are unaffected

## M11. Owner Vehicle Management & Data Integrity

Tasks:

- [x] Add `DELETE /api/owner/tags/:tagId` route — soft delete sets `deletedAt` + `status: "inactive"` so the tag is invisible to all owner and admin queries
- [x] Add "Remove Vehicle" button to the MORE tab on `/owner-vehicle-detail` — shows a confirmation dialog before deleting
- [x] Handle localStorage-only vehicles in the remove flow — clears both the user-scoped key and `pt_pending_vehicles` without hitting the API
- [x] Fix admin dashboard endpoint (`/api/admin/dashboard`) — `ownerTags` now filters `deletedAt` tags so owner tag and active counts are accurate
- [x] Fix admin owners endpoint (`/api/admin/owners`) — same `deletedAt` filter applied so the owner list tag counts are accurate
- [x] Add `syncLocalVehicles()` to `welcome.js` — fires silently after dashboard load, POSTs each localStorage-only vehicle to `/api/owner/local-vehicle`, removes from localStorage on success, then re-fetches dashboard and re-renders the grid with real tokens and QR codes
- [x] Document new vehicle tag allocation and free contact policy in `PLAN.md` section 13

Verification:

- [x] Add a vehicle via `/register-owner` → appears on dashboard with real `PT-XXXXXXXX` tag id (not `DEMO-` prefix) after auto-sync
- [x] Open a vehicle on dashboard → MORE tab → "Remove Vehicle" → confirm → vehicle disappears from dashboard
- [x] Remove a vehicle → refresh admin dashboard → owner tag count decreases correctly (no longer counts deleted tag)
- [x] Simulate a failed API save during registration (temporarily break the route) → vehicle lands in localStorage → open dashboard → vehicle auto-syncs and gets a real token without any user action
- [x] Remove a vehicle → check MongoDB directly → confirm `deletedAt` is set and `status` is `"inactive"` (data preserved, not hard-deleted)
- [x] Owner dashboard never shows a vehicle with `deletedAt` set (soft-deleted tag is fully invisible to owner)

## M12. New Vehicle Registration Flow — End-to-End

Covers the complete flow when an existing owner adds a new vehicle, from the registration page through to a live active tag on the dashboard.

### Step 1 — Owner fills the registration form (`/register-owner`)

- [x] Owner selects vehicle type and enters plate number
- [x] Plate is validated against Indian format (`DL 01 AB 1234`) before the vehicle is added to the in-page list
- [x] Bicycle frame numbers are accepted with a relaxed 3-char minimum instead of the plate regex
- [x] Duplicate plates are rejected (checked against both in-page list and localStorage)
- [x] Owner enters a mobile number (pre-filled and read-only if already saved on the account)
- [x] Submitting with an unfilled type/plate in the input fields auto-adds the vehicle before proceeding

### Step 2 — E-Tag popup and save

- [x] On submit, the E-Tag popup appears showing a printable QR sticker for the first vehicle
- [x] "Download E-Tag" → calls `saveVehicles()` which POSTs each vehicle to `POST /api/owner/local-vehicle` → creates a real tag in MongoDB with `status: "active"`, `freeContactUsed: false`, `premium: false`
- [x] "Skip" → same `saveVehicles()` call, no print dialog
- [x] If the API call fails (network drop etc.) → `savePendingVehicles()` stores the vehicle in `localStorage` as a fallback
- [x] `POST /api/owner/local-vehicle` is idempotent — re-adding the same plate returns `409` and reuses the existing tag (never duplicates)

### Step 3 — Dashboard load and auto-sync

- [x] Owner lands on `/owner-welcome` after registration
- [x] Dashboard fetches `/api/owner/dashboard` → returns all active (non-deleted) tags for this owner
- [x] If any vehicles are localStorage-only (API save failed in step 2), `syncLocalVehicles()` fires silently in the background
- [x] `syncLocalVehicles()` retries `POST /api/owner/local-vehicle` for each localStorage vehicle → on success removes it from localStorage and re-renders the grid with the real tag data
- [x] New vehicle appears on the dashboard with a real `PT-XXXXXXXX` tag id and a scannable QR code

### Step 4 — Tag lifecycle after registration

- [x] New tag starts with `freeContactUsed: false` — one free masked contact is available immediately
- [x] `contactAvailable` on the public tag page reflects `premium OR NOT freeContactUsed`
- [x] After the first scanner contact is made, the backend sets `freeContactUsed: true` — subsequent contact attempts return `402 FREE_USED`
- [x] Owner must purchase the official physical sticker (premium) to unlock unlimited contact for that vehicle
- [x] Each vehicle has its own independent free contact slot — adding a new vehicle never affects other vehicles

### Verification

- [x] Register a new vehicle as an existing owner → vehicle appears on dashboard with real tag id (not `DEMO-` prefix)
- [x] Same plate registered twice → second attempt returns 409, only one tag exists in DB
- [x] Two different vehicles registered → each gets its own independent tag and QR
- [x] Simulate API failure during registration → vehicle lands in localStorage → open dashboard → vehicle auto-syncs silently and real token appears without any manual action
- [x] Scan the new vehicle QR as a public user → contact succeeds → `freeContactUsed` becomes `true`
- [x] Try a second contact on the same tag → page shows `contactAvailable: false`, server returns `402 FREE_USED`
- [x] Purchase premium on the tag → second contact now succeeds (premium bypasses `freeContactUsed` gate)
- [x] Admin dashboard shows correct tag count for the owner after adding the new vehicle

## M13. Exotel Inbound Call Flow (Connect-to-Flow)

> Replaces the old two-leg outbound call. Scanner now dials the owner themselves via a virtual Exotel number. Backend provides a "Dial Whom" webhook that Exotel hits to resolve the correct owner number dynamically. The same architecture also powers the owner callback flow — owner dials the same virtual number to reach the scanner.

### Architecture decision
- [x] Remove reliance on `triggerExotelCall` outbound API for the call action — removed from `lib/core/contact-actions.js`; backend no longer initiates the call
- [x] Reuse `EXOTEL_CALLER_ID` as the virtual number — removed `EXOTEL_VIRTUAL_NUMBER` from `lib/env.js`; all routes now read `env.exotelCallerId` for the virtual number returned to the frontend
- [x] Use a unified `pendingCalls` schema with `callerPhone` (who dials the virtual number) and `targetPhone` (who Exotel connects them to) — works for both directions

### Backend — pending call schema (both directions)

Both `register-call` and owner callback store the same shape:

```
{
  callerPhone:  <who dials the virtual number>,
  targetPhone:  <who Exotel should connect to>,
  token:        <tag token>,
  ownerId:      <ObjectId>,
  type:         "scanner_to_owner" | "owner_to_scanner",
  requestId:    <contactRequest ObjectId, set for owner_to_scanner>,
  consumed:     false,
  expiresAt:    <now + 10 min>   ← TTL index auto-deletes this
}
```

Dial Whom always looks up by `callerPhone` — no special casing needed.

### Backend — scanner call registration (public)
- [x] Add `POST /api/tags/:token/register-call` route in `routes/public/index.js` — checks `freeContactUsed` gate, resolves token → owner phone, stores `{ callerPhone: scannerPhone, targetPhone: ownerPhone, type: "scanner_to_owner" }` in `pendingCalls`, returns `{ ok: true, virtualNumber }`
- [x] Add rate limit `max: 5, timeWindow: "1 minute"` to `POST /api/tags/:token/register-call`
- [x] Add MongoDB TTL index on `pendingCalls.expiresAt` so undialled records auto-delete after 10 minutes
- [x] Create contact request record at registration time and set `freeContactUsed: true` on the tag
- [x] Mark pending call record `consumed: true` after Dial Whom lookup to prevent same record routing two calls

### Backend — owner callback registration (authenticated)
- [x] Add `POST /api/owner/callback/register-call` route in `routes/owner/dashboard.js` — requires owner session
- [x] Get `ownerPhone` from session → `owners` collection (`owner.mobile`) — no phone input from the owner
- [x] Block with `402` if `owner.mobile` is not set — prompt owner to add phone first
- [x] Query `contactRequests` for the most recent record for this `ownerId` where `phone` exists and `createdAt >= now - 60min`
- [x] Return `410 CALLBACK_WINDOW_EXPIRED` if no contact request exists within the 60-minute window
- [x] Store `{ callerPhone: ownerPhone, targetPhone: scannerPhone, type: "owner_to_scanner", requestId }` in `pendingCalls`
- [x] Return `{ ok: true, virtualNumber }` — same virtual number as scanner flow

### Backend — Dial Whom webhook
- [x] Add `GET /api/exotel/dial-whom` public endpoint in `routes/webhooks/exotel.js` — reads `CallFrom` query param (A-party from Exotel), looks up unconsumed `pendingCalls` record by `callerPhone`, returns `targetPhone` as plain text
- [x] Exotel Dial Whom response format confirmed: plain text phone number, HTTP 200; non-200 or empty = busy tone
- [x] Return a safe fallback (HTTP 404 + empty body) if no pending record matches the incoming caller number
- [x] Log unmatched Dial Whom hits for debugging without writing phone numbers to logs

### Backend — status callback update
- [x] Update `routes/webhooks/exotel.js` to handle inbound call status events — links by `providerRequestId` (CallSid stored at Dial Whom time) when no `CustomField` is present

### Frontend — scanner call button
- [x] Replace current call trigger (`POST /api/contact-requests` with `action: "call"`) with two-step flow: 1) `POST /api/tags/:token/register-call` → 2) open `tel:<virtualNumber>` on success
- [x] Remove "waiting for a call back" UI state — scanner is making the call, not receiving one
- [x] Show the virtual number visibly on screen as a fallback in case `tel:` link does not auto-open the dialer
- [x] Add a "Tap to Call" button that re-opens `tel:<virtualNumber>` after register-call succeeds
- [x] Handle `register-call` API failure gracefully — show clear error, do not open dialer
- [x] Scanner phone number field remains required — it is the Dial Whom lookup key

### Frontend — owner callback button (dashboard)
- [x] Add a "Call Back" button on each contact request card in the owner dashboard (only shown when `phone` is present on the request)
- [x] Button calls `POST /api/owner/callback/register-call` (no body — phone comes from owner's profile)
- [x] On success, open `tel:<virtualNumber>` — same native dialer flow as scanner
- [x] If `owner.mobile` is not set, show inline prompt "Add your phone number to enable callback"
- [x] Show `410` response as "Window expired — no recent contact within 60 min"
- [x] Button enters loading state while awaiting the API response — never open dialer before success

### Exotel App Bazaar — manual configuration (one-time)
- [x] Create a Passthru / Connect-to-Flow app in App Bazaar with Primary URL → `https://app.parktag.me/api/exotel/dial-whom` (GET, no fallback URL, "Fetch after every attempt" unchecked)
- [x] Assign ExoPhone `08047284348` to this flow via "Attach flow" in App Bazaar
- [x] Confirmed Dial Whom endpoint returns HTTP 200 + empty body when no caller param — Exotel URL validation passes
- [x] Confirmed Exotel sends `CallFrom` as `0XXXXXXXXXX` (trunk-prefix format) — `toE164` in `exotel.js` updated to handle 11-digit numbers starting with `0`
- [x] Confirmed `targetPhone` normalized to E.164 via `toE164()` before being returned to Exotel
- [x] Set `EXOTEL_STATUS_CALLBACK_URL=https://app.parktag.me/api/provider/exotel/webhook` in Railway env vars — callback wired in the function and tested live

### Verification — scanner → owner (execute in order)

**Step 1 — Register the call**
- [x] Open a tag URL on phone → enter scanner phone → tap "Call Owner"
- [x] API returns virtual number → native dialer opens (or "Tap to Call" button appears)
- [x] Open Atlas → `prod_contact_requests` → confirm new document exists with `action: "call"` and `status: "pending"`
- [x] Open Atlas → `prod_tags` → confirm `freeContactUsed: true` on that tag immediately after clicking Call

**Step 2 — Dial and connect**
- [x] Scanner dials ExoPhone `08047284348` → Exotel hits `GET /api/exotel/dial-whom?CallFrom=0XXXXXXXXXX`
- [x] Railway logs show no "unmatched" warning → pending call record found and consumed
- [x] Owner's phone rings and call connects ✓
- [x] Open Atlas → `prod_pending_calls` → confirm `consumed: true` on the record after the call

**Step 3 — Status callback**
- [x] After call ends → open Atlas → `prod_contact_requests` → confirm `callResult` and `callDuration` fields updated by Exotel webhook

**Step 4 — Edge cases**
- [x] Try "Call Owner" on same tag a second time (freeContactUsed already true) → page shows `402 FREE_USED` error, dialer does not open
- [x] Visit `https://app.parktag.me/api/exotel/dial-whom` in browser with no params → blank white page (200 + empty body, no Chrome 404 error)
- [x] Check Railway logs after an unmatched Dial Whom hit → `[dial-whom] unmatched inbound call` warning appears, no phone number logged

### Verification — owner → scanner callback (execute in order)

**Prerequisites**
- [x] Owner must have `mobile` set in their profile — open owner dashboard → confirm phone is saved; if not, add it via the profile section first
- [x] A scanner must have contacted the owner within the last 60 minutes — open a tag URL → enter scanner phone → tap "Call Owner"

**Step 1 — Call Back button appears**
- [x] Owner opens dashboard → finds the contact request card → "Call Back" button is visible (not greyed out)
- [x] If button shows "60-min window closed" the scanner contact was too long ago — redo the scanner contact first

**Step 2 — Register the owner callback**
- [x] Owner taps "Call Back" → button shows "Connecting…" while API call is in flight
- [x] API returns virtual number → native dialer opens with `08047284348` pre-filled (or "Tap to Call" appears)
- [x] Open Atlas → `prod_pending_calls` → confirm new document with `type: "owner_to_scanner"`, `callerPhone: owner's E.164 number`, `targetPhone: scanner's phone`, `consumed: false`

**Step 3 — Dial and connect**
- [x] Owner dials ExoPhone `08047284348` → Exotel hits `GET /api/exotel/dial-whom?CallFrom=0<owner digits>`
- [x] Check Railway logs → `[dial-whom]` line present, no "unmatched" warning
- [x] Scanner's phone rings → call connects → both parties connected through Exotel masked number
- [x] Open Atlas → `prod_pending_calls` → confirm `consumed: true` on the owner_to_scanner record

**Step 4 — Edge cases**
- [x] Owner taps "Call Back" after 60-minute window → UI shows "Window expired — no recent contact within 60 min", dialer does not open
- [x] Owner has no `mobile` saved → tapping "Call Back" shows inline prompt "Add your phone number to enable callback", dialer does not open
- [x] Two scanners contact owner within 60 min → owner taps "Call Back" → call connects to the most recent scanner (not the first one)

## M14. Owner Dashboard & Scanner UX Polish

Covers UX and security improvements made after M13 call flow was confirmed working end-to-end.

### Admin — Batch Issuance
- [x] Add premium toggle slider to Batch Issuance page — when ON all tags in the batch get `premium: true`
- [x] `createUnclaimedTags()` accepts `premiumBatch` flag and overrides `tagLifecycleDefaults()` `premium: false`

### Scanner — Claim Form
- [x] Add confirm password field with show/hide eye toggle to "Register this WaveTag" form
- [x] Add real-time blur validation — mismatch hint appears when user leaves confirm field; clears as they correct
- [x] Add password length check (8-char minimum) before submission
- [x] Redesign hero section — dark gradient banner, glow decorations, trust pills (🔒 Private calls · ✓ Free to activate · ⚡ Takes 1 min)
- [x] 2-column form layout on ≥700px screens to reduce scrolling
- [x] Fix "Registration required" badge — consolidated CSS, glass-style `data-tone` variants (amber/green), overflow protection

### Owner Dashboard — Phone & Callbacks
- [x] Add phone number input row in User Info menu section with `saveMobile()` function
- [x] Add amber alert banner in Tags & Call accordion when owner has no mobile number — tooltip 'i' button navigates to phone setup
- [x] Add callback prompt (`#callbackPrompt`) between Overview and My Vehicles — shows only eligible call (within 60-min window) with pulsing red dot
- [x] Move Activity section to last position (after My Vehicles)
- [x] Limit Activity section to last 2 days — entries older than 48 hours are hidden
- [x] Add 'i' tooltip button on Activity header — floating card explains the 2-day filter, closes on outside click
- [x] Unify all 'i' tooltip buttons to same floating popup pattern with light colour tinting per context

### Security — Auto-logout
- [x] Session cookie by default (no `maxAge`) — expires when browser closes
- [x] "Remember me on this device" checkbox on login — sets 7-day persistent cookie
- [x] Server-side guard on `/owner-welcome` — redirects to `/owner-login` if no valid session
- [x] `load()` in `welcome.js` redirects to `/owner-login` on 401/403 from dashboard API

### Pending
- [x] Set `EXOTEL_STATUS_CALLBACK_URL=https://app.parktag.me/api/provider/exotel/webhook` in Railway env vars — needed for post-call status tracking (call duration, connected/missed); not required for call bridging itself
- [x] Add Google Cloud Console Authorized JS Origins: `https://app.parktag.me` — needed for popup-based Google Sign-In
- [x] Banner carousel — replace placeholder slides with real content (three real banners, `images/banner-1..3.webp`, in `welcome.html`; found done during audit item 22)
- [x] "Add phone to call back" text in activity cards → make clickable, navigate to phone setup via `goToPhoneSetup()`

## M15. Lock Shop Payment Amounts Server-Side

> Closes the money-integrity hole in `POST /api/shop/create-order`, which currently trusts a client-supplied `amount`. See `PLAN.md` §17 for the design and rationale. The owner premium-upgrade flow (`/api/owner/tags/:tagId/purchase-*`) is already server-locked and must stay unchanged.

### Step 1 — Confirm the canonical product catalog

- [x] Read the shop frontend script(s) that call `/api/shop/*` (welcome / vehicle-detail / shop UI) and list every `productId` and the price shown to the user — `welcome.html:1396` `PRODUCTS`: `pt-car-1`=₹399, `pt-car-2`=₹699, `pt-bike-1`=₹349, `pt-combo`=₹699 (welcome.html is the only shop caller)
- [x] Reconcile those against `PLAN.md` §17.3; update the §17.3 table so it matches the exact ids and prices the shop actually sells — server catalog now mirrors the UI ids/prices exactly
- [x] Confirm the currency is INR and prices are whole rupees (converted to paise only inside `createRazorpayOrder`) — catalog amounts are whole INR; `createRazorpayOrder` does `Math.round(amount*100)`

### Step 2 — Add a server-side product catalog

- [x] Add a `SHOP_PRODUCTS` map (`productId` → `{ name, amount }`, amounts in INR) to `src/backend/lib/integrations/payments.js`
- [x] Add a `getShopProduct(productId)` helper that returns the product or `null` for unknown ids
- [x] Export both so the shop route can import them

### Step 3 — Rewrite `create-order` to ignore the client amount

- [x] In `src/backend/routes/shop/index.js`, change `POST /api/shop/create-order` to read only `productId` from the body (stop trusting `amount`) — `amount` is no longer destructured from the body at all
- [x] Resolve the product via `getShopProduct(productId)`; return `400` with a clear error for a missing/unknown `productId` ("productId required." / "Unknown product.")
- [x] Pass the catalog `amount` (server value) and catalog `name` into `createRazorpayOrder` — never the client value
- [x] Keep returning `{ ok, orderId, amount, currency }` where `amount` is the Razorpay order amount (paise) derived from the server price

### Step 4 — Align the shop frontend

- [x] Update the shop frontend checkout call to send only `productId` (and display name); remove `amount` from the request body — now sends `{ productId, variant }`
- [x] Keep the price shown in the UI, but treat it as display-only — Razorpay opens with `orderData.amount` (server value), not `p.price`

### Step 5 — Hardening (done)

- [x] Persist each created shop order to `shop_orders` (`orderId`, `productId`, `productName`, `amount` (paise), `currency`, `status`, `createdAt`) — added `shopOrders` to `repositories.js`; `create-order` inserts with `status:"created"`
- [x] In `verify-payment`, after signature check, load the stored order by `razorpay_order_id` and confirm it exists and its amount matches the catalog price (paise) before marking success; on success flip the order to `status:"paid"` with `paymentId`/`paidAt`
- [x] Reject with `400` if no matching server-created order is found ("No matching order.") or the amount doesn't match ("Order amount mismatch.")

### Verification

- [x] `getShopProduct` unit-checked: `pt-car-1`→399, `pt-car-2`→699, `pt-bike-1`→349, `pt-combo`→699; unknown/empty/undefined id → `null` (10/10 pass). Client `amount` is structurally unreachable — the route never reads it.
- [x] Live `curl create-order '{"productId":"pt-car-1","amount":1}'` → `amount:39900` (paise), **not** `100` — tampered client amount ignored ✓
- [x] Live `curl create-order '{"productId":"pt-bike-1"}'` (no amount) → `amount:34900` (correct catalog) ✓
- [x] Live `curl create-order '{"productId":"does_not_exist"}'` → `400` "Unknown product." ✓; missing productId → `400` "productId required." ✓
- [x] Live `verify-payment` with a valid HMAC signature but an order we never created → `400` "No matching order." ✓; bad signature → `400` "Payment verification failed." ✓
- [x] Persistence confirmed: successful create-orders land in `dev_shop_orders` at the catalog price (`pt-car-1`=39900, `pt-bike-1`=34900); test rows cleaned up after
- [ ] Complete a real shop checkout end-to-end in the browser → Razorpay opens with the correct price → `verify-payment` returns `{ ok: true }` (needs a live Razorpay checkout + test card — manual)
- [x] Owner premium-upgrade flow unchanged: `purchase-order`/`purchase-verify` untouched by M15 (still `STICKER_PRICE_INR`)

## M16. Per-Vehicle Official Sticker Upgrade & Gated Download (My Vehicles Cards)

> Surfaces the existing per-tag premium purchase (`/api/owner/tags/:tagId/purchase-*`, ₹199 server-fixed) and the official E-Tag download directly on each vehicle card in the owner dashboard's My Vehicles list. Download appears only after the Razorpay purchase completes. Frontend-only — no backend changes. See `PLAN.md` §18. All edits are in `src/frontend/scripts/owner/welcome.js` and `src/frontend/pages/owner/welcome.html`.

### Step 1 — Card action row (structure + conditional render)

- [x] Restructure `vehicleCard()` in `welcome.js` so the wrapper is no longer a single `<a>` — keep icon/body as the tap target that opens `/owner-vehicle-detail?...`, add a dedicated action-row region inside the card
- [x] When `tag.premium !== true`: render a primary **"Official Sticker — ₹199"** button in the action row (no download button)
- [x] When `tag.premium === true`: render a **"Download E-Tag"** button in the action row (no upgrade button) — covers both in-app upgrade and external premium-batch stickers
- [x] Ensure both buttons call `event.stopPropagation()` / `preventDefault()` so tapping them never triggers card navigation
- [x] Show the action row on both active and inactive cards

### Step 2 — Purchase wiring (reuse existing endpoints)

- [x] Add `buyOfficialSticker(tagId, btnEl)` in `welcome.js` mirroring `vehicle-detail.js`: `POST /api/owner/tags/:tagId/purchase-order` → open Razorpay with the returned `keyId/orderId/amount/currency` → on handler success `POST /api/owner/tags/:tagId/purchase-verify`
- [x] Guard: `window.Razorpay` present and tag has a real id; disable button + apply `.pt-btn-loading` while in flight
- [x] On verify success → success toast + `window._reloadDashboard()` so the card flips from upgrade → download automatically
- [x] On verify failure or modal dismiss → restore button, show error toast (never leave the button stuck)
- [x] Expose the helper on `window` and wire the card's upgrade button to it with the correct `tagId`

### Step 3 — Download wiring (reuse existing print template)

- [x] Add `downloadETagFor(tagId)` in `welcome.js` that resolves the tag from `allTags` by id, fills `#wl-print-vehicle-num` / `#wl-print-etag-id` / `#wl-print-status` / `#wl-print-qr-img`, then calls `window.print()` — independent of the burger-menu `_selIdx`
- [x] Wire the card's Download button (rendered only when purchased) to `downloadETagFor(tag.id)`
- [x] Expose the helper on `window`

### Step 4 — Styles

- [x] Add CSS for the `.pt-vlc` action row and button variants (upgrade = primary/red, download = neutral) that lay out cleanly in the card grid on both mobile and desktop widths

### Step 5 — Cross-check

- [x] Confirm Razorpay `checkout.js` is loaded on `welcome.html`; add the script tag if missing
- [x] Confirm no regression: tapping the card body still opens the vehicle-detail page (card body is a `role="link"` tap target; buttons stopPropagation)

### Verification

- [x] Non-premium **active** vehicle card shows "Official Sticker — ₹199" and no download button
- [x] Non-premium **inactive** vehicle card shows the same upgrade button (feature works regardless of active/inactive)
- [x] Tap the upgrade button → Razorpay opens with **₹199 for that specific tag** → complete a test payment → success toast → dashboard auto-reloads → the same card now shows "Download E-Tag" instead of the upgrade button
- [x] Tap "Download E-Tag" → print dialog opens showing that vehicle's plate, E-Tag id, status, and QR
- [x] Before purchase there is no download button on that card
- [x] Tapping the card **body** (not a button) still navigates to the vehicle-detail page
- [x] Tapping either **button** does NOT navigate to vehicle-detail
- [x] In MongoDB, after purchase the tag has `purchaseStatus:"paid"`, `premium:true`, `physicalTagPurchased:true`
- [x] Reload the dashboard → the purchased card still shows Download (state comes from the server, not memory)
- [x] A premium-batch tag (`premium:true`, `purchaseStatus:"none"`) shows the **Download** button, not the upgrade button (gate is `premium`-based — premium-batch stickers are bought externally, no in-app payment; see `PLAN.md` §18.4)
- [x] The existing premium purchase + download on the vehicle-detail page still works unchanged

## M17. Print Queue Split & Delete Safeguards (Admin)

> Splits the admin Print Queue into "To Print" (unprinted) and "Printed · awaiting claim" views, and hardens the destructive delete actions. Backend: `src/backend/routes/admin/index.js`; frontend: `src/frontend/scripts/admin/index.js` + `src/frontend/pages/admin/print-queue.html`.

### Print Queue split

- [x] `GET /api/admin/print-queue` accepts `?printed=1` → returns unclaimed tags with `printStatus === "printed"`; default returns unclaimed with `printStatus !== "printed"`
- [x] `GET /api/admin/print-queue/export` scoped to unprinted tags only (the sheet that still needs printing)
- [x] Print Queue page has a tab toggle: **To Print** (default) vs **Printed · awaiting claim**; each loads the matching view
- [x] "Clear all unprinted" button is hidden on the Printed view (only applies to unprinted)

### Delete safeguards

- [x] `DELETE /api/admin/tags/unclaimed/all` requires `?confirm=all`; otherwise 400
- [x] `DELETE /api/admin/tags/unclaimed/all` now deletes only UNPRINTED tags (`printStatus !== "printed"`) — printed unclaimed tags are preserved (previously it wiped all unclaimed regardless of print status)
- [x] `DELETE /api/admin/tags/batch/:batchNumber` requires `?confirm=1`; otherwise 400
- [x] Frontend "Clear all unprinted" uses a typed-confirmation (type `DELETE`) before calling the API
- [x] Frontend batch delete confirm wording clarifies it includes already-printed tags

### Verification

- [x] Issue a batch → all tags appear under **To Print**; **Printed · awaiting claim** is empty
- [x] Mark a tag printed → it moves from **To Print** to **Printed · awaiting claim**
- [x] Claim that printed tag (scan → claim) → it disappears from both print-queue views and appears under Owners + E-Tags
- [x] "Clear all unprinted" → prompts to type `DELETE`; cancelling or wrong text does nothing
- [x] After confirming "Clear all unprinted" → unprinted tags gone, **Printed · awaiting claim** tags still present
- [x] Direct `DELETE /api/admin/tags/unclaimed/all` without `?confirm=all` → 400; with it → succeeds (unprinted only)
- [x] Direct `DELETE /api/admin/tags/batch/<n>` without `?confirm=1` → 400; with it → succeeds
- [x] Export QRs shows only unprinted tags

## M18. Free-Trial → Buy-Premium-Via-Shop & Tag Replacement

> Retires the in-place ₹199 per-tag upgrade. The free E-Tag is now a one-contact trial;
> when it's spent the owner buys a premium tag through the shop (rate list). A paid shop
> order carrying `replaceTagId` mints a new premium tag for that vehicle and soft-removes
> the spent free tag. Download E-Tag / E-Tag info are kept for premium tags only. See
> `PLAN.md` §13, §16 Q3, §18.

### Backend

- [x] Add `createPremiumTagForVehicle(collections, ownerId, {plateNumber, vehicleType, vehicleLabel})` to `lib/core/tag-issuance.js` — inserts a premium tag directly (new token, `premium:true`, `purchaseStatus:"paid"`, `printStatus:"pending_print"`); does not reuse by plate
- [x] `POST /api/shop/create-order` — add owner session; accept optional `replaceTagId`, validate it (owner-scoped, live, non-premium), store it + `ownerId` on the `shopOrders` doc and in Razorpay `notes`
- [x] `POST /api/shop/verify-payment` — add owner session; on the `created → paid` transition only, if the order has a `replaceTagId`: mint the premium tag (copy plate/type/label from the old tag) + soft-remove the old free tag (`deletedAt`, `status:"inactive"`); return `{ replaced, newTagId }`
- [x] Remove `POST /api/owner/tags/:tagId/purchase-order` + `purchase-verify` and their `STICKER_PRICE_INR`/Razorpay imports from `routes/owner/dashboard.js`

### Frontend

- [x] `welcome.js` `vehicleCard()` — premium → Download E-Tag; free+used → "trial ended" note + Buy Premium Tag (`goToShopForReplace`); free+unused → no action buttons; remove `buyOfficialSticker`
- [x] `welcome.js` — add `goToShopForReplace(tagId)` (remembers `window._replaceTagId`, opens shop); parse `?shop=1&replace=<id>` on load to auto-open the shop with the replace-context
- [x] `welcome.html` `handleBuyNow()` — send `replaceTagId: window._replaceTagId || null`; clear it on success; success toast reflects `replaced`
- [x] `welcome.html` — `.pt-vlc-trial` style for the trial-ended note
- [x] `vehicle-detail.js` — capture `freeContactUsed`; `updatePremiumUI()` drives premium / free-unused / free-used states; Buy button redirects to `/owner-welcome?shop=1&replace=<id>`; Download E-Tag item shown only for premium
- [x] `vehicle-detail.html` — relabel buy button "Buy Premium Tag"; Download E-Tag item gated to premium via JS

### Verification

- [ ] Fresh free tag card shows "1 Free Call", no buy/download buttons
- [x] After the free contact is used → card shows the trial-ended note + Buy Premium Tag (verified locally via expired demo-seed tag)
- [ ] Buy Premium Tag → shop opens → pay `pt-car-1` (₹299) test card → dashboard reloads: vehicle now premium with Download E-Tag; old free tag `deletedAt` set + new tag `premium:true, purchaseStatus:"paid"` (new token) in Mongo
- [ ] Same path from the vehicle-detail page (redirects to `/owner-welcome?shop=1&replace=…`)
- [ ] A generic shop purchase (no replace-context) still behaves as a plain order — no tag minted/removed
- [ ] Removed `purchase-order`/`purchase-verify` endpoints 404; premium tags still download

## M19. Paid Callback After The Free Window (Premium)

> A premium tag includes calling a scanner back for 10 minutes from their contact. After that,
> the owner can pay ₹20 to reopen the callback for that one contact, for 10 minutes from the
> payment. Replaces the ₹20 one-time pass that was built for E-Tags by mistake — E-Tags go back
> to the plain "Premium to call back" nudge. See `wiki/paid-callback-after-window.md`.

### Backend

- [x] `lib/core/callback-pass.js` — the pass is the settled `callbackOrders` row (no pass field on the tag or contact); `callbackPassOffer()` (premium + masking, past the free window, ≤ 48h old), `findLiveCallbackPasses()`, `settleCallbackOrder()` (conditional `created → paid`, so browser and webhook settle once)
- [x] `POST /api/owner/callback/create-order` — refuses E-Tags (`PREMIUM_REQUIRED`), lapsed premium (`CALL_SUBSCRIPTION_REQUIRED`), contacts still inside the free window (`CALLBACK_INCLUDED`), older than 48h (`CALLBACK_WINDOW_EXPIRED`), not the vehicle's newest (`CALLBACK_NOT_LATEST`), already paid (`PASS_ALREADY_PAID`); reuses a started order
- [x] `POST /api/owner/callback/verify-payment` — signature, owner and amount checks, settles the order, registers the Exotel bridge in the same request and returns the virtual number; replays inside the 10 minutes are harmless, after it `PASS_EXPIRED`
- [x] Razorpay webhook settles a callback order the browser never confirmed (never places the call)
- [x] `register-call` honours a live paid callback for the named contact on its own clock; a premium contact past its window without one answers `CALLBACK_WINDOW_EXPIRED`
- [x] Dashboard: `callbackPassExpiresAt` per contact row; publishes `callbackPassPaise` + `callbackPassMaxAgeMs` (drops the E-Tag `callbackPassMinRemainingMs` and per-tag `callbackPass`)
- [x] Side fix: `register-call` now projects `subscription`/`documentSubscription`, so a premium member past the first year is no longer refused a callback the dashboard offers

### Frontend

- [x] `callback-eligibility.js` — `NEEDS_PAYMENT` for a running premium row past the free window (within the horizon); live paid rows are `CALLABLE`; E-Tag rows never offered ₹20; `PASS_SPENT` removed
- [x] `welcome.js` — "Call Back ₹20" on each vehicle's newest contact; banner carries it for the first hour; paid rows keep Call Back until their 10 minutes end; timer re-renders at every boundary
- [x] Payment flow — `CALLBACK_INCLUDED` falls back to the free call (clock skew), `PASS_ALREADY_PAID` reloads to the paid row, verify retried on a dropped connection, call sheet says the paid window allows redials
- [x] Found in local QA: stale-tab refusals (`CALLBACK_NOT_LATEST`, premium/subscription changes) now refetch the list instead of re-drawing the stale copy; a paid row that ended in a conversation no longer keeps its Call Back button; the post-payment reload called a non-existent `loadDashboard()`

### Verification

- [x] `callback-pass.test.js`, `callback-eligibility.test.js`, `callback-premium-only.test.js`, `callback-from-activity.test.js`, `razorpay-webhook.test.js` pass
- [x] Local QA, real dashboard in headless Chrome, 89/89: free window, window closing live, paying ₹20 (new order), checkout dismissed then reused, tab closed → webhook settles, paid window ending live, stale tabs (newer contact / already paid), phone clock ahead, no mobile, lapsed premium, E-Tag, member past year one, two vehicles, API refusals, Exotel dial-whom + status callback. Run with no provider credentials, every outbound connection blocked, Razorpay's order API answered in-process (never contacted), checkout sheet stubbed
- [ ] Live: premium contact older than 10 min → Call Back ₹20 → Razorpay test payment → call sheet opens → dial from the owner's mobile connects to the scanner
- [ ] Live: close the tab right after paying → webhook settles → dashboard shows Call Back on that row for the rest of the 10 minutes

## Current Focus

- [x] Establish root workflow and tracking files
- [x] Write the first wiki note
- [x] Define the minimum demo slice before broader implementation
- [x] Scaffold and deploy backend server
- [x] Build scanner, owner, and admin web flows
- [x] Implement Exotel inbound call flow — scanner → owner and owner → scanner both verified end-to-end
- [x] Polish owner dashboard UX and scanner claim form
- [x] Harden session security — auto-logout, server-side page guard, remember-me
- [x] Set `EXOTEL_STATUS_CALLBACK_URL` in Railway
- [x] Configure Google Cloud Console for production Google Sign-In
- [x] Implement WhatsApp message delivery via Meta WhatsApp Cloud API (M7) — code-complete; live delivery test + Meta template approval pending
- [x] Complete M6 security hardening checklist (boundaries code-verified; limitations write-up pending)
- [ ] Lock shop payment amounts server-side (M15)
- [x] Surface per-vehicle official sticker upgrade & gated download on My Vehicles cards (M16)

## Meta purchase matching, 2026-09-18

- [x] Preserve actual Meta click/browser cookies across landing and shop; store checkout IP, user agent and cookies on new/reused orders; pass saved context to paid-order CAPI events and log acceptance. Verified with 39 focused tests using disposable collection prefix test_meta_tracking_20260918_.
- [x] Deploy to production (Railway 626f5f19-a07a-4441-b89e-755cb764299b, SUCCESS); live health and shared-cookie analytics bundle verified.
- [ ] Verify receipt and matching for the next real paid order in Meta Events Manager; no historical order replay performed.

## Internal test batch reporting, 2026-09-18
- [x] Exclude PT-Batch-002 from order linking and server activation conversions; exclude internal orders from server Purchase sends. 41 targeted tests passed. Production: 10 test tags classified and incorrect PT-260728-00002 linkage removed. Active n8n activation wording and daily digest exclusions corrected.
- [x] Railway deployment bbbebd4f-20b1-4737-9de0-ae86bf546692 succeeded; live health verified.

## Quantity checkout CI, 2026-09-18
- [x] Correct the missing-Razorpay assertion and verify quantity-1 legacy reuse and quantity-3 pricing without a provider call. All 8 quantity tests pass with an isolated test prefix.

## CI throughput, 2026-09-18

- [x] Implement PR-only superseded-run cancellation, three isolated backend test shards, and the existing `verify` gate. Gate checked against 576 outcome combinations; full workflow validation tracked in the PR.
## Slack operator commands, 2026-09-18
- [x] Implement signed /parktag commands with Girish/team/channel restrictions, private replies, exact batch lookup, tracking, status controls and transactional ownership reset. Thirteen focused tests passed, including real reset transactions against isolated Atlas collections.
- [x] Merge/deploy and register the Slack slash command; private help and tag lookup verified live on 2026-09-18.

## Slack reply presentation, 2026-09-18

- [x] Group help and results with Block Kit sections, dividers, status icons and readable IST dates; retain private replies and text fallback.
- [x] Acknowledge silently so asynchronous commands show one result instead of an extra working message. Existing command tests pass.
- [ ] Merge and deploy formatting update.
## WhatsApp and SMS owner login, 2026-09-18
- [x] Add SMS alongside WhatsApp using existing Firebase endpoints, Firebase reCAPTCHA and shared send limits. Focused mocked-provider tests cover login, resend, email regression, invalid codes and account reuse.
- [x] Identify live Firebase project: parktag-449be belongs to biz.edittree@gmail.com, not contact@edittree.in. Phone enabled; Spark plan. Ten focused tests pass.
- [ ] User completes correct project billing setup; approve adding app.parktag.me authorized domain, then deploy and verify SMS delivery. Earlier parktag1 Blaze restoration is a separate project.

## Primary Firebase switch, 2026-09-18
- [x] User chose parktag1 under contact@edittree.in. Verified existing production API key already belongs to parktag1 and is valid; only FIREBASE_PROJECT_ID was mismatched. Target already on Blaze, Phone enabled, app.parktag.me authorized, India-only SMS policy. Set Railway production project ID to parktag1 without redeploy pending release checks.
- [x] Deploy WhatsApp/SMS login choice and verify live configuration/UI. PR #253 merged after all CI checks passed using explicitly approved owner override. Railway deployment e93c90a2-7c36-49ef-a1ab-80d23dc824a0 succeeded at commit 434e06a; live health OK, Firebase project parktag1, both channel options visible.
- [ ] Account holder verifies actual WhatsApp/SMS handset delivery; no live OTPs sent during automated checks.

- [x] WhatsApp remains default; SMS fallback revealed after 10 seconds with a server-enforced 10-minute per-number SMS reservation and UI cooldown. Targeted tests passed.

- [x] SMS fallback layout corrected: below verification controls, compact typography, consent shown only when choosing SMS; 10-second delay starts after WhatsApp send and resets on resend/back. Targeted checks pass.

## Live OTP delivery, 2026-09-21

- [x] Stop rejected Firebase sends from consuming the shared WhatsApp/SMS budget or ten-minute SMS reservation; ignore legacy unconfirmed SMS markers.
- [x] Expose SMS immediately when WhatsApp sending fails. Fifteen focused OTP tests pass.
- [ ] Merge, deploy, and verify both channels on a real handset.

## Response compression, 2026-09-24

- [x] Negotiate response compression from Accept-Encoding with `@fastify/compress`: zstd, then brotli, then gzip, plain body when the client asks for none. Request decompression left off so webhook signatures still see raw bytes.
- [x] Verify negotiation, round-trip decoding, `Vary: Accept-Encoding` and asset stamping before compression (7 tests in `response-compression.test.js` pass). Measured `styles.css` 161 KB to 40-44 KB and `/get` 28 KB to 7.5-7.8 KB.
- [ ] Decide whether to raise zstd/brotli levels (see `wiki/response-compression.md`) after measuring egress and CPU on production.

## Error monitoring, 2026-09-24

- [x] Report server errors to Sentry (`@sentry/node` v10): 5xx from the Fastify error handler, unhandled rejections and uncaught exceptions from `server.js`, flushed on shutdown. Off unless `SENTRY_DSN` is set.
- [x] Keep reports privacy-safe: no request, user, IP or breadcrumbs; phone numbers, OTPs and emails masked; route pattern tags only. User-facing `clientError`s and 4xx are not reported. Verified with 6 unit tests and an end-to-end run against a local fake Sentry endpoint.
- [ ] Create the Sentry project, set `SENTRY_DSN` on Railway, and confirm the first real event arrives scrubbed.

## Shop product images refreshed, 2026-09-30

- [x] Car Tag (Pack of 2): new artwork (two tilted stickers) on the dashboard shop and on `/shop`. Desktop uses the supplied 16:9 image as is (`shop-car-2-v2-desktop.webp`). The phone card is 4:3, so `shop-car-2-v2-900.webp` is the same artwork with the striped background carried on above and below, not a crop, which would have put the stickers against the card edges.
- [x] Bike Tag (Pack of 2): the phone image was a different photograph from the desktop one. `shop-bike-v2-900.webp` is now a 4:3 crop of the same supplied photo.
- [x] Combo Tag (Pack of 2): no change needed. Both existing files already carry the supplied artwork.
- [x] New filenames rather than files replaced in place, because `/images/` is cached for thirty days. The three replaced files are removed; nothing else referenced them.
- [ ] Not changed: the small `shop-*-thumb.webp` images on `/get` and `/direct`. The Pack of 2 thumbnail there still shows the earlier straight layout.

## Checkout pincode guard, 2026-09-27

- [x] Rename the checkout field from "PIN code / 6-digit PIN" to "Pincode (postal code) / e.g. 110052": a buyer read it as a card PIN, typed a Kerala code on a New Delhi address, paid, and the Delhivery booking failed (PT-260927-00037).
- [x] Refuse a pincode from another state, in the form (India Post's state for the pincode) and in the shared `validateAddress` (two-digit postal-circle table, generous at borders, unknown prefixes not judged). The typed number is never echoed back. `address-check` answers `validated: false` for such a pair without asking Ola.
- [x] Ask Delhivery for serviceability on guest pay-online orders before payment (COD already did); only an explicit "not serviceable" refuses.
- [x] Verify: 6 unit tests in `pincode-state.test.js` pass; the rule refuses none of the 29 real prod order addresses or 4 saved addresses.
- [ ] Run the Mongo-backed suites in CI (`guest-checkout`, `address-suggest` updated for the new wording and fixture), merge, deploy, and place one test checkout with a mismatched pincode.
- [ ] Decide whether to WhatsApp the buyer automatically when a paid order's booking still fails.

## Locked E-Tag: owner nudged, nothing promised to the scanner, 2026-09-30

- [x] Checked what happens once a door hanger tag's two free contacts are spent. The call and the alert were refused (402), but the owner was told nothing: no message when the limit was reached and none when later scanners were turned away, and those attempts were not recorded anywhere. The Emergency call still connected.
- [x] Owner's rules, applied: (1) locked means locked, **including the Emergency call**; (2) the scan page makes **no claim** that the owner was told, because the message is capped and can fail; (3) the owner's message should sell the Premium tag.
- [x] Emergency: `register-emergency-call` refuses a locked E-Tag (402 `EMERGENCY_LOCKED`) and the load payload reports `emergencyAvailable: false` for it, so the Emergency button leads to the public helplines. A premium tag whose year has lapsed is not affected. Consequence, tested in `contact-routing.test.js`: on a one-contact E-Tag the scanner's own call is what locks it, so they cannot then escalate to Emergency on the same visit.
- [x] Scanner: the locked panel reads "This tag's free limit is used up … its owner has used the full limit", with the sticker link and nothing else. No button, no status. The helplines note no longer says "no emergency contact added" when the page does not know that to be the reason.
- [x] Owner: a verified scan of a locked tag is counted server-side from the verify route (one per scanner per tag per day) and the owner is messaged at most once per tag per 24 hours on WhatsApp and e-mail (`lib/core/locked-tag-nudge.js`). The send is claimed by a conditional update and released if delivery fails. It never carries the scanner's reason.
- [x] The message rides in `{{2}}` of the approved `parktag_owner_notification_v2`, worded to sell: what is switched off, and what upgrading gives back. No price or discount. **Risk:** this is promotional copy in a UTILITY template that also carries every real alert; if recipients block or report it Meta can pause the template. `docs/WHATSAPP_TEMPLATES.md` 2.8 has the proper MARKETING template and the opt-in it needs.
- [x] Dashboard: the locked vehicle card says how many people tried and could not reach the owner (`missedContacts`).
- [x] Found on the way: `DASHBOARD_TAG_PROJECTION` left out `freeContactAllowance` and `freeContactsSpent`, so door hanger stock was shown to its owner with one free contact instead of two. The scan page and the 402 message also said "one free contact" on tags that had two.
- [x] Tests: `locked-tag-nudge.test.js` (32), `scanner-locked-panel.test.js` (11), one new and two changed in `contact-routing.test.js`.
- [ ] After deploy: scan a locked door hanger tag on a phone, enter the plate, and confirm the WhatsApp arrives once, the dashboard count goes up, and Emergency shows only the helplines.
- [ ] Add a marketing opt-in to the activation wizard, then submit `parktag_tag_locked` and move the pitch off the utility alert.
- [x] Decide whether the owner should also be told at the moment the last free contact is spent. It needs its own template. **Decided yes, 2026-10-01**: see the next section.

## Three alert templates: vehicle number, emergency location, trial ended, 2026-10-01

- [x] Owner alert names the vehicle. `sendMetaWhatsappAlert` takes a `plate` and tries the new `parktag_owner_notification_v4` (name, plate, reason) first, falling back to v2. The plate also rides at the end of the reason on v2 and on the map variant ("… (vehicle DL9CP4455)"), so an owner with several tags sees it from the next deploy, before Meta approves anything.
- [x] Emergency contact's location message gets its own template, `parktag_emergency_location_v1` (masked plate, place, Open in Maps button). Tried first; until approved the owner alert carries it as before.
- [x] Owner is told once, at the moment the last free contact is spent, on `parktag_free_trial_ended` (`lib/core/trial-ended-notice.js`, called from both routes that spend a contact, claimed by a conditional update, outcome recorded on the tag as `trialEndedNotice`). Applies to every E-Tag, not only door hanger stock. No fallback: until the template is approved nothing is sent.
- [x] `src/backend/scripts/create-alert-templates.js` submits all three (`--dry-run` prints them). Copy recorded in `docs/WHATSAPP_TEMPLATES.md` 2.9 to 2.11.
- [x] `verify-whatsapp-templates.js` lists the three, checks their category, and now checks the owner alert the code really sends (it was still checking v1).
- [x] Tests: `alert-templates.test.js` (28, template shape and send/fallback against a stubbed Meta) and `trial-ended-notice.test.js` (11).
- [x] Submitted all three on 2026-10-01 (Meta returned PENDING, UTILITY for each). The trial-ended button reads "See my vehicle": in this account `parktag_premium_lapsed` with "Turn premium back on" was filed MARKETING while `parktag_premium_ending_today` with "See my vehicle" stayed UTILITY.
- [x] Meta approved all three as UTILITY on 2026-10-01 (checked in the account).
- [x] Trial-ended wording changed the same day on the owner's instruction: it no longer mentions WhatsApp alerts, only "private calls and the emergency call". Edit accepted by Meta and back in review; the first approved wording stays live until the edit is approved.
- [x] The edited `parktag_free_trial_ended` is APPROVED and still UTILITY (checked in the account, 2026-10-01). All three templates are live with their final wording.
- [x] **Product decision settled, 2026-10-01:** WhatsApp alerts keep working for ever on **door hanger tags**; only the private call and the Emergency call lock. See the next section.

## Door hanger tags keep their WhatsApp alert for life, 2026-10-01

- [x] `hasLifetimeAlerts(tag)` in `call-access.js`: a non-premium tag stamped with more than one free contact, which is the only marker door hanger stock carries. Ordinary E-Tags are unchanged (one free contact, call or alert, then fully locked).
- [x] Server: `/api/contact-requests` no longer refuses a locked door hanger tag; `register-call` and `register-emergency-call` still do. A WhatsApp alert on door hanger stock spends no free contact, so the two free contacts are two free calls. `/verify` answers `messageAlwaysOn`.
- [x] Scan page: on a locked door hanger tag the WhatsApp tile stays, the Private Call tile is hidden and a note says the call is not available. After an alert on a door hanger tag that still has a call left, the call stays available.
- [x] The alert names the vehicle (already done above), and so does the once-a-day message.
- [x] Owner-facing wording for door hanger tags speaks of calls only and never says WhatsApp still works (owner's instruction): the once-a-day message ("they could not call you …"), the dashboard card ("N people could not call you") and the vehicle page ("free calls").
- [x] The trial-ended notice is only considered after a contact that actually spent something, so an alert on a tag that locked long ago cannot announce it late.
- [x] Tests: 41 in `locked-tag-nudge.test.js` (9 new), 16 in `scanner-locked-panel.test.js` (5 new).
- [x] **A free call is counted only when it connects** (owner's rule, 2026-10-01). `register-call` no longer spends anything; Exotel's status callback spends one free call when it reports at least 1 second of conversation (`lib/core/free-call-spend.js`), once per scan. Unanswered, busy, failed and never-dialled calls cost nothing. Applies to every E-Tag's calls, not only door hanger stock. The trial-ended notice now follows the connected call.
- [x] Tests: 10 new in `free-contact-allowance.test.js` (unanswered, never dialled, status word without duration, redial, duplicate report, premium, upgrade mid-call), plus the Emergency consequence in `contact-routing.test.js`.
- [ ] After deploy, on a real door hanger tag: place one call and let it ring out, confirm the dashboard still shows 2 free calls; then place one that is answered and confirm it shows 1. This also proves Exotel's status callback is reaching production with a talk time, which the deduction now depends on.
- [ ] Not yet checked in a real browser: scan a locked door hanger tag on a phone and confirm the WhatsApp tile is full width, the call tile is gone, the note shows, and the alert arrives naming the vehicle.
- [ ] The hanger itself prints "First 2 contacts free". It is still true (two free calls), but decide whether the next print run should say "2 free calls + WhatsApp alerts for life".
- [ ] Owner-facing pages for ordinary E-Tags still say "1 free contact via masked call or WhatsApp" and are unchanged. Decide whether ordinary E-Tags should get lifetime alerts too.
- [ ] **Reminder: rotate the Meta token.** The production `META_WHATSAPP_ACCESS_TOKEN` was pasted into a chat on 2026-10-01, so it is in that conversation's history, and it is also saved in `.env.meta.local` in this folder. Once the three templates are approved, generate a new token in Meta (Business Settings → System users), update it on Railway, and delete `.env.meta.local` or replace the token in it.
- [ ] Found while listing the account: `parktag_owner_notification_v3` (Call-back button) is APPROVED but the code still sends v2; `parktag_premium_lapsed` and `parktag_referral_reward` are now MARKETING, which `docs/WHATSAPP_TEMPLATES.md` still describes as UTILITY. Check whether either is sent without a marketing opt-in.
- [ ] After approval and deploy: report an issue on a tag and confirm the vehicle number shows; spend the last free contact on a door hanger tag and confirm the trial-ended WhatsApp arrives once; place an SOS call with location shared and confirm the emergency contact gets the new message with a working map button.
- [ ] Decide whether the trial-ended notice should also go by e-mail to owners with no mobile on file.
- [ ] `parktag_owner_notification_map_v2` with its own plate variable, to replace the "(vehicle …)" suffix on the map alert.

## Performance audit fixes, 2026-09-28

- [x] Audit written to `PERFORMANCE_AUDIT.md` (live traces, headers, three code audits). Landing hero LCP was 5.7 s on throttled mobile because `AnimateIn` hid the hero until hydration; `/get` was 0.65 s.
- [x] Landing: hero and above-the-fold render in the server HTML (CSS-driven `AnimateIn`, no hydration gate); below-fold images lazy, hero sticker `fetchPriority=high`; 2.4 MB `old-way.jpg` and other rasters re-exported as WebP; `PageLoader`, fade-out navigation and the client-side launch-offer fetch removed; scanner modal lazy; long-cache rules for `public/` assets; dead assets, components and `free-regular-svg-icons` removed.
- [x] App frontend: hidden print stickers load only on print; Razorpay and `address-step.js` load on demand via `checkout-loader.js`; Inter self-hosted (latin plus a rupee subset) with preload; analytics vendor tags start when the page is idle; oversized thumbnails and icons replaced; inline CSS of `welcome.html` and `vehicle-detail.html` moved to fingerprinted files; admin CSS split out of `styles.css`; timers and scroll handlers tightened; owner-local caches cleared on logout; three dead SVGs (3.97 MB) deleted.
- [x] Backend: native `bcrypt` (bcryptjs fallback) so hashing stops blocking the event loop; dashboard reads run in parallel and QR moved to a cached `/api/owner/tags/:tagId/qr.svg` (`?qr=0` drops the inline data URL); shared `fetchWithTimeout` on every provider call; admin N+1 and unbounded queries fixed, secrets never loaded; new indexes; Mongo pool, pooled mail transport, memoised Razorpay client and collections; pincode, Ola, catalogue and reviews caches (production only); HTML shells served from memory with ETag and 304; import specifiers stamped so ES modules are `immutable`; `/api/*` defaults to `no-store`; raw `pages/` no longer served by the static root; quieter request logs; static assets exempt from the global rate limit; `axios` dependency removed.
- [x] New tests: password hashing, fetch timeout, import stamping, provider caching, client memoisation, dashboard QR, admin read paths, app delivery, core indexes. Existing analytics, order-breakdown and callback tests updated for the deferred vendor tags and moved CSS.
- [ ] Set `UV_THREADPOOL_SIZE=8` on Railway (native bcrypt shares libuv's four-thread pool with zlib and DNS), then watch login latency.
- [ ] Manual pass before deploy: `/get`, `/direct`, `/shop`, dashboard shop, membership pay button, vehicle print, owner login, and a real Razorpay checkout on mobile.
- [ ] Watch GA4 / Pixel / Clarity event counts for a day: vendor tags now start at idle (or after 8 s at most), so very fast bounces may be counted less.
- [ ] Decide on `landing/public/brand-guideline/` (176 files, 2 MB, publicly served) and on putting a CDN in front once the cache headers here are in production.
- [ ] Minify `styles.css` at serve time (about 50 KB of comments) and delete the dead rules copied into `styles/admin.css`.

## Referral flow end to end, 2026-09-30

- [x] Traced "refer a friend" from the dashboard card to the reward. The server priced and rewarded correctly on a first, uninterrupted online payment; everything around that was broken or missing, and no test drove the routes a browser actually calls.
- [x] Friend: `get.js`, `shop.js` and `direct.js` cleared the parked code as soon as an order was CREATED, so closing the payment window and trying again sent no code and was charged the full price. Now cleared in `showDone`, once the order is placed.
- [x] Friend: the checkout sheet quoted the full price and the ₹50 only appeared inside Razorpay. `/get` now asks `POST /api/shop/referral/check` whether the code is real, then shows the online price with the link off and a "Friend's link" badge (`address-step.js` takes `referralLabel`; both badges hide beside COD, which never takes it).
- [x] Friend: a code the server refuses at checkout (your own link) no longer opens a payment window at a price the sheet did not quote. `create-order` returns `referralRefused`; the page stops, says why and drops the code. The reused-order response also lacked `referralDiscountPaise`.
- [x] Owner: a referrer with no premium tag had the month banked in `referralCreditMonths` and nothing ever spent it. `redeemReferralCredit` adds it when the dashboard loads and a premium tag exists, claiming the balance before spending so concurrent loads spend it once.
- [x] Owner: the reward was read-then-write, so two friends paying together lost a month; it also wrote a dated period over an open-ended (comped) subscription. `extendPremium` is now a conditional update with retry, and open-ended tags are skipped.
- [x] Owner: nothing told them. The card now reports friends, months earned and months waiting (`referral.friends / monthsEarned / monthsWaiting`), and the approved `parktag_referral_reward` template, which no code sent, goes out after a reward lands. Held rewards are stamped on their order so the cap and the count see them.
- [x] Tests: `referral-journey.test.js` (11, HTTP end to end with only Razorpay's order mint stubbed; all fail on the old code), `referral-checkout-page.test.js` (12), 17 more in `referrals.test.js`, 4 in `referral-card.test.js`.
- [ ] After deploy: one real referred purchase on production. Check the sheet shows the discounted online price, the referrer's Premium date moves by a month, the card line appears and the WhatsApp arrives (the template has not been sent before).
- [ ] Decide whether `/shop` should show the friend's price in its sheet too. It keeps the code and the server applies it, but only `/get`, where the share link points, shows it.

## Admin nav and API tokens page, 2026-09-29

- [x] Found `/admin/promo-codes` and `/admin/reviews` had pages but no sidebar link on any page (only reachable by typing the URL). Added both links, plus API Tokens, to the sidebar on all 13 admin pages.
- [x] New `/admin/api-tokens` page (`pages/admin/api-tokens.html`, `scripts/admin/api-tokens.js`) over the existing `/api/admin/api-tokens` routes: create (name, read/write, 1-90 days), one-time reveal with copy, list with status and last used, revoke. Route added in `app.js`.
- [x] `tests/admin-nav.test.js` (no DB): every admin page links to every other and marks only itself active. Verified in Chromium against a mock API: create, reveal, escaping, revoke, 375px width, no console errors.
- [ ] Run `app-delivery.test.js` and `admin-api-tokens.test.js` in CI (they need Mongo; not run locally, no database here). `app-delivery` now expects `/admin/api-tokens` to redirect when signed out.
- [ ] `/api/admin/utm-sales` (PR 287) still has no UI; decide whether to add a table to the Traffic page.

## SMS login window countdown, 2026-09-30

- [x] Tested the owner-login "Try SMS" 10-minute window. Server side held (second send to the same number → 429). Page side did not: the window lived only in script memory, so a reload or back-navigation offered SMS again and the server's refusal showed as a bare error with no timer; a server 429 never started a countdown; tapping Resend inside the window re-enabled the button for a second; an SMS refusal was worded as a WhatsApp failure.
- [x] `reserveSmsWindow` now reads the live window's expiry and refuses with `retryAfterSeconds`; the send route returns it as `retryAfter` in the 429 body and a `Retry-After` header, with the wait spelled out in the message.
- [x] `owner/login.js` keeps the window in `localStorage` keyed to the number (`pt_sms_window`), restores it whenever that number is entered again, starts the countdown from the server's `retryAfter` on a 429, keeps Resend disabled while the window runs, and reports an SMS refusal as SMS.
- [x] Tests: six new cases in `sms-login-ui.test.js` (countdown to Resend, Resend inside window, reload persistence, per-number scoping, server 429 countdown, WhatsApp wording) and one in `sms-login-backend.test.js` (429 carries the remaining seconds). Existing cooldown test updated for the new wording.
- [ ] Manual pass with real Firebase keys: send SMS, reload, confirm the timer is still counting; wait it out and confirm Resend works.
- [x] "I'm not a robot" card overflowed the sign-in card on phones when trying SMS: Google's `normal` widget is a fixed 304px, the card leaves `viewport - 82px` (278px on a 360px phone). `firebase-sms.js` now measures the container and asks for `compact` (164px) when `normal` will not fit; the container is centred and clipped to the card. Tests in `sms-captcha-size.test.js`.
- [ ] Look at the captcha on a real phone with Firebase keys (360px and 390px wide): compact card centred on the first, normal card centred on the second.

## A reload no longer loses the checkout, 2026-10-01

- [x] Reported: the delivery address step disappears on reload. Found the cause: the step is one shared sheet (`scripts/owner/address-step.js`) opened by four pages, and only `/get` restored it. `/shop`, `/direct` and the dashboard shop closed it and lost everything typed.
- [x] The sheet keeps its own draft (fields, Cash on Delivery choice, an unticked WhatsApp box) in `sessionStorage`, so every page that opens it gets the typed address back. `/get`'s own copy of that logic is removed.
- [x] `/shop` and `/direct` reopen the delivery step on the same pack after a reload, and keep the add-on tick; `/direct` also keeps the pack counts and the typed code. Shared storage in `scripts/checkout-cart.js`.
- [x] Dashboard shop: the product sheet, the delivery step and the pack step (with its selection) each come back after a reload.
- [x] Backing out is not reopened; a paid or placed order clears everything; a reopened checkout is not counted as a new `begin_checkout`; a sold-out or junk saved pack is ignored; with storage disabled the pages behave as before.
- [x] After a reload the sheet reuses its history entry, so Back does not need two presses.
- [x] Tests: `checkout-survives-reload.test.js` (30, real pages and the real sheet in jsdom; 13 of the first 21 fail on the old code). `direct-coupon-page.test.js` harness given the new shared module.
- [x] Confirmed on the local server that `/shop`, `/get` and `/direct` serve 200 and that the new `checkout-cart.js` import is stamped and served.
- [ ] Not checked in a real browser (this Mac has only Safari, which cannot be driven without enabling remote automation). After deploy, on a phone: open `/shop`, tap Order, type half an address, reload, and confirm the step is back with the text. Repeat on `/direct` and in the dashboard shop.
- [ ] A reload while Razorpay's own payment window is open returns to the delivery step (public pages) or the pack step (dashboard), with the address still filled in. Razorpay's window itself cannot be restored.

## Checkout speed: the wait before Razorpay opens, 2026-10-01

- [x] Reported: Razorpay's window takes 2 to 3 seconds on `/shop` and 5 to 6 on `/get`. Measured production with read-only requests: every request costs about 250 ms before the app runs (edge in Singapore, app server about 170 ms beyond it), and each database trip roughly 120 to 240 ms. Guest `create-order` did its database trips, the courier lookup and the Razorpay call one after another. `/get` also re-fetched an expired reCAPTCHA token at the tap. Written up in `wiki/checkout-speed.md`.
- [x] `/get` keeps its bot-check token fresh while the delivery step is open (`scripts/fresh-captcha.js`), so the tap never waits for Google.
- [x] New `POST /api/shop/guest/warm` (pincode only, returns nothing, rate limited): the address sheet calls it when the pincode is complete and when the form is, so the courier's answer is cached and the Razorpay connection is open before the tap.
- [x] The server keeps its connection to Razorpay open between orders (`payments.js`), and `warmRazorpay` opens it early with the same read-only request the boot check uses.
- [x] Guest `create-order` starts the courier lookup, the referral lookup and the unscored-order cap alongside the bot check, and creates the Razorpay order and the order number together. Decisions are taken in the original order. One cost: an order number is skipped on the rare order Razorpay refuses.
- [x] `/shop` opens its connections to Razorpay's hosts at the tap.
- [x] Simulated with production latencies: order creation 2715 ms before, 1014 ms after when warmed (2513 ms when nothing was warmed). Tests: `checkout-speed.test.js` (22).
- [ ] **Decide on moving the Railway service to a region near the database and India.** It is the largest remaining lever and affects every page. Check the Atlas cluster region first: the app and the database must end up near each other.
- [ ] After deploy, time a real order on `/shop` and `/get` on a phone, once straight through and once after waiting three minutes on the address form.
- [ ] `/direct` still mints its bot-check token at the tap, and the signed-in dashboard checkout is unchanged. Apply the same fixes if wanted.

## Address QA: valid, invalid and unservable pincodes, 2026-10-03

- [x] Drove every route that takes an address (guest create-order online and COD, the guest COD code send, the COD address check, the owner's address save, signed-in place-cod) with valid, invalid and unservable pincodes, with Delhivery's pincode answer stubbed. Suite: `address-qa.test.js` (52).
- [x] Found and fixed, in `lib/core/address.js`: an 11-digit phone and a 7-digit pincode were cut to length and accepted; a state not on the sheet's list (e.g. "Mars", "UP") skipped the pincode check and was accepted. Phone and pincode are now matched whole; the state must be one the pincode table knows (the same list the sheet offers, pinned by a test). State labels in errors read "Jammu and Kashmir", not "And".
- [x] Found and fixed, in `routes/shop/index.js`: signed-in `place-cod` never asked whether the courier collects cash at the saved pincode (the address save only asks whether it delivers at all). It now refuses a prepaid-only pincode like guest COD does; an unknown answer still fails open.
- [x] Confirmed unchanged: a pincode from another state is refused without echoing it; an unserved pincode is refused online, for COD, at the code send and at the address save, before anything is written; a courier outage fails open. The sheet's own checks mirror the server (maxlength 10/6, a state list, India Post state cross-check).
- [x] `quantity-checkout.test.js` fixture sent `state: "UP"`, which the sheet cannot send and the server now refuses; corrected to "Uttar Pradesh". 191 neighbouring tests pass locally.

## Cash on Delivery: the wait after "Place order, pay on delivery", 2026-10-03

- [x] Reported: confirming the delivery address takes up to two seconds on `/shop` and `/get`. Paying online, the tap closes the sheet with no network call; the wait was the Cash on Delivery tap, which ran the Ola address check, a bot-check token mint and the WhatsApp code send one after another before the code screen appeared. Written up in `wiki/cod-address-tap.md`.
- [x] The code screen appears at the tap, saying the code is on its way; the send runs behind it and updates the screen, or brings the form back with the server's reason. An address Ola cannot match becomes an amber note on the code screen (the buyer may still place it); the back link reads "Change address or mobile number".
- [x] The bot-check token is minted when Cash on Delivery is chosen and kept young while the form is typed. `POST /api/shop/guest/cod-otp/send` starts the bot check, the open-order lookup and the courier's pincode answer together, deciding in the old order.
- [x] Tests: `cod-address-tap.test.js` (9, the real sheet in jsdom, no database); `guest-cod-otp-wiring.test.js` updated. `checkout-survives-reload`, `checkout-speed`, `address-suggest`, `guest-cod`, `guest-checkout-bot-gate`, `direct-coupon-page` and `guest-checkout` pass locally against the local MongoDB.
- [ ] After deploy, on a phone: choose Cash on Delivery on `/shop`, tap the button, and confirm the code screen is immediate and the WhatsApp code follows. Try a PIN from another state to see the amber note.

## Cash on Delivery: the wait after "Place order", 2026-10-03

- [x] Reported: a COD order on `/shop` takes five seconds or more to confirm. Found the cause: after writing the order, guest `create-order` waited for the Delhivery booking and pickup, the promo burn, the WhatsApp confirmation and the Meta conversion, one after another, before replying. Written up in `wiki/cod-order-speed.md`.
- [x] New `lib/core/after-reply.js`: work a route hands off after its reply, failures logged with a label, tracked so `settleAfterReply()` can wait for it. `server.js` settles it between draining HTTP and closing Mongo; `tests/helpers.js` settles it in `stopTestApp`.
- [x] Guest COD replies as soon as the order is written; the courier, the promo burn, the confirmation and the conversion run after the reply in the same order as before. The courier and address checks start before the phone lock; the order number is drawn beside the proof burn.
- [x] Signed-in `/api/shop/place-cod`: the booking and the confirmation are handed off the same way.
- [x] `/shop` keeps its bot-check token fresh while the delivery step is open for a pack that takes COD (`fresh-captcha.js`), so the tap does not wait on Google. Online orders there still send no token.
- [x] Tests: `cod-order-speed.test.js` (9, no database) and a new case in `guest-cod.test.js` (reply before the promo burn, promo still burnt). `guest-cod.test.js`, `checkout-pricing.test.js` and `checkout-low-findings.test.js` need Mongo and could not be run from this Mac (Atlas times out); CI runs them.
- [ ] After deploy, time a COD order on `/shop` on a phone, and confirm the WhatsApp confirmation still arrives a few seconds after the screen.
- [ ] `/direct` still mints its bot-check token at the tap; the server-side change covers its COD orders already.

## /get: only the Order button starts a purchase, 2026-10-03

- [x] Reported: a tap anywhere on the ₹299 or ₹399 pack card on `/get` (price, name, photo) opened the delivery address sheet. Reproduced with the real page in jsdom. Cause: PR #300 made the whole card buy ("dead taps on the price and the photo"), which reads as the page acting on its own.
- [x] `get.js`: the card no longer carries a `data-sku`, and the Order handler matches Order controls only. `begin_checkout` now always means a pressed Order button; `select_item` is no longer sent from `/get`. The dead `.gt-pack[data-sku]` cursor rule is removed from `get.css`.
- [x] Tests: `get-card-tap.test.js` (5, the real page and sheet in jsdom; the first two fail on the old code). `checkout-intent-count.test.js` updated. `get-sold-out`, `order-breakdown`, `checkout-survives-reload`, `get-page-speed`, `checkout-speed`, `direct-coupon-page` pass locally.
- [ ] After deploy, on a phone: tap the price and the photo of each pack on `/get` and confirm nothing opens; tap Order and confirm the delivery sheet opens.

## Dashboard shop: Combo and Bike packs shown as sold out, 2026-10-03

- [x] Reported: the signed-in dashboard shop on production still sold the Combo Tag and the Bike Tag, while `/shop` and `/get` show them sold out and the server refuses the order. `welcome-shop.js` hard-coded its four cards with no stock flag.
- [x] `pt-combo` and `pt-bike-1` carry `soldOut: true` in `welcome-shop.js`. A sold-out card has no tap, a grey SOLD OUT badge, dimmed artwork, and keeps its name and price. `?shop=1&sku=` links, the product sheet and a saved checkout refuse them too. Styles in `owner-welcome.css`.
- [x] Tests: `dashboard-shop-sold-out.test.js` (3, no database). `checkout-survives-reload`, `shop-sold-out`, `get-sold-out`, `checkout-low-findings`, `checkout-pricing` and `checkout-csp` pass locally against the local MongoDB.
- [ ] After deploy, open the dashboard shop on a phone and confirm the two cards read SOLD OUT and do not open.

## Razorpay netbanking: blank page at the bank, 2026-10-03

- [x] Reported: choosing netbanking in the Razorpay window shows a blank page. Cause: the page's CSP had `form-action 'self' https://www.facebook.com`. Cards, UPI and wallets stay inside Razorpay's iframe; netbanking posts a form through `api.razorpay.com` to the bank, and that directive refused the navigation.
- [x] `app.js`: `form-action` now also allows `https://api.razorpay.com` and `https://*.razorpay.com`, as Razorpay's CSP guidance lists. Nothing else widened.
- [x] Tests: `netbanking-form-action.test.js` (4). `checkout-csp`, `csp-analytics` and `login-low-findings` pass locally.
- [ ] After deploy, on a phone: pay a test order by netbanking and confirm the bank page loads. Razorpay's window taking about two seconds to open is the Razorpay script and its own frame, not this.

## Switched-off tag: an inactive screen for the scanner, no reactivation from the sticker, 2026-10-07

- [x] Reported: an owner switched Tag Active off on the dashboard; scanning the sticker opened the activation wizard ("You are about to reactivate the tag"), which sent an OTP, took the details and then failed with "Tag is not claimable". Cause: `scanner/app.js` chose the wizard from `status` alone (`unclaimed` or `inactive`), while the server only lets unowned stock be claimed, and a switched-off tag keeps its owner.
- [x] `scanner/app.js`: the wizard and the "Register to activate" chip follow the server's `claimable` flag. Any other tag that is not `active` shows the new `#tag-off-card` and stops there. The "reactivate" wording is gone.
- [x] `scanner/index.html` + `styles.css`: `#tag-off-card` says the tag is inactive and the owner has turned it off for now, with a **Get a ParkTag** button to `/get` and a small "Is this your vehicle?" link to `/owner`. No inputs, no owner data.
- [x] No server change: the toggle already keeps `ownerId`, the dashboard lists the tag while off, and `/activate` and `/claim` already refuse owned tags.
- [x] Tests: `tag-off-scan.test.js` (8). Headless Chrome at 390px: active → contact card; switched off → inactive card only, no chip, Get a ParkTag opens `/get`; still on the dashboard; switched on → contact card; unclaimed stock → wizard with chip. `wiki/tag-switches.md` updated.
- [ ] After deploy, on a phone: switch a tag off on the dashboard, scan it, confirm the inactive screen; switch it on and scan again.

## Audit items 4-6: E-Tag free call, promo usage cap, parallel guesses, 2026-10-12

- [x] Item 4, E-Tag free call reset: deleting a vehicle soft-deletes its tag, and re-adding the plate minted a new E-Tag with `freeContactUsed: false`. `createEtagForVehicle` now starts a new E-Tag from the most-spent free-call state of any earlier non-premium tag the same owner had for the same plate (deleted or live, spaces and dashes ignored), copying `freeContactsSpent`, `freeContactAllowance`, and when spent `freeContactUsed`, `freeContactUsedAt`, `trialEndedNotice`. Another account adding the plate still gets a fresh one. `wiki/etag-free-call-per-car.md`.
- [x] Item 5, promo cap checked only at order creation: unpaid orders could all carry a single-use code. Capped codes now take a hold (`holdPromoForOrder`, `promoCodes.holds`, 30 minutes, one per buyer by hashed delivery phone) before the order can be paid or placed, on guest online, guest COD, dashboard online and dashboard COD, including a reused checkout. The cap counts uses plus other buyers' live holds; `consumePromo` turns the hold into the use and logs `promo-over-cap` for a late payment it cannot refuse. A race lost between quote and hold answers 409 `PROMO_TAKEN`. Previews and storefront offers ignore holds. Uncapped codes (LAUNCH100) take none. `wiki/promo-holds.md`.
- [x] Item 6, parallel guesses past the limits: `verifyOtp` reserves the attempt with a conditional `$inc` before comparing, and marks a correct code used conditionally (one sign-in per code). `reserveLoginAttempt` replaces `getLoginLock` + `recordLoginFailure` for owner/admin login, the vault PIN and the login-PIN change check. `wiki/attempt-limits.md`.
- [x] Tests: `etag-free-call-carryover.test.js` (8), `promo-holds.test.js` (15), `attempt-limits-parallel.test.js` (9). Item 4 and 6 tests and the route-level promo tests fail on the old code. `cod-order-speed.test.js` still passes (the COD promo burn stays after the reply).
- [x] Follow-up, spray lockout: `reserveSprayAttempt` takes the identifier's place on the per-IP list before the check (`getSprayLock` + `recordSprayFailure` removed); a successful sign-in, or a refusal by the account lockout, calls `releaseSprayAttempt`. Twelve accounts may be on the list; the attempt that would add a thirteenth lands the 30-minute lock and is refused, so a sign-in that succeeds never trips it. Tests in `login-pin.test.js` (burst of 20 gets 12 checks; success comes off the list).
- [x] Follow-up, account deletion: `DELETE /api/owner/account` calls `rememberSpentFreeCalls` before removing the tags. It stores, per car whose free call was touched, HMAC(identity + plate) for the mobile and the e-mail, with the free-call counters, in `spent_free_calls` for a year (TTL). `createEtagForVehicle` matches the new account's mobile and e-mail against it. Key: `FREE_CALL_HASH_KEY`, else `META_APP_SECRET`. Tests: 4 more in `etag-free-call-carryover.test.js`.
- [ ] Decide whether the privacy policy should mention that a deleted account's spent free calls are remembered for a year as keyed hashes (no plate, number or e-mail kept).
- [ ] After deploy: re-add a deleted vehicle whose free call was used and confirm the card says "Call Used"; open two /direct checkouts on two phones with one single-use code and confirm only the first is discounted.

## Audit item 7: Google sign-in completes only in the browser that started it, 2026-10-12

- [x] The redirect sign-in's `state` was stored server-side but not tied to a browser, so a callback link started and approved by one person could be sent to another and would sign them into the sender's account (login CSRF). `GET /api/auth/google` and `/api/auth/admin/google` give the browser a random id in `pt_google_browser` (HttpOnly, SameSite=Lax, path `/api/auth/google/callback`, 10 minutes, reused across tabs) and store each state with a hash of it. The callback consumes a state only for the browser that started it, leaving it in place otherwise, and answers `invalid_state` on a mismatch. Sign-ins started in two tabs both complete. `wiki/google-oauth-state.md`.
- [x] Tests: `google-oauth-state.test.js` (8: forwarded link refused, another browser's id refused, two tabs both complete, no replay).
- [ ] Sign-ins in flight at the moment of deploy (stored without a browser hash) fail once with `invalid_state`; the person just tries again.
- [ ] After deploy: sign in to /admin with "Continue with Google" and confirm it still lands on the overview.

## Audit item 8: membership checkout names the premium tag it goes on, 2026-10-12

- [x] `POST /api/owner/membership/create-order` refused an owner with more than one tag ("Choose which tag…") and the page only sent `{ planId }`, so an owner with two vehicles could not buy. It also counted free E-Tags, so an E-Tag-only owner was charged for time that gives an E-Tag nothing (`call-access.js` and `vault.js` decide an E-Tag's access before any subscription; activation writes only `subscription`).
- [x] Server: only live premium tags can carry a membership. One premium tag is chosen silently; several need `tagId` (`CHOOSE_TAG` with choices); none is refused (`NO_PREMIUM_TAG`); an E-Tag id is refused (`NOT_PREMIUM`). `GET /api/owner/membership` returns `tags` (premium only, with each one's `coveredUntil` and `trial`).
- [x] Page: "Choose Your Vehicle" picker (navy rows like the plan cards) for 2+ premium tags, preselecting the one whose cover ends first; the cover note names the chosen vehicle; `tagId` is always sent; with no premium tag the button is off and the note says why. `wiki/membership-tag-choice.md`.
- [x] Tests: `membership-tag-choice.test.js` (9: 6 routes against Mongo, 3 on the real page in jsdom; 7 fail on the old code). `membership.test.js` fixture is now a premium tag. Headless Chrome at 320 and 390 px: two tags (picker, chosen `tagId` sent), one tag (no picker), none (button off); no horizontal overflow, no script errors.
- [ ] After deploy, with an account holding two premium tags: open /owner-membership, pick the second vehicle, pay a test plan and confirm the date moves on that vehicle only.

## Audit item 9: the dashboard's Retry button reloads, 2026-10-13

- [x] When `/api/owner/dashboard` failed, the error card drew `<button onclick="load()">`. `welcome.js` is loaded as a module, so `load` is not a global: every tap threw `ReferenceError: load is not defined` and nothing reloaded. A server error (5xx) never reached that card; it drew only "Add Vehicle", telling an owner with vehicles that they had none.
- [x] `welcome.js`: a non-OK response (other than 401/403, which still go to sign-in) is a failed load and shows "Couldn't load your vehicles." with Retry. Retry is bound with `addEventListener` after the card is drawn, so it works on every failure, including a second one in a row.
- [x] Tests: `dashboard-retry.test.js` (2) runs the real `load()` in jsdom with inline handlers on and none of its names global; both fail on the old code (one with the exact ReferenceError). Headless Chrome on the real page at 320 and 390 px: dropped connection → Retry → vehicles; 500 then 503 then OK → Retry twice → vehicles; no script errors, no horizontal overflow. The old file in the same run threw "load is not defined" and showed only "Add Vehicle" for a 500.
- [ ] After deploy, on a phone: open the dashboard in airplane mode, turn the connection back on, tap Retry and confirm the vehicles appear.

## Audit item 10: a friend's referral link survives into the dashboard checkout, 2026-10-13

- [x] `POST /api/shop/create-order` (the signed-in checkout) read `ref` and the dashboard never sent one. A friend who opened a `/get?ref=` link and tapped "Sign in", or a signed-in owner sent through `/shop?ref=` (the redirect dropped it), paid full price and the referrer earned nothing. The route also checked the code against the account only, not the delivery phone, and never said why a code was not applied.
- [x] Server: create-order resolves the code after reading the address, against the account and the delivery phone (as the guest route does); replies carry `referralDiscountPaise` and `referralRefused` on new and reused orders; an unpaid order is reused only for the same referrer. `/api/shop/referral/check` refuses a signed-in owner's own code. `/shop` carries a well-formed `ref` into `/owner-welcome?shop=1&ref=` (`referralCodeShape`).
- [x] Page: `welcome.js` imports `referral-link.js` (parks a `?ref=` from its own address) and hands `ptReferralCode` / `ptClearReferralCode` to the classic `welcome-shop.js`. The pack sheet asks the referral check, shows "Friend's link applied: ₹50 off when you pay online" with the online total (Cash on Delivery priced without it), sends `ref`, stops before Razorpay if the server refused it (with the reason, code dropped), and forgets the code once an order is placed, as `/get` does.
- [x] Tests: `dashboard-referral.test.js` (13: 8 routes against Mongo incl. verify-payment and the friend's month, 5 on the real page in jsdom with the real `referral-link.js`); 12 fail on the old code. Headless Chrome at 320 and 390 px: `/get?ref=` then the dashboard in the same tab, sheet shows ₹449 online and ₹548 COD, `ref` sent; a refused code stops with the reason and the total returns to ₹499; no script errors, no horizontal overflow. `wiki/referral-flow.md` updated.
- [ ] After deploy: open a friend's `/get?ref=` link signed out, tap Sign in, buy from the dashboard shop online and confirm the ₹50 off and the friend's month.

## Audit item 12: a token cannot bring a big promo code back to life, 2026-10-13

- [x] `POST /api/admin/promo-codes/:code/activate` skipped `promoLimitError`, so a token (hand-minted or OAuth, e.g. Claude's `parktag_set_promo_active`) could put back on sale a code an admin had made big and revoked: 100% off, unlimited, no expiry, a website offer.
- [x] The route now reads the code and, for a token, judges it whole with `promoLimitError` (as if creating it) before switching it on; a refusal is 400 with the reason and the code stays off. A signed-in admin is not limited; an unknown code is still 404.
- [x] Found while fixing it (the user chose to fix it here): `PATCH /api/admin/promo-codes/:code` judged a token's edit field by field, so an admin's used-up, expired 100%-off code came back for 1000 uses until 2030 through `maxUses: 1000` and a later `expiresAt`, each fine on its own (checked on the real routes). `promoLimitError` now takes the code as it stood: while the edited code is still beyond the limits as a whole, a token may not widen it (more uses, counting single-use; later expiry; earlier start; other or no bound phone; more or all packs; hand-over to ship). Narrowing and shipping still work; an edit that brings the code within the limits as a whole goes through.
- [x] Tests: `promo-token-revive.test.js` (10: activate and edit; 5 fail on the old code, the 5 that pass guard what must keep working). `mcp-guards.test.js` unchanged and passing. `docs/ADMIN_MCP.md`: limits table lists switching a code on and website offers; the editing paragraph says what a token may and may not do to a code beyond its limits.

## Owner dashboard: stay signed in, 2026-10-08

- [x] Reported: owners had to sign in again whenever they closed the browser or the phone cleared it. Cause: the session cookie was persistent only with "Remember me", which only the PIN form sent; OTP, Firebase SMS, Google and activation sign-ins all set a browser-session cookie.
- [x] `lib/auth/session.js`: owner sessions live 30 days from last use and slide on use (`renewIfDue`, at most one write a day), capped at 180 days from sign-in. `writeSessionCookie` takes the session role; an owner cookie gets `Max-Age` of 180 days, any other role ends with the browser.
- [x] Every sign-in path passes its role: `credentials.js`, `otp.js`, `firebase.js`, `google.js` (admin Google sign-in passes `"admin"`), `/activate` in `public/index.js`.
- [x] Owner login page: "Remember me on this device" removed; `rememberMe` from an old cached page is ignored.
- [x] Admin unchanged: 12 hours, browser-session cookie, no slide.
- [x] Tests: `owner-stay-signed-in.test.js` (9); `admin-hardening.test.js` passes. Full suite: see PR.
- [x] `PLAN.md` auth model and `wiki/owner-sessions.md` updated.
- [ ] After deploy, on a phone: sign in with a code, swipe the browser away, reopen `/owner-welcome` and confirm the dashboard opens without a code.

## Backup number: confirm before saving, tell the backup person, let them say no, 2026-10-08

- [x] Owner's ask: no OTP on the backup number, but catch typos and get the backup person's consent.
- [x] Dashboard menu and vehicle page: Save opens a pop-up over the blurred page ("Is this number right?", the number large, Yes, save / Edit number). The dashboard menu stays open behind it; Edit number, Escape or a tap outside go back with what was typed kept. A stale error under the row is cleared when it opens.
- [x] `lib/core/backup-contact.js`: after a save, one WhatsApp to the backup number (`parktag_backup_contact_v1`), once per number, max 5 a day per owner, never blocking the save. Token hashed on the owner (`backupNotice`).
- [x] `/backup/<token>` page + `POST /api/backup-contact/decline`: removes the number (if still the backup), blocks it for that owner (`backupDeclinedMobiles`), dashboard shows "asked not to be your backup" until a new number is saved. Opening the link removes nothing.
- [x] Template copy in `docs/WHATSAPP_TEMPLATES.md` 2.12, `scripts/create-backup-contact-template.js`, added to `verify-whatsapp-templates.js`.
- [x] Tests: `backup-contact-consent.test.js` (12); `backup-number.test.js` passes. `wiki/backup-number.md` updated.
- [x] Submitted to Meta 2026-10-08: id 1569004908362271, PENDING, UTILITY (WABA 276277365570926).
- [x] APPROVED and UTILITY (checked in the account, 2026-10-08). Live once this branch is deployed.
- [ ] After deploy and approval: save a backup on a test account, check the WhatsApp arrives, tap Remove my number, check the dashboard row.

## Add Your Vehicles: sticker code box removed, 2026-10-09

- [x] Found in QA: the "Link sticker code (optional)" box on `/register-owner` could not link any real sticker. It took exactly 12 characters, upper-cased them and redirected to `/vehicle/<CODE>`. That was the QR token format until `c1e30f4` (26 Jun 2026); every sticker since carries a 64-character lowercase token, and the printed serial (`PT-01-004242`) was refused as "must be exactly 12 characters". Headless Chrome: printed serial, pasted token, pasted QR link and a 12-char mixed-case code all failed; every redirect ended on "Tag not found".
- [x] Side effect found: a vehicle typed above the box was put in `pt_pending_vehicles` before the redirect, and the dashboard's `syncLocalVehicles` then created a free E-Tag for it, so a failed sticker link turned into an E-Tag.
- [x] `register.html` / `register.js` / `owner-register.css`: the box, its divider and its skeleton rows are gone; one line in their place: "Have a ParkTag sticker? Scan the QR on it with your phone camera to activate it." Submit now only needs a vehicle ("Add at least one vehicle.").
- [x] `scanner/app.js`: the not-found card keeps the markup's sentence ("This QR code could not be linked to an active vehicle…") instead of copying the server's "Tag not found" under the "Tag not found" heading.
- [x] Tests: `register-no-sticker-code.test.js` (4). `scanner-network-resilience`, `csp-analytics`, `app-delivery`, `tag-off-scan` pass; full suite 2133 pass / 0 fail / 3 skipped. Headless Chrome at 390px (13/13): form without the box, hint shown, empty submit message, vehicle → E-Tag pop-up → dashboard with one E-Tag, scanning stock still opens the wizard, not-found card explains itself. `wiki/sticker-code-box.md`.
- [ ] Not changed, noted: `/register-owner` saves plates with spaces (`DL 09 QA 7373`) while `/activate` strips them, and `createEtagForVehicle` matches the exact text, so the same vehicle can hold a sticker and an E-Tag. Decide whether plates should be compared without spaces.
- [ ] After deploy, on a phone: open Add Vehicle from the dashboard, confirm the sticker box is gone and the scan line shows; add a vehicle and confirm the E-Tag flow is unchanged.

## Audit task 1, bugs 1-3: alerts to the old number, calls after switch-off, reviving a deleted tag, 2026-10-10

- [x] Bug 1: after an owner changed their number, the WhatsApp scan alert, the locked-tag nudge and the trial-ended notice still went to the old one. They read `owner.phone || owner.mobile`, and `POST /api/owner/mobile` wrote only `mobile`. The three senders now read `mobile` first, like every other sender, and the change-number route writes `phone` with `mobile`, as every signup path does.
- [x] Bug 2: a call route registered before the owner switched off still rang them for its ten minutes, because Dial Whom never read the tag again. Dial Whom now re-reads the tag for scanner routes: a private call needs the tag active, not deleted and calls not paused; an Emergency call needs it active and not deleted. The owner's own call back to a scanner is unchanged.
- [x] Bug 3: `POST /api/owner/tags/:tagId/status` could switch a deleted tag back on, making it scannable while hidden from the dashboard. It now matches non-deleted tags only (404 otherwise), as the admin route already did.
- [x] Tests: `tag-off-live-route.test.js` (10) and `owner-mobile-change.test.js` (2). Every bug-specific test fails on the old code. The senders' recipient cannot be observed in a test run (`external-guard.js` refuses WhatsApp sends), so bug 1 is pinned at the route.
- [ ] Not done here: owners who changed their number before this fix still hold the old number in `phone`. Alerts now go to `mobile`, but owner lookups that match either field (the WhatsApp opt-out webhook, the one-number-one-account guard) still match the old number on those rows until a backfill sets `phone = mobile`.
- [ ] After deploy: register a private call from a phone, switch Tag Active off on the dashboard, dial the virtual number and confirm a busy tone.

## Audit item 11: the activation queue answers the MCP tool's page, 2026-10-13

- [x] `parktag_activations` offered `page` and `GET /api/admin/activations` ignored it: every call returned the whole queue, cut at the 60,000-character MCP reply limit, so buyers past the cut could not be read.
- [x] Route: `?page=<n>` returns 25 rows a page, waiting longest first, with `page`, `pages`, `pageSize` and `total`; `counts` always cover the whole queue; past the end is the last page, junk is page 1 (`listPage` now takes a page size). Without `page` the reply is unchanged, so the Activations page still gets the whole queue.
- [x] MCP tool: `page` defaults to 1 and the description says what the list is (sold orders waiting for activation, not "premium tag orders and whether activated") and that it is 25 a page.
- [x] Tests: `admin-activations-paging.test.js` (2: the route's pages together equal the queue in order; the tool's `page` reaches the route over `/mcp` with a read token); both fail on the old code. `admin-activations`, `oauth-mcp` and `admin-api-tokens` still pass. `wiki/activation-queue.md` updated.

## Audit item 13: Mixpanel contact_action and /claim tag_activated fire on what happened, 2026-10-13

- [x] `contact_action` (a scanner reached the owner) was sent by `register-call` and `register-emergency-call`, which only hand the scanner a number to dial; scanners who never dialled were counted. AGENTS.md: never fire before the action succeeded.
- [x] Now sent from Exotel's dial-whom webhook when the call is actually placed, once per registration (first ask; `dialRequests` comes from the atomic `$inc`, so racing asks cannot both count). `callContactEvent` in `lib/core/contact-actions.js` decides: `scanner_to_owner` → `call`, `scanner_to_emergency` → `emergency_call`; the owner's callback (`owner_to_scanner`), redials and backup legs are not counted. The WhatsApp `message` event was already sent only after a delivered alert and is unchanged.
- [x] `/api/tags/:token/claim`: `tag_activated` now skips the team's own numbers (`isInternalPhone`), as `/activate` does.
- [x] Tests: `mixpanel-contact-timing.test.js` (6: the decision, and where each route reports; a test run never sends to Mixpanel, so the routes are read as source like `analytics-asset.test.js`); all fail on the old code. The 18 existing call/claim test files pass (263 tests). AGENTS.md tracking plan row updated.
- [ ] After deploy, in Mixpanel Live View: register a call without dialling (no `contact_action`), then dial (one `contact_action`, method `call`).

## Two tests that failed without a regression, 2026-10-13

- [x] `app-funnel.test.js` "app views are separable from landing views": the test inserts a landing row (`visitorHash: qa-landing-visitor`) and its cleanup removed only `site: "app"` rows, so the row outlived every run and the next run counted two. Cleanup now removes this file's rows of both kinds; three runs in a row pass.
- [x] `login-hardening.test.js` timing tests: a fixed 60ms / 120ms allowance on a bcrypt comparison that a busy machine runs at 190-800ms, so load alone failed it (bcrypt=743ms legacy=703ms none=817ms in a full run). The allowance is now half of one comparison measured in the same run (old values as the floor). A path that skips the check still fails: measured 263ms gap against a 131ms allowance.

## Audit item 14: the unreachable owner dashboard page and its code, 2026-10-14

- [x] `pages/owner/dashboard.html` was served by no route (the static server refuses `pages/`, and app.js never loads it), so no URL could open it. Deleted.
- [x] `scripts/owner/login.js` code that only that page used: `renderDashboard`, `loadOwnerDashboard`, `logoutOwner`, `clearOwnerLocalCache`, `requestSticker` (and its `window` global), `updateTagStatus`, `openMenu`, `closeMenu`, `shareQr`, `esc`, their nine bindings and the dashboard load. Every element id they bound existed only in that page. `welcome.js` keeps its own menu, sign-out and cache clearing; the welcome page never loads login.js.
- [x] `styles.css`: the rules for the 33 classes only that page used (QR and vehicle cards, what's-next list, menu drawer, active badge, notice banner, bottom bar, empty hint, `.pt-hub-main`, `.pt-reg-title`/`-sub`), lines ~2831-3301, outside item 21's range. No page, script or test uses them. `.pt-header` stays (seven live pages); its section comment now says so.
- [x] `session-back-navigation.test.js` checked a sign-out in login.js too; now welcome.js only (the one that exists). Login tests pass (41). Headless Chrome on the real login page at 320 and 390 px: the error message shows, a mobile number sends the code and opens the code step, no script errors, no overflow.
- [x] `POST /api/owner/tags/:tagId/request-sticker` had that page's "Request printed sticker" button as its only caller; it now has none. Removed in audit item 18.
- [ ] `landing/public/brand-guideline/ui_kits/owner-app/` recreates the deleted page as its "Dashboard" screen (README, `DashboardScreen.jsx`). A design reference, not app code; left as is. Decide whether the kit should show `welcome.html` instead.

## Audit item 15: the unused Exotel client and its env settings, 2026-10-14

- [x] `lib/integrations/exotel.js` (`triggerExotelCall`, `sendExotelSms`, `sendExotelMessage`, `isExotelSmsConfigured`) was imported by nothing: calls are inbound Dial-Whom since M13 and messaging is Meta. Deleted.
- [x] `env.js`: removed `exotelApiBaseUrl`, `exotelStatusCallbackUrl`, `exotelSmsSenderId`, `exotelSmsDltEntityId`, `exotelSmsTemplateId`, read only by that file. `EXOTEL_ACCOUNT_SID`/`API_KEY`/`API_TOKEN`/`CALLER_ID` stay (runtime status, scanner and owner call routes). `.env.example` updated; its webhook-secret comment now says both callback URLs live on the Exotel flow.
- [x] Docs that named the file or the removed settings: README (tree, verify-script note), PLAN.md 14.3/14.6, `wiki/telephony-messaging-assumptions.md`, M7 above. Older audit write-ups (survey.md, docs/SAMPARK_GAP_ANALYSIS.md, docs/DEVELOPER_BRIEF.md, PERFORMANCE_AUDIT.md) left as historical records.
- [ ] Optional after deploy: the five variables can be deleted from Railway. Leaving them set is harmless; nothing reads them.

## Audit item 16: the scanner's unreachable WhatsApp panel and its missing status line, 2026-10-15

- [x] `pages/scanner/index.html`: the old WhatsApp panel (`#message-panel`: template select, message editor, "Send to owner") could never open. `openWhatsAppPanel` and `handleTemplateSelection` in `scripts/scanner/app.js` had no caller, and nothing read the message box. The live WhatsApp tile opens the reason step (`openReasonStep`) and sends its own text. Removed the panel, both functions, `DEFAULT_MESSAGE`/`MESSAGE_TEMPLATES`, and the hide/reset/disable lines that only touched the panel's elements.
- [x] `app.js` wrote five page states to `#scanner-load-status`, an element removed in the scanner redesign (0666d97), so the text went nowhere. Removed the five writes; each state already shows its own card (error, switched off, activation, contact).
- [x] `styles.css`: `.pt-textarea` and `.pt-btn-whatsapp` were used only by that panel; removed. The unused `.message-panel` class rule sits in the legacy block item 21 removes.
- [x] Scanner tests (11 files, 107) pass. Headless Chrome on the real `/vehicle` page at 320 and 390 px: active tag shows the contact card and the WhatsApp tile opens the reason step; switched-off, not-found and no-token states show their cards; no script errors, no overflow.

## Audit item 17: admin page dead code and the demo seed that could never be authorised, 2026-10-15

- [x] `scripts/admin/index.js`: `setReadyState` had no caller (and no page has `#admin-ready-card`); `seedAdminDemo` was bound to `#admin-seed-button`, which no admin page has. Both removed with the binding. The local-dev sign-in error told people to click "Seed demo setup", that missing button; it now points at `/verify`.
- [x] `/verify` (non-production dev view): the Seed demo data button posted `{}`, but `POST /api/demo/seed` refuses anything without `DEMO_SEED_SECRET` (`routes/system/demo.js`), so it could only answer Forbidden. The page now has a secret field, sends `{ secret }` exactly as typed, and asks for it instead of posting when it is blank. The route is unchanged.
- [x] Same empty body elsewhere: `scripts/verify-admin-registration-visibility.js` now sends `DEMO_SEED_SECRET` from its environment (and stops with a clear message without it; the script was then removed in item 18); README's curl example sends `secret`. `.env.example` called the secret optional; without it the route is disabled.
- [x] Test: `demo-seed-secret.test.js` (3; all fail on the old code). Headless Chrome on the real `/verify` and `/admin` at 320 and 390 px: blank secret posts nothing and says so; the route's refusal is shown; the right secret is sent in the body; the admin hint points at /verify; no script errors, no overflow.

## Audit item 18: routes nothing called, 2026-10-15

Each route was checked against the repo's pages and scripts, the MCP tools, the API-token allowlist, the landing site and links; the owner decided which go.

- [x] Removed `POST /api/auth/firebase-phone/verify-token` and `GET /api/auth/firebase-phone/recaptcha-key`: the login page sends with `/send` and `/verify` and uses Firebase's own reCAPTCHA widget (`/api/auth/firebase-config` stays).
- [x] Removed `POST /api/tags/:token/claim`, the e-mail-and-password activation; the scanner wizard uses `/activate`. Its three now-unused imports went with it, and the `/activate` comments that pointed at it now stand alone. AGENTS.md: `tag_activated` comes from `/activate` only.
- [x] Removed `POST /api/register-owner` (`routes/owner/registration.js`, no page called it; the `/register-owner` page itself stays) and `scripts/verify-admin-registration-visibility.js` with its `verify:admin-registration` npm script, which only exercised it (and never sent the OTP the route required). With both account-creating routes gone, `findOwnerHoldingMobile` and `createRegisteredOwnerTag` had no caller and were removed; one number per account is still held by `resolveOwnerByVerifiedMobile` and the `mobile_unique` index.
- [x] Removed `GET /api/admin/etag-activations`: no admin page, MCP tool or token used it. The Activations page reads the same list from `/api/admin/activations/recent?type=etag` (same filter), and the tag-batches tests now check that route.
- [x] Removed `POST /api/owner/tags/:tagId/request-sticker` (left over from item 14).
- [x] Kept, by the owner's decision: owner Google sign-in (`/api/auth/google`, callback, `/config`, `/credential`, `/popup`), so a button can come back; `/api/admin/overview` (API-token allowlist); `/api/shop/reviews` and its photo route (where approved reviews are served); `/api/admin/mcp-calls` (AI connector audit trail).
- [x] Tests: `removed-routes.test.js` (11: the six answer 404, the kept neighbours still answer; the six fail on the old code). `one-number-one-account`, `marketing-demo-tags` and `mixpanel-contact-timing` now check the same rules on `/activate` instead of the removed routes. `marketing-stock.js`'s comment on why passwordHash is ignored no longer says the activation flow always sets one.

## Audit item 19: exports nothing uses, 2026-10-15

- [x] Removed, no caller anywhere (app or tests): `findCanonicalDuplicates` (identity.js), `MARKETING_ACTIVATED_STATUS` (marketing-stock.js), `membershipIncluded` (membership-plans.js, with the two vault imports only it used), `withCollections` (message-log.js, with its `getCollections` import), `isStaticAssetUrl` (request-policy.js; `isQuietUrl` holds the same pattern), `isOlaMapsConfigured` (ola-maps.js), `STICKER_PRICE_INR` (payments.js; its upgrade route went in M18).
- [x] Removed, only tests called them: `shouldOfferCallback` and `wasAnswered` (call-outcome.js), a server copy of the callback rule the page decides in `callback-eligibility.js`; the call-outcome tests now ask that real rule (`pageOffersCallback`). `hasOpenServiceWindow` (messaging-consent.js): no campaign orders by it; the webhook still stamps `waWindowOpenUntil` through `serviceWindowUntil`, and nothing reads it yet. `toE164Digits` (phone.js): its own comment said nothing used it.
- [x] Kept on purpose: `canSendMarketing`, the owner marketing gate that `docs/WHATSAPP_TEMPLATES.md` 2.8 names for the planned locked-tag offer template; `settleEmergencyAlerts`, `settleScannerLocations`, `settleTrialEndedNotices`, test hooks marked "Tests only" that let tests wait for background work instead of polling.
- [x] Affected tests (7 files, 167) pass.

## Audit item 20: unused locals, an unused setting, and the plaintext-OTP fallback, 2026-10-15

- [x] `integrations/email.js`: `vehicleLine` in the scan-report e-mail was built and never used (the plate is already shown in the reason box). Removed.
- [x] `integrations/car-map.js`: unused `readFileSync` import removed.
- [x] `env.js`: `superAdminBootstrapKey` (`SUPER_ADMIN_BOOTSTRAP_KEY`) was read and never used. Removed, with its `.env.example` entry. Optional after deploy: delete it from Railway; nothing reads it.
- [x] `auth/otp.js`: `verifyOtp` still accepted a token holding a plaintext `code` (no `codeHash`), a fallback for codes issued before hashing (ac2fb02, 17 Aug 2026). Codes live ten minutes, so none can still exist; the branch only meant a planted plaintext row could be opened. Such a token is now refused (after a burnt hash comparison, so it answers as slowly as a real check, and the attempt still counts). `safeEqual` import dropped.
- [x] `otp-storage.test.js`: "a code issued before the change still verifies" is now "a token holding a plaintext code is never accepted" (fails on the old code). Affected tests (13 files, 164) pass.
- [x] Checked and kept: `referralSummary` in `routes/owner/dashboard.js` is used (a spread call), despite looking unused to a quick scan.

## Audit item 21: dead CSS, 2026-10-15

- [x] Every rule in `admin.css`, `styles.css` and `owner-welcome.css` was checked by parsing its selectors: a selector is dead when a class or id it needs (outside `:not()`) appears in no page, script or server-rendered string under `src/`, and cannot be built at runtime from a string prefix (`pt-addr-`, `cbBtn-` and the rest were found and honoured; the bare `"pt-" +` in analytics.js builds an event id, not a class).
- [x] Removed: `admin.css` 99 rules (the old registration/activation/premium-activation screens, logo, reason-callback, sticker card, step strip, unused admin button and badge variants, stat/monitor cards); `styles.css` 121 rules (the legacy shell, admin sidebar, scanner choice cards, call popup, plate guide and dial panel, `.pt-btn-line`, unused loading-ring variants); `owner-welcome.css` 31 rules (`.pt-slide-ph*`, `.pt-slide-blank*`, the vehicle-card status dot and pill, `.wl-pt-*` except `.wl-pt-etagline`). 19 selector lists lost only their dead selectors; @media blocks left empty went; 14 comments that described only removed rules went with them. About 1,580 lines.
- [x] Proof nothing visible changed: the real app served 33 pages (scanner, owner, admin and public) in Chrome at 390 and 1280 px, each loaded with the old and the new stylesheets, and every element's computed style (with ::before/::after) compared. All identical; the one difference was a spinner's rotation caught at a different moment. No script errors.

## Audit item 22: README and .env.example said things the code does not do, 2026-10-15

- [x] README checked line by line against the code (every route against the registered routes, every variable against `env.js` and the scripts). Fixed: Firebase SMS sign-in is live (`/api/auth/firebase-config`, `/firebase-phone/send`, `/verify`), not removed, and the old hardcoded key's history note now says it is expired (checked against Google on 2026-10-15); `render.yaml` and `/hub` no longer exist; the print export is `POST`; `/api/session` is the session route; production refuses to start without seven variables, not one; env.js reads `~/.parktag/.env` (or `PARKTAG_ENV_FILE`) and only falls back to the repo `.env`; the shop table now matches `SHOP_PRODUCTS` (8 packs, bike and combo sold out) and names where prices are shown (`/api/shop/public-catalogue`, `/api/shop/pricing`, the first-paint copies in `welcome-shop.js` and `get.html`), not `welcome.html`.
- [x] Also wrong and fixed: `/register-owner` adds vehicles for a signed-in owner (accounts are made at sign-in); the scanner asks for the plate's last 4 digits (a call also takes the finder's number), not a phone number first; free calls are spent only by a connected call, never by WhatsApp, and premium calls freely for 12 months then needs a membership; the tag lifecycle no longer mentions the removed claim route; the seed also makes an unclaimed tag; the Razorpay webhook is listed with the other webhooks and deploy URLs; layout, milestones (M1…M19) and project status brought up to date.
- [x] `.env.example`: added the 13 variables the app reads but the file lacked (`RAZORPAY_WEBHOOK_SECRET`, the four reCAPTCHA keys, `META_CAPI_ACCESS_TOKEN`, `META_CAPI_TEST_EVENT_CODE`, `DELHIVERY_PICKUP_TIME`, `OLA_MAPS_API_KEY`, `SCHEDULER_ENABLED`, `CAMPAIGN_DRY_RUN`, `REVIEW_REQUESTS_ENABLED`, `INTERNAL_TEST_PHONES`) plus the script-only `WHATSAPP_TEST_TO`; removed `REVIEWER_SETUP_*` (its route is gone); marked the production-required ones. Every variable read in `src/` is now listed except `PARKTAG_ENV_FILE` (it picks the file, so it is documented in the README) and `RAILWAY_GIT_COMMIT_SHA` (set by Railway).

## Owner app as a PWA (installable dashboard), 2026-10-16

Branch `feat/owner-pwa` (worktree `parktag-pwa`, off origin/main d484fc8). Stage 1 of the app plan: the owner pages install to the home screen; the scanner and shop pages stay plain. Details and the live checklist in `wiki/owner-pwa.md`.

- [x] `src/frontend/manifest.webmanifest`: name ParkTag, `start_url` `/owner` (signed-in owners land on the dashboard, others on sign-in), `display: standalone`, scope `/`, theme `#03162D` (the dashboard header navy), background `#F1F1F0` (the page body).
- [x] Icons `images/pwa-icon-{192,512}.png` (purpose `any`, the round logo) and `pwa-icon-maskable-{192,512}.png` (full-bleed navy, logo in the 80% safe zone), made from `icon.png` with System.Drawing; the method is in the wiki.
- [x] Service worker `src/backend/assets/sw.js`, served at `GET /sw.js` (stamped `__SW_VERSION__` = asset version + offline page digest, `Cache-Control: no-cache`, ETag/304). It intercepts page loads only, to show `/offline` when the phone has no connection; scripts, styles, images and `/api` are never touched, so no-store pages stay uncached. `lib/core/pwa.js` holds the version helper. The source is under `src/backend/assets` so it is not reachable unstamped.
- [x] Offline page `pages/offline.html` at `GET /offline`: everything inline (the worker keeps one copy; a stylesheet it had to fetch would not arrive), a Try again link to `/owner`.
- [x] `scripts/pwa.js` on every owner page (versioned like the other scripts, a classic file so the strict sign-in CSP allows it): registers the worker; on the dashboard turns Chrome's install offer into an "Install the ParkTag app" row in the menu drawer (`#menuInstallRow`, new App section, hidden until the offer, hidden again after install). On pages without the row Chrome's own offer is left alone; Safari never fires it, so on iPhone the row stays hidden (Share, Add to Home Screen).
- [x] Every `pages/owner/*.html` head: manifest link, `mobile-web-app-capable`, `apple-mobile-web-app-capable`, status-bar style, `apple-mobile-web-app-title`, the script. No `theme-color` meta, so the ordinary website's address bar colour is unchanged.
- [x] `tests/owner-pwa.test.js` (12 tests): manifest shape and content type, every icon a real PNG with both purposes, `/sw.js` stamped + no-cache + 304, `/assets/sw.js` 404, offline page self-contained, every owner page (6 signed-out, 4 signed-in) carries the tags with a 12-hex stamp, `pwa.js` immutable, the drawer row present and hidden, the strict sign-in CSP still has `self` and no `unsafe-inline`, `/get` `/shop` `/verify` `/offline` carry none of it. Full suite 2295 tests: 2292 pass, 0 fail, 3 skipped.
- [x] Headless Chrome (mobile viewport) against the app on :3100 with a minted owner session: worker active at scope `/`, one cache named by version holding `/offline`, `/owner` lands on the dashboard, the row hidden until a simulated install offer, tapping it prompts and hides the row, flight-mode navigation shows the ParkTag offline page, `/api` not served offline, back online the same link returns the dashboard, sign-out still works, `/get` untouched. 22/24 checks; the 2 misses are the pre-existing Razorpay risk-detection script the CSP blocks by design.
- [ ] Live, after deploy (cannot be done headless): install from Android Chrome and iPhone Safari; open the installed app in flight mode; from the installed app try Continue with Google and a Razorpay netbanking payment (both leave the origin and must come back).
- [ ] Later, not in this change: Play Store listing via Bubblewrap/TWA (`/.well-known/assetlinks.json` + Play account); push notifications (WhatsApp already delivers scan alerts).

## Refer & Earn banner links to the referral offer, 2026-10-16

- [x] Dashboard carousel slide 2 (`banner-2.webp` / `banner-2-desktop.webp`, "Good Drivers Know Good People. Refer & Earn") is now a link: the whole picture, phone and desktop cuts alike, is an `<a class="pt-slide-link" href="#referralCard">` that calls `goToReferral()` (`welcome.js`). It scrolls the "Give ₹X, get a free month" card into view, centred, with a one-second red lift (`.pt-ref-flash`, off under reduced motion) so the offer is found at a glance; the URL does not jump to `#referralCard`. A hidden card (no code minted) makes the tap a no-op.
- [x] `referral-card.test.js`: +2 (slide 2 wraps both artwork cuts in the link; the function scrolls and flashes when the card is shown and does nothing while hidden). Related suites 53/53.
- [x] Headless Chrome on the dev server, signed in, 390 px and 1280 px: the card starts below the fold, clicking the slide brings it fully into view with the highlight, URL unchanged, no page errors.

## Password reset: sign out every other device, sign this one in, 2026-10-16

Branch `feat/password-reset-signs-in` (off origin/main d484fc8). What modern apps do after a reset, and what the reset route did only in part.

- [x] `routes/auth/password-reset.js`: after `resetPassword()` the route calls `revokeSessionsForUser()` (Mongo rows and this instance's cache, so a stolen session dies now, not at the next 30-second re-check), then mints a fresh owner session for the device that proved it owns the email (`signInMethod: "password_reset"`, usual 180-day cookie) and answers `{ ok, signedIn }`. Session creation is best-effort: a failure still leaves the password changed and the page falls back to its sign-in link.
- [x] `lib/auth/password-reset.js`: no longer deletes session rows itself (that left the cache warm and gave the cache-aware revoke nothing to evict); burns every unused reset link for the address, not only the one used; sends the changed-password notice, detached like the reset mail; returns the owner. Stale "7-day TTL" comment gone.
- [x] `lib/integrations/email.js`: `buildPasswordChangedEmail()` (pure, tested) and `sendPasswordChangedEmail()`: "Your ParkTag password was changed", other devices signed out, red "Reset my password" button to `/forgot-password` for the case where it was not the owner.
- [x] `reset-password.html` / `reset-password.js`: success state now says this device is signed in and every other device is signed out, button "Go to my dashboard" (`/owner`); when the server says `signedIn:false` the copy and button fall back to sign-in.
- [x] `AGENTS.md`: `password_reset` added to the `owner_signed_in` methods.
- [x] `tests/password-reset-sessions.test.js` (4): two warm sessions die at once and this device gets a new id with the owner cookie, old password refused and new accepted; a second pending link is refused after the reset; only one session row remains and it is the cookie's; the notice escapes the name and links to forgot-password.
- [x] Headless Chrome on :3100 with maildev: phone signed in, laptop does forgot, opens the emailed link, sets the password, sees the signed-in copy, Go to my dashboard lands on the dashboard; phone's /api/session is null and /owner redirects to sign-in; the notice email arrives with the undo link; old password 401, new 200; no page errors. 14/14.
- [ ] Still open from the session review: changing the sign-in mobile number asks for an OTP on the new number only, so a stolen session can move the account's sign-in to another phone. Confirm on the old number or ask for the login PIN first.
