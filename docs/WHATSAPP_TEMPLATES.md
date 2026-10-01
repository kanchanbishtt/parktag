# WhatsApp templates: the copy, and why each one exists

**Status: all seven new templates are submitted and in review, and every live
ParkTag template now reads `Powered by ParkTag`.** Done via the Graph API on
2026-09-08 with the `App For CRM` system-user token, which carries
`whatsapp_business_management`.

This file is the source of truth for the COPY. When a template is rejected, fix
the wording here first and resubmit from here, so the repo and WhatsApp Manager
never disagree about what a customer was told.

Check state with `npm run verify:whatsapp`, or `GET /v21.0/{WABA_ID}/message_templates`.

---

## 0. In review

| Template | Category | Why it exists |
| --- | --- | --- |
| `parktag_owner_notification_v3` | UTILITY | the alert, with a Call-back button |
| `parktag_trial_ending` | UTILITY | T-30 / T-7 / T-1, one template |
| `parktag_premium_lapsed` | UTILITY | the day the year ends |
| `parktag_doc_expiry` | UTILITY | insurance / PUC expiring |
| `parktag_activation_pending` | UTILITY | delivered, never activated |
| `parktag_call_missed` | UTILITY | a scanner rang and got no answer |
| `parktag_referral_reward` | UTILITY | a reward already earned |

Plus six footer edits, which put those templates back in review as well. **A
template in review still sends on its last approved version, so there is no
outage** — only a window in which it cannot be edited again.

Two deliberate departures from the copy below, both made at submission to avoid
a rejection sitting on the critical path:

- **`parktag_trial_ending` does not name the price.** "from Rs 249 for a year"
  was cut. A price in a UTILITY body is the likeliest rejection reason in this
  batch, and the button already leads to the page that quotes it.
- **`parktag_referral_reward` ends "…with nothing else for you to do."** The
  version below ended on `*{{4}}*` plus a full stop, and Meta rejects a body
  whose last token is a placeholder.

---

## 1. The interim alert template

`parktag_owner_notification` is the most important message ParkTag sends and the
worst formatted one in the account. It is the only template with no header, no
footer and no bold anywhere:

> Hello {{1}}, someone has reported an issue near your vehicle: {{2}}. Please
> check your vehicle at the earliest.

`parktag_owner_notification_v2` is already approved and already better, and it
is what the code sends today (`OWNER_ALERT_TEMPLATE` in
`src/backend/lib/integrations/meta.js`):

> **ParkTag**
> Hello {{1}}, someone scanned the ParkTag QR sticker on your vehicle and
> reported: {{2}}.
>
> Please check your vehicle when you can.
> *Powered by ParkTag*

Same two variables, same order, so this is the safe place to sit while v3 is in
review. **When v3 is APPROVED, change `OWNER_ALERT_TEMPLATE` to
`parktag_owner_notification_v3` and deploy** — the button parameter is already
being passed, and the constant flips the send to the button variant on its own.

---

## 2. The copy, as submitted

All **UTILITY** unless marked otherwise. Utility is not a billing preference: it
is the category for a message about something the customer already has. The
moment a body carries an offer or a discount it is marketing, needs recorded
opt-in, and costs roughly seven times as much.

Meta's rules that bite most often when writing these:

- A body may not **start or end** with a variable.
- Two variables may not be **adjacent** (`{{1}} {{2}}` is rejected).
- A URL button is a **fixed approved base plus one variable suffix**. It cannot
  be a whole URL passed at send time.
- Every variable needs a sample value at submission.

---

### 2.1 `parktag_owner_notification_v3` — UTILITY

**The one that matters.** The current alert tells an owner something is wrong
with their car and gives them nothing to do about it, while
`CALLBACK_WINDOW_MS` (`routes/owner/dashboard.js:54`) gives them exactly ten
minutes to call that scanner back. The window expires while they look for an app
that does not exist.

New name rather than an edit: editing a live template sends it back through
review, and this one carries real traffic.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, someone just scanned the ParkTag on your vehicle.

They reported: *{{2}}*

