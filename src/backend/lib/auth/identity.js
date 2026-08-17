// Canonical account identity.
//
// An email address is one account. That was not true here: the password path
// queried `owners.findOne({ email })` with the value exactly as typed, while
// the OTP path lowercased it first. So an owner registered as
// "Case.Test@example.com" could not sign in with "case.test@example.com" — and
// worse, signing in with a code at the lowercased spelling found no account and
// created a second, empty one. Their tags, vehicles and documents stayed on the
// first account, which reads to the user as data loss.
//
// Everything that reads or writes an account email goes through here now, so
// the two spellings cannot drift apart again.
import { isNonEmptyString } from "./security.js";

// Lowercased and trimmed. The domain half of an address is case-insensitive by
// specification, and every mail provider in practice treats the local half that
// way too — so treating "A@x.com" and "a@x.com" as different people is a bug in
// every case that matters, not a feature.
export function canonicalEmail(value) {
  if (!isNonEmptyString(value)) return "";
  return value.trim().toLowerCase();
}

// Look an account up by email, whatever spelling it was stored with.
//
// Exactly ONE query, always. The obvious shape — try the canonical spelling,
// then fall back to a case-insensitive search — costs two round trips when the
// account does not exist and one when it does, and that difference is itself an
// enumeration oracle: an unregistered address answers measurably slower than a
// registered one, which is the very thing the padded password comparison in
// security.js exists to prevent. A single collation query has the same cost
// either way.
//
// A collation query, not a regex, so no part of a caller-supplied string is
// ever interpreted as a pattern. It is served by the `email_ci` index declared
// in db/repositories.js — a collation query can only use an index whose
// collation matches, so removing that index turns every sign-in into a
// collection scan rather than merely being slower.
//
// `collection` is passed in rather than a role string so admins and owners share
// exactly one implementation — the admin table had the same split.
export async function findByCanonicalEmail(collection, email) {
  const canonical = canonicalEmail(email);
  if (!canonical) return null;

  return collection.findOne(
    { email: canonical },
    { collation: { locale: "en", strength: 2 } }
  );
}

// Are there several accounts that differ only by case? Nothing should ever
// create one, but rows predating the canonicalisation can collide, and merging
// two accounts is a decision for a human rather than something a login should
// do silently.
export async function findCanonicalDuplicates(collection, email) {
  const canonical = canonicalEmail(email);
  if (!canonical) return [];

  return collection
    .find({ email: canonical }, { collation: { locale: "en", strength: 2 } })
    .toArray();
}
