// Who may reach an owner through call masking, and until when.
//
// Masking used to be a permanent property of a premium tag: buy the sticker,
// keep masked contact forever. It now works the way the document vault does —
// the purchase includes the service for a fixed period, after which continuing
// it is a subscription.
//
//   E-Tag                    one free masked contact, then blocked. Unchanged;
//                            this is what makes an unactivated sticker useful
//                            at all, and it is the whole upgrade prompt.
//   Premium, first 90 days   masking included. Buying a premium tag pays for
//                            this window, so an owner has used the service
//                            before being asked to pay again for it.
//   Premium + subscription   masking, for as long as the subscription runs.
//   Premium, lapsed          NO masking. The tag still works as a tag — the
//                            scanner still sees the vehicle and can leave a
//                            message — but the masked call is off.
//
// The 90 days are deliberately the SAME window as the document vault's, read
// from the same premiumTrialEndsAt(). One tag has one trial; documents and
// calls expiring on different days off the same purchase would be impossible
// to explain on a receipt.
//
// Like the vault, nothing SELLS this subscription yet: there is no checkout, no
// renewal job and no webhook that writes tag.callSubscription. What exists is
// the shape it will be written in, read from one place, so switching it on is
// stamping the tag rather than threading a new rule through three routes.

import { isInPremiumTrial, premiumTrialEndsAt } from "./vault.js";
import { hasActiveSubscription } from "./subscription.js";

export const CALL_TIER_ETAG_FREE = "etag-free";
export const CALL_TIER_ETAG_USED = "etag-used";
export const CALL_TIER_TRIAL = "premium-trial";
export const CALL_TIER_SUBSCRIBED = "premium-subscription";
export const CALL_TIER_LAPSED = "premium-lapsed";

// Is a paid call subscription running on this tag right now?
//
// Mirrors hasActiveDocumentSubscription exactly, including the two edge cases
// that matter, because a tag carrying both fields must not have them read by
// two different sets of rules:
//
//   - an ABSENT end date is open-ended, which is what a comped or grandfathered
//     tag looks like. Tested for absence specifically rather than falsiness: an
//     empty string is a blank field, not a decision to grant unlimited access.
//   - anything else present must parse to a future instant. Junk reads as
//     expired rather than unlimited, so a malformed tag can never mint service.
//
// Expiry is checked against the clock rather than trusting a job to have
// downgraded the tag: a renewal that fails at 3am must not leave masking open
// until somebody notices.
export function hasActiveCallSubscription(tag, now = Date.now()) {
  return hasActiveSubscription(tag, now);
}

// What one tag may do about calls. The single place this is decided — the
// scanner's availability check, the contact action, register-call and the
// owner's callback route all read this, so they cannot drift into disagreeing
// about who may call whom.
//
// `masking` is the only field a gate should branch on. The tier is for copy.
//
// `masking` is also what gates the owner's own masking switch in the app, and
// it is deliberately the SAME field the scanner gate reads rather than a
// second owner-facing boolean beside it. The ladder an owner climbs is:
//
//   E-Tag, free contact unused   switch live, on by default — the one free
//                                masked contact is theirs to use.
//   E-Tag, free contact spent    locked. Needs a premium tag.
//   Premium, first 90 days       switch live.
//   Premium, past 90 days        locked. Needs a subscription.
//   Premium + subscription       switch live.
//
// Which is "may this tag mask a call right now?" asked from the other side of
// the glass. Two booleans agreeing in every row would only be two things to
// keep in step, so there is one. The tier says WHY a locked switch is locked,
// and that is what the upgrade copy branches on.
export function callEntitlement(tag, now = Date.now()) {
  // `premium: true` is the single source of truth for a premium tag. Tags
  // issued before the flag existed have no field at all, which reads falsy —
  // correct, they are E-Tags.
  if (!tag || !tag.premium) {
    const used = Boolean(tag && tag.freeContactUsed);
    return {
      tier: used ? CALL_TIER_ETAG_USED : CALL_TIER_ETAG_FREE,
      masking: !used,
      premium: false,
      subscribed: false
    };
  }

  // A paying subscriber is never labelled as being on a trial, even inside the
  // first 90 days. Same access either way, but the page says something
  // different about each, and telling somebody who has paid that their calls
  // stop in three months would be alarming and wrong.
  if (hasActiveCallSubscription(tag, now)) {
    return { tier: CALL_TIER_SUBSCRIBED, masking: true, premium: true, subscribed: true };
  }

  if (isInPremiumTrial(tag, now)) {
    return {
      tier: CALL_TIER_TRIAL,
      masking: true,
      premium: true,
      subscribed: false,
      trialEndsAt: new Date(premiumTrialEndsAt(tag, now)).toISOString()
    };
  }

  return { tier: CALL_TIER_LAPSED, masking: false, premium: true, subscribed: false };
}

// What the scanner is told when masking is off.
//
// Two audiences, two messages, and they must not be merged. A scanner standing
// at a car cannot fix either problem, but the E-Tag case has a next step the
// owner can take and the lapsed case does not concern the scanner at all — so
// the lapsed message says nothing about money or subscriptions, which would
// read as this vehicle's owner being in arrears to a stranger.
export function callBlockedMessage(entitlement) {
  if (entitlement && entitlement.tier === CALL_TIER_LAPSED) {
    return "Calling isn't available for this vehicle right now. You can still leave a message.";
  }
  return "This E-Tag's free contact has already been used. The owner can re-enable contact with the official ParkTag sticker.";
}

// The machine-readable reason, for clients that branch on it.
//
// FREE_USED is kept verbatim for the E-Tag case: the scanner page already
// branches on that string, and renaming it would silently change what an
// already-deployed page does with an unactivated sticker.
export function callBlockedCode(entitlement) {
  return entitlement && entitlement.tier === CALL_TIER_LAPSED ? "CALL_SUBSCRIPTION_REQUIRED" : "FREE_USED";
}
