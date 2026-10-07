// Which state a number plate was registered in, from its first two letters.
//
// Used to suggest which buyer an unlinked activation might belong to: a
// sticker shipped to Haryana that turns up on an HR plate is a better guess
// than one on a KL plate. A guess, never a link — see order-linking.js for why
// a wrong link is worse than none.

const STATE_BY_CODE = {
  AN: "andaman and nicobar islands",
  AP: "andhra pradesh",
  AR: "arunachal pradesh",
  AS: "assam",
  BR: "bihar",
  CG: "chhattisgarh",
  CH: "chandigarh",
  DD: "daman and diu",
  DL: "delhi",
  DN: "dadra and nagar haveli",
  GA: "goa",
  GJ: "gujarat",
  HP: "himachal pradesh",
  HR: "haryana",
  JH: "jharkhand",
  JK: "jammu and kashmir",
  KA: "karnataka",
  KL: "kerala",
  LA: "ladakh",
  LD: "lakshadweep",
  MH: "maharashtra",
  ML: "meghalaya",
  MN: "manipur",
  MP: "madhya pradesh",
  MZ: "mizoram",
  NL: "nagaland",
  OD: "odisha",
  OR: "odisha",
  PB: "punjab",
  PY: "puducherry",
  RJ: "rajasthan",
  SK: "sikkim",
  TN: "tamil nadu",
  TR: "tripura",
  TS: "telangana",
  TG: "telangana",
  UK: "uttarakhand",
  UA: "uttarakhand",
  UP: "uttar pradesh",
  WB: "west bengal"
};

// Letters only, lower case, so "New Delhi", "NCT of Delhi" and "Delhi" all
// read as delhi, and "Jammu & Kashmir" as jammu and kashmir would.
export function normalizeStateName(value) {
  const s = String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z]+/g, " ").trim();
  if (!s) return null;
  if (/\bdelhi\b/.test(s)) return "delhi";
  if (/\bpondicherry\b/.test(s)) return "puducherry";
  if (/\borissa\b/.test(s)) return "odisha";
  if (/\buttaranchal\b/.test(s)) return "uttarakhand";
  return s;
}

// null when the plate is missing, foreign, or a BH-series plate, which carries
// no state at all.
export function stateOfPlate(plateNumber) {
  const code = String(plateNumber || "").replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();
  return STATE_BY_CODE[code] || null;
}

export function plateMatchesState(plateNumber, stateName) {
  const fromPlate = stateOfPlate(plateNumber);
  const wanted = normalizeStateName(stateName);
  return Boolean(fromPlate && wanted && fromPlate === wanted);
}
