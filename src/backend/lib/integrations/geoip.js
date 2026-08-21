// Turns a visitor's IP address into a coarse location (country / region / city)
// so the admin panel can answer "where is our traffic coming from".
//
// WHY IP AND NOT THE BROWSER'S LOCATION API:
// A `navigator.geolocation` prompt is the wrong instrument for this question.
// Most visitors on a marketing page decline it, so the sample is both tiny and
// self-selected; Chrome degrades the prompt on sites with poor accept rates;
// and metre-accurate coordinates are far more personal data than "which city"
// needs, which makes it disproportionate under the DPDP Act. An IP lookup
// answers the same question for 100% of visitors, silently, at city precision.
//
// WHAT IS NEVER STORED:
// The IP is used to resolve a location and then dropped. Nothing in this file
// writes, and the caller (routes/system/analytics.js) persists only the derived
// country/region/city. See the note there.
//
// The lookup is entirely OPT-IN and fail-soft: with no provider reachable, the
// visit is still recorded with an unknown location rather than lost.

// ipwho.is is the default because it is HTTPS, needs no API key and no signup,
// so this works on a fresh deploy with nothing configured. Swap in a paid
// provider (or a self-hosted MaxMind reader) with GEOIP_URL — any URL
// containing `{ip}` works as long as the response has the fields read below.
const DEFAULT_GEOIP_URL = "https://ipwho.is/{ip}";

// A provider outage must never hold up a page view being recorded, and this
// call sits on the request path of the beacon endpoint.
const LOOKUP_TIMEOUT_MS = 2500;

// Addresses repeat constantly — one visitor reading four pages is four beacons
// from the same IP. Caching keeps us far inside any provider's free tier.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 5000;

const cache = new Map();

function cacheGet(ip) {
  const hit = cache.get(ip);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(ip);
    return null;
  }
  // Re-insert so the Map's insertion order approximates recency, which is what
  // the eviction below relies on.
  cache.delete(ip);
  cache.set(ip, hit);
  return hit.value;
}

function cacheSet(ip, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map iterates in insertion order, so the first key is the least recently
    // used. Evicting one per insert is enough to hold the ceiling.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(ip, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Exported for the tests, which must not inherit state between cases.
export function resetGeoipCache() {
  cache.clear();
}

// Normalise what a proxy hands us into a bare address.
//
// Railway sits in front of both services and sets x-forwarded-for; the client
// address is the FIRST entry, everything after it being the proxy chain. Any
// later entry is attacker-controlled on a direct request, so only the first is
// ever read — and only because Railway rewrites the header rather than
// appending to a client-supplied one.
export function normalizeIp(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return "";

  // "1.2.3.4, 10.0.0.1" — the client, then the proxies.
  if (value.includes(",")) value = value.split(",")[0].trim();

  // IPv4-mapped IPv6, as Node reports for a v4 client on a dual-stack socket.
  if (value.toLowerCase().startsWith("::ffff:")) value = value.slice(7);

  // "[2001:db8::1]:443" or "1.2.3.4:443" — strip the port. An IPv6 address
  // without brackets contains many colons, so only split when there is exactly
  // one, which cannot be a bare v6 address.
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end > 0) value = value.slice(1, end);
  } else if (value.split(":").length === 2) {
    value = value.split(":")[0];
  }

  return value;
}

// True for addresses no geo provider can resolve: loopback, RFC1918 private
// ranges, link-local, and carrier-grade NAT. Looking these up wastes a request
// and always comes back empty, so they short-circuit to "unknown".
export function isPrivateIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return true;

  if (value === "::1" || value === "0.0.0.0") return true;

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  const lower = value.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") ||
      lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true;
  }

  const parts = value.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;

  const [a, b] = octets;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 — carrier-grade NAT. A real mobile visitor can appear here,
  // but the address identifies the carrier's pool rather than the subscriber,
  // so no provider resolves it usefully.
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

const UNKNOWN = Object.freeze({
  country: null,
  countryCode: null,
  region: null,
  city: null
});

function cleanField(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // A provider response is third-party text that ends up rendered in the admin
  // panel. Cap it so a hostile or broken response cannot bloat a document, and
  // let the page escape it on render.
  return trimmed.slice(0, 80);
}

// Resolve one address. Always resolves — never throws, never rejects — because
// a failed lookup must still leave a counted page view.
//
// Returns { country, countryCode, region, city } with nulls where unknown,
// plus a `source` describing how the answer was reached (useful when the admin
// page shows a suspicious number of unknowns).
export async function lookupGeo(env, rawIp) {
  const ip = normalizeIp(rawIp);

  if (!ip) return { ...UNKNOWN, source: "no-ip" };
  if (isPrivateIp(ip)) return { ...UNKNOWN, source: "private-ip" };

  const cached = cacheGet(ip);
  if (cached) return { ...cached, source: "cache" };

  const template = env?.geoipUrl || DEFAULT_GEOIP_URL;
  if (!template.includes("{ip}")) {
    return { ...UNKNOWN, source: "bad-provider-url" };
  }

  let data;
  try {
    const res = await fetch(template.replace("{ip}", encodeURIComponent(ip)), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
    });
    if (!res.ok) return { ...UNKNOWN, source: `http-${res.status}` };
    data = await res.json();
  } catch (err) {
    // Timeout, DNS failure, provider outage, rate limit. The visit still counts.
    return { ...UNKNOWN, source: "unreachable", error: err && err.message };
  }

  // ipwho.is reports a refusal as 200 + { success: false }, so an HTTP-level
  // check alone is not enough.
  if (!data || data.success === false) {
    return { ...UNKNOWN, source: "provider-declined" };
  }

  // Field names differ between providers. Accept the handful of spellings the
  // common ones use so GEOIP_URL can be repointed without a code change.
  const value = {
    country: cleanField(data.country ?? data.country_name),
    countryCode: cleanField(data.country_code ?? data.countryCode ?? data.country_code2),
    region: cleanField(data.region ?? data.region_name ?? data.regionName ?? data.state),
    city: cleanField(data.city)
  };

  // Don't cache a blank answer — a provider hiccup would otherwise pin this IP
  // to "unknown" for the next twelve hours.
  if (value.country || value.city) cacheSet(ip, value);

  return { ...value, source: "lookup" };
}
