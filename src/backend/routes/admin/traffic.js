import { requireSession } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import { istDayKey } from "../system/analytics.js";

// Read side of landing-page traffic geography.
//
//   GET /api/admin/traffic?days=30
//
// Everything here is an aggregate. The underlying documents hold no IP and no
// raw User-Agent (see routes/system/analytics.js), so there is nothing to
// narrow down to an individual even from this side.

const ALLOWED_RANGES = [7, 30, 90];
const DEFAULT_RANGE = 30;
// Long tails are noise on a dashboard; the totals below still count everything.
const TOP_N = 12;

// The IST day, `back` days ago. Built by walking back in whole days from now
// and re-formatting in IST, so it stays correct across a DST-free but
// offset-shifted timezone and across month boundaries.
function dayKeyDaysAgo(back) {
  const d = new Date(Date.now() - back * 24 * 60 * 60 * 1000);
  return istDayKey(d);
}

// One pass over the window, grouped several ways. Small enough to do in code:
// at the volume a marketing page produces, a single find() over an indexed day
// range is cheaper than several aggregation pipelines, and it keeps the
// unique-visitor counts exact rather than approximate.
function summarize(rows, dayKeys) {
  const byCountry = new Map();
  const byCity = new Map();
  const byReferrer = new Map();
  const byPath = new Map();
  const byDevice = new Map();
  const byDay = new Map();
  const visitors = new Set();
  let unknownGeo = 0;

  const bump = (map, key, visitorHash) => {
    let entry = map.get(key);
    if (!entry) {
      entry = { key, views: 0, visitors: new Set() };
      map.set(key, entry);
    }
    entry.views += 1;
    if (visitorHash) entry.visitors.add(visitorHash);
  };

  for (const row of rows) {
    const hash = row.visitorHash || null;
    if (hash) visitors.add(hash);

    const country = row.country || null;
    if (!country) unknownGeo += 1;

    bump(byCountry, country || "Unknown", hash);
    // City alone is ambiguous across countries — there is more than one
    // Hyderabad — so the label carries its country.
    bump(byCity, row.city ? `${row.city}${country ? `, ${country}` : ""}` : "Unknown", hash);
    bump(byReferrer, row.referrerHost || "Direct / none", hash);
    bump(byPath, row.path || "/", hash);
    bump(byDevice, row.device || "unknown", hash);
    bump(byDay, row.day || "", hash);
  }

  const rank = (map, limit) =>
    [...map.values()]
      .map((e) => ({ key: e.key, views: e.views, visitors: e.visitors.size }))
      .sort((a, b) => b.views - a.views || a.key.localeCompare(b.key))
      .slice(0, limit);

  return {
    totals: {
      views: rows.length,
      visitors: visitors.size,
      // Surfaced deliberately: a high share means the geo provider is failing
      // or unconfigured, and the numbers below should not be trusted yet.
      unknownGeo
    },
    countries: rank(byCountry, TOP_N),
    cities: rank(byCity, TOP_N),
    referrers: rank(byReferrer, TOP_N),
    paths: rank(byPath, TOP_N),
    devices: rank(byDevice, 5),
    // Chronological rather than ranked — this one is a trend line, and it
    // covers EVERY day in the window including the silent ones. Emitting only
    // the days that happen to have traffic would rescale the chart to whatever
    // is left: one busy day in a quiet month would render as a single full-width
    // block rather than one spike against thirty empty days.
    daily: dayKeys.map((key) => {
      const entry = byDay.get(key);
      return { key, views: entry ? entry.views : 0, visitors: entry ? entry.visitors.size : 0 };
    })
  };
}

export function registerAdminTrafficRoutes(app, env) {
  app.get("/api/admin/traffic", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(503);
      return { ok: false, error: "Database is not available." };
    }

    const requested = Number(request.query?.days);
    const days = ALLOWED_RANGES.includes(requested) ? requested : DEFAULT_RANGE;

    // Every day in the window, oldest first, inclusive of today — hence
    // days - 1. Doubles as the range bounds and as the chart's x-axis, so the
    // two can never disagree.
    const dayKeys = [];
    for (let back = days - 1; back >= 0; back -= 1) dayKeys.push(dayKeyDaysAgo(back));
    const from = dayKeys[0];
    const to = dayKeys[dayKeys.length - 1];

    const rows = await collections.landingVisits
      .find(
        { day: { $gte: from, $lte: to } },
        {
          // Only what the summary groups on. Keeps a busy month's worth of
          // documents small in memory.
          projection: {
            _id: 0,
            day: 1,
            path: 1,
            referrerHost: 1,
            country: 1,
            city: 1,
            device: 1,
            visitorHash: 1
          }
        }
      )
      .toArray();

    return {
      ok: true,
      range: { days, from, to },
      configured: Boolean(env.analyticsIngestKey),
      ...summarize(rows, dayKeys)
    };
  });
}
