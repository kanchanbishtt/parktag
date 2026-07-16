# Telephony & Messaging Assumptions (M7)

This note records the implementation assumptions and real-world constraints behind
ParkTag's two provider paths: **Exotel** (calls) and **Meta WhatsApp Cloud API**
(messaging). It is the `wiki/` write-up called for by TASKS.md M7.

## Split of responsibilities

- **Calls → Exotel only.** Masked voice bridging between finder and owner.
- **Messaging → Meta WhatsApp Cloud API only.** No SMS.

Exotel's SMS / WhatsApp send helpers (`sendExotelSms`, `sendExotelMessage`) still exist
in `lib/integrations/exotel.js` but are **not on the active scanner path** — they are
legacy and kept only for reference.

---

## Calls — Exotel (inbound "Dial-Whom" / Connect-to-Flow)

### How it actually works
- The call path is **inbound**, not outbound. The finder/owner dials a virtual ExoPhone;
  Exotel calls `GET /api/exotel/dial-whom`, and the backend returns the party to connect.
- The earlier outbound `triggerExotelCall` trigger was **retired in M13** — do not
  re-introduce outbound dialing.
- Status callbacks (duration, result, recording) land at
  `POST /api/provider/exotel/webhook` and are mapped onto the `contactRequests` record.

### Assumptions we depend on
- **ExoPhone `08047284348`** is attached to this flow in Exotel App Bazaar. Changing the
  flow attachment in the Exotel console silently breaks bridging — there is no in-app alarm.
- Exotel's URL validation pings `dial-whom` with **no caller param**; the endpoint must
  answer **HTTP 200 + empty body** in that case or Exotel rejects the flow.
- Exotel sends `CallFrom` in **trunk-prefix format** (`0XXXXXXXXXX`, 11 digits leading `0`).
  `toE164()` in `exotel.js` normalizes this; a provider format change would require updating it.
- `targetPhone` is normalized to E.164 via `toE164()` before being returned to Exotel.
- `EXOTEL_STATUS_CALLBACK_URL` must point at the deployed webhook
  (`https://app.parktag.me/api/provider/exotel/webhook`); it is set in Railway env vars.

### Real-world constraints
- **Neither party ever sees the other's number** — this is the core privacy guarantee and
  depends entirely on Exotel doing the bridging; the backend never returns raw numbers to a
  browser.
- Failure states are masked (`maskPhoneLikeValue` / `sanitizeProviderDetail`) so a failed
  call never leaks a phone number into logs or admin views.
- Recording URLs, when present, are provider-hosted; ParkTag only stores the link.

---

## Messaging — Meta WhatsApp Cloud API (Graph API v19.0)

### How it actually works
- The scanner "Send Message" action creates `POST /api/contact-requests` with
  `action:"message"`, `messageChannel:"whatsapp"`, then the backend calls
  `sendMetaWhatsapp` (official Graph `/messages` contract).
- Delivery status (`sent / delivered / read / failed`) is received at
  `POST /api/provider/meta/webhook` and mapped onto the `contactRequests` record **by wamid**
  (`providerRequestId`).
- The `GET /api/provider/meta/webhook` handler echoes `hub.challenge` when
  `hub.verify_token` matches — this is how Meta validates the webhook.

### Assumptions we depend on
- **The Graph API version is pinned to `v19.0` in `meta.js`** — there is no env var for it.
  When Meta deprecates v19.0, this string must be bumped in code.
- **The message body is built entirely server-side** (`contact-actions.js`
  `WHATSAPP_BASE_MESSAGE` + whitelisted `REASON_LABELS`). The finder can **never** author
  free text that reaches the owner — this is a hard privacy/abuse boundary, not a convenience.
- WhatsApp delivery to a user who has **not messaged the business in 24h** requires an
  **approved message template**. Live delivery was verified with an approved Meta template
  and real numbers; template approval is a Meta-console dependency outside this repo.
- Required provider values live only in env (server-side): `META_WHATSAPP_PHONE_NUMBER_ID`,
  `META_WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
  None of these are ever exposed to the scanner UI.

### Real-world constraints
- **Access tokens expire.** A long-lived system-user token is assumed; if a short-lived
  token is used, sends start failing silently with a Meta auth error — check
  `providerError` on the contact request.
- Failure detail is masked before storage; a failed send never persists a raw phone number
  or full Meta error payload.
- Both owner and admin surfaces show message-attempt state, but they show **status only**,
  never the message-provider secrets.

---

## Shared persistence

Both calls and WhatsApp attempts share the **`contactRequests`** collection:
`provider`, `providerRequestId`, `providerWebhookStatus`, `providerError`,
`callResult`, `callDuration`, `recordingUrl`, `status`. This keeps one activity timeline
across both providers for owner + admin views.

## Non-goals / open items

- No SMS path (deliberate — see `wiki/whatsapp-mvp-plan.md`).
- No retry/backoff on provider failures — a failed attempt stays failed and is surfaced,
  not auto-retried.
- Graph API version and ExoPhone flow attachment are **manual, console-side** dependencies;
  they are not health-checked by the app.
