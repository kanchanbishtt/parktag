# ParkTag Analytics Events — Developer Handover

**Status:** implemented and unit-tested, NOT yet configured or verified in a browser.
**Branch:** working tree on `main`, uncommitted.

Purpose: give GA4 and the Meta Pixel a full view of the funnel so ad spend can be
optimised against real activations and orders instead of clicks.

---

## 1. What is already done

| File | Change |
|---|---|
| `src/backend/assets/analytics.js` | **New.** The whole tracking layer: loader, event map, PII allow-list, dispatch |
| `src/backend/lib/analytics.js` | **New.** `renderAnalyticsBundle()` — fills the env placeholders |
| `src/backend/tests/analytics-asset.test.js` | **New.** 5 tests, no DB required |
| `src/backend/app.js` | Route `GET /pt-analytics.js` + `analyticsAsset` path const |
| `src/backend/lib/env.js` | `ga4MeasurementId`, `metaPixelId` |
| `src/frontend/pages/owner/welcome.html` | Script tag + `view_item`, `begin_checkout`, `purchase` |
| `src/frontend/pages/owner/register.html` | Script tag |
| `src/frontend/pages/scanner/index.html` | Script tag (`data-surface="scanner"`) |
| `src/frontend/scripts/owner/welcome.js` | `sign_up` |
| `src/frontend/scripts/scanner/app.js` | `tag_activated`, `scan_received`, `contact_action` |

120 insertions, no deletions, no behaviour changed for existing code paths.

### How it works

Pages include one tag:

```html
<script src="/pt-analytics.js" data-surface="app"></script>
```

The route fills the GA4 / Pixel IDs from env at request time (5-min cache). Both
unset means the bundle installs a no-op `ptTrack` and loads nothing. That is the
intended dev and staging state.

Call sites only ever do:

```js
if (window.ptTrack) ptTrack("purchase", { transaction_id: "...", value: 449, currency: "INR" });
```

`assets/analytics.js` owns the entire mapping to GA4 and Meta. Adding a
destination later means editing `dispatch()` in one file, not the call sites.

### Event map

| `ptTrack` name | GA4 | Meta Pixel | Fires at |
|---|---|---|---|
| `view_item` | `view_item` | `ViewContent` | `openProduct()` in welcome.html |
| `begin_checkout` | `begin_checkout` | `InitiateCheckout` | `startPayment()` and `packPlaceCod()` |
| `purchase` | `purchase` | `Purchase` | `showConfirmation()` in welcome.html |
| `sign_up` | `sign_up` | `CompleteRegistration` | welcome.js, on `?new=1` arrival |
| `tag_activated` | `tag_activated` | `TagActivated` (custom) | scanner/app.js, after `/api/tags/:token/activate` |
| `scan_received` | `scan_received` | **never** | scanner/app.js, after the tag resolves |
| `contact_action` | `contact_action` | **never** | scanner/app.js, in `createRequest()` |

`purchase` is fired from `showConfirmation()` because that is the single point
both the prepaid and the COD paths pass through. Do not move it into the two
callers: the COD-to-prepaid upgrade re-enters it and would double-count.

COD is reported as a purchase (that is when the customer commits) but tagged
`cod: true` so the ~25% that never get accepted at the door can be segmented out
later. Prepaid is the honest revenue number.

---

## 2. What you need to do

### a. Create the properties and set env vars

On the **app** service (Railway, `parktag app`), production only:

```bash
GA4_MEASUREMENT_ID=G-XXXXXXXXXX
META_PIXEL_ID=XXXXXXXXXXXXXXX
```

**Leave both unset on staging and dev.** That is the only thing stopping test
traffic being counted as real conversions and fed to Meta as optimisation signal.

The landing site needs no new vars. It loads the same bundle from the app domain
via the existing `NEXT_PUBLIC_APP_URL`, so the IDs live in exactly one place.

### b. Verify in a browser (30 minutes, not yet done)

