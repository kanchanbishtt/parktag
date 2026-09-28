# Application Performance Audit

Audit date: 2026-09-28. Read-only: no application code was changed. Measurements are from the live sites plus a local read of the repo.

Method: four inputs. (1) Direct inspection of config, headers and code. (2) Live `curl` of production headers and compression. (3) Chrome performance traces (mobile 390x844, Fast 4G, 4x CPU throttle) of `parktag.me/` and `app.parktag.me/get`. (4) Three parallel code audits (frontend, landing, backend). Where two audits disagreed I checked the source. One agent claim was wrong and is dropped (Brotli quality, see section 11).

Not run: `npm test` (needs Mongo, not needed for this audit), Lighthouse performance category (the tooling excludes it; I used a real trace instead), bundle analyser (the frontend has no bundler, and Turbopack prints no per-route sizes; I measured the chunks directly).

---

## 1. Architecture Summary

ParkTag is **two separate deployables on Railway** (edge `sin1`, `server: railway-hikari`, HTTP/2 to browsers).

| | App (`app.parktag.me`) | Landing (`parktag.me`) |
|---|---|---|
| Location | `src/backend`, `src/frontend` | `landing/` |
| Framework | Fastify 5 on Node >=20, ESM | Next.js 16.2.9, React 19.2.4, Tailwind 4, Turbopack |
| Rendering | Server-served static HTML shells, page data via JSON APIs (CSR by hand) | Fully prerendered (SSG), one dynamic route `/api/launch-offer`, `proxy.ts` for analytics |
| Frontend | Vanilla HTML, CSS and JS (no bundler, no framework, ES modules in the browser) | React, 14 `"use client"` components |
| State | None (per-page module state, `localStorage`/`sessionStorage` for small conveniences) | Local `useState` only |
| Data fetching | Bare `fetch`, no query library | One `fetch` in `LaunchOffer` |
| Styling | One global `styles.css` (163 KB) plus page CSS, large inline `<style>` in `welcome.html` | Tailwind 4 + 101-line `globals.css`, FontAwesome CSS |
| Fonts | Google Fonts Inter (render-blocking `<link>`) on 22 pages | System font stack, no font requests |
| Images | 37 files, 8.4 MB, mix of WebP, PNG and base64-in-SVG | `public/` 8.7 MB, mostly plain `<img>`, one `next/image` |
| Auth | Mongo-backed sessions, cookie, 30 s in-process session cache, bcryptjs, OTP, Google, Firebase phone | None |
| DB / services | MongoDB (Atlas), Razorpay, Exotel, Meta WhatsApp and CAPI, Delhivery, Ola Maps, Sentry, Mixpanel | Reads launch offer from the app |
| Caching | Fingerprinted `?v=<sha>` assets get `immutable, 1y`; HTML `no-cache`; ETag on static; `@fastify/compress` zstd, br, gzip | Next defaults; `_next/static` immutable; `public/` files `max-age=0` |
| CDN | None visible. Railway edge routes, does not cache | None |
| Service worker / PWA | None | None |
| Third parties | GA4, Meta Pixel, Clarity, Razorpay, reCAPTCHA v3, Firebase, Google Fonts, `api.qrserver.com`, `api.postalpincode.in` | GA4, Pixel, Clarity via `app.parktag.me/pt-analytics.js` |

The two audits also agree that this codebase is **already well tuned in the delivery layer** (fingerprinting, ETag, compression, bounded caches, lazy third parties). The remaining problems are concentrated in a few places, listed below.

---

## 2. Executive Summary

Counts are of distinct findings in sections 3 to 12 (M19, M20 and M25 are cross-references and are not counted twice; H9 is the same finding as M20).

| Level | Count |
|---|---|
| Critical | **1** |
| High | **9** |
| Medium | **22** |
| Low | **8** |
| Already correctly implemented (listed) | **22** |
| Not applicable / deliberately not recommended | **9** |

**Live measurements (mobile, throttled):**

| Page | LCP | CLS | Notes |
|---|---|---|---|
| `parktag.me/` | **5,667 ms** (TTFB 376 ms, **render delay 5,291 ms**) | 0.07 | LCP element is hero text. Render delay is JS hydration gating opacity. |
| `app.parktag.me/get` | **645 ms** (TTFB 344 ms, render delay 251 ms) | 0.02 | Warm-cache reload; excellent. |

**Headline:** the ad landing pages in the app are fast. The marketing site's hero is the outlier: it paints nothing until React has downloaded, hydrated and run an effect. Second-biggest theme is that below-the-fold images on the marketing site are preloaded at high priority, including a 2.4 MB JPEG. Third is server-side blocking work (bcryptjs at cost 12 takes about 460 ms on the main thread per compare, and the owner dashboard makes six sequential Mongo calls and renders a QR per vehicle).

---

## 3. Core Web Vitals Risks

### C1. Hero content is invisible in the server HTML until hydration
Status: ❌ Missing (fix)
Severity: **Critical**
Location: `landing/app/components/AnimateIn.tsx:12-72`; used on the hero at `landing/app/page.tsx:200` and `:290`
Current implementation: `AnimateIn` starts with `useState(false)`, renders `opacity:0; transform:translateY(28px)`, then in `useEffect` plus `requestAnimationFrame` calls `setVisible(true)`, followed by a 550 ms CSS transition.
Evidence: SSR HTML contains `opacity:0;transform:translateY(28px)` on the hero wrapper. The trace's LCP element is `P.text-white/70 text-lg ...` (the hero copy), 93% of LCP is "render delay" (5,291 ms), the resource is text and is not fetched. 26 `AnimateIn` instances exist on the home page.
Problem: the H1, copy, CTA and hero sticker are all painted at opacity 0 until about 190 KB gzip of JS has been fetched, executed and hydrated, then 550 ms more. LCP and FCP are tied to JS. With JS blocked or failing the hero never appears.
Recommendation:
1. Do not use `AnimateIn` above the fold. Render the hero as plain server markup.
2. Replace the JS animation for below-fold sections with a CSS `@keyframes` plus `animation-timeline: view()` (fall back to no animation), gated by `prefers-reduced-motion`. `AnimateIn` then becomes a server component and its hydration and 26 forced `getBoundingClientRect()` calls disappear.
Expected benefit: LCP from about 5.7 s to roughly 1 to 2 s on the throttled profile; no JS dependency for first paint; less hydration work.
Complexity: Low. Risk: Low (visual only; check reduced-motion).

### M1. Landing CLS 0.07 from the launch-offer banner and rotator
Status: ⚠️ Needs improvement
Severity: Medium
Location: `landing/app/components/LaunchOffer.tsx:14-25`, `page.tsx:186`, `components/VehicleRotator.tsx:10-20`
Evidence: worst cluster 2,452 to 3,452 ms, score 0.0657, impacted element `SECTION.relative.bg-[#03162D]` (the hero section). `LaunchOfferBanner` returns `null` then appears; `HeroOfferLabel` swaps text after a client fetch.
Problem: content is inserted or resized after hydration.
Recommendation: fetch the offer on the server in `page.tsx` (`fetch(..., { next: { revalidate: 60 } })`) and pass it as props, or reserve fixed height. Give the rotator an inline-block with a fixed min-width.
Expected benefit: CLS to about 0.0.
Complexity: Low to Medium. Risk: Low.

### Live check: app landing pages
Status: ✅ Already implemented
`/get` has `<link rel=preload ... fetchpriority=high>` for the hero sticker, width and height on the hero image, dimensions on every gallery image, and LCP of 645 ms (see section 2).

---

