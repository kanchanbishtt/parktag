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

// "Wave Mall, Sector 18, Noida" for a point, or null. The nearest named place
// plus its locality, not the full postal address: the owner needs a landmark
// to walk to, and the scanner's position should read as a place, not a door.
export async function placeName(lat, lng, opts) {
  const res = await olaFetch("/places/v1/reverse-geocode", { latlng: `${lat},${lng}` }, opts);
  if (!res) return null;
  const top = ((await res.json()).results || [])[0];
  if (!top) return null;
  const parts = String(top.formatted_address || "").split(",").map((s) => s.trim()).filter(Boolean);
  // Drop the state, PIN and country off the end; keep name, sub-locality, city.
  // "Wave Mall, Pocket J, Sector 18, Noida, Uttar Pradesh 201301" → "Wave Mall, Sector 18, Noida".
  const f = parts.filter((p) => !/\d{6}/.test(p) && p !== "India");
  const picked = f.length > 3 ? [f[0], f[f.length - 2], f[f.length - 1]] : f;
  return picked.length ? picked.join(", ").slice(0, 120) : null;
}

// A 600x300 PNG with a pin, or null.
export async function staticMapPng(lat, lng, opts) {
  const res = await olaFetch(
    `/tiles/v1/styles/default-light-standard/static/${lng},${lat},16/600x300.png`,
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
