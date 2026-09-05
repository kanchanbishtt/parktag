// Turning a paid membership order into time on a tag.
//
// Shared by the two paths that can report a payment, exactly like
// fulfilPaidOrder is for the shop: POST /api/owner/membership/verify-payment,
// called by the buyer's browser, and the Razorpay webhook, which does not
// depend on the buyer's device surviving the redirect. Whichever arrives first
// does the work and the other is a no-op — a lesson this codebase learned the
// expensive way, with a webhook that was never configured and orders that sat
// unfulfilled because the tab closed.
//
// ONE TAG, ONE SUBSCRIPTION. subscription.js is the only thing that decides
// whether a tag is entitled, and it reads `tag.subscription`. That is the field
// written here. The two legacy names it also reads — callSubscription and
// documentSubscription — are deliberately NOT written: they exist so tags
// stamped before that module was unified keep working, and writing a third
// copy of the same fact is how they came to disagree in the first place.

import { hasActiveSubscription } from "./subscription.js";
import { premiumTrialEndsAt } from "./vault.js";
import { addMonths } from "./calendar.js";
import { getMembershipPlan } from "./membership-plans.js";
import { firstNameOf, resolveOwnerName } from "./owner-name.js";
import {
  isMetaWhatsappConfigured,
  sendMetaWhatsappMembershipConfirmation
} from "../integrations/meta.js";
import { sendMembershipConfirmationEmail } from "../integrations/email.js";

// Re-exported because this was its home before the complimentary year needed
// the same arithmetic, and callers — including the tests that pin the
// month-end clamping — import it from here.
export { addMonths };

// Where a newly bought period should start.
//
// Not "now". Three things can already be running, and charging over the top of
// any of them means selling somebody days they already hold:
//
//   an active paid period   renewing early must EXTEND, not reset. Buying a
//                           second year in month eleven is the ordinary case.
//   the free year           a premium tag carries one from activation. Starting
//                           a paid month today would eat into a year of free
//                           service.
//   nothing                 start from now.
//
// So the base is the furthest-out of them. This is deliberately generous at the
// boundary: a lapsed subscription's end date is in the past, so it falls back
// to `now` rather than back-dating the new period into the gap.
export function membershipPeriodStart(tag, now = Date.now()) {
  let start = now;

  const sub = tag && (tag.subscription || tag.callSubscription || tag.documentSubscription);
  if (hasActiveSubscription(tag, now) && sub && sub.currentPeriodEnd) {
    const end = new Date(sub.currentPeriodEnd).getTime();
    if (Number.isFinite(end) && end > start) start = end;
  }

  // premiumTrialEndsAt returns null for a non-premium tag or an unparseable
  // start date, and it refuses a start date far in the future rather than
  // granting an unbounded trial — so a bad field cannot push a paid period
  // years out.
  const trialEnd = premiumTrialEndsAt(tag, now);
  if (trialEnd) {
    const end = new Date(trialEnd).getTime();
    if (Number.isFinite(end) && end > start) start = end;
  }

  return start;
}

// The date premium runs until, as a person in India would read it.
//
// IST, not UTC. A period ending at 2027-09-12T19:30:00Z is the 13th in Delhi,
// and a confirmation that names the wrong last day is worse than one that names
// no day at all — it is the number the buyer will hold us to.
function readableDate(iso) {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(at);
}