## 4. Network and API Findings

### H5. Outbound provider calls have no timeout
Status: ❌ Missing
Severity: **High**
Location: `src/backend/lib/integrations/delhivery.js:22,115,216,269`; `exotel.js:132,163`; `meta.js:82,317,321`; `recaptcha.js:45,100`; `routes/auth/google.js:118,137,230,286,301`; `routes/auth/firebase.js:29,103,147`
Current implementation: native `fetch` with no `AbortSignal.timeout`. Only Mixpanel, Meta CAPI, geoip, Ola Maps and the Razorpay probe have one.
Problem: Node's undici `headersTimeout` defaults to 300 s. One hung provider pins a request, a Mongo operation and a rate-limit slot for up to five minutes.
Recommendation: one shared `fetchWithTimeout(url, opts, ms)` helper (3 to 10 s) used at every call site.
Expected benefit: bounded tail latency and resource use during provider outages.
Complexity: Low. Risk: Low.

### H4. `GET /api/owner/dashboard`: six sequential reads plus one QR render per vehicle, called up to three times per page
Status: ⚠️ Needs improvement
Severity: **High** (it is the main signed-in screen)
Location: `src/backend/routes/owner/dashboard.js:139,160,183,191,196,236,353`; callers `src/frontend/scripts/owner/vehicle-detail.js:43,93,308`, `documents.js:557`
Evidence: owner, tags, requests, livePasses, address and referral code are awaited one after another although all depend only on the session's `ownerId`. `createQrDataUrl(scanUrl)` runs per tag: measured 8.4 ms CPU each, about 4 KB of base64 per tag in the JSON. `vehicle-detail.js` fetches the same endpoint three times and adds 250 to 600 ms of artificial `setTimeout` delays.
Problem: about 40 ms of blocked event loop for a five-vehicle owner, per call, and the QR is a pure function of the token so it is recomputed every time and cannot be browser-cached.
Recommendation:
1. `Promise.all` the independent reads and add `projection` to the tags query.
2. Stop returning `qrDataUrl` in the list; serve `/api/owner/tags/:id/qr.svg` with `Cache-Control: private, max-age=86400`, or render client-side.
3. `vehicle-detail.js`: fetch once, share the promise; add a light single-tag endpoint; drop the fake delays.
Expected benefit: lower dashboard latency and CPU, smaller JSON, fewer duplicate requests.
Complexity: Medium. Risk: Low to Medium (response shape change; keep a `?qr=1` flag during rollout).

### M2. Unbounded and unprojected admin queries; an N+1
Status: ⚠️ Needs improvement
Severity: Medium (admin only)
Location: `src/backend/routes/admin/index.js:106-117,193,685-698,783-849,956,1249`; `routes/admin/traffic.js:41`
Evidence: `buildActivations` loads every premium tag and every paid or COD order and runs `tags.findOne` inside the loop (`:193`); `/overview/summary` calls it only to compute three counts; `/print-queue` is `find(...).toArray()` with no limit or projection; `/overview` and `/owners` return whole owner documents including `passwordHash`; `landingTotals` reads every `visitorHash` into a Set.
Recommendation: replace summary counts with `countDocuments` or `$group`; batch the tag lookup with one `$in`; add projection and pagination; never return `passwordHash`.
Expected benefit: admin load stays flat as data grows; removes a needless hash exposure to the browser.
Complexity: Medium. Risk: Low.

### M3. Missing indexes for known query shapes
Status: ⚠️ Needs improvement
Severity: Medium
Location: `src/backend/lib/db/repositories.js` (`ensureCoreIndexes`)
Evidence and gaps: `contactRequests` sorted by `{createdAt:-1}` with no plain index (three call sites, `admin/index.js:699,839,1358`), and `countDocuments()` with an empty filter where `estimatedDocumentCount()` fits; `owners.createdAt`; `shopOrders {status, createdAt}` (the existing index is ownerId-first) used every 15 minutes by campaigns; `sessions {userId}` used by revoke paths; the sessions TTL index is created lazily in `createSession`, not in the core list.
Recommendation: add the indexes after confirming with `explain()`, keep `ensureCoreIndexes` post-listen and non-blocking as it is today.
Expected benefit: avoids in-memory sorts of the fastest-growing collection.
Complexity: Low. Risk: Low (index build on a live collection, run off-peak).

### M4. Connection reuse: Mongo pool, mail transport, Razorpay client, `getCollections()` and `getEnv()` per call
Status: ⚠️ Needs improvement
Severity: Medium
Location: `lib/db/mongo.js:37-44`; `lib/integrations/email.js:100-107,152,210,251,295`; `lib/integrations/payments.js:60-63`; `lib/db/repositories.js:9-16`; `lib/env.js:93+`
Evidence: no `maxPoolSize` or `minPoolSize` (defaults 100 and 0, with `maxIdleTimeMS` 60 s so an idle replica drops every connection). `createTransport` per email means TCP, TLS and SMTP AUTH per send. `getRazorpay()` builds an SDK instance per call so each call is a fresh TLS handshake. `getCollections()` builds about 45 collection handles per call; `getEnv()` re-reads about 150 env vars and validates on every call.
Recommendation: set `maxPoolSize` 20 to 30 and `minPoolSize` 2 to 5; memoise one pooled nodemailer transport with explicit timeouts; memoise `getRazorpay(env)`, `getCollections(db, prefix)` and `getEnv()`. Confirm Atlas region matches Railway `sin1`.
Expected benefit: no cold-connection latency on bursts (for example a wave of QR scans), lower per-request CPU.
Complexity: Low. Risk: Low.

### M5. No caching of pincode serviceability, Ola autocomplete or public catalogue
Status: ❌ Missing
Severity: Medium
Location: `routes/owner/dashboard.js:619`, `routes/shop/index.js:523,1210` (pincode); `:639-650` (Ola); `:673-752` (`/api/shop/public-catalogue`, two Mongo reads per call, identical for everyone); `/api/shop/reviews`
Recommendation: `BoundedTtlMap` (already used elsewhere) for pincode (6 to 24 h), Ola `(q, pin)` (about 24 h) and the public catalogue and reviews (30 to 60 s); add `Cache-Control: public, max-age=30` on the catalogue. Make `GET /api/owner/orders` read only from the cached tracking (the scheduler already refreshes it) instead of fanning out up to 20 Delhivery calls on a cold cache.
Expected benefit: fewer provider calls, lower tail latency on checkout.
Complexity: Low. Risk: Low.

### L1. Every request logged twice, including static assets and health checks
Status: ⚠️ Needs improvement. Severity: Low. Location: `app.js:352-367`. Recommendation: `disableRequestLogging: true` for static and `/api/health`, or set `LOG_LEVEL`. Benefit: less I/O and log cost. Complexity: Low. Risk: Low.

### L2. Global 200 per minute limit also counts static assets
Status: ⚠️ Needs improvement. Severity: Low. Location: `app.js:795-797`. Evidence: a first load of a page with 30 to 50 assets counts against a shared carrier-NAT IP. Recommendation: `allowList` for `/images`, `/styles`, `/scripts`, `/api/health`. Complexity: Low. Risk: Low.

### L3. High-rate routes use the Mongo-backed rate limiter
Status: ⚠️ Needs improvement. Severity: Low. Location: `lib/auth/rate-limit-store.js` (`incrShared`, one `findOneAndUpdate` per request on about 31 routes). Recommendation: keep it for auth and checkout; use the in-memory counter for `membership` status, `login-pin` GET, `reviews`, `public-catalogue`. Complexity: Low. Risk: Low.

