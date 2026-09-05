// One place that decides what a phone number IS.
//
// There were three of these — normalizePhone in auth/otp.js, and a
// normalizeIndianNumber in each of integrations/meta.js and
// integrations/exotel.js — written separately, agreeing on the easy cases and
// diverging on the rest. All three shared one gap, and it is the gap that
// matters most in India: the domestic trunk prefix.
//
// THE TRUNK ZERO. Inside India a mobile is dialled as 0XXXXXXXXXX, and people
// write it down that way. The 0 is a dialling instruction, not part of the
// number — E.164 has no room for it. All three normalisers tested for 10
// digits, for 12 digits beginning 91, and for a leading +, and let anything
// else fall out of the bottom unchanged. An eleven-digit 0XXXXXXXXXX matched
// none of them, so it was stored, looked up and dialled verbatim. Two
// consequences, both live:
//
//   identity   normalizePhone turned "9812345678" into "+919812345678" and
//              "09812345678" into "09812345678" — two identities for one
//              person, on a system whose whole one-number-one-account
//              invariant assumes normalisation is total. See
//              tests/one-number-one-account.test.js for why that matters.
//
//   delivery   the WhatsApp sender passed it straight to Meta. Which brings us
//              to the second rule this module exists to encode.
//
// THE PLUS SIGN IS NOT OPTIONAL. Meta's Cloud API documents that when the +
// is omitted it prepends the BUSINESS number's country calling code to
// whatever it was given — unconditionally, without first checking whether the
// number already carries one. Meta's own worked example uses an Indian
// business (country code 91) and shows "1 (631) 555-1234" being delivered to
// +9116315551234. A number that already began with a country code got another
// one glued to the front.
//
// meta.js used to strip the + before sending, which put every message ParkTag
// sends into exactly the shape that table marks "potentially wrong". It has
// worked so far, so Meta is evidently more forgiving in practice than its
// documentation promises — but "the provider is currently lenient" is not a
// contract, and the cost of it tightening is silent misdelivery of login codes
// to a stranger's handset. So: always E.164, always with the +.
//
// Reference: developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/
//            ("Phone number formats"), and India's National Numbering Plan —
//            mobiles are ten digits beginning 6, 7, 8 or 9.

// Ten digits, first one 6-9. The Indian mobile range, and the same rule
// core/address.js already applies to a delivery phone.
const INDIAN_MOBILE_10 = /^[6-9]\d{9}$/;

export function isIndianMobile10(digits) {
  return INDIAN_MOBILE_10.test(String(digits ?? ""));
}

// Everything that is not a digit or a leading +. Callers hand this whatever
// arrived in a JSON body, so it may be an array, an object or a number — the
// String() is load-bearing, not decoration.
function scrub(input) {
  const raw = String(input ?? "").trim();
  const kept = raw.replace(/[^\d+]/g, "");
  // A + is only meaningful in front. "+91 98-12+34" is a typo, not a second
  // country code, so anything after the first character is dropped.
  return kept.startsWith("+") ? `+${kept.slice(1).replace(/\+/g, "")}` : kept.replace(/\+/g, "");
}

// The canonical form: "+" followed by country code and subscriber number.
// Returns null when the input cannot be resolved to one — the caller decides
// whether that is a validation error, a skipped notification, or a fallback.
//
// Deliberately conservative about the trunk zero: the 0 is only stripped when
// what remains is a real Indian mobile. "0" is a plausible first digit of a
// foreign number written without its +, and silently deleting it would turn a
// wrong number into a different wrong number.
export function toE164(input) {
  const value = scrub(input);
  if (!value) return null;

  // Already international. Trusted as given — the caller has told us the
  // country code, so there is nothing left to infer.
  if (value.startsWith("+")) {
    const digits = value.slice(1);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // 00 is the international access prefix dialled from India (and most of the
  // world). Same meaning as +, different keypad.
  if (value.startsWith("00")) {
    const digits = value.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // The trunk zero: 0XXXXXXXXXX dialled inside India.
  if (value.length === 11 && value.startsWith("0") && isIndianMobile10(value.slice(1))) {
    return `+91${value.slice(1)}`;
  }

  // 91XXXXXXXXXX written without its +. Guarded on the subscriber part being a
  // real mobile so a twelve-digit foreign number that happens to start "91"
  // is not claimed for India.
  if (value.length === 12 && value.startsWith("91") && isIndianMobile10(value.slice(2))) {
    return `+91${value.slice(2)}`;
  }

  // A bare Indian mobile, which is how almost everyone types it.
  if (value.length === 10 && isIndianMobile10(value)) {
    return `+91${value}`;
  }

  // Anything else — too short, too long, or a shape that cannot be read
  // without guessing. Guessing is what produced the trunk-zero bug.
  return null;
}

// The same value without the +, for the rare consumer that wants digits only.
// Not used for sending: see the note on the plus sign above.
export function toE164Digits(input) {
  const e164 = toE164(input);
  return e164 ? e164.slice(1) : null;
}