1. GA4 DebugView: confirm all 7 events arrive with the right params.
2. Meta Events Manager Test Events: confirm the 5 Pixel events arrive.
3. **Open a `/vehicle/:token` scan page and confirm NO request goes to
   `connect.facebook.net`.** This is the important one, see section 3.
4. Confirm staging fires nothing at all.

### c. Mark the conversions

- GA4: mark `purchase` and `tag_activated` as key events.
- Meta: `Purchase` is standard. `TagActivated` is a custom event, so create a
  custom conversion for it in Events Manager or it cannot be optimised against.

---

## 3. The privacy rule, please do not undo this

The scan pages are used by **strangers standing at someone else's vehicle**. They
did not buy anything, did not sign up, and consented to nothing. Loading the Meta
Pixel there would hand Meta a record of an identified person scanning a specific
vehicle tag, from a product whose entire pitch is privacy. It is also the kind of
thing the DPDP Act is about.

So this is enforced in three places on purpose:

1. `data-surface="scanner"` on the scan page → the Pixel never initialises.
2. `scan_received` and `contact_action` carry `pixel: null` in the event map.
3. A test asserts both, so an edit that changes it fails CI.

There is a real cost to this, stated plainly: `tag_activated` also happens on that
page, so **Meta never receives your activation event.** That is your single best
optimisation signal and it is currently GA4-only. The correct fix is the
Conversions API (section 5), not putting the Pixel on the scan page.

Separately, `assets/analytics.js` has an **allow-list** (`var ALLOWED`) of
permitted parameter keys. Anything not named there is stripped before dispatch.
Do not switch this to a deny-list. `reason` is safe to send because it is one of
five fixed keys the UI offers and the server rejects anything else.

---

## 4. Known gaps

| Gap | Impact | Fix |
|---|---|---|
| **Razorpay webhook captures are not tracked** | A payment confirmed by webhook after the user closed the tab is never reported. Under-counts purchases | Server-side CAPI |
| **COD acceptance is not tracked** | We report the order, never the ~25% that fail at the door. Revenue over-reports | Fire on the delivery-status update |
| **`tag_activated` is GA4-only** | Meta cannot optimise on your best signal | Server-side CAPI |
| **Ad blockers / iOS ITP** | Expect 15-30% under-reporting on all client-side events | Server-side CAPI |
| **No consent banner** | Fine for now given no Pixel on the scan surface, but review before an EU launch | Out of scope |
| **Premium subscription has no distinct event** | It is reported as a `purchase` with the premium SKU in `items` | Segment on SKU in GA4. No code change needed |

Every one of these resolves the same way, which is the next piece of work.

---

## 5. Recommended next step: Conversions API

Add `src/backend/lib/integrations/meta-capi.js` posting to
`https://graph.facebook.com/v19.0/<PIXEL_ID>/events` and call it from the server
at the three moments the browser cannot be trusted with:

- `/api/shop/verify-payment` success and the Razorpay webhook → `Purchase`
- `/api/tags/:token/activate` success → `TagActivated`
- COD delivery confirmed → `Purchase`

`dispatch()` in `assets/analytics.js` already generates an `eventID` per event
and passes it to `fbq`. Send the **same** id from the server and Meta will
de-duplicate instead of double-counting. That is why it is there.

This is also what unblocks CTWA optimisation: right now Meta optimises for people
who *start chats*, which includes every tyre-kicker. With server-side purchase
events it learns who actually buys.

Reuse `env.metaAppSecret` handling and the `sanitizeProviderDetail()` /
`normalizeIndianNumber()` helpers already in `lib/integrations/meta.js`.

---

## 6. Testing

```bash
node --test --test-concurrency=1 src/backend/tests/analytics-asset.test.js
```

5 tests, all passing, no database needed. They cover: placeholder/renderer
agreement, substitution, the inert-when-unconfigured path, the scanner Pixel ban,
and the PII allow-list.

The full suite needs Mongo and `MONGODB_COLLECTION_PREFIX=test_`. The Atlas
credentials in the local `.env` currently fail auth, so the rest of the suite was
not run against these changes. Nothing here touches a DB code path.