You can call them back privately for the next 10 minutes. Your number stays
hidden from them.
```

**Footer:** `Powered by ParkTag`

**Button (URL, dynamic):**
`https://app.parktag.me/v/{{1}}` — text: `Call them back`

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `the vehicle's lights appear to be on`,
button `{{1}}` = `65f1a2b3c4d5e6f701234567`

> **The button target is live.** `/v/:tagId` exists (`src/backend/app.js`,
> tested in `src/backend/tests/vehicle-deep-link.test.js`). It resolves the tag,
> requires an owner session, parks the intent through sign-in for a signed-out
> owner, and lands on the dashboard scrolled to the Activity list, which is where
> the Call Back button lives.
>
> The id in the button is the tag's **ObjectId, not its scan token**. The token
> is the QR secret printed on the sticker, and a forwarded message carrying it
> would hand a stranger the scan page for that vehicle.
>
> `lib/integrations/meta.js` already passes the button parameter. Switching to v3
> once approved is one line: `OWNER_ALERT_TEMPLATE`.

---

### 2.2 `parktag_trial_ending` — UTILITY

One template for all three notices (T-30, T-7, T-1). One approval instead of
three, and the copy stays identical across them, which is what makes the third
one read as a final notice rather than as nagging.

This is the commercial spine of the premium year. Everything else supports it.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, the premium year on your *{{2}}* ends in *{{3}}*.

After that, masked calls switch off and your document vault drops to 3 files.
Renewing keeps both, from Rs 249 for a year.
```

**Footer:** `Powered by ParkTag`

**Button (URL, dynamic):**
`https://app.parktag.me/owner-membership?tag={{1}}` — text: `Keep premium on`

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `Honda City`, `{{3}}` = `30 days`

> Naming the price in a utility template is a judgement call. It is defensible
> here because it states the cost of continuing a service the customer already
> holds, which is a fact about their account rather than an offer. If Meta pushes
> back, drop the second sentence and let the button carry it.

---

### 2.3 `parktag_premium_lapsed` — UTILITY

Sent the day it ends. Not an offer, a status change, and it must go out whether
or not they ever renew: a customer who does not know masking is off will believe
the product broke.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, the premium year on your *{{2}}* has ended.

Masked calls are now off, so a scanner can no longer reach you by phone through
the tag. Your QR still works and your documents are safe.
```

**Footer:** `Powered by ParkTag`

**Button (URL, dynamic):** `https://app.parktag.me/owner-membership?tag={{1}}` — text: `Turn premium back on`

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `Honda City`

---

### 2.4 `parktag_doc_expiry` — UTILITY

The strongest reason anyone has to come back to the web app, and the thing that
makes the vault worth paying for at 2.2. A free insurance reminder for a vehicle
whose papers you already stored.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, the *{{2}}* you stored for your *{{3}}* expires on *{{4}}*.

Your copy is in your ParkTag vault whenever you need it.
```

**Footer:** `Powered by ParkTag`

**Button (URL, dynamic):** `https://app.parktag.me/owner-documents?tag={{1}}` — text: `Open my documents`

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `insurance policy`, `{{3}}` = `Honda City`, `{{4}}` = `12 October 2026`

> **Data prerequisite.** `vaultDocuments` has `label` and `type` but no expiry
> date. Needs an optional `expiresOn`, asked for at upload only for insurance and
> PUC.

---

### 2.5 `parktag_activation_pending` — UTILITY

Delivered three days ago, still unactivated. An unactivated tag is a customer who
paid and got nothing, and today nothing chases them.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, your ParkTag sticker was delivered but has not been activated yet.

It takes about a minute: stick it on the windscreen, scan it with your phone
camera, and enter your details. Until then it cannot reach you.
```

**Footer:** `Powered by ParkTag`

**Button (URL, static):** `https://app.parktag.me/owner` — text: `Activate my tag`

**Samples:** `{{1}}` = `Girish`

---

### 2.6 `parktag_call_missed` — UTILITY

A scanner rang and the owner missed it. `lib/core/call-outcome.js` already
computes the verdict; nothing tells the owner.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, someone tried to call you about your *{{2}}* through ParkTag and you
missed it.

