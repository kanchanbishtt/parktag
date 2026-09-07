// Which addresses in an X-Forwarded-For chain are OUR infrastructure, and how
// far back request.ip may therefore look.
//
// WHY THIS FILE EXISTS. app.js trusted exactly one proxy hop:
//
//     trustProxy: (_address, hop) => hop === 0
//
// and its own comment predicted the failure that followed — "if the deployment
// ever gains another proxy hop, widen this to match the real count". Railway now
// puts two of its own machines between a visitor and this process, so stopping
// after one left `request.ip` holding a Railway edge address instead of the
// caller. Measured in production: the socket peer logged as 152.233.33.x while
// the address stored on contact rows was 152.233.15.x — two different Railway
// machines, neither of them the customer.
//
// The visible damage was an activity log that told owners every scan came from
// Singapore, because sin1 is the edge PoP that served it. The invisible damage
// was worse: every per-IP rate limit, the credential-spray lockout and the plate
// last-four counters all key on request.ip, so every visitor through one PoP
// shared a single bucket and one abuser could throttle everybody behind it.
//
// WHY A NETWORK CHECK RATHER THAN A BIGGER NUMBER. `hop <= 1` would fix today
// and break silently the next time Railway adds or removes a layer, in exactly
// the same way `hop === 0` just did — and breaking means either a wrong city or
// a collapsed rate-limit bucket, neither of which announces itself. Recognising
// our own infrastructure walks past however many hops there are and stops at the
// first address that is not ours, which is the caller by definition.
//
// WHY IT IS STILL CAPPED. If a real visitor ever browses from inside one of
// these ranges (DataPacket sells transit to other people), the network test
// alone would walk straight past them and believe whatever sits further left —
// which the caller controls. The hop cap means the worst case there is one
// address too far, not an open door. Both conditions must hold.

// Private, loopback and link-local space. The first hop inside a container
// platform is normally one of these.
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./
];

// Railway's edge, which runs on DataPacket. Confirmed from production rather
// than assumed: 152.233.33.165 reverse-resolves to
// unn-152-233-33-165.datapacket.com, and responses carry `x-railway-edge: sin1`.
// 79.127.x is the same operator serving other PoPs (the Hong Kong rows).
//
// This list is the one maintenance cost of the approach. If Railway moves
// networks, the guard in scan-location.js starts logging that it resolved an
// address it still believes is infrastructure, which is the signal to update it.
const RAILWAY_EDGE_V4 = [
  /^152\.233\./,
  /^79\.127\./
];

// How many hops beyond the immediate peer may be skipped. Two is one more than
// Railway currently uses, so a layer can be added without an outage, and far
// short of trusting a chain a caller can lengthen at will.
export const MAX_TRUSTED_HOPS = 2;

// Is this address one of ours rather than a visitor's?
export function isInfrastructureAddress(address) {
  if (typeof address !== "string" || !address) return false;

  // ::ffff:1.2.3.4 — an IPv4 address arriving over a v6 socket.
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;

  if (v4 === "::1") return true;
  // fc00::/7, unique local addresses.
  if (/^f[cd]/i.test(v4)) return true;

  return PRIVATE_V4.some((r) => r.test(v4)) || RAILWAY_EDGE_V4.some((r) => r.test(v4));
}

// The predicate Fastify calls for each address in the chain, nearest first.
// Returning true means "this one is a proxy of ours, keep looking further left".
//
// Hop 0 is trusted unconditionally: it is the socket peer, which cannot be
// forged, and by definition it is whatever Railway connected to us with. Beyond
// that an address must both look like ours AND sit inside the cap.
export function trustProxy(address, hop) {
  if (hop === 0) return true;
  return hop <= MAX_TRUSTED_HOPS && isInfrastructureAddress(address);
}
