// What to call an owner on screen.
//
// Sign-in only ever asks for an email or a mobile number, so for most owners the
// system has an identifier and no name. Worse, the OTP and Firebase signup paths
// used to write that identifier straight into `displayName`, which made every
// screen reading that field render a phone number as though it were a person's
// name ("Hi 9876500123"). Those paths now leave it null, and this module is the
// single place that decides what a null means on screen.
//
// The order is: what they told us, then what they typed for delivery, then
// nothing. "Nothing" is a real answer — the dashboard greets an unnamed owner
// with "Hi there" and offers an inline field.
//
// It deliberately does NOT guess a name out of the email address. Reading the
// local part turned "info@" into "Hi Info" and "no-reply@" into "Hi No"; a
// blocklist of role accounts would only have narrowed that, since "nameflow@"
// or "bookings2024@" are just as wrong and impossible to enumerate. A guess
// dressed as a fact is worse than an honest "there", and now that the greeting
// can collect the real name in one tap, there is nothing left for the guess to
// buy.

// A stored displayName that is really just the identifier the owner logged in
// with. Older accounts carry these, so reads have to recognise them rather than
// trust the field.
export function isIdentifierNotAName(value, owner = {}) {
  const name = String(value ?? "").trim();
  if (!name) return true;
  if (name.includes("@")) return true;                 // an email address
  if (/^[+\d][\d\s()-]{5,}$/.test(name)) return true;  // a phone number
  const identifiers = [owner.mobile, owner.email, owner.phone]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());
  return identifiers.includes(name.toLowerCase());
}

// Trim a stored or submitted name to something displayable, or null. Collapses
// whitespace so " Kanchan   Bisht " and "Kanchan Bisht" are one value, and caps
// the length so a pasted essay cannot reach the greeting.
export function cleanName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length < 2) return null;
  return name.slice(0, 60);
}

// The name to greet this owner with, or null if we genuinely do not know.
// `address` is the owner's saved delivery address, where a real name was typed
// for the courier — the best source available for anyone who has ever ordered.
export function resolveOwnerName(owner = {}, address = null) {
  const stored = cleanName(owner.displayName);
  if (stored && !isIdentifierNotAName(stored, owner)) return stored;

  const delivered = cleanName(address?.fullName);
  if (delivered && !isIdentifierNotAName(delivered, owner)) return delivered;

  return null;
}

// The greeting itself uses one word — a full "Hi Kanchan Bisht" reads like a
// form letter. Returns null when there is no name, so the caller shows "there".
export function firstNameOf(fullName) {
  const name = cleanName(fullName);
  if (!name) return null;
  return name.split(" ")[0];
}
