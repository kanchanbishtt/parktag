// Shared delivery-address validation + shaping. Used by both the per-tag
// premium purchase (dashboard.js) and the shop checkout (shop/index.js) so the
// rules for a shippable address live in exactly one place.

const PIN_RE = /^[1-9][0-9]{5}$/; // Indian PIN: 6 digits, never leading 0
const PHONE_RE = /^[6-9][0-9]{9}$/; // Indian mobile: 10 digits, starts 6-9

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

// India Post's first two digits name a postal circle, which is a state or a
// small group of them. PT-260927-00037 is why this exists: a New Delhi buyer
// read "6-digit PIN" as a card PIN, typed a Kerala code, paid, and the parcel
// could not be booked. A prefix that spans a border lists every state it
// covers, so a real address is never refused; an unknown prefix or a state
// this table does not name is not checked at all.
// ponytail: two-digit prefixes only; a three-digit table is the upgrade if a
// border district ever slips through.
const PIN_PREFIX_STATES = {
  11: ["delhi"],
  12: ["haryana"],
  13: ["haryana", "punjab", "chandigarh", "himachal pradesh"],
  14: ["punjab", "haryana"],
  15: ["punjab"],
  16: ["punjab", "chandigarh", "haryana"],
  17: ["himachal pradesh"],
  18: ["jammu and kashmir"],
  19: ["jammu and kashmir", "ladakh"],
  20: ["uttar pradesh"], 21: ["uttar pradesh"], 22: ["uttar pradesh"], 23: ["uttar pradesh"],
  24: ["uttar pradesh", "uttarakhand"],
  25: ["uttar pradesh"],
  26: ["uttar pradesh", "uttarakhand"],
  27: ["uttar pradesh"], 28: ["uttar pradesh"],
  30: ["rajasthan"], 31: ["rajasthan"], 32: ["rajasthan"], 33: ["rajasthan"], 34: ["rajasthan"],
  36: ["gujarat"], 37: ["gujarat"], 38: ["gujarat"],
  39: ["gujarat", "dadra and nagar haveli and daman and diu"],
  40: ["maharashtra", "goa"],
  41: ["maharashtra"], 42: ["maharashtra"], 43: ["maharashtra"], 44: ["maharashtra"],
  45: ["madhya pradesh"], 46: ["madhya pradesh"], 47: ["madhya pradesh"], 48: ["madhya pradesh"],
  49: ["chhattisgarh"],
  50: ["telangana", "andhra pradesh"],
  51: ["andhra pradesh", "telangana"], 52: ["andhra pradesh", "telangana"], 53: ["andhra pradesh", "telangana"],
  56: ["karnataka"], 57: ["karnataka"], 58: ["karnataka"], 59: ["karnataka"],
  60: ["tamil nadu", "puducherry"], 61: ["tamil nadu", "puducherry"], 62: ["tamil nadu"],
  63: ["tamil nadu"], 64: ["tamil nadu"], 65: ["tamil nadu"], 66: ["tamil nadu"],
  67: ["kerala", "puducherry"], 68: ["kerala", "lakshadweep"], 69: ["kerala"],
  70: ["west bengal"], 71: ["west bengal"], 72: ["west bengal"],
  73: ["west bengal", "sikkim"],
  74: ["west bengal", "andaman and nicobar islands"],
  75: ["odisha"], 76: ["odisha"], 77: ["odisha"],
  78: ["assam", "meghalaya", "arunachal pradesh", "nagaland"],
  79: ["arunachal pradesh", "assam", "manipur", "meghalaya", "mizoram", "nagaland", "tripura"],
  80: ["bihar", "jharkhand"], 81: ["bihar", "jharkhand"], 82: ["bihar", "jharkhand"],
  83: ["jharkhand", "bihar"], 84: ["bihar"], 85: ["bihar", "jharkhand"]
};
const KNOWN_STATES = new Set(Object.values(PIN_PREFIX_STATES).flat());
const STATE_LABEL = {};
// "Jammu and Kashmir", as India Post and the sheet write it: the joining word
// stays lower-case.
for (const s of KNOWN_STATES) STATE_LABEL[s] = s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and");

function normaliseState(state) {
  return String(state || "").toLowerCase().replace(/&/g, "and").replace(/^nct of /, "").replace(/\s+/g, " ").trim();
}

// The states a delivery address may name, as the sheet spells them, for the
// page and for tests to agree with this table.
export const INDIAN_STATES = Object.freeze([...KNOWN_STATES].map((s) => STATE_LABEL[s]).sort());

