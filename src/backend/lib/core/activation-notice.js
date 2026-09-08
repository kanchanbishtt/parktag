// Telling somebody their tag is live.
//
// Nothing did, before this. A buyer stuck the sticker on, scanned it, typed
// their plate, proved their number by OTP, and got a success screen. Close the
// tab and there was no record of it anywhere they could see: no message, no
// mail, nothing to search for later. `parktag_tag_activated` has existed and
// been approved in WhatsApp Manager for months with zero messages delivered,
// because no code ever called it.
//
// This is also the moment the premium year starts, which makes it the setup for
// every trial-expiry message that follows. An owner who was never told the year
// began cannot be reminded it is ending.
//
// Shaped exactly like sendOrderConfirmation in order-fulfilment.js, and for the
// same reasons: both channels started TOGETHER rather than one after the other,
// each absorbing its own rejection so a dead provider costs only its own
// message, and an unreachable owner logged rather than passed over in silence.

import { isMetaWhatsappConfigured, sendMetaWhatsappTagActivated } from "../integrations/meta.js";
import { sendTagActivatedEmail } from "../integrations/email.js";
import { firstNameOf, resolveOwnerName } from "./owner-name.js";

/**
 * Best effort, always. An activation must never fail because Meta or the mail
 * server was slow: the tag is already live and the customer is already looking
 * at the success screen. Callers do not await this.
 */
export async function sendActivationNotice(env, owner, tag, log) {
  try {
    // Both fields, because signup wrote `phone` for years and `mobile` now.
    // login-pin.js and membership-fulfilment.js read the same pair.
    const mobile = owner && (owner.mobile || owner.phone);
    const email = owner && owner.email;

    // Never the raw displayName. The OTP and Firebase signup paths used to
    // write the phone number itself into that field, so reading it raw
    // addressed people as "Hi 9876500123" -- in a Meta-approved template, which
    // is the one place nobody can quietly fix it afterwards.
    const name = firstNameOf(resolveOwnerName(owner || {})) || "there";
    const vehicle = tag?.vehicleLabel || "vehicle";
    const plate = tag?.plateNumber || "";

    // {{3}} in the approved template, and Meta rejects a blank variable
    // outright. A tag can reach here with no plate only through a path that
    // does not ask for one, so the WhatsApp send stands down rather than
    // failing; the e-mail has no such constraint and still goes.
    const attempts = [];

    if (mobile && plate && isMetaWhatsappConfigured(env)) {
      attempts.push(
        sendMetaWhatsappTagActivated(env, { to: mobile, name, vehicle, plate })
          .then(() => true)
          .catch((err) => {
            log?.error?.({ err, tagId: String(tag?._id) }, "[activation] confirmation WhatsApp failed");
            return false;
          })
      );
    }

    if (email) {
      attempts.push(
        sendTagActivatedEmail(env, { to: email, name, vehicle, plate, tagId: String(tag?._id || "") })
          .then(() => true)
          .catch((err) => {
            log?.error?.({ err, tagId: String(tag?._id) }, "[activation] confirmation e-mail failed");
            return false;
          })
      );
    }

    const reached = (await Promise.all(attempts)).some(Boolean);
    if (reached) return;

    // Not silence. An activation nobody could be told about is a customer who
    // owns a working product and has no record of it, and the only way that
    // becomes answerable later is if it is an error line now.
    log?.error?.(
      {
        event: "activation-confirmation-undeliverable",
        tagId: String(tag?._id || ""),
        hasPhone: Boolean(mobile),
        hasEmail: Boolean(email),
        hasPlate: Boolean(plate)
      },
      "[activation] a tag was activated and its owner could not be told on any channel"
    );
  } catch (err) {
    // The outer guard. Nothing in a notification may escape into the activation
    // request that triggered it.
    log?.error?.({ err }, "[activation] notice failed");
  }
}