### Not applicable: React Query, SWR, polling
Status: ➖ Not applicable. There is no query library and no server-side polling. Adding TanStack Query to a vanilla multi-page app is not justified. The only fix needed is section H4's shared promise.

---

## 5. Image Findings

### H1. Below-the-fold images preloaded at high priority on the landing page
Status: ❌ Missing (fix)
Severity: **High**
Location: `landing/app/page.tsx:298,406,431,542`
Evidence (head of prerendered `/`): `<link rel="preload" href="/old-way.jpg" as="image"/>`, `/tag-scan.jpg`, `/acrylic-dashboard-plate-real.jpg`, `/dark-logo.png`, `/sticker-artwork.png`, none with `fetchpriority`. The three sizeable ones are plain `<img>` with no `loading` attribute, which React 19 hoists into a preload.
Problem: about 2.4 MB + 142 KB + 295 KB of below-fold images are requested ahead of or beside the 161 KB hero sticker on a mobile connection.
Recommendation: add `loading="lazy" decoding="async"` to those three images (this removes their preloads); put `fetchPriority="high"` on the hero sticker only; add `<link rel="preconnect" href="https://app.parktag.me">`.
Expected benefit: faster LCP resource, about 2.8 MB less initial transfer on mobile.
Complexity: Low. Risk: Low.

### H2. `old-way.jpg` is 2.4 MB and served raw with no cache lifetime
Status: ❌ Missing
Severity: **High**
Location: `landing/public/old-way.jpg`, used at `page.tsx:406`
Evidence: 2,431,668 B, 1448x1086, displayed in about 500 px wide half-column. `curl -I` shows `cache-control: public, max-age=0`, so it revalidates on every visit.
Recommendation: re-export at about 1000 px wide as WebP or AVIF (about 60 to 80 KB); add width and height.
Expected benefit: -2.3 MB on a landing view.
Complexity: Low. Risk: Low.

### M6. Landing `public/` assets are served with `max-age=0`, by one Node process
Status: ⚠️ Needs improvement
Severity: Medium
Location: `landing/next.config.ts` (headers), `landing/railway.json`
Evidence: `sticker-artwork.png` and `old-way.jpg` both return `cache-control: public, max-age=0`. `_next/image` outputs get `max-age=14400, must-revalidate`. `_next/static` is correctly immutable.
Recommendation: add a header rule for `/proof/*`, `/*.webp`, `/*.png`, `/*.jpg`, `/*.mp4` of `public, max-age=31536000, immutable` and rely on the existing `-v2` renaming convention for changes, or put Cloudflare in front (the page headers are already CDN-safe).
Expected benefit: repeat visits stop revalidating about 8 MB of assets.
Complexity: Low. Risk: Low (must rename on change).

### M7. Most landing images are plain `<img>`, no responsive sizes or modern formats
Status: ⚠️ Needs improvement
Severity: Medium
Location: `page.tsx:298,367,406,431,542,606,635,641,648,878`, `SiteHeader.tsx:191`; only `WhyBetter.tsx:48` uses `next/image`
Evidence: `app-preview-*-v2.png` (99, 165, 212 KB, 604x1067), `sticker-artwork.png` (161 KB), `acrylic-dashboard-plate-real.jpg` (295 KB, 1319x1626 shown at max 520 px tall). The `pack-card-in-hand.png` `next/image` emits a 9-step `srcset` up to 3840 w for a small card.
Recommendation: pre-convert to WebP or AVIF at display size at build time (cheaper on Railway CPU than runtime `next/image`), and trim the `next/image` `sizes` and `deviceSizes` for the pack card.
Expected benefit: about 500 to 700 KB less image transfer.
Complexity: Low to Medium. Risk: Low.

### M8. Header logo is invisible until mount and oversized
Status: ⚠️ Needs improvement
Severity: Medium
Location: `landing/app/components/SiteHeader.tsx:88-95,190-200`
Evidence: SSR HTML `<img src="/dark-logo.png" style="height:42px;width:auto;display:block;opacity:0;transition:none"/>`. The PNG is 745x280 shown at 42 px tall (about 6x oversized). Light and dark are separate files swapped in JS.
Recommendation: ship an SVG (or a 224x84 PNG), render both variants and toggle with CSS, no `mounted` gate.
Expected benefit: no logo flash, less JS, smaller file.
Complexity: Low. Risk: Low.

### H8. A hidden print sticker downloads on every owner dashboard load
Status: ❌ Missing (fix)
Severity: **High**
Location: `src/frontend/pages/owner/welcome.html:2956-2958`, `vehicle-detail.html:766-768`, `register.html:189`, `vehicle-detail.html:751`
Evidence: `<img src="/images/org-parktag-sticker.svg">` (134,947 B) and `<img src="https://api.qrserver.com/v1/create-qr-code/...">` sit in a block that `welcome.html:1787` sets to `display:none`. Browsers still fetch `display:none` images. Verified by grep.
Problem: 135 KB plus a third-party origin on the most-used signed-in page, for a feature used rarely.
Recommendation: leave `src` empty and set it in JS just before `window.print()` (the on-demand print code exists at `vehicle-detail.js:355`), or add `loading="lazy"`.
Expected benefit: -135 KB and one third-party request per load.
Complexity: Low. Risk: Low.

### M9. Oversized thumbnails and icons in the app
Status: ⚠️ Needs improvement
Severity: Medium
Location: `src/frontend/images/shop-car.webp` (1800x1350, 84 KB), `shop-bike.webp` (137 KB), `shop-car-2.svg` and `shop-combo.svg` (about 92 KB each, base64 raster inside SVG), `bike-tag.svg` (107 KB, 210 paths) used as a 28 to 34 px icon (`scanner/app.js:114`, `welcome.js:929`, `register.js:13`)
Recommendation: about 200 px WebP or AVIF for thumbnails; replace `bike-tag.svg` with a small purpose-made icon; on mobile `shop-bike.webp` (137 KB) is larger than its desktop variant (89 KB), so check the mapping.
Expected benefit: about 330 KB off shop pages, smaller JS bundles that inline the icon.
Complexity: Low. Risk: Low.

### M10. Scanner hero image has no priority hint and no responsive variant
Status: ⚠️ Needs improvement
Severity: Medium
Location: `src/frontend/pages/scanner/index.html:38,74-75`
Evidence: `verify-vehicle.webp` is 1134x496 (56 KB) shown at about 360 px, no `fetchpriority` or `srcset`; `dark-logo.png` (745x280, 12.7 KB) at 42 px with no width or height (small CLS and bytes on every page).
Recommendation: `fetchpriority="high"` (or preload) plus a 600 px variant; resize the logo and set width and height.
Expected benefit: a stranger on mobile data sees the page faster.
Complexity: Low. Risk: Low.

### M11. Autoplaying MP4s load eagerly
Status: ⚠️ Needs improvement
Severity: Medium
Location: `src/frontend/pages/get.html:212` (`sticking-demo.mp4`, 1.8 MB, `autoplay ... preload="metadata"`); landing `page.tsx:629` (`preload="none"` with `autoPlay`, still starts loading in most browsers)
Recommendation: start playback from an IntersectionObserver (set `src` and `play()` on first view), keep the poster.
Expected benefit: about 1.8 MB less contention with hero bytes on mobile data.
Complexity: Low. Risk: Low.

### Correct already
Status: ✅ `/get` hero uses `fetchpriority="high"` plus preload with width and height; gallery images use `loading="lazy"` with dimensions or `aspect-ratio`; `/proof/*.webp` are WebP at 26 to 125 KB; `banner-*.webp` and `shop-gal-*.webp` are already WebP.