// The state(s) a pincode belongs to when it plainly contradicts the chosen
// state, else null (a match, or not enough to judge).
export function pincodeStateMismatch(pincode, state) {
  const chosen = normaliseState(state);
  const expected = PIN_PREFIX_STATES[String(pincode).slice(0, 2)];
  if (!expected || !KNOWN_STATES.has(chosen) || expected.includes(chosen)) return null;
  return expected.map((s) => STATE_LABEL[s]);
}

// Validate a raw address payload from the client. Returns
// { ok: true, address } with a normalised, snapshot-ready object, or
// { ok: false, error } with a human-readable reason for a 400.
export function validateAddress(raw) {
  const body = raw || {};
  const fullName = clean(body.fullName, 80);
  // Not cut to length like the free-text fields: the two regexes below bound
  // these, and cutting first turned an 11-digit phone or a 7-digit pincode
  // into a valid-looking one and let it through (QA, 2026-10-03). The sheet
  // never sends either (maxlength), so only a direct request reaches this.
  const phone = String(body.phone ?? "").trim();
  const line1 = clean(body.line1, 120);
  const line2 = clean(body.line2, 120);
  const landmark = clean(body.landmark, 120);
  const city = clean(body.city, 60);
  const state = clean(body.state, 60);
  const pincode = String(body.pincode ?? "").trim();

  if (fullName.length < 2) return { ok: false, error: "Please enter the recipient's full name." };
  if (!PHONE_RE.test(phone)) return { ok: false, error: "Enter a valid 10-digit mobile number." };
  if (line1.length < 4) return { ok: false, error: "Enter your house / flat and street." };
  if (city.length < 2) return { ok: false, error: "Please enter your city." };
  if (state.length < 2) return { ok: false, error: "Please enter your state." };
  // The sheet offers a list of states; a direct request can send anything,
  // and an unknown state was skipped by the pincode check below rather than
  // refused, so "Mars" shipped. The list is the one the pincode table knows.
  if (!KNOWN_STATES.has(normaliseState(state))) return { ok: false, error: "Please choose your state from the list." };
  if (!PIN_RE.test(pincode)) return { ok: false, error: "Enter a valid 6-digit pincode (your area's postal code)." };
  const belongsTo = pincodeStateMismatch(pincode, state);
  if (belongsTo) {
    // The typed number is not echoed back: it may be a card PIN, not a pincode.
    return { ok: false, error: `That pincode is in ${belongsTo.join(" or ")}, not ${state}. Please check your area's postal code.` };
  }

  return {
    ok: true,
    address: { fullName, phone, line1, line2, landmark, city, state, pincode }
  };
}

// A handover sale has no parcel, so it has no address to validate.
//
// The buyer is standing in front of somebody with the sticker already in their
// hand: asking for a house number and a PIN code is friction for a delivery
// that will never happen, and it leaves an order the stuck-parcel alert then
// chases forever for a missing waybill.
//
// Name and phone are still REQUIRED, and the phone is the one that matters.
// It is what links the activated tag back to this order later, which is the
// whole reason these sales come through the checkout at all rather than
// arriving as a UPI message nobody writes down.
//
// The same shape as validateAddress returns, with the postal fields empty, so
// every consumer downstream reads one kind of object.
export function validateHandoverContact(raw) {
  const body = raw || {};
  const fullName = clean(body.fullName, 80);
  const phone = clean(body.phone, 10);

  if (fullName.length < 2) return { ok: false, error: "Please enter the buyer's full name." };
  if (!PHONE_RE.test(phone)) return { ok: false, error: "Enter a valid 10-digit mobile number." };

  return {
    ok: true,
    address: { fullName, phone, line1: "", line2: "", landmark: "", city: "", state: "", pincode: "" }
  };
}

// Flatten an address into Razorpay `notes` (string values only) so the shipping
// destination is visible on the payment in the Razorpay dashboard for reconciliation.
export function addressToNotes(address) {
  if (!address) return {};
  return {
    ship_name: address.fullName,
    ship_phone: address.phone,
    ship_line: [address.line1, address.line2, address.landmark].filter(Boolean).join(", "),
    ship_city: address.city,
    ship_state: address.state,
    ship_pincode: address.pincode
  };
}

// One line, as a postal clerk would read it: what the address check sends Ola.
export function addressLine(address) {
  return [address.line1, address.line2, address.landmark, address.city, address.state, address.pincode]
    .filter(Boolean).join(", ");
}
