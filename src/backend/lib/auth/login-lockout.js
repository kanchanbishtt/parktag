import crypto from "node:crypto";

// ── Per-account sign-in lockout ────────────────────────────────────────────
// `/api/auth/login` had no lockout of any kind: its only brute-force defence
// was the per-IP rate limit, which (a) was counted per replica and so was
// really 5×replicas per minute, and (b) is inherently weak anyway — credential
// stuffing is run from a rotating pool of addresses, and a per-IP limit simply
// does not see that as one attack. This control is keyed on the ACCOUNT, so it
// holds no matter how many source addresses are used.
//
// It complements, and does not replace, the per-IP limit: per-IP stops one
// host hammering the whole app, this stops the internet grinding one account.
//
// NOT AN ENUMERATION ORACLE: attempts are recorded against the submitted
// identifier whether or not an account exists for it, and the lockout response
// is identical either way. A nonexistent address locks out exactly like a real
// one, so the response still answers nothing about who has an account.
//
// KNOWN TRADE-OFF (deliberate): anyone who knows a victim's email can trip
// their lockout on purpose — the classic availability cost of account
// lockouts. It is bounded on purpose: the window is short, the base lockout is
// 15 minutes, and password reset stays reachable throughout, so a targeted
// victim is delayed rather than locked out of their account. The alternative
// (no lockout) leaves ~36k unthrottled guesses/day per address against a
// single account, which is the worse failure.

const FAILURE_WINDOW_MS = 15 * 60 * 1000; // attempts must cluster to count
const MAX_FAILURES = 10; // consecutive failures in-window before locking
const BASE_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOCKOUT_MS = 60 * 60 * 1000; // ceiling on the exponential backoff
const MAX_LOCK_COUNT = 8; // caps 2^n so the backoff maths cannot overflow

// Hashed so this collection never becomes a list of email addresses that
// someone tried to sign in as — matching how the app already stores ipHash.
function accountKey(role, email) {
  const identifier = String(email || "").trim().toLowerCase();
  return crypto.createHash("sha256").update(`${role}|${identifier}`).digest("hex");
}

// Is this account currently locked? Call BEFORE verifying the password so a
// locked account costs an attacker a DB read rather than a bcrypt comparison.
//
// Fails OPEN on a storage error, which is safe here specifically because login
// itself needs the same database to read the user: if this read fails, the
// authentication below it cannot succeed either, so nothing is bypassed.
export async function getLoginLock(collections, role, email) {
  if (!collections?.loginAttempts) return { locked: false, retryAfterSeconds: 0 };

  try {
    const doc = await collections.loginAttempts.findOne({ _id: accountKey(role, email) });
    if (!doc?.lockedUntil) return { locked: false, retryAfterSeconds: 0 };

    const remainingMs = doc.lockedUntil.getTime() - Date.now();
    if (remainingMs <= 0) return { locked: false, retryAfterSeconds: 0 };

    return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
  } catch {
    return { locked: false, retryAfterSeconds: 0 };
  }
}

export async function recordLoginFailure(collections, role, email) {
  if (!collections?.loginAttempts) return;

  // Single atomic pipeline update. A read-modify-write would drop failures
  // under exactly the concurrent load this exists to stop — parallel guesses
  // would each read the same count and write back the same increment.
  // `$$NOW` is the server clock so replicas agree on window boundaries.
  const windowAlive = {
    $gt: [{ $add: [{ $ifNull: ["$windowStartAt", "$$NOW"] }, FAILURE_WINDOW_MS] }, "$$NOW"]
  };
  const shouldLock = { $gte: ["$failures", MAX_FAILURES] };

  try {
    await collections.loginAttempts.updateOne(
      { _id: accountKey(role, email) },
      [
        {
          $set: {
            failures: { $cond: [windowAlive, { $add: [{ $ifNull: ["$failures", 0] }, 1] }, 1] },
            // On insert `$windowStartAt` is missing, which makes windowAlive
            // true, so the $ifNull is what actually anchors the first window.
            windowStartAt: {
              $cond: [windowAlive, { $ifNull: ["$windowStartAt", "$$NOW"] }, "$$NOW"]
            }
          }
        },
        {
          // Reads the failures value written by the stage above.
          $set: {
            lockedUntil: {
              $cond: [
                shouldLock,
                {
                  $add: [
                    "$$NOW",
                    {
                      $min: [
                        {
                          $multiply: [
                            BASE_LOCKOUT_MS,
                            { $pow: [2, { $ifNull: ["$lockCount", 0] }] }
                          ]
                        },
                        MAX_LOCKOUT_MS
                      ]
                    }
                  ]
                },
                { $ifNull: ["$lockedUntil", null] }
              ]
            },
            // Repeat offenders wait longer; capped so $pow stays finite.
            lockCount: {
              $cond: [
                shouldLock,
                { $min: [{ $add: [{ $ifNull: ["$lockCount", 0] }, 1] }, MAX_LOCK_COUNT] },
                { $ifNull: ["$lockCount", 0] }
              ]
            },
            updatedAt: "$$NOW"
          }
        },
        {
          // Start the next window clean once a lock has been applied, so the
          // counter measures failures since the lock rather than since forever.
          $set: { failures: { $cond: [shouldLock, 0, "$failures"] } }
        }
      ],
      { upsert: true }
    );
  } catch {
    // Never let bookkeeping turn a failed login into a 500.
  }
}

// Successful authentication proves the requester holds the credentials, so the
// whole record goes — including lockCount, which would otherwise make the next
// unrelated typo-streak escalate faster than it should.
export async function clearLoginFailures(collections, role, email) {
  if (!collections?.loginAttempts) return;
  try {
    await collections.loginAttempts.deleteOne({ _id: accountKey(role, email) });
  } catch {
    // Non-fatal: a stale counter expires on its own via the window/TTL.
  }
}
