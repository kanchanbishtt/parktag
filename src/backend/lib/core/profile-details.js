// The optional things an owner can tell us about themselves.
//
// Name, email and mobile are not here. Those are identity — the first is
// handled by owner-name.js, and the other two are LOGIN IDENTIFIERS: owners.email
// and owners.mobile are indexed and are what a person signs in with, so changing
// either is an account change that needs its own verification, not a field on a
// details form. The profile sheet shows them read-only for that reason.
//
// What is left is genuinely optional, and the shape of the validation follows
// from that: a blank value is a valid answer meaning "cleared", never an error.
// Somebody who filled this in once must be able to empty it again.

export const GENDERS = ["male", "female", "other", "prefer_not_to_say"];

// What each value is called on screen. Kept beside the values rather than in the
// page so the API and the form cannot disagree about what "other" means.
export const GENDER_LABELS = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Prefer not to say"
};

// Bounds on a plausible date of birth.
//
// The floor is not a legal age check — nothing here gates a purchase. It is
// there so a typo of the current year, or a date a century out, is refused at
// the door rather than stored and rendered as an age of 3 or 214 on the owner's
// own profile.
export const MIN_AGE_YEARS = 13;
export const MAX_AGE_YEARS = 120;

// One of GENDERS, or null.
//
// Anything unrecognised is null rather than an error: this field is a closed set
// the form itself supplies, so a value outside it is a broken client, and the
// answer to a broken client is to store nothing rather than to store junk.
export function cleanGender(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  return GENDERS.includes(v) ? v : null;
}

// A calendar date as YYYY-MM-DD, or null.
//
// Stored as the date the owner typed, NOT as an instant. A birthday has no time
// and no timezone — storing `new Date("1990-04-12")` would make it midnight UTC,
// which is the 11th in some places, and an owner in India would see their own
// birthday shift by a day. The string is the value.
export function cleanDateOfBirth(value, now = Date.now()) {
  if (value === null || value === undefined) return { ok: true, value: null };

  const raw = String(value).trim();
  if (!raw) return { ok: true, value: null };

  // Matched against the format the date input emits before parsing, because
  // Date.parse is lenient enough to accept things that are not calendar dates.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, error: "Enter a date of birth as YYYY-MM-DD." };
  }

  const [y, m, d] = raw.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));

  // Catches the dates that pass the pattern but do not exist — 2025-02-30 parses
  // as 2 March, so the only reliable test is whether it survived the round trip.
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return { ok: false, error: "That date does not exist." };
  }

  const age = ageFromDateOfBirth(raw, now);
  if (age === null) return { ok: false, error: "Enter a valid date of birth." };
  if (age < 0) return { ok: false, error: "Date of birth cannot be in the future." };
  if (age < MIN_AGE_YEARS) return { ok: false, error: `You must be at least ${MIN_AGE_YEARS}.` };
  if (age > MAX_AGE_YEARS) return { ok: false, error: "Please check the year." };

  return { ok: true, value: raw };
}

// Whole years, or null.
//
// Derived on every read and never stored. An age written into the database is
// wrong from the owner's next birthday onwards, and nothing would be there to
// correct it.
export function ageFromDateOfBirth(dateOfBirth, now = Date.now()) {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateOfBirth))) return null;

  const [y, m, d] = String(dateOfBirth).split("-").map(Number);
  const today = new Date(now);

  // Compared in UTC against a date built in UTC, so the answer does not depend
  // on which side of midnight the server happens to be.
  let age = today.getUTCFullYear() - y;
  const monthsIn = today.getUTCMonth() + 1 - m;
  if (monthsIn < 0 || (monthsIn === 0 && today.getUTCDate() < d)) age -= 1;

  return age;
}

// What the dashboard sends and the sheet renders. One shape, built in one place,
// so a field added here reaches the page without a second edit.
export function shapeProfileDetails(owner, now = Date.now()) {
  const dateOfBirth = owner && owner.dateOfBirth ? String(owner.dateOfBirth) : null;
  return {
    gender: cleanGender(owner && owner.gender),
    dateOfBirth,
    age: ageFromDateOfBirth(dateOfBirth, now)
  };
}
