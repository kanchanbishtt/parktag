// Shared delivery-address validation + shaping. Used by both the per-tag
// premium purchase (dashboard.js) and the shop checkout (shop/index.js) so the
// rules for a shippable address live in exactly one place.

const PIN_RE = /^[1-9][0-9]{5}$/; // Indian PIN: 6 digits, never leading 0
const PHONE_RE = /^[6-9][0-9]{9}$/; // Indian mobile: 10 digits, starts 6-9

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

// Validate a raw address payload from the client. Returns
// { ok: true, address } with a normalised, snapshot-ready object, or
// { ok: false, error } with a human-readable reason for a 400.
export function validateAddress(raw) {
  const body = raw || {};
  const fullName = clean(body.fullName, 80);
  const phone = clean(body.phone, 10);
  const line1 = clean(body.line1, 120);
  const line2 = clean(body.line2, 120);
  const landmark = clean(body.landmark, 120);
  const city = clean(body.city, 60);
  const state = clean(body.state, 60);
  const pincode = clean(body.pincode, 6);

  if (fullName.length < 2) return { ok: false, error: "Please enter the recipient's full name." };
  if (!PHONE_RE.test(phone)) return { ok: false, error: "Enter a valid 10-digit mobile number." };
  if (line1.length < 4) return { ok: false, error: "Enter your house / flat and street." };
  if (city.length < 2) return { ok: false, error: "Please enter your city." };
  if (state.length < 2) return { ok: false, error: "Please enter your state." };
  if (!PIN_RE.test(pincode)) return { ok: false, error: "Enter a valid 6-digit PIN code." };

  return {
    ok: true,
    address: { fullName, phone, line1, line2, landmark, city, state, pincode }
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
