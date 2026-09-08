# ParkTag vs Sampark - Gap Analysis

Sources used: Sampark product pages, RFA_SPEC.md competitor section, and current codebase audit.

---

## What Sampark Has That ParkTag Does Not (Yet)

### 1. Emergency SOS Button

**Sampark:** Scanner can tap an Emergency button that reveals the owner's medical profile (blood group, allergies) and designated family/emergency contact numbers. No phone number entry is required for SOS.

**ParkTag now:** No SOS button exists anywhere in the scanner flow. The `index.html` scanner page has only "Call Owner" and "Leave WhatsApp Message". The RFA spec defines this as `R_SOS_DISCLOSURE` and it is marked HIGH priority - but it was deliberately deferred in PLAN.md.

**Impact:** In an accident or medical emergency scenario, ParkTag offers nothing. A bystander or paramedic gets a scanner page asking for their own phone number with no emergency exit.

**What to build:** A red SOS button on the scanner page that bypasses phone number entry and displays a pre-configured medical profile and one designated emergency contact number. No masking on SOS contacts - that is a deliberate privacy exception defined in the spec.

---

### 2. Emergency / Backup Contact (Family Number)

**Sampark:** Owner can add an alternative family contact number. If the owner is unreachable, the system can route through to the backup contact.

**ParkTag now:** The owner document in MongoDB stores only `phone` (single number). There is no `emergencyPhone`, `familyContact`, or fallback routing logic anywhere in the backend. The owner dashboard has no field to enter a second contact.

**Impact:** If the owner does not pick up, the scanner's only option is to leave a WhatsApp message and hope. There is no automatic fallback.

**What to build:**
- Add `emergencyPhone` and `emergencyName` fields to the owner schema
- Add input fields to the owner dashboard for emergency contact
- Optionally route the Exotel call to the emergency number if the primary call fails (requires Exotel status webhook to detect Leg B failure first)

---

### 3. Notification Channel Toggle (Per-Channel On/Off)

**Sampark:** Owner can individually toggle WhatsApp on or off, audio calls on or off, SMS on or off, independently.

**ParkTag now:** The owner can only toggle the entire tag Active/Inactive. There is no per-channel preference. If the owner turns the tag inactive, the scanner sees an unavailable state and cannot even leave a WhatsApp message through the call path (though the message action technically still works).

**Impact:** An owner who wants calls disabled but still wants WhatsApp messages has no way to do this.

**What to build:**
- Add `preferences` object to owner schema: `{ callEnabled: true, whatsappEnabled: true }`
- Expose toggles on the owner dashboard
- Read preferences in `contact-actions.js` before triggering each provider

---

### 4. PWA / Add to Home Screen

**Sampark:** Has a dedicated app (Android + iOS) for owners. Users get push notifications on their phone.

**ParkTag now:** The RFA spec explicitly calls for PWA support (`R_PWA_HOME`) as the alternative to a native app. There is no `manifest.json`, no service worker, and no `<meta name="theme-color">` in any of the HTML pages. The owner dashboard is a plain HTML page with no PWA capability.

**Impact:** Owners cannot add ParkTag to their home screen. Every time they need to check the dashboard they have to type the URL or find a bookmark. This is a friction gap vs. Sampark's native app.

**What to build:**
- Add a `manifest.json` with app name, icons, theme color, and display mode
- Link it from `owner.html` with `<link rel="manifest">`
- Add a basic service worker that caches the owner shell for offline loading
- Add `<meta name="theme-color">` and apple touch icon tags

---

### 5. Pre-defined Contact Reason / Reason Selection

**Sampark:** The scanner selects a reason for contact from a predefined list (e.g., "Your car is blocking my exit", "Lights left on", "Minor accident") before or alongside the contact action.

**ParkTag now:** The scanner types a free-form message for WhatsApp. For the call path there is no reason field at all. The contact request stored in MongoDB has no `reason` field.

**Impact:** The owner receives a call with no context. They pick up and have to figure out why they are being called. For the WhatsApp path, the scanner writes a custom message which is fine - but the call path gives zero context.

**What to build:**
- Add a `reason` dropdown on the scanner page (4-5 options: blocking exit, lights on, minor damage, other)
- Store `reason` in the contact request
- For the call path, consider using Exotel's `WaitUrl` to play a voice message to the owner telling them the reason before the bridge connects (this is already in the RFA spec as a feature of the Connect API)

---

### 6. Offline Support / PSTN-First Reliability

**Sampark:** Claims offline capabilities - the system can reach the owner even in poor internet coverage areas because it uses real phone calls (PSTN), not internet calls.

**ParkTag now:** The call itself is PSTN via Exotel (correct), but the scanner page requires an active internet connection to load and submit the contact request. If the scanner is in a basement or dead zone, the page will not load and nothing works. There is no offline fallback and no service worker caching the scanner page.

