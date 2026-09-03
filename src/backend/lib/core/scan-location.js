// Where the scanner was, for the owner's activity log.
//
// An owner seeing "someone contacted you" learns very little. Seeing that it
// came from the street their car is parked on tells them whether this is about
// the vehicle in front of them or a stale report from another city. That is the
// whole feature: enough location to make an activity row actionable.
//
// WHAT IS RESOLVED, AND WHAT IS NOT
// City precision from the IP, via the same lookup the landing analytics uses.
// Deliberately NOT `navigator.geolocation`: a metre-accurate fix on a stranger
// standing next to somebody else's car is disproportionate to the question, it
// needs a prompt most scanners would decline, and the ones who accepted would
// be the only ones logged. An IP answers it for everyone, at a precision that
// cannot follow anybody to a front door.
//
// WHAT REACHES THE OWNER
// The derived country / region / city only. The raw IP is already stored on the
// contact row for abuse handling and stays server-side — handing one user
// another user's network address is a different act from telling them which
// city a report came from, and only the second one is this feature.
//
// THE ENTITLEMENT GATES CAPTURE, NOT DISPLAY
// Nothing is looked up or stored for a tag that is not entitled. An owner who
// cannot see this has no location collected on their scanners at all, so there
// is no quiet archive waiting to be switched on. The cost is that a tag which
// lapses and later subscribes has blank rows from the gap — the honest trade
// for not holding data we have no permission to show.
//
// The ladder is `callEntitlement().masking` — the SAME field that decides
// whether the masked contact may happen at all, not a second rule beside it:
//
//   E-Tag, free contact unused   captured (their one contact, so one location)
//   E-Tag, free contact spent    nothing — no further contact happens anyway
//   Premium, first year         captured
//   Premium, past its first year  nothing
//   Premium + subscription       captured
//
// Reading the same field is what keeps "you were allowed to contact this owner"
// and "that contact carries a location" from ever disagreeing. The emergency
// route is why the check has to be here rather than assumed: it deliberately
// does NOT gate on masking — an SOS must connect regardless of billing — so it
// is the one path that can write a contact row for a lapsed tag.

import { callEntitlement } from "./call-access.js";
import { lookupGeo } from "../integrations/geoip.js";

// Why this does not block the response.
//
// The contact routes are fast. /register-call and /register-emergency-call do
// NOT place a call — they write a pendingCall and hand the scanner a virtual
// number to dial — so both were pure database work. Putting a provider call in
// front of them leaves somebody standing at a car watching a spinner, and on the
// SOS path that somebody may be dealing with an accident.
//
// An earlier attempt raced the lookup against an 800ms deadline. That was worse
// than either option: the default provider answers in about 1.5s from
// production, so the deadline expired on essentially every real contact and the
// feature silently never worked, while still costing 800ms on the SOS path.
// Measured, not guessed — a live lookup of a real scanner's address took 1.505s.
//
// So the row is written immediately with no location, and the lookup runs after
// the response and updates the row when it lands. Nothing waits on it. The owner
// reads their activity log minutes or hours later, by which time a lookup that
// took two seconds has long since arrived; and when the provider is down the row
// simply keeps the null it was born with.

// Resolve the scanner's coarse location for a contact about to be recorded.
//
// Returns null for "no location on this row", which is the shape every caller
// stores when unentitled, when the address is unresolvable, or when the
// provider is down. One null means the row simply carries no location; the
// activity log renders that as nothing rather than as an error, because a
// missing city is not a failure the owner can act on.
//
// Never throws. lookupGeo already resolves rather than rejecting — a provider
// outage must not cost somebody their call — and the entitlement read above it
// is pure. A contact must never fail because a lookup did.
export async function resolveScannerLocation(env, tag, rawIp) {
  if (!callEntitlement(tag).masking) return null;

  const geo = await lookupGeo(env, rawIp);
  if (!geo) return null;

  // A private, loopback or unresolvable address comes back as all-nulls. Storing
  // that would put an empty object on the row and make "we looked and found
  // nothing" indistinguishable from "we found somewhere" at every read site.
  if (!geo.country && !geo.region && !geo.city) return null;

  // Only the four derived fields. `source` is deliberately dropped: it is a
  // diagnostic about our provider, not a fact about the scanner, and this
  // document is read by a route that serves owners.
  return {
    country: geo.country || null,
    countryCode: geo.countryCode || null,
    region: geo.region || null,
    city: geo.city || null
  };
}

// In-flight background captures.
//
// Kept only so tests can wait for them. Production never looks at this: the
// routes fire a capture and return, and the write lands whenever it lands.
const inFlight = new Set();

// Resolve the location for a contact row that has ALREADY been written, and
// stamp it on when it arrives. Returns a promise, but callers on a request path
// must NOT await it — that is the entire point.
//
// Every failure is swallowed. This runs after the response has been decided, so
// there is nobody left to tell: a throw here could only become an unhandled
// rejection and take the process down over a missing city. The row keeps the
// null it was inserted with, which is exactly how a row from before this feature
// reads, and the activity log renders both as nothing.
//
// The entitlement is checked before anything else, so an unentitled tag still
// costs no lookup at all — capture is gated, not display.
export function captureScannerLocation(env, collections, contactRequestId, tag, rawIp) {
  const task = (async () => {
    const location = await resolveScannerLocation(env, tag, rawIp);
    // Nothing to say. Leave the null already on the row rather than writing one
    // over it, so this never touches a document it has no news for.
    if (!location) return;

    await collections.contactRequests.updateOne(
      { _id: contactRequestId },
      { $set: { scannerLocation: location } }
    );
  })().catch(() => {});

  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
  return task;
}

// Wait for every background capture started so far. Tests only.
//
// Without this a test would have to poll the row and hope, which is how a suite
// becomes flaky. Loops rather than awaiting once, because settling one capture
// can start another.
export async function settleScannerLocations() {
  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }
}

// One line for a human, most specific part first.
//
// Shared so the owner dashboard and the admin console cannot describe the same
// row differently. Returns null when there is nothing worth printing, so a
// caller can branch on it instead of rendering an empty string.
export function formatScannerLocation(location) {
  if (!location) return null;

  const parts = [location.city, location.region, location.country]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);

  if (parts.length === 0) return null;

  // "Andheri East, Maharashtra, India" — but a provider that repeats itself
  // ("Mumbai, Mumbai, India") should not be echoed back with the repeat, so
  // consecutive duplicates collapse. Compared case-insensitively because the
  // repeat is often a casing difference rather than an exact one.
  const deduped = parts.filter(
    (part, i) => i === 0 || part.toLowerCase() !== parts[i - 1].toLowerCase()
  );

  return deduped.join(", ");
}