You can call them back privately for the next 10 minutes.
```

**Footer:** `Powered by ParkTag`

**Button (URL, dynamic):** `https://app.parktag.me/v/{{1}}` — text: `Call them back`

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `Honda City`

> Same `/v/:tagId` prerequisite as 2.1.

---

### 2.7 `parktag_referral_reward` — UTILITY

Confirms a reward that has already been earned, which is a fact about the
customer's account rather than a solicitation. The message that *asks* for a
referral is marketing and belongs in `parktag_upgrade_offer` or in e-mail.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, good news. *{{2}}* used your ParkTag referral, so we have added
*{{3}}* of premium to your account.

Your premium now runs until *{{4}}*.
```

**Footer:** `Powered by ParkTag`

**Button (URL, static):** `https://app.parktag.me/owner` — text: `See my account`

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `Kanchan`, `{{3}}` = `1 month`, `{{4}}` = `12 October 2027`

---

### 2.8 `parktag_tag_locked` — MARKETING (not yet submitted)

For an E-Tag whose free contacts are spent, sent when a scanner reads the plate
off it and finds it locked. At most once per tag per 24 hours
(`lib/core/locked-tag-nudge.js`). Its job is to sell the Premium tag at the one
moment the owner can see what the free one is costing them.

Not to be confused with 2.9, which tells the owner once, as a plain UTILITY
notice, at the moment the trial ends.

**Until this is approved the app sends `parktag_owner_notification_v2`
instead**, with a fixed sentence in `{{2}}` (`LOCKED_NUDGE_REASON`). That works
today, but it is a sales message riding in a UTILITY template, and two things
follow from that:

- The alert's closing line, "Please check your vehicle when you can", is
  written for a reported problem and reads oddly after a pitch.
- Meta does not review a variable at send time, but it does act on how
  recipients respond. A utility template that draws blocks or reports can be
  paused, and this one also carries **every real owner alert**. Keep the
  sentence free of prices and discounts, and move to the template below as
  soon as it can be used.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, someone just tried to reach you at your *{{2}}* and could not get
through.

The free contacts on your ParkTag are finished, so calls, WhatsApp alerts and
the emergency call are all switched off.

Upgrade to a Premium tag for unlimited private calls and alerts for a full
year, and never miss someone at your vehicle again.
```

**Footer:** `Powered by ParkTag`

**Buttons:** URL, dynamic, `https://app.parktag.me/v/{{1}}` — text: `Get Premium`;
quick reply — text: `Stop promotions` (the Meta webhook already honours it).

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `car`, button `{{1}}` = `65f1a2b3c4d5e6f701234567`

What has to be true before the code switches to it:

- **It is MARKETING, so it needs consent.** `canSendMarketing` requires a
  recorded opt-in, and an owner who activated a door hanger was never asked for
  one. Either add an opt-in tick to the activation wizard first, or this
  template reaches almost nobody. Until then the v2 alert is the only thing
  that gets through.
- **It never carries the scanner's reason.** The reason is what a free contact
  buys. A locked tag that still delivers it is not locked.
- **Price stays out of the body** even here. The button leads to the page that
  quotes it, and a price in the text dates the template the day it changes.

To switch: add a sender beside `sendMetaWhatsappAlert` in
`lib/integrations/meta.js` (two body variables and the `/v/` button parameter,
the same shape as `sendMetaWhatsappTrialEnding`), gate it on `canSendMarketing`
in `sendNudge`, and keep the v2 alert as the fallback for owners without an
opt-in.

---

### 2.9 `parktag_free_trial_ended` — UTILITY (submitted 2026-10-01, Meta id 1136798835688745)

Sent **once per tag, at the moment its last free contact is spent**: the first
on an ordinary E-Tag, the second on door hanger stock
(`lib/core/trial-ended-notice.js`). Until now an owner learned their tag had
locked only when a later scanner was turned away, which could be days on.

This is not 2.8. That one fires when a scanner is turned away, and sells. This
one states a change to something the owner holds, the way
`parktag_premium_lapsed` does, so it needs no marketing opt-in and reaches a
door hanger owner, who was never asked for one.