**Impact:** In exactly the situations where someone most needs to reach a car owner (underground parking, stadium basement), the page may fail to load for the scanner.

**What to build:**
- Cache the scanner page shell (`index.html`) via a service worker so it loads from cache if offline
- Show a clear offline message with a fallback (e.g., display the Exotel virtual number directly so the scanner can call it manually)

---

### 7. SMS as a Contact Channel

**Sampark:** Supports masked SMS as a recovery channel alongside WhatsApp.

**ParkTag now:** The codebase has Exotel SMS environment variables defined (`EXOTEL_SMS_SENDER_ID`, `EXOTEL_SMS_DLT_ENTITY_ID`, `EXOTEL_SMS_TEMPLATE_ID`) but zero SMS sending logic is implemented. The `exotel.js` lib has no `sendExotelSms` function. The scanner page does not show an SMS option.

**Impact:** If the owner does not have WhatsApp or has WhatsApp blocked, there is no fallback message channel.

**What to build:**
- Implement `sendExotelSms()` in `lib/exotel.js` using Exotel's SMS API
- Add SMS as a `messageChannel` option in the scanner action hub
- Note: TRAI DLT registration for the SMS sender ID is required before this works in India

---

### 8. Sunlight-Proof / High-Contrast UI

**Sampark:** Claims high-contrast, glare-resistant design for outdoor use.

**ParkTag now:** The scanner page (`index.html`) uses a dark background design which is reasonable. However, there is no explicit "Sunlight Mode", no WCAG 2.1 color contrast audit, and no mention of high-contrast printing guidelines for the physical sticker. The RFA spec defines this as `R_SUNLIGHT` (HIGH priority).

**Impact:** In harsh Indian sunlight, low-contrast UI elements may be unreadable. This is especially critical for the QR sticker itself and the first few seconds of the scanner page.

**What to build:**
- Run a WCAG 2.1 color contrast check on the scanner page buttons and text
- Ensure the CTA buttons (Call, WhatsApp) meet at least 4.5:1 contrast ratio
- Document sticker printing specs (minimum QR size, background color, border clearance)

---

### 9. Timed Do-Not-Disturb (Auto-Reactivation)

**Sampark:** Owners can set a timer so the tag automatically returns to Active after a set duration (e.g., 2 hours for a meeting or movie).

**ParkTag now:** The owner toggles Active/Inactive manually and must remember to turn it back on. There is no timer, no scheduled job, and no TTL-based auto-reactivation.

**Impact:** Owners forget to reactivate. The tag stays inactive. A scanner who genuinely needs help gets the "unavailable" page.

**What to build:** Deferred in the RFA spec to Phase 2. But worth noting as a gap vs. Sampark.

---

### 10. Digital eTag Download (When Physical Sticker Is Unavailable)

**Sampark:** Owner can download a digital version of their tag (eTag) to show on-screen if the physical sticker is lost, damaged, or not yet delivered.

**ParkTag now:** QR code download is implemented for newly registered owners (via `qr-output.js`). However, the owner dashboard does not have a persistent "Download My QR" button after initial registration. If an owner loses their sticker, they have to contact admin.

**Impact:** Owner is stuck without a physical sticker and cannot self-serve a replacement.

**What to build:**
- Add a "Download My QR" button to the owner dashboard that regenerates and downloads the current active QR image
- This is simple since the token never changes - just re-generate the QR PNG on demand

---

## What ParkTag Has That Sampark Does Not

These are ParkTag's current advantages worth preserving.

| ParkTag advantage | Why it matters |
|---|---|
| No app required for the owner either (pure web) | Sampark requires a native app download for owners |
| Admin batch issuance with print queue | Sampark handles this offline; ParkTag has a full digital print queue |
| Open self-registration without buying a sticker first | Sampark is hardware-first; ParkTag allows digital-first onboarding |
| Transparent backend (your own infra) | Sampark is a closed SaaS; ParkTag data stays under your control |

---

## Priority Order for Closing the Gaps

| # | Gap | Effort | Impact |
|---|---|---|---|
| 1 | Digital eTag re-download on owner dashboard | Low | High - self-service, no support needed |
| 2 | Emergency/backup contact field on owner profile | Low | High - safety use case |
| 3 | Pre-defined contact reason on scanner page | Low | Medium - better UX for owner |
| 4 | PWA manifest + Add to Home Screen | Medium | High - owner retention |
| 5 | Emergency SOS button on scanner page | Medium | High - differentiator and safety |
| 6 | Per-channel notification toggle (call/WhatsApp) | Medium | Medium - owner control |
| 7 | SMS channel via Exotel | Medium | Medium - needs DLT registration |
| 8 | WCAG contrast audit + sunlight mode | Low | Medium - usability outdoors |
| 9 | Scanner page offline caching (service worker) | Medium | Medium - dead-zone resilience |
| 10 | Timed DND / auto-reactivation | High | Low for MVP - Phase 2 |
