import crypto from "node:crypto";

import { isNonEmptyString, safeEqual } from "../../lib/auth/security.js";
import { getCollections } from "../../lib/db/repositories.js";
import { lookupGeo } from "../../lib/integrations/geoip.js";

// Ingest for landing-page traffic geography.
//
//   POST /api/analytics/landing-visit
//
// The landing site (parktag.me) and this API (app.parktag.me) are SEPARATE
// Railway services, so a beacon arriving here has the landing server as its
// socket peer — `request.ip` is our own infrastructure, not the visitor. The
// visitor's address therefore has to be forwarded in the body, and the shared
// secret below is what makes that forwarded value trustworthy: without it,
// anyone could POST arbitrary addresses and invent traffic from anywhere.
//
// WHAT IS PERSISTED, AND WHAT IS NOT:
// The IP is resolved to a country/region/city and then discarded — no address
// is written to the database, and neither is the raw User-Agent. Repeat views
// are collapsed with `visitorHash`, a salted digest of (IP + UA + IST date)
// that ROTATES DAILY and is one-way, so it separates "20 people from Delhi"
// from "one person reloading 20 times" without creating an identifier that can
// follow anyone from one day to the next. There is no cookie and no client-side
// storage, which is also why this needs no consent banner.

// A page path is only ever a route on our own marketing site.
const MAX_PATH_LENGTH = 512;

// Coarse buckets. The full User-Agent is a strong fingerprint and is
// deliberately reduced to one of these three before anything is stored.
function deviceClass(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return "unknown";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return "mobile";
  return "desktop";
}

// Crawlers would otherwise dominate the numbers — a marketing page is indexed
// far more often than it is read. Matched here as well as in the landing
// proxy (landing/proxy.ts) so a direct caller cannot skip the filter.
const BOT_PATTERN =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|embedly|quora link preview|pinterest|semrush|ahrefs|mj12|dotbot|petalbot|headlesschrome|lighthouse|gtmetrix|uptime|pingdom|curl\/|wget|python-requests|axios\/|go-http-client|okhttp/i;

export function isBotUserAgent(userAgent) {
  const ua = String(userAgent || "");
  if (!ua.trim()) return true; // A real browser always sends one.
  return BOT_PATTERN.test(ua);
}

// The calendar day in IST. The business and essentially all of its traffic sit
// in one timezone, so bucketing by UTC would split an Indian evening across two
// days and make the daily chart wrong by half a night.
export function istDayKey(date = new Date()) {
  // en-CA formats as YYYY-MM-DD, which sorts lexicographically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

// Only the host is kept. A full referrer URL can carry a search query or other
// personal detail in its path, and "which site sent them" is the whole question.
export function referrerHost(raw, selfHosts = []) {
  if (!isNonEmptyString(raw)) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  // Internal navigation is not a traffic source.
  if (selfHosts.some((self) => host === self || host.endsWith(`.${self}`))) return null;
  return host.slice(0, 120);
}

// A path we are willing to store: our own route, no query string, no fragment.
export function cleanPath(raw) {
  if (!isNonEmptyString(raw)) return "/";
  let value = raw.trim();
  // Reject anything that is not a same-site absolute path — a full URL here
  // would mean the beacon is reporting somewhere other than our own page.
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  value = value.split("?")[0].split("#")[0];
  if (value.length > 1) value = value.replace(/\/+$/, "") || "/";
  return value.slice(0, MAX_PATH_LENGTH);
}

// One-way, daily-rotating. `salt` includes the date, so yesterday's hashes
// cannot be matched against today's even by us.
function visitorDigest(salt, ip, userAgent, day) {
  return crypto
    .createHash("sha256")
    .update(`${salt}|${day}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

export function registerAnalyticsRoutes(app, env) {
  const configured = isNonEmptyString(env.analyticsIngestKey);

  if (!configured) {
    // Same contract as the other integrations in this codebase: unconfigured
    // means OFF, loudly, rather than open. An unauthenticated ingest would let
    // anyone write unbounded documents into the database.
    app.log.warn(
      "[analytics] ANALYTICS_INGEST_KEY is not configured — /api/analytics/landing-visit will refuse every beacon and the admin Traffic page will stay empty. Set the same value here and as ANALYTICS_INGEST_KEY on the landing service."
    );
  }

  // Hosts that count as "us", so an internal link is not recorded as a referrer.
  const selfHosts = [env.appBaseUrl, env.landingBaseUrl]
    .filter(isNonEmptyString)
    .map((value) => {
      try {
        return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  app.post(
    "/api/analytics/landing-visit",
    // Generous, because this is one call per page view for the whole site, but
    // still bounded so a leaked key cannot be used to fill the database.
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!configured) {
        reply.code(503);
        return { ok: false, error: "Analytics ingest is not configured." };
      }

      const supplied = request.headers["x-parktag-analytics-key"];
      if (!isNonEmptyString(supplied) || !safeEqual(supplied, env.analyticsIngestKey)) {
        reply.code(401);
        return { ok: false, error: "Unauthorized." };
      }

      const body = request.body || {};
      const userAgent = String(body.userAgent || "").slice(0, 512);

      // Answer 204 for bots too. The landing proxy already filters them;
      // reporting a rejection would only invite a retry.
      if (isBotUserAgent(userAgent)) {
        reply.code(204);
        return null;
      }

      const collections = await getCollections(env);
      if (!collections) {
        reply.code(503);
        return { ok: false, error: "Database is not available." };
      }

      // Trusted only because the shared secret above was presented.
      const visitorIp = String(body.ip || "").slice(0, 64);
      const geo = await lookupGeo(env, visitorIp);

      const now = new Date();
      const day = istDayKey(now);
      const salt = env.analyticsHashSalt || env.analyticsIngestKey;

      const doc = {
        day,
        // A real Date, not the ISO string used elsewhere in this codebase: the
        // TTL index that enforces the 180-day retention only acts on Date
        // fields and would silently ignore a string. See repositories.js.
        createdAt: now,
        path: cleanPath(body.path),
        referrerHost: referrerHost(body.referrer, selfHosts),
        country: geo.country,
        countryCode: geo.countryCode,
        region: geo.region,
        city: geo.city,
        geoSource: geo.source,
        device: deviceClass(userAgent),
        // See the header note: one-way and rotated daily. Never an IP.
        visitorHash: visitorDigest(salt, visitorIp, userAgent, day)
      };

      await collections.landingVisits.insertOne(doc);

      reply.code(204);
      return null;
    }
  );
}
