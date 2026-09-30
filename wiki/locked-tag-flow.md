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
- A recycled sticker clears `blockedAttempts`, `lastBlockedAt` and
  `lockedNudgeAt` (`DEMO_TAG_FIELDS`).

See `lib/core/locked-tag-nudge.js`.
