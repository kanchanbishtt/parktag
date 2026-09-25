// Ola Maps: street suggestions, place names for a shared car location, the map
// image in the owner's alert, and the COD address check.
//
// The key is domain-locked on Ola's side to parktag.me, and Ola checks that
// through the Origin header. Node's fetch drops Referer, so Origin is the one
// that has to be sent, or every call comes back 403 "Domain is not allowed".
//
// Everything here fails soft: a missing key, a timeout or a refusal returns
// null, and every caller treats null as "carry on without it".

const BASE = "https://api.olamaps.io";
const ORIGIN = "https://app.parktag.me";

export function isOlaMapsConfigured() {
  return !!process.env.OLA_MAPS_API_KEY;
}

async function olaFetch(path, params, { timeoutMs = 3000, log = null } = {}) {
  const key = process.env.OLA_MAPS_API_KEY || "";
  if (!key) return null;
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);
  try {
    const res = await fetch(url, {
      headers: { Origin: ORIGIN, "X-Request-Id": crypto.randomUUID() },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      log?.warn?.({ status: res.status, path }, "[ola-maps] refused");
      return null;
    }
    return res;
  } catch (err) {
    log?.warn?.({ err, path }, "[ola-maps] request failed");
    return null;
  }
}

export async function autocomplete(input, opts) {
  const res = await olaFetch("/places/v1/autocomplete", { input }, opts);
  return res ? (await res.json()).predictions || [] : [];
}

// Named places a stranger can walk to. Ola's nearest result is usually just the
// closest business ("Xacco Global Hospitalities", a firm on the 19th floor), so
// a result is only used as the landmark when it is one of these kinds.
const LANDMARK_TYPES = new Set([
  "shopping_mall", "subway_station", "transit_station", "train_station", "bus_station",
  "light_rail_station", "hospital", "park", "place_of_worship", "hindu_temple", "church",
  "mosque", "gurudwara", "stadium", "university", "airport", "tourist_attraction", "museum"
]);

// What to tell the owner about a point, or null:
//   place  "Wave Mall, Sector 18, Noida"   (the alert text)
//   pin    "Wave Mall"                     (the label on the map image)
// Built from the address components (block, sector, city), with a landmark in
// front only when one of the results is a genuine landmark within 150 m.
export async function describePlace(lat, lng, opts) {
  const res = await olaFetch("/places/v1/reverse-geocode", { latlng: `${lat},${lng}` }, opts);
  if (!res) return null;
  const results = (await res.json()).results || [];
  if (!results.length) return null;

  const part = (type) => {
    for (const r of results) {
      const c = (r.address_components || []).find((x) => (x.types || []).includes(type));
      if (c?.long_name) return c.long_name;
    }
    return "";
  };
  const block = part("neighborhood");
  const sector = part("sublocality");
  const city = part("locality") || part("administrative_area_level_3");
  const landmark = results.find((r) =>
    r.name && (r.types || []).some((t) => LANDMARK_TYPES.has(t)) && !(Number(r.distance_meters) > 150)
  )?.name || "";

  const unique = (xs) => xs.filter((x, i) => x && xs.indexOf(x) === i);
  const place = unique(landmark ? [landmark, sector || block, city] : [block, sector, city]).join(", ");
  const pin = landmark || unique([block, sector]).join(", ") || city;
  return place ? { place: place.slice(0, 120), pin: (pin || place).slice(0, 40) } : null;
}

// A 1200x600 PNG (600x300 at 2x, so it stays sharp on a phone), pin at the
// centre, or null.
export async function staticMapPng(lat, lng, opts) {
  const res = await olaFetch(
    `/tiles/v1/styles/default-light-standard/static/${lng},${lat},16/600x300@2x.png`,
    { marker: `${lng},${lat}|red|scale:0.9` },
    { timeoutMs: 5000, ...opts }
  );
  return res ? Buffer.from(await res.arrayBuffer()) : null;
}

// true / false when Ola answered, null when it could not be asked.
export async function addressValidates(text, opts) {
  const res = await olaFetch("/places/v1/addressvalidation", { address: text }, opts);
  if (!res) return null;
  const validated = (await res.json())?.result?.validated;
  return typeof validated === "boolean" ? validated : null;
}