**Header (text):** `ParkTag`

**Body:**
```
Hi *{{1}}*, the free trial on the ParkTag for your vehicle *{{2}}* has ended.

Its free contacts are used up, so private calls and the emergency call through
this tag are now switched off.
```

> **WhatsApp alerts are not mentioned, on purpose** (owner's decision,
> 2026-10-01). The first approved version listed "calls, WhatsApp alerts and
> the emergency call"; it was edited the same day to name calls only.

**Footer:** `Powered by ParkTag`

**Button (URL, dynamic):** `https://app.parktag.me/v/{{1}}` — text: `See my vehicle`

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `DL9CP4455`, button `{{1}}` = `65f1a2b3c4d5e6f701234567`

> **No word of Premium, a price or an upgrade in the body**, on purpose. That is
> what keeps it UTILITY (see 2.2); the button leads to the page that sells.
>
> **The button says "See my vehicle", not "Turn my tag back on".** Checked in
> the account on 2026-10-01: `parktag_premium_lapsed` ("…has ended", button
> "Turn premium back on") was filed as MARKETING, while
> `parktag_premium_ending_today` (near-identical body, button "See my vehicle"
> to `/v/{{1}}`) stayed UTILITY. The buying verb on the button is the
> difference, so this one uses the button that survived.
>
> `{{2}}` is the full plate. It goes to the owner's own number, and it is what
> tells an owner with several tags which one has locked.
>
> **Nothing stands in for it while it is in review.** The owner alert's wording
> is "someone … reported", which this is not, so until approval no message is
> sent at this moment, exactly as before. The tag records the outcome either
> way: `trialEndedNotice: { at, whatsapp: "sent" | "not-sent" }`.

---

### 2.10 `parktag_emergency_location_v1` — UTILITY (submitted 2026-10-01, Meta id 2671684443267225)

Where the car is, sent to the owner's **emergency contact** after an SOS call in
which the scanner tapped "Share where the car is" (`lib/core/emergency-alert.js`).
Until it is approved the same facts ride in `{{2}}` of the owner alert, which
opens "Hello there, someone scanned the ParkTag QR sticker on your vehicle…" to
a relative who owns no ParkTag, and carries the map link as untappable body text.

**Header (text):** `ParkTag`

**Body:**
```
An emergency has been reported at vehicle *{{1}}*, near *{{2}}*.

The person at the vehicle is calling you through ParkTag. If you miss the call,
tap the button below to see where the vehicle is.
```

**Footer:** `Powered by ParkTag`

**Button (URL, dynamic):** `https://www.google.com/maps/search/?api=1&query={{1}}` — text: `Open in Maps`

**Samples:** `{{1}}` = `DL9CP####`, `{{2}}` = `Wave Mall, Sector 18, Noida`, button `{{1}}` = `28.5677,77.323`

> `{{1}}` is the **masked** plate and there is no name in the body: a mistyped
> emergency number must receive nothing that identifies a person. When Ola Maps
> returns no place, `{{2}}` is "the point shown on the map", because Meta
> rejects a blank variable.
>
> The button is the one place a link outside our own domain is used: it is the
> same Google Maps link `carMapLink()` already builds, and the variable is only
> the rounded `lat,lng`.

---

### 2.11 `parktag_owner_notification_v4` — UTILITY (submitted 2026-10-01, Meta id 39009627572018151)

`parktag_owner_notification_v2` with the **vehicle number** added, for an owner
with several tags who cannot otherwise tell which vehicle the alert is about.

A new name rather than an edit of v2. An edit that adds a variable would, the
moment Meta approved it, reject every send still passing two, and the alert
would be down until the next deploy.

**Header (text):** `ParkTag`

**Body:**
```
Hello {{1}}, someone scanned the ParkTag QR sticker on your vehicle *{{2}}* and
reported: {{3}}.

Please check your vehicle when you can.
```

**Footer:** `Powered by ParkTag`

