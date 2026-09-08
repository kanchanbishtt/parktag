# WhatsApp templates: what to submit, and why each one exists

Meta approval is the critical path for the lifecycle programme. Code can be
written while a template waits; a template cannot be written while code waits.
So **submit everything in section 2 in one batch**, then wire them as they clear.

Submit at: WhatsApp Manager → Message templates → Create Template.

---

## 1. The free win: switch the owner alert to a template we already have

`parktag_owner_notification` is the most important message ParkTag sends and the
worst formatted one in the account. It is the only template with no header, no
footer and no bold anywhere:

> Hello {{1}}, someone has reported an issue near your vehicle: {{2}}. Please
> check your vehicle at the earliest.

`parktag_owner_notification_v2` is **already approved** and already better, and
nothing calls it:

> **ParkTag**
> Hello {{1}}, someone scanned the ParkTag QR sticker on your vehicle and
> reported: {{2}}.
>
> Please check your vehicle when you can.
> *Powered by ParkTag*

Same two variables, same order. Pointing `sendMetaWhatsappAlert` at v2 is a
one-line change with no approval wait. Do it if v3 below is still in review when
the next deploy goes out.

---

## 2. Templates to submit

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

## 3. The footer says the wrong company

Every approved ParkTag template currently ends **`Powered by EditTree`**. The
customer bought a ParkTag, the message comes from ParkTag, and the link goes to
`app.parktag.me`, so naming a company they have never heard of is the one line
in the message that does not belong to them. It should read **`Powered by
ParkTag`** everywhere.

New templates in section 2 already say ParkTag. The five live ones need editing
in WhatsApp Manager:

| Template | Sent today |
| --- | --- |
| `parktag_order_update_v2` | yes, regularly |
| `parktag_membership_confirmed` | yes |
| `parktag_tag_activated` | about to be, this release |
| `parktag_cart_reminder` | about to be, this release |
| `parktag_owner_notification_v2` | yes, this release |

A footer edit sends the template back through review, so **do these one at a
time and confirm each is APPROVED before the next**. A template in review still
sends on its last approved version, so there is no outage, but editing all five
at once means every one of them is unverifiable at the same moment.

`parktag_upgrade_offer` is MARKETING and also carries the wrong footer. Leave it
until the win-back campaign is actually built, and edit it then.

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
