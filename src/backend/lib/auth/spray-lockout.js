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

// Take this attempt's place in the source's count BEFORE the secret is checked.
//
// It used to be check, then verify, then record the failure. Guesses sent in
// parallel all read "not locked" before any had recorded, so a burst got past
// the threshold by however many were in flight. The per-IP rate limit kept
// that small, but the count is now taken first, in one atomic pipeline update,
// as reserveLoginAttempt does for the per-account counter.
//
// The identifier counts as a failed account until the caller proves otherwise:
// a successful sign-in calls releaseSprayAttempt, which takes it off the list.
// Up to MAX_DISTINCT_ACCOUNTS identifiers may be on the list; the attempt that
// would add one more lands the lock and is refused. So the lock lands on the
// same attempt as before (the one after the twelfth failure), and a sign-in
// that succeeds never trips it. An attempt refused for the lock leaves the row
// as it is.
//
// Returns { allowed: true } or { allowed: false, retryAfterSeconds }.
//
// Fails OPEN on a storage error, for the same reason reserveLoginAttempt does:
// this write and the authentication behind it need the same database, so a
// failure here cannot let anything through that would otherwise have been
// stopped.
export async function reserveSprayAttempt(collections, ip, identifier) {
  if (!collections?.loginAttempts) return { allowed: true };

  const token = accountToken(identifier);
  const windowAlive = {
    $gt: [{ $add: [{ $ifNull: ["$windowStartAt", "$$NOW"] }, WINDOW_MS] }, "$$NOW"]
  };
  // A missing lockedUntil reads as null, and null sorts below every date.
  const lockedNow = { $gt: [{ $ifNull: ["$lockedUntil", null] }, "$$NOW"] };
  const unlessLocked = (expr, field) => ({ $cond: [lockedNow, field, expr] });
  // A new identifier with the list already full.
  const overflow = {
    $and: [
      { $not: [{ $in: [token, "$sprayed"] }] },
      { $gte: [{ $size: "$sprayed" }, MAX_DISTINCT_ACCOUNTS] }
    ]
  };

  try {
    const after = await collections.loginAttempts.findOneAndUpdate(
      { _id: sourceKey(ip) },
      [
        {
          // On insert `$windowStartAt` is missing, which makes windowAlive
          // true, so the $ifNull is what anchors the first window.
          $set: {
            windowStartAt: unlessLocked(
              { $cond: [windowAlive, { $ifNull: ["$windowStartAt", "$$NOW"] }, "$$NOW"] },
              "$windowStartAt"
            ),
            sprayed: unlessLocked(
              { $cond: [windowAlive, { $ifNull: ["$sprayed", []] }, []] },
              { $ifNull: ["$sprayed", []] }
            )
          }
        },
        {
          // $setUnion, so the same identifier failing repeatedly counts once —
          // that is the per-account counter's job, not this one's. The list is
          // emptied once a lock lands, so it stays bounded and the next window
          // measures afresh.
          $set: {
            lockedUntil: unlessLocked(
              { $cond: [overflow, { $add: ["$$NOW", LOCKOUT_MS] }, { $ifNull: ["$lockedUntil", null] }] },
              "$lockedUntil"
            ),
            sprayed: unlessLocked(
              { $cond: [overflow, [], { $setUnion: ["$sprayed", [token]] }] },
              "$sprayed"
            ),
            updatedAt: "$$NOW"
          }
        }
      ],
      { upsert: true, returnDocument: "after" }
    );

    const remainingMs = after?.lockedUntil ? after.lockedUntil.getTime() - Date.now() : 0;
    if (remainingMs > 0 || !(after?.sprayed || []).includes(token)) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

// The attempt was not a failed guess after all: the sign-in succeeded (the
// person holds that account's credential, so earlier misses on it from here
// were theirs too), or the account's own lockout refused it before any check.
// Takes the identifier off this source's list.
export async function releaseSprayAttempt(collections, ip, identifier) {
  if (!collections?.loginAttempts) return;
  try {
    await collections.loginAttempts.updateOne(
      { _id: sourceKey(ip) },
      { $pull: { sprayed: accountToken(identifier) } }
    );
  } catch {
    // Never let bookkeeping turn a sign-in into a 500.
  }
}