**Samples:** `{{1}}` = `Girish`, `{{2}}` = `DL9CP4455`, `{{3}}` = `the vehicle's lights appear to be on`

> `sendMetaWhatsappAlert` tries this template whenever the caller passes a
> plate, and falls back to v2 when the send fails, so approval needs no deploy.
>
> **The plate reaches the owner before approval too.** v2 and the map variant
> have no slot for it, so there it is appended to the reason:
> "…and reported: the vehicle's lights appear to be on (vehicle DL9CP4455)."
> The map variant (`parktag_owner_notification_map_v1`) keeps doing that after
> v4 is approved; a `map_v2` with its own plate variable is the tidy follow-up.
>
> No Call-back button. That is `parktag_owner_notification_v3`, still not
> switched on; folding the two together is a separate decision.

**How 2.9, 2.10 and 2.11 were submitted:** `node --env-file=.env.meta.local src/backend/scripts/create-alert-templates.js`
with the production `META_WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_BUSINESS_ACCOUNT_ID`
(`--dry-run` prints the three payloads and sends nothing). After approval run
`npm run verify:whatsapp`: it reports each one's status and flags any that Meta
has filed as MARKETING, which should then be deleted.

---

## 3. Footers: done

Edited via the API: `parktag_tag_activated`, `parktag_order_update_v2`,
`parktag_membership_confirmed`, `parktag_cart_reminder`,
`parktag_owner_notification_v2`, `parktag_upgrade_offer`.

Two were skipped on purpose, because both should be deleted rather than edited:

- **`parktag_order_update`** (v1) is superseded by v2 and called by nothing.
- **`send_invoice_customer`** is not ParkTag's at all. It is a leftover EditTree
  invoicing template, MARKETING, whose button points at a Google Maps review
  link.

`parktag_owner_notification` (v1) has no footer to edit, which is part of why it
is being replaced rather than fixed.

## 4. Housekeeping in WhatsApp Manager

- **`hello_world`** and **`send_invoice_customer`** are not ParkTag's. The second
  is a leftover from another EditTree workflow, is MARKETING, and points its
  button at a Google Maps review link. Delete both.
- **`parktag_order_update`** (v1) is superseded by `parktag_order_update_v2` and
  nothing calls it. Delete once v2 has run for a while.
- **`parktag_owner_notification`** (v1) can be deleted once v3 is live and the
  code has been switched.
- **`parktag_upgrade_offer`** is MARKETING and already carries a "Stop promotions"
  quick-reply button. That button now works: the Meta webhook reads
  `value.messages` and records the opt-out. **It could not be honoured before**,
  so this template should not have been sent at all.

## 5. Rules for whoever writes the next one

The house style is set by `parktag_order_update_v2`, which is the best template
in the account:

1. A `ParkTag` text header and a `Powered by ParkTag` footer. Always.
2. Bold the name and the one fact that matters. Nothing else.
3. A blank line between facts. Not one paragraph.
4. A URL **button**, never a bare URL in the body. A link in body text is not
   tappable in every client and cannot be measured.
5. No em-dashes.
6. Under four short lines. This is read on a lock screen.
7. Add it to the list in `src/backend/scripts/verify-whatsapp-templates.js`, which
   is the only thing that catches a rejected or mis-shaped template before a
   customer does. Run `npm run verify:whatsapp`.

---

## Owner alert with a map: `parktag_owner_notification_map_v1`

Submitted 25 Sep 2026 (Meta id 1814668546543159, UTILITY). It's v2 with an IMAGE header. It's sent only when the scanner tapped "Share where the car is", and the header is `/m/<token>.png`, a static Ola Maps image of the rounded point (lib/core/car-location.js).

> [map image]
> Hello {{1}}, someone scanned the ParkTag on your vehicle and reported: {{2}}.
>
> The map shows roughly where your vehicle is. Please check it when you can.
> *Powered by ParkTag*

{{2}} already carries the place ("…, near Wave Mall, Sector 18, Noida"), so the plain v2 alert names the place too. `sendMetaWhatsappAlert` tries this template first. Until it is approved, the send fails and falls back to v2 on its own, so approval needs no deploy.