// Tell the buyer their membership went through.
//
// Until this existed, NOTHING did. activateMembership extended the tag, logged
// a line for us, and returned; the buyer's only confirmation was a dialog in
// the tab they had just paid in. Close that tab — or pay on a phone that slept
// through the redirect — and the money was gone with no acknowledgement on any
// channel. Worse, the Razorpay webhook is the path that exists PRECISELY for
// the closed-tab case, and it has no browser to show a dialog to at all, so the
// people most in need of a confirmation were the only ones guaranteed not to
// get one.
//
// Best-effort, and deliberately so: the payment is captured and the
// subscription is already extended by the time this runs. A template that is
// not approved yet, or a number that is not on WhatsApp, must never turn a
// successful purchase into a failed one — so every failure here is logged and
// swallowed.
async function sendMembershipConfirmation(env, collections, { order, currentPeriodEnd, log }) {
  try {
    if (!env) return;

    const owner = order.ownerId
      ? await collections.owners.findOne({ _id: order.ownerId })
      : null;

    // The delivery address, purely for the name on it.
    //
    // Sign-in asks for a phone number and nothing else, so an owner who has
    // never filled in the dashboard greeting has no name we can use and the
    // message opens "Hi there". They almost certainly have one on file
    // regardless: a membership needs an activated tag, an activated tag came
    // from an order, and an order asked for a name to put on the parcel.
    // resolveOwnerName has always taken this as its second source — it just
    // had to be fetched. One indexed read (addresses is unique on ownerId)
    // against a message the buyer keeps.
    //
    // Optional in every sense: a missing collection, a missing row or a throw
    // all land on "there", which is what it said before.
    let address = null;
    if (owner && collections.addresses) {
      address = await collections.addresses
        .findOne({ ownerId: owner._id })
        .catch(() => null);
    }
    // Both fields are written together at signup, but older accounts carry only
    // one of them — login-pin.js reads the same pair for the same reason.
    const mobile = owner && (owner.mobile || owner.phone);
    const email = owner && owner.email;
    const endsOn = currentPeriodEnd ? readableDate(currentPeriodEnd) : null;

    // Without a date there is nothing worth saying on any channel — the one
    // fact this message exists to carry is how long they have bought.
    if (!endsOn) {
      log?.error?.(
        {
          event: "membership-confirmation-undeliverable",
          orderId: order.orderId,
          hasPhone: Boolean(mobile),
          hasEmail: Boolean(email),
          hasEndDate: false
        },
        "[membership] a PAID membership could not be confirmed to its buyer"
      );
      return;
    }

    const plan = getMembershipPlan(order.planId);
    // Never the raw displayName: the OTP signup path used to store the phone
    // number in it, and neither a Meta template nor a sent e-mail can be
    // edited afterwards.
    const name = firstNameOf(resolveOwnerName(owner, address)) || "there";
    const planLabel = (plan && plan.label) || `${order.months} month`;

    // BOTH channels, started together — the shape sendOrderConfirmation uses,
    // and for the same reason. This used to require a mobile and send only
    // WhatsApp, so an owner who signed up by e-mail and never added a number
    // got NOTHING: no message, a logged "undeliverable", and a membership they
    // had already paid for. Each promise absorbs its own rejection and reports
    // a boolean, so one channel failing cannot suppress the other.
    const attempts = [];

    if (mobile && isMetaWhatsappConfigured(env)) {
      attempts.push(
        sendMetaWhatsappMembershipConfirmation(env, { to: mobile, name, planLabel, endsOn })
          .then(() => true)
          .catch((err) => {
            log?.error?.({ err, orderId: order.orderId }, "[membership] confirmation WhatsApp failed");
            return false;
          })
      );
    }

    if (email) {
      attempts.push(
        sendMembershipConfirmationEmail(env, {
          to: email,
          name,
          planLabel,
          endsOn,
          orderNumber: order.orderNumber || null
        })
          .then(() => true)
          .catch((err) => {
            log?.error?.({ err, orderId: order.orderId }, "[membership] confirmation e-mail failed");
            return false;
          })
      );
    }

    const reached = (await Promise.all(attempts)).some(Boolean);
    if (reached) return;

    log?.error?.(
      {
        event: "membership-confirmation-undeliverable",
        orderId: order.orderId,
        hasPhone: Boolean(mobile),
        hasEmail: Boolean(email),
        hasEndDate: true,
        whatsappConfigured: isMetaWhatsappConfigured(env)
      },
      "[membership] a PAID membership could not be confirmed to its buyer"
    );
  } catch (err) {
    log?.error?.(
      { err, event: "membership-confirmation-failed", orderId: order.orderId },
      "[membership] confirmation WhatsApp failed"
    );
  }
}

// Claim the order and extend the tag. Returns { firstTime, currentPeriodEnd }.
//
// `firstTime` is false when someone else already claimed it, which is normal
// traffic rather than an error: Razorpay retries its webhook until it gets a
// 2xx, and the browser callback races it on every successful checkout.
export async function activateMembership(collections, { env, order, paymentId, log, now = Date.now() }) {
  // The gate, and the only thing preventing a double activation. A conditional
  // update from "created" is atomic in the database, so of two concurrent
  // callers exactly one sees modifiedCount 1 — the same mechanism
  // fulfilPaidOrder uses. Checking-then-writing in application code would let
  // both pass the check and both extend the subscription, selling one payment
  // twice as much time as it bought.
  const claimed = await collections.membershipOrders.updateOne(
    { orderId: order.orderId, status: "created" },
    {
      $set: {
        status: "paid",
        paymentId: paymentId || order.paymentId || null,
        paidAt: new Date(now).toISOString()
      }
    }
  );

  if (!claimed.modifiedCount) {
    const settled = await collections.membershipOrders.findOne({ orderId: order.orderId });
    return { firstTime: false, currentPeriodEnd: settled ? settled.currentPeriodEnd || null : null };
  }

  const tag = await collections.tags.findOne({ _id: order.tagId });
  if (!tag) {
    // The order is paid — that is not in doubt and must not be undone. What
    // cannot be done is grant the time, because the tag it was bought for is
    // gone. Flagged for a person rather than swallowed: the money is real.
    await collections.membershipOrders.updateOne(
      { orderId: order.orderId },
      { $set: { needsAttention: "tag-missing", updatedAt: new Date(now).toISOString() } }
    );
    if (log && log.error) {
      log.error(
        { event: "membership-tag-missing", orderId: order.orderId, tagId: String(order.tagId) },
        "[membership] paid order whose tag no longer exists"
      );
    }
    return { firstTime: true, currentPeriodEnd: null };
  }

  const startMs = membershipPeriodStart(tag, now);
  const currentPeriodEnd = new Date(addMonths(startMs, order.months)).toISOString();

  await collections.tags.updateOne(
    { _id: tag._id },
    {
      $set: {
        subscription: { status: "active", currentPeriodEnd },
        updatedAt: new Date(now).toISOString()
      }
    }
  );

  await collections.membershipOrders.updateOne(
    { orderId: order.orderId },
    { $set: { currentPeriodEnd } }
  );

  if (log && log.info) {
    log.info(
      {
        event: "membership-activated",
        orderId: order.orderId,
        planId: order.planId,
        months: order.months,
        currentPeriodEnd
      },
      "[membership] subscription extended"
    );
  }

  // Inside the firstTime branch, never at a call site. Both callers race each
  // other on every purchase and Razorpay retries its webhook until it gets a
  // 2xx, so a notification hung off the return value would message the buyer
  // once per delivery attempt. The conditional claim above is the one place
  // that is guaranteed to run exactly once per payment.
  await sendMembershipConfirmation(env, collections, { order, currentPeriodEnd, log });

  return { firstTime: true, currentPeriodEnd };
}