---

## 6. Caching Findings

### M12. HTML is re-read from disk on every request; inline CSS cannot be cached
Status: ⚠️ Needs improvement
Severity: Medium
Location: `src/backend/app.js:900,929,954,1169,1254,1358`, onSend hook `:639-657`; `pages/owner/welcome.html` (177 KB, of which 98 KB is one inline `<style>` at lines 14-1829), `pages/scanner/index.html` (74 KB)
Evidence: each route does `fs.readFile` and the hook does `replaceAll("__ASSET_VERSION__")` per response; string payloads get no ETag; the signed-in and scanner pages are `no-store`. `curl` shows `/get` 29 KB raw to about 7.6 KB brotli.
Problem: the scanner shell is identical for every visitor and is opened by strangers on mobile data, yet cannot 304. `welcome.html` re-downloads its 98 KB of CSS on every navigation.
Recommendation: (1) read and stamp each page once at boot into a Map with a sha1 ETag; serve the scanner shell as `no-cache` plus ETag (safe, token-agnostic); keep `no-store` on signed-in pages but serve from memory. (2) Move the 98 KB inline CSS of `welcome.html` (and the 17 KB in `vehicle-detail.html`) to `/styles/*.css`, which is already fingerprinted and immutable.
Expected benefit: about 100 KB less per owner navigation; 304s for scanner; no disk reads.
Complexity: Medium. Risk: Low. (The inline CSS move touches CSP: `welcome` has no inline script today, styles already allow `'self'`.)

### M13. ES-module `import`s are unversioned, so they revalidate on every visit
Status: ⚠️ Needs improvement
Severity: Medium
Location: `get.js:15-17`, `direct.js:29-31`, `shop.js:13-14`, `welcome.js:1-2`, `login.js:1-2`, `membership.js:1`, `scanner/app.js:1-2`, `import("/scripts/vendor/number-flow.js")`; policy in `lib/core/asset-version.js:97-115`
Evidence: `cacheControlFor` grants `immutable` only when `?v=` matches; these imports carry no `v`, so they get `max-age=0, must-revalidate`, and being nested they form a second-level waterfall with no `modulepreload`.
Recommendation: stamp import specifiers through the existing onSend hook, or add an import map with stamped URLs, plus `<link rel=modulepreload>` for the first-level imports.
Expected benefit: fewer conditional requests on every return visit, shorter waterfall.
Complexity: Medium. Risk: Medium (JS rewriting must be exact; test all pages).

### L4. `/pt-analytics.js` re-templated on every request, 5-minute cache
Status: ⚠️ Needs improvement. Severity: Low. Location: `app.js:920-926`. Evidence: `fs.readFile` plus three `replaceAll` per hit, `max-age=300`, no ETag, 17,958 B unminified. Recommendation: build once at boot with an ETag, add `stale-while-revalidate`, minify. Complexity: Low. Risk: Low.

### L5. `/images` cache is 1 day and not immutable
Status: ⚠️ Needs improvement. Severity: Low. Location: `asset-version.js:107`, `app.js:871-892`. Recommendation: raise to 30 days given the repo already renames changed art. Complexity: Low. Risk: Low.

### M14. No default `no-store` on `/api/*`
Status: ⚠️ Needs improvement (defensive)
Severity: Medium (security-adjacent)
Location: `app.js` onSend
Evidence: API routes set no `Cache-Control` except a few download routes. Today nothing caches them (no `Last-Modified`, Railway edge does not cache), so there is no known leak, but a future CDN would change that.
Recommendation: an onSend default of `no-store` for `/api/*` unless a route sets its own. Then whitelist: `public-catalogue` and `reviews` `max-age=30 to 60`, `razorpay-key` and auth config `max-age=3600`.
Complexity: Low. Risk: Low.

### Must NOT be cached
`/api/session`, all `/api/owner/*`, `/api/admin/*`, vault routes, `/api/shop/pricing` (session-gated), all auth, OTP and webhook routes, and `/api/tags/:token` (state changes on claim or activation; at most `no-cache` plus ETag).

