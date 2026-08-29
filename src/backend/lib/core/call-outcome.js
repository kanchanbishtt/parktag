// What actually happened on a masked call.
//
// Exotel reports an outcome in whichever of half a dozen fields its flow
// happens to populate, spelled in whichever case and separator that product
// area favours — `CallStatus`, `DialCallStatus`, `Status`, `no-answer` vs
// `no_answer`, `canceled` vs `cancelled`. Letting that vocabulary leak into the
// dashboard means every reader has to know it, and the one place that already
// tried got it wrong: the activity badge tests for `"connected"`, which Exotel
// never sends. A real answered call would have rendered as "Failed".
//
// So it is normalised once, here, into three words the rest of the app can
// reason about, and stored on the contact request as `callOutcome`.
//
//   answered — the two parties were connected and spoke
//   missed   — it rang out, was busy, or was cancelled before anyone spoke
//   failed   — the provider could not place it at all
//   null     — we genuinely do not know
//
// `null` is a real answer and not a failure of this function. Every call in
// production is currently null, because Exotel's status callback has never been
// configured and so has never fired. Callers must treat "unknown" as "do not
// assume it was answered" rather than as an error.

const ANSWERED = new Set(["completed", "connected", "answered", "success", "in-progress"]);
const MISSED = new Set([
  "no-answer", "noanswer", "no-response", "missed",
  "busy", "canceled", "cancelled", "rejected", "declined", "timeout"
]);
const FAILED = new Set(["failed", "failure", "error", "invalid", "unreachable"]);

// Lowercase, and underscores folded to hyphens, so `No_Answer` and `no-answer`
// are the same word. Anything non-stringy becomes "" and falls through to null.
function canonical(status) {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

// Seconds of actual conversation, or null when the provider did not say.
//
// Distinguishing "0" from "absent" is the whole reason this is separate: a
// reported zero is evidence nobody spoke, while a missing field is no evidence
// at all, and conflating them would mark every un-instrumented call as missed.
export function parseCallDuration(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function normalizeCallOutcome({ status, duration } = {}) {
  const s = canonical(status);
  const seconds = parseCallDuration(duration);

  // Talk time wins over the status word.
  //
  // Exotel marks a call `completed` when its FLOW ran to the end, which happens
  // whether or not the far end ever picked up — so `completed` with zero
  // conversation is a call the owner missed, however the provider labels it.
  // Believing the label there would hide the callback button from exactly the
  // person who needs it.
  if (seconds !== null) {
    if (seconds > 0) return "answered";
    if (FAILED.has(s)) return "failed";
    return "missed";
  }

  if (ANSWERED.has(s)) return "answered";
  if (MISSED.has(s)) return "missed";
  if (FAILED.has(s)) return "failed";
  return null;
}

// Did these two people actually speak?
//
// Positive evidence only. Unknown is NOT answered, which is what keeps the
// callback button visible on the entire existing backlog of calls rather than
// silently retiring a feature the moment it is gated on data we do not have.
export function wasAnswered(contactRequest) {
  return contactRequest?.callOutcome === "answered";
}

// Should the owner be offered a way to call this person back?
//
// Everything except a call they already had. A missed call obviously qualifies;
// so does one we know nothing about, because "we did not measure it" is not a
// reason to withhold the only route back to the person.
//
// Requires a number: a scanner who stayed anonymous left nobody to dial.
export function shouldOfferCallback(contactRequest) {
  if (!contactRequest?.phone) return false;
  return !wasAnswered(contactRequest);
}
