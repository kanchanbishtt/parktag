// Where the car is, sent to the owner's emergency contact after an SOS call.
//
// The masked SOS call connects a scanner standing at an accident to the
// relative the owner nominated. A call says that something has happened; it
// cannot say where. This is the other half: when the scanner shared the car's
// position (the same opt-in "Share where the car is" fix the routine contacts
// carry), the relative also gets a WhatsApp with a map link, so they can start
// moving even if they miss the call.
//
// WHAT IS SENT, AND TO WHOM
// Only to `tag.emergencyContact`, and only once per REGISTERED emergency call:
// the route has already checked the grant, the plate and the daily SOS ceiling
// before this runs, so the alert can never be sent to anyone the call itself
// could not reach, and never more often than the call could be placed. A tag
// with no emergency contact never gets here — the route answers with the public
// helplines instead, which is the flow that already covers it.
//
// The message carries the MASKED plate and the rounded point (~11 m, see
// car-location.js). Never the scanner's number: the call is masked for exactly
// that reason. Never the owner's number either. A mistyped emergency contact
// therefore receives nothing that identifies a person.
//
// WhatsApp only. An SMS copy was considered and set aside: every A2P SMS in
// India has to match a DLT-registered template whose variables are capped at
// 30 characters, which a map link does not fit. If it is picked up again it
// needs a short link on our own domain first.
//
// NOTHING HERE WAITS ON THE CALL
// Like captureScannerLocation, this runs after the response. Someone at a crash
// must get the virtual number at once; a place lookup and a provider send can
// take seconds, and neither may fail the call. Every failure is swallowed and
// recorded on the row, so support can see what did and did not go out without
// any of it having reached the scanner as an error.

import { toE164 } from "./phone.js";
import { readCarLocation, resolveCarLocation, carMapLink, carMapUrl } from "./car-location.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappAlert } from "../integrations/meta.js";
import { maskPlateNumber, redactText } from "../auth/security.js";

// What the relative reads. One line, because a WhatsApp template variable may
// not contain a line break.
export function emergencyAlertText(tag, carLocation) {
  const plate = maskPlateNumber(tag?.plateNumber) || tag?.vehicleLabel || "a ParkTag vehicle";
  const near = carLocation?.place ? `, near ${carLocation.place}` : "";
  return (
    `EMERGENCY reported at vehicle ${plate}${near}. ` +
    `The person there is calling you through ParkTag. Car location: ${carMapLink(carLocation)}`
  );
}

// In-flight alerts. Kept only so tests can wait for them; production fires and
// returns, exactly as scan-location.js does.
const inFlight = new Set();

// Resolve the shared position, stamp it on the emergency row, and tell the
// emergency contact. Returns a promise the ROUTE MUST NOT AWAIT.
//
// Returns without touching anything when the position is missing or unreadable:
// the row keeps the shape of one from before this feature, and the owner's
// activity shows nothing for it rather than an error.
export function captureEmergencyLocation(env, collections, { requestId, tag, rawCarLocation, log = null }) {
  const task = (async () => {
    if (!readCarLocation(rawCarLocation)) return;

    // Defensive only: the route refused a tag without a contact long before
    // this ran. If it ever changes, the worst case here is silence, not a
    // message to an empty number.
    const targetPhone = toE164(tag?.emergencyContact || "");
    if (!targetPhone) return;

    const carLocation = await resolveCarLocation(rawCarLocation, { log });
    if (!carLocation) return;

    await collections.contactRequests.updateOne({ _id: requestId }, { $set: { carLocation } });

    const outcome = { whatsapp: "skipped", sentAt: new Date().toISOString() };

    if (isMetaWhatsappConfigured(env)) {
      try {
        // The approved owner-alert template: its {{2}} carries the sentence
        // and, once the map variant clears review, the header carries the map.
        await sendMetaWhatsappAlert(env, {
          to: targetPhone,
          ownerName: "there",
          reason: emergencyAlertText(tag, carLocation),
          tagId: String(tag._id),
          mapUrl: carMapUrl(env, carLocation)
        });
        outcome.whatsapp = "sent";
      } catch (err) {
        outcome.whatsapp = "failed";
        log?.warn(
          { event: "emergency-alert-failed", channel: "whatsapp", requestId: String(requestId), detail: redactText(err?.providerDetail || err?.message) },
          "[emergency] location alert not sent on WhatsApp"
        );
      }
    }

    await collections.contactRequests.updateOne({ _id: requestId }, { $set: { emergencyAlert: outcome } });

    // No phone number in this line, on purpose: it is read by people who are
    // not meant to have the emergency contact's number.
    log?.info(
      { event: "emergency-location-alert", requestId: String(requestId), token: tag?.token || null, whatsapp: outcome.whatsapp },
      "[emergency] car location handled for the emergency contact"
    );
  })().catch((err) => {
    // Nobody is left to tell — the response has gone. Logged so the failure is
    // visible, never thrown, because an unhandled rejection here could take
    // the process down over an alert.
    log?.warn({ event: "emergency-alert-failed", requestId: String(requestId), detail: redactText(err?.message) }, "[emergency] location alert aborted");
  });

  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
  return task;
}

// Wait for every alert started so far. Tests only.
export async function settleEmergencyAlerts() {
  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }
}
