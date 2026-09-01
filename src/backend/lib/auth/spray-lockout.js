import crypto from "node:crypto";

// ── Credential-spraying lockout (per source, across accounts) ──────────────
//
// The per-account lockout in login-lockout.js stops the internet grinding ONE
// account. It is blind to the opposite shape of attack: one guess tried against
// thousands of accounts. Spraying never trips a per-account counter, because no
// single account sees more than one or two failures.
//
// That shape matters much more now that a login PIN is a valid credential.
// A PIN is drawn from a space of a million values, and the weak-PIN screen in
// login-pin.js removes the obvious ones — but "one plausible PIN against every
// account we have an address for" does not need the PIN to be obvious, only for
// SOMEBODY to have chosen it. With enough accounts, somebody always has.
//
// ── Why distinct accounts and not raw failures ─────────────────────────────
// The counter is the number of DIFFERENT identifiers this source has failed
// against in the window, not how many times it has failed. That distinction is
// the whole design:
//
//   - It is what actually characterises spraying. One person fumbling their own
//     PIN produces many failures against ONE identifier and never trips this,
//     however many times they get it wrong.
//   - It survives shared addresses. A college or office NAT is hundreds of
//     people behind one IP, and a raw failure counter there is a lockout waiting
//     to happen on an ordinary Monday morning. Reaching twelve distinct FAILED
//     accounts from one address in fifteen minutes is not an ordinary morning.
//
// So this is deliberately not a rate limit. @fastify/rate-limit already caps
// this route at 5 requests a minute per address; that bounds volume. This bounds
// BREADTH, which volume limits cannot see.
//
// Keyed on request.ip as computed by Fastify from trustProxy — never on a raw
// X-Forwarded-For, whose leftmost entry the client controls. A spoofable key
// would hand an attacker a fresh allowance per request and make this decorative.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_DISTINCT_ACCOUNTS = 12;
const LOCKOUT_MS = 30 * 60 * 1000;

// Stored in login_attempts alongside the per-account rows: same shape of data,
// same 7-day TTL on `updatedAt`, one collection to reason about. The `spray|`
// prefix inside the hash keeps the two keyspaces from ever colliding.
function sourceKey(ip) {
  return crypto.createHash("sha256").update(`spray|${String(ip || "unknown")}`).digest("hex");
}

// Hashed, so this row never becomes a list of the addresses someone sprayed.
// It only ever needs to be counted, never read back.
function accountToken(identifier) {
  return crypto
    .createHash("sha256")
    .update(String(identifier || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

// Fails OPEN on a storage error, for the same reason getLoginLock does: this
// read and the authentication behind it need the same database, so a failure
// here cannot let anything through that would otherwise have been stopped.
export async function getSprayLock(collections, ip) {
  if (!collections?.loginAttempts) return { locked: false, retryAfterSeconds: 0 };

  try {
    const doc = await collections.loginAttempts.findOne({ _id: sourceKey(ip) });
    if (!doc?.lockedUntil) return { locked: false, retryAfterSeconds: 0 };

    const remainingMs = doc.lockedUntil.getTime() - Date.now();
    if (remainingMs <= 0) return { locked: false, retryAfterSeconds: 0 };

    return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
  } catch {
    return { locked: false, retryAfterSeconds: 0 };
  }
}

export async function recordSprayFailure(collections, ip, identifier) {
  if (!collections?.loginAttempts) return;

  const token = accountToken(identifier);
  const windowAlive = {
    $gt: [{ $add: [{ $ifNull: ["$windowStartAt", "$$NOW"] }, WINDOW_MS] }, "$$NOW"]
  };

  try {
    // One atomic pipeline update, like recordLoginFailure. A read-modify-write
    // would drop entries under exactly the parallel load this exists to catch:
    // a sprayer runs its guesses concurrently, and every one of them would read
    // the same account list and write back the same single addition.
    await collections.loginAttempts.updateOne(
      { _id: sourceKey(ip) },
      [
        {
          $set: {
            // On insert `$windowStartAt` is missing, which makes windowAlive
            // true, so the $ifNull is what anchors the first window.
            windowStartAt: {
              $cond: [windowAlive, { $ifNull: ["$windowStartAt", "$$NOW"] }, "$$NOW"]
            },
            // $setUnion, so the same identifier failing repeatedly counts once
            // — that is the per-account counter's job, not this one's.
            sprayed: {
              $cond: [
                windowAlive,
                { $setUnion: [{ $ifNull: ["$sprayed", []] }, [token]] },
                [token]
              ]
            }
          }
        },
        {
          // Reads the list written by the stage above.
          $set: {
            lockedUntil: {
              $cond: [
                { $gte: [{ $size: "$sprayed" }, MAX_DISTINCT_ACCOUNTS] },
                { $add: ["$$NOW", LOCKOUT_MS] },
                { $ifNull: ["$lockedUntil", null] }
              ]
            },
            updatedAt: "$$NOW"
          }
        },
        {
          // Empty the list once a lock lands, so the array is bounded by
          // MAX_DISTINCT_ACCOUNTS and the next window measures afresh rather
          // than re-locking instantly off the same twelve entries.
          $set: {
            sprayed: {
              $cond: [
                { $gte: [{ $size: "$sprayed" }, MAX_DISTINCT_ACCOUNTS] },
                [],
                "$sprayed"
              ]
            }
          }
        }
      ],
      { upsert: true }
    );
  } catch {
    // Never let bookkeeping turn a failed login into a 500.
  }
}
