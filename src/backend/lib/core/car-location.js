// Where the car is, when the scanner chooses to share it.
//
// scan-location.js records a city off the scanner's IP for everyone, silently.
// This is the other half, and it is opt-in: the scan page asks the phone for its
// position only when the scanner taps "Share where the car is". The scanner is
// standing at the car, so the fix is the CAR's position, which is what the owner
// needs for a tow or a blocked gate, and an IP city cannot give.
//
// WHAT IS KEPT
// The point rounded to 3 decimals (about 110 m), the nearest landmark name from
// Ola Maps, and a random token for the map image URL. Not the raw fix, not its
// accuracy. The owner is shown the landmark and a map of the rounded point:
// enough to find a car in a street, never enough to single out a doorway.

import crypto from "node:crypto";

import { placeName } from "../integrations/ola-maps.js";

const round3 = (n) => Math.round(n * 1000) / 1000;

// The raw { lat, lng } from the request body, checked, or null.
export function readCarLocation(raw) {
  const lat = Number(raw?.lat);
  const lng = Number(raw?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat: round3(lat), lng: round3(lng) };
}

// { place, lat, lng, mapToken } or null. Bounded by Ola's own timeout, because
// the owner's alert waits on it.
export async function resolveCarLocation(raw, { log = null, timeoutMs = 2500 } = {}) {
  const point = readCarLocation(raw);
  if (!point) return null;
  const place = await placeName(point.lat, point.lng, { log, timeoutMs });
  return {
    place: place || null,
    lat: point.lat,
    lng: point.lng,
    mapToken: crypto.randomBytes(12).toString("base64url")
  };
}

export function carMapUrl(env, carLocation) {
  if (!carLocation?.mapToken) return null;
  return `${String(env.appBaseUrl || "").replace(/\/+$/, "")}/m/${carLocation.mapToken}.png`;
}
