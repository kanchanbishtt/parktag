// Does this tag carry a live paid subscription?
//
// ONE tag, ONE subscription. This module exists because there used to be two:
// `tag.callSubscription`, read only by call-access.js, and
// `tag.documentSubscription`, read only by vault.js — two fields, two readers,
// never compared. A tag stamped with one and not the other came out half paid:
//
//   lapsed + callSubscription only      masked calls back, vault still at 3 docs
//   lapsed + documentSubscription only  vault back at 10, masked calls still off
//
// Nobody would have chosen that. It is the same purchase — the trial for calls
// and the trial for documents are deliberately the SAME 90 days off the SAME
// premiumTrialEndsAt(), because one tag has one receipt — and the renewal of
// that purchase must not be two independent switches either. The bug was latent
// rather than live only because nothing sells a subscription yet; it would have
// shipped the day checkout did, and grandfather-call-subscriptions.js, which
// stamps callSubscription alone, would have half-rescued every legacy tag.
//
// So: any of the three field names counts as THE tag's subscription.
//
//   subscription          the name to write from here on.
//   callSubscription      legacy. Still read, so the grandfather script and any
//   documentSubscription  tag already stamped keep working with no migration.
//
// Reading all three rather than migrating is deliberate: a migration that has
// to run before the code is correct is a migration that can be forgotten, and
// this must not be wrong in the window between deploy and script.
//
// If calls and storage are ever genuinely sold apart, this is the one function
// to split — and splitting it will be a decision somebody makes on purpose,
// which is exactly what the previous arrangement never got.

// Expiry is checked against the clock rather than trusting a job to have
// downgraded the tag on time: a renewal that fails at 3am must not quietly
// leave a paid tier open until somebody notices.
export function hasActiveSubscription(tag, now = Date.now()) {
  const sub = tag && (tag.subscription || tag.callSubscription || tag.documentSubscription);

  // `status` is compared exactly. "ACTIVE", "Active" and "trialing" are not
  // this, and a loose check here would let a provider's own vocabulary decide
  // who is entitled.
  if (!sub || sub.status !== "active") return false;

  // An ABSENT end date means open-ended, which is what a comped or
  // grandfathered tag looks like. Tested for absence specifically, not for
  // falsiness: an empty string is a blank field, not a decision to grant
  // somebody unlimited access, and a truthiness check reads the two the same.
  if (sub.currentPeriodEnd === null || sub.currentPeriodEnd === undefined) return true;

  // Anything else present must parse to a future instant. An unparseable date
  // reads as expired rather than unlimited — junk in this field must never be
  // the thing that hands service out.
  const endsAt = new Date(sub.currentPeriodEnd).getTime();
  return Number.isFinite(endsAt) && endsAt > now;
}
