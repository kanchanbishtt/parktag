# What happens at a locked E-Tag

An E-Tag locks once its free contacts are spent: one on an ordinary E-Tag, two
on door hanger stock. The lock is the product. Built 2026-09-30, to three rules
set by the owner.

## 1. Locked means locked

No masked call, no WhatsApp alert, and **no Emergency call** through a locked
E-Tag. `register-emergency-call` refuses it (402 `EMERGENCY_LOCKED`). The
Emergency button stays on the page and leads to the public helplines, which are
not ours to switch off.

- An emergency call never *spends* a free contact. It is only blocked once they
  are gone.
- A premium tag whose year has lapsed is a different case and keeps its
  Emergency call.
- On a one-contact E-Tag, the scanner's own call is what locks it, so they
  cannot then escalate to Emergency on the same visit.
- **Door hanger stock is the exception for the WhatsApp alert only.** See 5.

## 2. The scanner is promised nothing

The panel says: "This tag's free limit is used up. This was a free trial
ParkTag, and its owner has used the full limit." That is true every time.

It does **not** say the owner has been told. A message does go out, but it is
capped at one a day and a send can fail, so that line would sometimes be false,
and the person reading it is deciding whether to wait by a car. There is no
button and no status for the same reason. Likewise the helplines are introduced
as "Emergency calling is not available on this tag", never "no emergency contact
added", which the page cannot know.

## 3. The owner is sold the Premium tag

- **Trigger:** a scanner reading the plate off a locked tag (the verify route).
  Counted once per scanner per tag per day.
- **One message per tag per 24 hours**, WhatsApp and e-mail. Every attempt is
  counted; only the first in a day is sent. ParkTag has one WhatsApp number and
  it carries login codes and real alerts, so it must not become one people mute.
- **It never says what the scanner wanted.** The reason is what a contact buys.
  Passing it on would make a locked tag work exactly like an unlocked one.
- **The wording sells**: what is switched off, and what upgrading gives back.
  No price, no discount.
- **The dashboard card** shows "N people tried to reach you and could not".

## 4. The owner is told when the trial ends

Added 2026-10-01. Rule 3 only fires when a later scanner is turned away. The
owner is now also told **once, at the moment the last free contact is spent**:
"the free trial on the ParkTag for your vehicle … has ended", naming the plate.

- Both routes that spend a contact (`register-call`, `contact-requests`) call
  `notifyTrialEnded`, never awaited. A conditional update on the tag decides, so
  it fires only on the contact that locks the tag and only once.
- The tag records what happened: `trialEndedNotice: { at, whatsapp }`.
- WhatsApp only, on `parktag_free_trial_ended` (UTILITY, no pitch in the body).
  **Until Meta approves that template nothing is sent**, as before.

See `lib/core/trial-ended-notice.js` and `docs/WHATSAPP_TEMPLATES.md` 2.9.

## 5. Door hanger tags keep their WhatsApp alert for life

Owner's decision, 2026-10-01. On door hanger stock the lock takes the **private
call and the Emergency call**, and nothing else.

- **Which tags:** a non-premium tag stamped with more than one free contact
  (`hasLifetimeAlerts` in `lib/core/call-access.js`). That stamp is the only
  thing that marks door hanger stock. Ordinary E-Tags are unchanged.
- **The two free contacts are two free calls.** A WhatsApp alert spends neither,
  before or after the tag locks.
- **Server:** `/api/contact-requests` lets the alert through on a locked door
  hanger tag. `register-call` and `register-emergency-call` still refuse it.
- **Scan page:** `/verify` answers `messageAlwaysOn: true`. On a locked door
  hanger tag the WhatsApp tile stays, the Private Call tile is hidden, and a note
  says "Private Call isn't available on this tag". The Emergency button leads to
  the helplines, as on any locked E-Tag.
- **The alert names the vehicle** (`parktag_owner_notification_v4`).
- **Nothing sent to the owner mentions that WhatsApp keeps working.** The
  trial-ended notice (4) names calls only. The once-a-day message (3) uses a
  door hanger sentence: "they could not call you … private calls and the
  emergency call are switched off". The dashboard card reads "N people could not
  call you". None of them says alerts are off either, because that would be
  untrue.

## 6. A call counts only once it connects

Owner's rule, 2026-10-01. A free call used to be spent the moment the scanner
was handed the number to dial, so an unanswered call, a busy line, or a scanner
who never dialled each cost one. Now:

- **Nothing is spent at `register-call`.** It marks the authorisation
  `spendOnConnect` (E-Tags only) and hands out the number.
- **The free call is spent by Exotel's status callback**, when it reports at
  least **1 second of conversation** (`lib/core/free-call-spend.js`). An
  unanswered, busy, failed or cancelled call costs nothing, and can be redialled.
- **Talk time is the only evidence.** A status word with no duration spends
  nothing: Exotel says "completed" whether or not anybody answered.
- **Once per scan.** The authorisation is claimed by a conditional update, so a
  callback delivered twice counts once. Emergency calls and the owner's own
  callback are never marked and never spend.
- **Applies to every E-Tag**, ordinary and door hanger. A WhatsApp alert on an
  ordinary E-Tag still spends its one free contact when it is delivered.
- **The dependency:** if the Exotel status callback stops arriving, no free call
  is ever deducted. It is configured in production (`PLAN.md` 14.2).
- Consequence: on a one-contact E-Tag, a call the owner did not answer leaves
  the tag unlocked, so the scanner can still use Emergency.

## The known risk

The message rides in a variable of the approved *utility* alert, which is also
the template every real owner alert uses. Promotional copy there is tolerated
only as long as recipients do not block or report it; if they do, Meta can pause
the template and real alerts stop with it. The proper home is a marketing
template, which needs an opt-in the activation wizard does not yet collect. See
`docs/WHATSAPP_TEMPLATES.md` 2.8.

## Rules worth keeping

- The once-a-day send is claimed with a conditional update before it is made,
  and released if delivery fails.
- A recycled sticker clears `blockedAttempts`, `lastBlockedAt`,
  `lockedNudgeAt` and `trialEndedNotice` (`DEMO_TAG_FIELDS`).

See `lib/core/locked-tag-nudge.js`.
