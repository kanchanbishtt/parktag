// Registering the bridge for an owner-to-scanner masked call.
//
// The owner does not dial the scanner. They dial our Exotel number, and the
// row this writes is what tells the inbound webhook who to connect them to —
// so the call is placed by the owner's handset but neither party ever learns
// the other's number.
//
// Extracted because there are now two ways to earn one of these: a premium
// tag's included callback, and an E-Tag's ₹20 pass. Both end in exactly this
// row, and two copies of it would be two chances for the paid path to write a
// subtly different bridge than the free one — a different expiry, a missing
// `consumed`, a raw ten-digit number where the webhook matches on E.164.
//
// The AUTHORISATION for each path stays where it belongs: this function asks no
// questions and grants nothing. Callers decide who may call whom.

// Ten minutes to actually dial the number we just handed over. Separate from
// the callback WINDOW (how long an owner may decide to call back) — this is how
// long the bridge itself stays live once they have decided.
export const PENDING_CALL_TTL_MS = 10 * 60 * 1000;

// India-normalised E.164. The webhook matches the caller's number against
// `callerPhone`, and Exotel reports it with the country code — so a row written
// with the ten digits the owner typed into their profile would never match, and
// the bridge would silently fail to find itself.
export function toE164(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

export async function registerOwnerToScannerCall(collections, { ownerPhone, contact, ownerId, now = new Date() }) {
  await collections.pendingCalls.insertOne({
    callerPhone: toE164(ownerPhone),
    targetPhone: contact.phone,
    token: contact.token,
    ownerId,
    requestId: contact._id,
    type: "owner_to_scanner",
    consumed: false,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PENDING_CALL_TTL_MS)
  });
}