### Local caching (item 7): storage audit
Status: ✅ No unsafe usage of tokens
Severity: informational, one Low finding
Evidence: `pt_get_orders` holds an order number, last 4 digits of the phone and a timestamp (TTL'd). No `document.cookie`, no IndexedDB, no auth tokens in JS.
Finding L6: `localStorage.pt_sos_<plate>` holds an emergency **phone number in plaintext** (`welcome.js:2844`, `vehicle-detail.js:282`) and `pt_vehicles_<email-or-mobile>` is keyed by cleartext identifier. Neither is cleared on logout (only `sessionStorage.clear()` at `welcome.js:3206`). Recommendation: keep in memory or `sessionStorage`, clear on logout, key by an opaque id. Severity Low. Complexity Low. Risk Low.
Do not add IndexedDB or Cache Storage here: nothing is large or repeatedly downloaded reference data. The only candidate (address and pincode lookups) belongs server-side (M5).

### Cache busting
Status: ✅ Already implemented
`__ASSET_VERSION__` is a boot-time sha256 of `styles/` and `scripts/`, stamped in one place; verified live: `/scripts/get.js?v=4759b1a37cf3` returns `cache-control: public, max-age=31536000, immutable`; HTML is `no-cache` so it cannot be the stale part; a mismatched `v` falls back to `must-revalidate`. `_next/static` on the landing site is content-hashed and immutable. There is no service worker to go stale.

---

## 7. JavaScript and Bundle Findings

### H6. Razorpay `checkout.js` loaded synchronously on four pages
Status: ⚠️ Needs improvement
Severity: **High**
Location: `pages/shop.html:210`, `owner/welcome.html:2966`, `owner/membership.html:144`, `owner/vehicle-detail.html:776`
Evidence: plain `<script src="https://checkout.razorpay.com/v1/checkout.js">` with no async or defer, ahead of the page module. `/get` and `/direct` already do the right thing with a lazy `loadRazorpay()` (`get.js:513-526`, `direct.js:629`).
Problem: the parser waits for a cross-origin fetch, delaying the deferred module and therefore the `/api/shop/public-catalogue` and `/api/owner/dashboard` calls.
Recommendation: reuse the lazy loader on the buy click.
Expected benefit: dashboard and shop data start earlier; one less blocking third-party origin.
Complexity: Low. Risk: Low (test the checkout flow).

### H7. `address-step.js` (56 KB, 17 KB gzip) is a plain synchronous script on five pages
Status: ⚠️ Needs improvement
Severity: **High**
Location: `get.html:454`, `direct.html:382`, `shop.html:211`, `welcome.html:2967`, `vehicle-detail.html:777`; eager `import("/scripts/vendor/number-flow.js")` at `address-step.js:532`; injects a `<style>` at `:261` on load
Problem: it is needed only when a visitor taps buy, but it delays parser completion, `get.js` and the catalogue fetch on the ad pages.
Recommendation: `import()` it on first buy click; load `number-flow` the first time the summary opens.
Expected benefit: about 17 KB gzip and one parse off the ad landing pages.
Complexity: Medium. Risk: Medium (checkout regression risk, needs the existing tests plus a manual pass).

### M15. Analytics start at DOMContentLoaded, all three loaders at once
Status: ⚠️ Needs improvement
Severity: Medium
Location: `src/backend/assets/analytics.js:90-98` (Clarity), `:264-267` (GA4), `:273-278` (Pixel)
Evidence: bundle is 17,958 B raw, 6,917 B gzip, `defer` on every page. Each vendor script is `async`, but all start immediately, competing with the hero preload and catalogue fetch, especially in Instagram's in-app browser.
Recommendation: wrap injection in `requestIdleCallback` (timeout about 2 s) or the window `load` event. Queues (`dataLayer`, `fbq.queue`, `clarity.q`) already exist, so no event is lost.
Expected benefit: better FCP and LCP on ad traffic; small loss risk on very fast bounces.
Complexity: Low. Risk: Low to Medium (validate event counts for a day).

### M16. Landing: `pt-analytics.js` cross-origin and no preconnect
Status: ⚠️ Needs improvement
Severity: Medium
Location: `landing/app/layout.tsx:87`
Evidence: `<Script strategy="afterInteractive">` (correct, not blocking) but rendered as `<link rel="preload" href="https://app.parktag.me/pt-analytics.js" as="script"/>`, and it is injected after hydration.
Recommendation: add `preconnect` to `app.parktag.me`, or switch to `lazyOnload` so the preload does not compete with LCP resources.
Complexity: Low. Risk: Low.

### M17. Landing: 14 client components, scanner ships to every visitor
Status: ⚠️ Needs improvement
Severity: Medium
Location: `landing/app/components/` (`FloatingActions`, `WhatsAppBubble`, `FaqAccordion`, `BuyOnAmazonButton`, `GetStartedButton`, `Marquee`, `FeatureIcons`, `PageLoader`, `AnimateIn`, `SiteHeader`, `HowItWorksSteps`, `VehicleRotator`, `LaunchOffer`, `ScanTagButton`); `layout.tsx:11,86` mounts `FloatingActions` on every page
Evidence: total first-load JS for `/` is about **191 KB gzip** across 8 chunks (largest 70.7, 47.9, 29.3, 12.9, 10.5, 9.0, 6.2, 4.2 KB). `ScanTagButton` (about 11.7 KB source, camera and `BarcodeDetector` code) ships to all visitors through `FloatingActions`. Several presentational components need no client JS (`WhatsAppBubble`, `BuyOnAmazonButton`, a `<details>`-based FAQ).
Recommendation: `next/dynamic` (or `import()` on click) for the scanner modal, keep only the button in the layout; convert presentational components to server components.
Expected benefit: about 10 to 25 KB gzip less first-load JS, less hydration.
Complexity: Medium. Risk: Low.

### Correct already
Status: ✅ Modern browsers skip the 39 KB gzip polyfill chunk (`noModule`). FontAwesome uses per-icon imports with `autoAddCss=false`. `pt-analytics.js`, reCAPTCHA v3, Firebase and Razorpay (on `/get`, `/direct`) load lazily. No inline `<script>` on any app page (0 bytes measured).
Not applicable: code splitting and dynamic imports in the app, since there is no bundler and each page is a small entry. Do not introduce one just for this.

---

## 8. React Rendering Findings

All React code is the landing site, and it is small. No profiling data indicates a render problem.

Status: ➖ Not applicable for `React.memo`, `useMemo`, `useCallback`, Redux or Zustand. Do not add them.

### L7. Timers and listeners
Status: ⚠️ Needs improvement. Severity: Low.
- `VehicleRotator.tsx:10-20`: `setInterval(2400)` plus an uncleared inner `setTimeout(320)`, runs while the tab is hidden. Use a CSS keyframe on stacked spans.
- `SiteHeader.tsx`: passive `scroll` listener calling `getBoundingClientRect()` each event; an IntersectionObserver on the `[data-nav-dark]` sentinel is cleaner.
- `AnimateIn`: one IntersectionObserver plus one forced layout measurement per instance (26). Goes away with C1.
- App side: `login.js:733` `setInterval(refreshSmsFallback, 1000)` never stops; `welcome.js:26,37` 3 s banner interval never pauses on `visibilitychange`. `get.js:824` and `direct.js:991` read `scrollLeft` and `clientWidth` on every scroll (passive).
Recommendation: clear or gate these, using the visibility pattern already present in `get.js`.
Complexity: Low. Risk: Low.

### Correct already
Status: ✅ `HowItWorksSteps` uses one IntersectionObserver with cleanup and honours `prefers-reduced-motion`. The app's carousels use passive listeners, pause on `visibilitychange`, and use IntersectionObserver. No `window.innerWidth` layout logic (only one scrollbar-gutter measurement at `scanner/app.js:282`).

---

## 9. CSS Findings

### M18. `styles.css` is one 163 KB global sheet for 25 pages, with about 50 KB of comments
Status: ⚠️ Needs improvement
Severity: Medium
Location: `src/frontend/styles/styles.css` (163,048 B raw, 40,720 gzip, 33,541 brotli)
Evidence: stripping comments and whitespace gives 103,152 B (18,648 gzip). By a rough class scan, `scanner/index` uses about 60 KB of it, admin pages about 30 KB, other owner pages 14 to 20 KB. Admin and print-queue CSS is about 30 KB (lines ~864-1300) and ships to every visitor including strangers on the scanner. The scan is a substring estimate, treat the split as approximate.
Recommendation: strip comments at deploy (a one-line minify script), then split into `base.css`, `scanner.css`, `admin.css`. Only load what each page needs.
Expected benefit: about 20 KB gzip off the scanner and owner pages, more once split.
Complexity: Medium. Risk: Medium (specificity and ordering regressions). Do minify first (Low risk), split later.

### M19. Landing CSS is small, but `PageLoader` and `Marquee` leave dead rules
Status: ✅ mostly. `globals.css` is 101 lines, no duplication. Dead: `@keyframes marquee` (`globals.css:41`) and `.skeleton-shimmer`. Total landing CSS is 76 KB (12.5 KB gzip), dominated by the FontAwesome stylesheet and Tailwind utilities.

### M20. Google Fonts is a render-blocking cross-origin stylesheet on 22 pages, including the scanner
Status: ⚠️ Needs improvement
Severity: **High** for `scanner/index.html`, Medium elsewhere (counted as High in section 2, item H9)
Location: `scanner/index.html:11-14`, `shop.html:15-17`, `direct.html:18-20` and 19 more; `welcome.html:1830` and `vehicle-detail.html:384` sit after 98 KB and 17 KB of inline CSS, so are discovered late
Evidence: `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">` then a second hop to `fonts.gstatic.com`. No `preload` for the font file. `get.html` sets `font-family: Inter` in `get.css:55` but has no font link at all, so the main ad page silently renders in `system-ui` while `shop` and `direct` use Inter.
Problem: the scanner page is opened by strangers on mobile data, and the CSS fetch gates first paint.
Recommendation: self-host one Latin variable Inter woff2 under `/fonts/` with `@font-face { font-display: swap }` and `<link rel=preload as=font crossorigin>`. Drop the two preconnects and the CSP `fonts.*` entries. Decide deliberately whether `get.html` should use Inter.
Expected benefit: removes two cross-origin round trips from first paint; removes one CSP origin.
Complexity: Low to Medium. Risk: Low (visual: check metrics). Note `app.js` CORP rule already lists `/fonts/`.

### Not applicable
Component-scoped CSS or CSS Modules: the app is vanilla pages; forcing another system is not warranted. Responsive layout is CSS-driven (Status ✅, see section 8).

---

## 10. Dead Code Findings (candidates only, nothing deleted)

Safe deletion candidates. Each was checked with a repo-wide grep for references.

| # | Candidate | Size | Evidence | Confidence |
|---|---|---|---|---|
| D1 | `src/frontend/images/sticker-bg-premium.svg` | 2.14 MB | 0 references outside docs | High |
| D2 | `src/frontend/images/demo-qr-sticker.svg` | 936 KB | 0 references | High |
| D3 | `src/frontend/images/org-premium-bg.svg` | 896 KB | 0 references | High |
| D4 | `landing/public/`: `acrylic-dashboard-plate-detail.jpg`, `final-landing-sticker.png`, `final-sticker.png`, `light-final-logo.png`, `dark-final-logo.png`, `vercel.svg`, `next.svg`, `globe.svg`, `window.svg`, `file.svg` | about 600 KB | 0 references in `app/` or `next.config.ts` | High |
| D5 | `landing/app/components/Marquee.tsx`, `FeatureIcons.tsx`, and their CSS (`@keyframes marquee`) | small | 0 importers | Medium (confirm FeatureIcons) |
| D6 | `@fortawesome/free-regular-svg-icons` in `landing/package.json` | dependency | not imported | High |
| D7 | `axios` in root `package.json` | dependency | not imported in `src`; transitive through `razorpay` | High |
| D8 | `landing/public/brand-guideline/` (176 tracked files, about 2 MB: design-system JSX, `.d.ts`, `.prompt.md`) | 2 MB | publicly served via the rewrite in `next.config.ts` | Decision needed, not automatic |

Important nuance: `PageLoader` is **not** dead, it wraps all five legal and info subpages (`about`, `contact`, `privacy`, `terms`, `refund`). It should still go (M21). `org-parktag-sticker.svg` (135 KB) **is** referenced, but only by print blocks (H8). No dead modules in `src/backend/lib` or `routes` (every file has an importer).

### M21. `PageLoader` fake skeleton covers real content on the five subpages
Status: ⚠️ Needs improvement
Severity: Medium
Location: `landing/app/components/PageLoader.tsx:57-88`, used in `about`, `contact`, `privacy`, `terms`, `refund`
Evidence: a `position:fixed; inset:0; zIndex:9999` skeleton is in the SSR HTML and is only removed by `setTimeout` (200 ms then 560 ms) after hydration. `pointerEvents:"auto"` blocks clicks meanwhile.
Problem: hides already-rendered legal text for hydration plus 560 ms, and if JS fails it never clears.
Recommendation: delete it. The pages are static HTML, there is no loading state to mask. If a fade is wanted, use a CSS animation on `main`.
Expected benefit: better FCP and LCP on those pages, one less client boundary.
Complexity: Low. Risk: Low.

### M22. Duplicated frontend code
Status: ⚠️ Needs improvement
Severity: Medium (maintainability, and repeated bytes)
Location: `get.js` and `direct.js` share 550 of 622 significant lines (88%); duplicated order-recall (`get.js:368-395`, `direct.js:491-511`, `shop.js:196-209`), four PACK image tables, `VEHICLE_ICON_SRC` in three files, `esc()` in 7 files
Recommendation: extract shared modules (cached across pages). Consider `direct` as a flag on `get`. Only after M13 (versioned imports) so the shared modules get cached correctly.
Complexity: Medium. Risk: Medium.

---

## 11. Infrastructure Findings

### Compression (item 13)
Status: ✅ Already implemented; do not add more
Evidence: production `curl` with `Accept-Encoding: br, gzip`: app HTML returns `content-encoding: br` (`/get` 29,214 B to 7,663 B; `/shop` 12,984 B to 3,584 B; `styles.css` to 42,315 B; `welcome.js` to 47,789 B). Landing HTML returns `gzip` (188 KB to 33.9 KB). `@fastify/compress` sets Brotli quality **4** explicitly (`node_modules/@fastify/compress/index.js:119`), so on-the-fly compression is cheap. (One sub-audit claimed Brotli-11 was in use; that is wrong, dropped.) Images and video are correctly not compressed.
Minor: Next serves gzip only; Brotli would save about 15% on the 188 KB landing HTML and the 2 JS chunks, and is best done by a CDN in front, not by application code.

### Connection reuse and HTTP/2 (item 14)
Status: ✅ HTTP/2 to browsers is provided by the Railway edge (`HTTP:2` in all `curl`s); the origin is plain HTTP/1.1, which is correct. Native `fetch` (undici) reuses keep-alive connections. Gaps are in M4. Third-party origin count on app pages is high (GA, Pixel, Clarity, Razorpay, reCAPTCHA, fonts, qrserver, postalpincode); H6, H8, M15 and M20 remove or defer several.

### CDN (item 22)
Status: ⚠️ Needs improvement (optional)
Severity: Low to Medium
Evidence: no `age` or `cf-cache` headers; `server: railway-hikari` is routing only. Every image, chunk and the 1.8 MB MP4 is served by one Node process in `sin1`. Measured TTFB from this machine is about 0.35 to 0.5 s.
Recommendation: put Cloudflare (free tier is enough) in front of `parktag.me` and the app's `/images`, `/styles`, `/scripts`. The landing `next.config.ts` page headers already anticipate a shared cache (`s-maxage=600, stale-while-revalidate=86400`). Prerequisite: fix M6 and M14 so nothing private or stale can be cached, and verify `/api/*` bypasses cache. This is the single lever that reduces TTFB for repeat and distant visitors, but it is infrastructure, not code.
Complexity: Medium. Risk: Medium.

### Service worker / PWA (item 23)
Status: ➖ Not applicable, do not add. Both apps are online-only (OTP, payments, live contact). A worker adds a stale-cache failure mode for no offline benefit. Cache busting via `?v=` already covers the repeat-visit case.

### Virtualization (item 8)
Status: ➖ Not applicable today. Longest list is admin owners at 500 rows (`admin/index.js:1251`), print queue capped at 200 rows in the DOM, activity 100. Admin-only. If the print export grows past a few thousand tags, page it (`grid.innerHTML = pagesHtml` with thousands of data-URI QR images, `admin/index.js:613,627`) and use `content-visibility: auto`. Do not add react-window or TanStack Virtual.

### IntersectionObserver and priority hints (items 9, 10)
Status: ✅ largely fine. IntersectionObserver is already used for carousels and steps; the scroll-listener cases are listed in L7. Preload use on `/get` is correct and targeted (hero only). Hints are wrong only on the landing page (H1) and the scanner hero (M10). Prefetch: none exists and none is warranted; navigation between the two sites is a full page load by design.

### L8. Sentry init after imports
Status: ✅ / informational. Tracing is off, 5xx only, scrubbed. No overhead concern.

---

## 12. Security Considerations

Performance changes recommended above that touch security, and issues found on the way:

1. **S1 (Medium): raw page shells are reachable without a session through the static root.** Verified live: `GET https://app.parktag.me/pages/admin/overview.html` returns 200 with the admin shell, and `/pages/owner/welcome.html` and `/pages/scanner/index.html` also return 200. These are HTML shells only (data comes from session-gated APIs), but they bypass the per-route CSP tightening and `no-store` headers the guarded routes apply, and are unstamped. Location: `app.js:858-860` (`fastifyStatic` rooted at `frontend/`). Fix: exclude `pages/` from the static plugin (`allowedPath` or serve from a sub-root). Complexity Low, Risk Low (make sure every page has a named route first).
2. **S2 (Medium): `passwordHash` is returned to the admin browser** by `/api/admin/overview` and `/api/admin/owners` (missing projection, see M2). Fix with projection.
3. **S3 (Low): plaintext emergency phone in `localStorage`** (L6).
4. **Caching safety:** M6 and the CDN recommendation must not cache `/api/*`, `/owner*`, `/admin*` or any `Set-Cookie` response. M14 adds a defensive `no-store` default. Do not cache `/api/tags/:token` beyond `no-cache` plus ETag.
5. **bcrypt change (H3 below):** moving hashing off the event loop must keep verifying existing `$2b$` hashes. Do not lower the cost factor to gain speed.
6. **Ola Maps key** is passed in a query string server-side (`shop/index.js:639-650`). It is server-to-server so it is not exposed to the browser; keep it that way and do not move the call client-side to "save a hop".
7. **No performance recommendation here weakens auth, cookies or CSRF.** The moves of inline CSS (M12) and inline logic to external files only tighten CSP.

### H3. bcryptjs at cost 12 runs on the event loop, including OTP
Status: ⚠️ Needs improvement
Severity: **High**
Location: `src/backend/lib/auth/security.js:4,41,84-91`; `lib/auth/auth.js` (`loginOwnerWithSecret`)
Evidence: measured on this machine, one `bcryptjs.compare` at cost 12 took 460 ms, and a 1 ms timer fired only 5 times during it (event loop starved in about 100 ms slices). A login does two compares plus a burn compare for unknown accounts; OTP send and verify also hash.
Problem: every login and OTP request blocks all other requests on that replica.
Recommendation: switch to native `bcrypt` (libuv threadpool) or `crypto.scrypt`, keeping `$2b$` verification for existing hashes. For the 6-digit OTP, an HMAC-SHA256 with a server pepper plus the existing attempt limits and `timingSafeEqual` is much cheaper (needs one new env secret, which the comment at `security.js:76-83` was avoiding).
Expected benefit: no cross-request stalls during login bursts.
Complexity: Medium. Risk: Medium (auth path; add tests for old and new hashes).

### H9. Google Fonts render-blocking on the highest-traffic page (scanner)
Same as M20; counted once as High.

### M23. Landing fade-out navigation adds 160 to 190 ms and breaks native link behaviour
Status: ⚠️ Needs improvement
Severity: Medium
Location: `landing/app/components/GetStartedButton.tsx:20-26`, `SiteHeader.tsx:165-171`, `layout.tsx:69-74`
Evidence: `e.preventDefault(); document.body.style.opacity="0"; setTimeout(()=>{window.location.href=href},190)` plus a `pageshow` script to undo it after bfcache.
Problem: artificial delay on the main conversion click, no prefetch, middle-click and open-in-new-tab break.
Recommendation: use a normal `<a href>` (or `<Link>` for internal routes) and delete the `pageshow` shim.
Complexity: Low. Risk: Low.

### M24. `LaunchOffer` fetches once per instance (5 on the home page)
Status: ⚠️ Needs improvement. Severity: Medium. Location: `LaunchOffer.tsx:14-25`, five uses in `page.tsx` (`:186,267,749,752,775`). Recommendation: fetch once on the server (see M1); this also removes the CLS and the client `/api/launch-offer` route. Complexity Low to Medium. Risk Low.

### M25. Nodemailer, provider and mail calls run inline in request paths
Covered by M4 (transport reuse) and H5 (timeouts). Also stop awaiting mail in OTP or reset request handlers where the response does not depend on it.

### L9. Raster and SVG "base64 in SVG" images
Status: ⚠️ Needs improvement. Severity: Low. `shop-car-2.svg`, `shop-combo.svg`, `sticker-bg-premium.svg` embed base64 rasters inside SVG wrappers, which defeats both SVG scaling and image codecs. Replace with real WebP or AVIF. Folded into M9 and D1 to D3.

---

## 13. Already Correctly Implemented (22)

1. Content-hashed asset URLs with `immutable, 1y`, fail-safe fallback to `must-revalidate` (`asset-version.js`).
2. `fastifyStatic` ETag and Last-Modified, 304s on static.
3. HTML `no-cache` (never the stale part), signed-in and scanner pages `no-store`.
4. zstd, br, gzip negotiation at low Brotli quality; registered after the version stamp and before static; request decompression off so webhook HMACs see raw bytes.
5. Correct CORP `cross-origin` scoped to `/images`, `/styles`, `/fonts`, `/pt-analytics.js` only.
6. Session lookups cached 30 s in-process with revocation still honoured.
7. Bounded TTL caches (`BoundedTtlMap`, geoip 5,000 entries, `MemoryCounters` cap); Delhivery tracking cached 15 minutes.
8. Rate-limit counters shared across replicas, fail-open to memory.
9. Indexes and index creation run after `listen` and are not awaited (boot never waits on Atlas).
10. Vault file download streams from GridFS with `private, no-store`.
11. Scheduler is bounded (lease, 200 sends per tick, `limit` on campaign queries).
12. Graceful shutdown (HTTP, Mongo, Sentry flush).
13. Sentry scrubbed, 5xx only, tracing off.
14. `/get` LCP 645 ms, CLS 0.02; hero sticker preload with `fetchpriority="high"` and dimensions.
15. Third parties on the app: reCAPTCHA, Firebase and Razorpay (`/get`, `/direct`) load on demand; Pixel never loads on the scanner until engagement; analytics bundle is `defer`.
16. No inline `<script>` in any app page, no base64 in HTML.
17. Carousels: passive listeners, pause on hidden tab and off-screen, honour reduced motion.
18. No auth tokens in browser storage; order recall stores only order number and last 4 digits, with TTL.
19. Landing: fully static prerender, system font stack (no font requests, no font CLS), per-icon FontAwesome imports.
20. Landing: page-level `Cache-Control` set route by route so `_next/static` keeps `immutable`; security headers complete; `poweredByHeader:false`.
21. Landing `proxy.ts` never blocks the response, skips bots and prefetches, `waitUntil` with a 3 s abort.
22. Below-fold `/proof/*.webp` are already WebP at sensible sizes with dimensions and `loading="lazy"`.

---

## 14. Prioritized Action Plan

### P0: Fix immediately
- **C1** Make the landing hero render in the server HTML (no `AnimateIn` above the fold).

### P1: High impact
- **H1** Lazy the three below-fold landing images, `fetchpriority="high"` on the hero sticker, `preconnect` to the app origin.
- **H2** Resize and convert `old-way.jpg` (2.4 MB).
- **H8** Stop loading the hidden print sticker and `api.qrserver.com` image on every dashboard load.
- **H6** Lazy-load Razorpay on the four pages that load it synchronously.
- **H7** Load `address-step.js` on first buy click.
- **H9/M20** Self-host Inter (start with the scanner page).
- **H3** Move bcrypt off the main thread.
- **H4** Dashboard: `Promise.all`, no per-request QR, one fetch per page.
- **H5** Timeouts on every provider `fetch`.

### P2: Useful improvements
M1 (CLS, folded with M24), M2, M3, M4, M5, M6, M7, M8, M9, M10, M11, M12, M13, M14, M15, M16, M17, M18, M21, M22, M23, M24, S1, S2.

### P3: Optional
L1 to L9, D-list deletions (D1 to D7 are safe housekeeping and free), CDN (only after M6 and M14), brand-guideline `public/` decision (D8), Brotli on the landing (via CDN).

---

## 15. Top 10 Performance Improvements (impact divided by effort)

| # | Change | Files | Expected impact | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Hero renders without JS; `AnimateIn` only below the fold, CSS-driven | `landing/app/components/AnimateIn.tsx`, `landing/app/page.tsx`, `globals.css` | LCP about 5.7 s to about 1 to 2 s (throttled mobile) | Low | Low |
| 2 | `loading="lazy"` on three landing images, `fetchpriority` on hero, `preconnect` app origin | `landing/app/page.tsx`, `layout.tsx` | about 2.8 MB less contention with LCP | Low | Low |
| 3 | Re-export `old-way.jpg` (and the other two) as WebP or AVIF at display size | `landing/public/*` | -2.3 MB on landing view | Low | Low |
| 4 | Dashboard hidden print `<img>` set in JS at print time | `owner/welcome.html`, `vehicle-detail.html`, `register.html`, `vehicle-detail.js` | -135 KB and one third-party request per owner page load | Low | Low |
| 5 | Lazy Razorpay on `shop`, `welcome`, `membership`, `vehicle-detail` | four HTML pages, reuse `get.js` loader | dashboard and catalogue data start earlier | Low | Low |
| 6 | Timeouts on all provider `fetch` calls via one helper | `delhivery.js`, `exotel.js`, `meta.js`, `recaptcha.js`, `google.js`, `firebase.js` | bounded worst-case latency | Low | Low |
| 7 | Dashboard: `Promise.all`, cached or lazy QR, single fetch per page | `routes/owner/dashboard.js`, `vehicle-detail.js`, `documents.js` | about 40 ms less blocked loop per load, smaller JSON, 2 fewer requests | Medium | Low to Medium |
| 8 | Off-main-thread password and OTP hashing | `lib/auth/security.js`, `auth.js` | removes 460 ms event-loop stalls per login | Medium | Medium |
| 9 | Self-host Inter with preload; drop Google Fonts | 22 HTML pages, `styles/`, CSP in `app.js` | removes two cross-origin hops from first paint | Low to Medium | Low |
| 10 | Load `address-step.js` and `number-flow` on demand | five HTML pages, `address-step.js` | about 17 KB gzip and one parse off the ad landing pages | Medium | Medium |

Runners-up: minify `styles.css` (comments are about 50 KB), in-memory HTML cache with ETag, delete dead assets (D1 to D3, about 4 MB and free).

---

## 16. Files That Would Need Modification (by phase)

- **Phase A (landing quick wins):** `landing/app/components/AnimateIn.tsx`, `landing/app/page.tsx`, `landing/app/layout.tsx`, `landing/app/globals.css`, `landing/app/components/PageLoader.tsx` (delete) and the five subpage `page.tsx` files, `GetStartedButton.tsx`, `SiteHeader.tsx`, `LaunchOffer.tsx`, `landing/next.config.ts`, `landing/public/` images.
- **Phase B (app frontend):** the four HTML pages with sync Razorpay; `owner/welcome.html`, `vehicle-detail.html`, `register.html` (print images); `address-step.js` callers; `assets/analytics.js`; the 22 pages with the Google Fonts link plus `styles/`; `styles/styles.css`.
- **Phase C (backend):** `lib/integrations/*` (timeouts, pooling), `routes/owner/dashboard.js`, `routes/admin/index.js`, `traffic.js`, `lib/db/repositories.js`, `lib/db/mongo.js`, `lib/auth/security.js`, `lib/env.js`, `app.js` (static root, log level, allow-list, `/api` default headers, HTML cache).
- **Phase D (housekeeping):** dead-asset deletions (D1 to D7), `package.json` dependency removals.

## 17. Changes I Consider Risky

- **Hashing change (H3):** touches login and OTP; needs migration-safe verification and tests. Highest risk in the whole plan.
- **`address-step.js` and Razorpay lazy loading (H6, H7):** checkout is revenue; requires a full manual pass of `/get`, `/direct`, `/shop`, membership and vehicle-detail purchase flows on mobile.
- **Versioned ES imports (M13) and splitting `styles.css` (M18):** wide blast radius across 25 pages; ordering and specificity regressions are easy to miss.
- **Moving inline CSS out of `welcome.html` (M12):** CSP and FOUC risk on the main signed-in page.
- **CDN in front:** a wrong cache rule on `/api`, `/owner`, `/admin` would leak private data; do it last and verify with `Vary` and `Set-Cookie` checks.
- **Dashboard response shape (H4):** dropping `qrDataUrl` changes the contract; keep a compatibility flag.

## 18. Changes That Should NOT Be Implemented

- A service worker or PWA layer.
- IndexedDB, Cache Storage or additional `localStorage` caching.
- React Query, SWR, Redux or Zustand (there is no React app to speak of, and the landing has no server state).
- `React.memo`, `useMemo`, `useCallback` sweeps.
- List virtualization libraries.
- A JS bundler or framework for the app frontend just for code splitting. Targeted dynamic `import()` on click gets the benefit.
- Runtime `next/image` for every landing image (prefer build-time conversion on this CPU-limited host).
- Application-level compression changes (already tuned).
- Preloading more assets. The current preload set on `/get` is right; the landing has too many.
- Lowering bcrypt cost as a "speedup".
- Aggressive API caching of anything user-specific.

---

## Appendix A: Measurements

| Measurement | Value | Source |
|---|---|---|
| Landing `/` LCP (mobile, Fast 4G, 4x CPU) | 5,667 ms; TTFB 376 ms; render delay 5,291 ms | Chrome trace |
| Landing `/` CLS | 0.07 (hero section, single cluster) | Chrome trace |
| App `/get` LCP, CLS | 645 ms, 0.02 | Chrome trace |
| Landing first-load JS | about 191 KB gzip, 8 chunks | `curl` of chunks referenced by prod HTML |
| Landing CSS | 76 KB raw, 12.5 KB gzip | build audit |
| Landing HTML | 188 KB raw, 33.9 KB gzip | `curl` |
| App `styles.css` | 163,048 B raw, 42,315 B br served | file plus `curl` |
| `owner/welcome.html` | 177,345 B raw, 98,280 B inline CSS | file |
| `scripts/owner/welcome.js` | 157 KB raw, 47,789 B br served | file plus `curl` |
| bcryptjs compare, cost 12 | 460 ms, event loop blocked | local timing (backend audit) |
| `QRCode.toDataURL` 280 px | 8.4 ms, about 4 KB base64 | local timing (backend audit) |
| TTFB from this machine | about 0.35 to 0.5 s | `curl`, edge `sin1` |

Not measured: real-user CrUX (no data for either origin), INP (no interaction trace), server CPU in production.

## Appendix B: Tooling and gaps

- `npm test` was not run.
- No bundle analyser installed; none added. No large tooling was installed.
- Lighthouse performance category is unavailable in the tooling used; traces were used instead.
- Two sub-audit claims were checked and corrected: Brotli quality (is 4, not 11) and `PageLoader` (is used, not dead).

---

## Appendix C: Implementation status (2026-09-28)

Everything in P0, P1 and P2 was implemented except the items below. Nothing is committed. See `TASKS.md` for the follow-ups.

Deliberately not done:
- `WhatsAppBubble` and `BuyOnAmazonButton` stay client components: their click handlers call `ptTrack` and `analytics.js` has no delegated tracking.
- Scanner CSS split (only about 9 KB was cleanly separable), and deduplicating `esc()`, `VEHICLE_ICON_SRC` and order-recall between `get.js`, `direct.js` and `shop.js`.
- Single-tag owner endpoint, `getEnv()` memoisation (about 37 microseconds per call, unsafe for tests), and replacing the vault byte-total aggregate.
- OTP HMAC pepper: no always-present secret suits it, so OTPs use the same native bcrypt.
- CDN, `brand-guideline/` removal, and CSS minification at serve time: need a decision or an infrastructure change.
- Findings that are informational or correct as they are (service worker, virtualization, React Query, memoisation) were intentionally left alone.

Corrections made while implementing: `/get` and three owner pages now render Inter (previously a system font); the scanner hero image uses `fetchpriority="low"` because it sits inside a hidden modal.
