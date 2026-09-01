import { ObjectId } from "mongodb";

import { getCollections } from "../db/repositories.js";
import {
  verifyPassword,
  createPasswordHash,
  isNonEmptyString,
  burnHashComparison
} from "./security.js";
import { readSession } from "./session.js";
import { findByCanonicalEmail } from "./identity.js";
import { isMobileIdentifier, normalizeIdentifier } from "./otp.js";

export async function findUserByEmail(env, role, email) {
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  // `email` reaches Mongo as a raw filter value — reject anything that isn't
  // a plain string so a crafted body (e.g. `{ "$ne": null }`) can never be
  // interpreted as a query operator (NoSQL injection / auth bypass).
  if (!isNonEmptyString(email)) return null;

  const collection = role === "admin" ? collections.admins : collections.owners;

  // Canonical, not as-typed. This used to be `findOne({ email })` with the raw
  // value, which made sign-in case-sensitive while the OTP path was not — the
  // two disagreed about which account an address belonged to.
  return findByCanonicalEmail(collection, email);
}

export async function loginUser(env, role, email, password) {
  if (!isNonEmptyString(password)) return null;

  const collections = await getCollections(env);
  const user = await findUserByEmail(env, role, email);

  if (!user) {
    // Pay for a password comparison we have no hash for. Returning here without
    // it answered an unregistered address ~240ms faster than a registered one,
    // which enumerates accounts regardless of the responses being identical.
    await burnHashComparison(password);
    return null;
  }

  const { valid, needsUpgrade } = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  // Transparently upgrade SHA-256 → bcrypt on first successful login
  if (needsUpgrade && collections) {
    const col = role === "admin" ? collections.admins : collections.owners;
    col.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await createPasswordHash(password) } }
    ).catch(() => {}); // non-blocking, best-effort
  }

  return {
    id: String(user._id),
    role,
    email: user.email,
    displayName: user.displayName,
  };
}

// Find an owner by whatever they typed into the one identifier box — an email
// address or an Indian mobile number.
//
// findUserByEmail above resolves e-mail only, which is why credential sign-in
// used to be e-mail-only while the OTP path accepted both. An owner who
// registered by phone had no address to type, so the password step could not
// authenticate them under any circumstances; with a PIN as the credential that
// gap would have made the whole feature unusable for most of the userbase.
//
// ONE query on each branch. Two — try this, fall back to that — costs more
// round trips when the account does not exist than when it does, and that
// difference is an enumeration oracle no matter how identical the responses
// are. The mobile branch matches the normalised number and the legacy `phone`
// spellings in a single $or for exactly that reason.
//
// Nothing here interpolates the caller's string into a pattern: `identifier`
// reaches Mongo as a literal filter value or not at all. A non-string body
// value (`{ "$ne": null }`) fails isMobileIdentifier's regex, falls to the
// e-mail branch, and is rejected by canonicalEmail's isNonEmptyString guard.
async function findOwnerByIdentifier(collections, identifier) {
  if (isMobileIdentifier(identifier)) {
    const mobile = normalizeIdentifier(identifier);
    const digits = String(mobile).replace(/\D/g, "");
    const last10 = digits.slice(-10);

    // Oldest first, so a number that somehow sits on two rows always resolves
    // to the same account — the same rule resolveOwnerByVerifiedMobile follows.
    return collections.owners.findOne(
      {
        $or: [
          { mobile },
          { phone: { $in: [mobile, digits, last10, `+${digits}`] } }
        ]
      },
      { sort: { createdAt: 1, _id: 1 } }
    );
  }

  return findByCanonicalEmail(collections.owners, identifier);
}

// Sign an owner in with the secret they typed: their login PIN, or their
// password if they are one of the accounts that registered with one.
//
// ONE field accepts both on purpose. Splitting them into two endpoints, or
// letting the client say which it is sending, means the server has to answer
// "does this account have a PIN?" before the caller has authenticated — and
// that answer is exactly the account-enumeration signal the rest of this file
// goes to some length to withhold.
//
// EXACTLY TWO bcrypt comparisons on every path, including the one where no
// account was found. A hash comparison is ~240ms and everything else here is
// sub-millisecond, so the NUMBER of comparisons is the response time. Doing one
// when there is no PIN and two when there is would publish which accounts have
// a PIN set; skipping both for an unknown identifier would publish which
// addresses are registered. verifyPassword pays for a comparison even when the
// hash is missing or malformed, so both calls cost the same whatever is stored.
export async function loginOwnerWithSecret(env, identifier, secret) {
  const collections = await getCollections(env);

  if (!collections) {
    throw new Error("MongoDB is not configured");
  }

  if (!isNonEmptyString(secret) || !isNonEmptyString(identifier)) {
    // Still pay twice. A malformed body must not answer faster than a real
    // attempt, or the shape of the request becomes the oracle instead.
    await burnHashComparison(String(secret ?? ""));
    await burnHashComparison(String(secret ?? ""));
    return null;
  }

  const owner = await findOwnerByIdentifier(collections, identifier);

  // Sequential, not Promise.all. bcrypt at cost 12 occupies a libuv thread
  // pool worker for the duration; running the pair concurrently would halve
  // the wall time for accounts that have both credentials and leave it
  // unchanged for accounts that have neither, re-introducing the very gap the
  // two comparisons exist to close.
  const pin = await verifyPassword(secret, owner ? owner.loginPinHash : null);
  const password = await verifyPassword(secret, owner ? owner.passwordHash : null);

  if (!owner || (!pin.valid && !password.valid)) return null;

  // Same transparent SHA-256 → bcrypt upgrade loginUser does, and only for the
  // credential that actually matched. A PIN is always written by
  // createPasswordHash so it can never be a legacy hash, but reading
  // `password.needsUpgrade` unconditionally would re-hash the PIN under the
  // password field the moment someone signed in with a legacy password.
  if (password.valid && password.needsUpgrade) {
    collections.owners
      .updateOne({ _id: owner._id }, { $set: { passwordHash: await createPasswordHash(secret) } })
      .catch(() => {}); // non-blocking, best-effort
  }

  return {
    id: String(owner._id),
    role: "owner",
    email: owner.email || null,
    displayName: owner.displayName
  };
}

export function requireSession(app, role) {
  return async function guarded(request, reply) {
    const session = await readSession(app, request);

    if (!session) {
      reply.code(401);
      return {
        ok: false,
        error: "Authentication required"
      };
    }

    if (role && session.role !== role) {
      reply.code(403);
      return {
        ok: false,
        error: "Forbidden"
      };
    }

    request.session = session;
    return null;
  };
}

export function toObjectId(id) {
  return new ObjectId(id);
}

// Like toObjectId but returns null instead of throwing on a malformed id. Use
// for client-supplied route params / body ids so a garbage value yields a clean
// 400 instead of an unhandled throw (HTTP 500). Trusted ids (e.g. our own
// session userId) can keep using toObjectId.
export function tryObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}
