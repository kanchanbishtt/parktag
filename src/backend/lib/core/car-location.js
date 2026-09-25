// Where the car is, when the scanner chooses to share it.
//
// scan-location.js records a city off the scanner's IP for everyone, silently.
// This is the other half, and it is opt-in: the scan page asks the phone for its
// position only when the scanner taps "Share where the car is". The scanner is
// standing at the car, so the fix is the CAR's position, which is what the owner
// needs for a tow or a blocked gate, and an IP city cannot give.
//
// WHAT IS KEPT
// The point rounded to 4 decimals (about 11 m), a place description from Ola
// Maps, and a random token for the map image URL. Not the raw fix, not its
// accuracy. 3 decimals (~110 m) was tried first and put the pin a building
// away, which defeats "find the car"; the phone's own error indoors is already
// 20-100 m, so 11 m rounding costs nothing and adds no precision it lacks.

import crypto from "node:crypto";

import { describePlace } from "../integrations/ola-maps.js";

const round4 = (n) => Math.round(n * 10000) / 10000;

// The raw { lat, lng } from the request body, checked, or null.
export function readCarLocation(raw) {
  const lat = Number(raw?.lat);
  const lng = Number(raw?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat: round4(lat), lng: round4(lng) };
}

// { place, pin, lat, lng, mapToken } or null. Bounded by Ola's own timeout, because
// the owner's alert waits on it.
export async function resolveCarLocation(raw, { log = null, timeoutMs = 2500 } = {}) {
  const point = readCarLocation(raw);
  if (!point) return null;
  const described = await describePlace(point.lat, point.lng, { log, timeoutMs });
  return {
    place: described?.place || null,
    pin: described?.pin || null,
    lat: point.lat,
    lng: point.lng,
    mapToken: crypto.randomBytes(12).toString("base64url")
  };
}

export function carMapUrl(env, carLocation) {
  if (!carLocation?.mapToken) return null;
  return `${String(env.appBaseUrl || "").replace(/\/+$/, "")}/m/${carLocation.mapToken}.png`;
}
