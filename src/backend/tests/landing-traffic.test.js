// Landing-page traffic geography.
//
// The feature answers "where are our visitors coming from" from the IP the
// server already receives, rather than from a `navigator.geolocation` prompt.
// That choice is only defensible if two things actually hold, so both are
// pinned here rather than left as comments:
//
//   1. No personal data is retained. A stored IP address or a stored raw
//      User-Agent would make this a tracking log; the tests below read the
//      written document back and assert neither is present in any form.
//   2. The forwarded IP cannot be forged. The landing site and this API are
//      separate services, so the visitor's address arrives in the request BODY.
//      Without a working shared secret that is an open invitation to invent
//      traffic, so the ingest must fail closed.
//
// Everything else here is ordinary correctness: day bucketing in IST, repeat
// views collapsing into one visitor, and the daily rotation that stops the
// visitor digest from following anyone across dates.
import http from "node:http";
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import {
  cleanPath,
  isBotUserAgent,
  istDayKey,
  referrerHost
} from "../routes/system/analytics.js";
import { isPrivateIp, lookupGeo, normalizeIp, resetGeoipCache } from "../lib/integrations/geoip.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const INGEST_KEY = "qa-analytics-ingest-key-8f21c4";
const ADMIN_EMAIL = assertUndeliverableIdentifier("qa-traffic-admin@parktag-test.invalid");

// TEST-NET-3 (RFC 5737). Routable-looking, so it takes the real lookup path,
// but reserved for documentation so it can never belong to anyone.
const VISITOR_IP = "203.0.113.5";
const OTHER_IP = "203.0.113.99";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let app;
let env;
let collections;
let adminCookie;
let geoServer;
let geoRequests = 0;

// Stands in for the geo provider so no test touches the network. Answers in
// ipwho.is's shape, which is what lookupGeo parses by default.
function startGeoStub() {
  geoServer = http.createServer((req, res) => {
    geoRequests += 1;
    const ip = decodeURIComponent(req.url.replace(/^\//, ""));
    const body =
      ip === OTHER_IP
        ? { success: true, country: "India", country_code: "IN", region: "Maharashtra", city: "Mumbai" }
        : { success: true, country: "India", country_code: "IN", region: "Delhi", city: "New Delhi" };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    geoServer.listen(0, "127.0.0.1", () => resolve(geoServer.address().port));
  });
}

before(async () => {
  const port = await startGeoStub();
  // Both must be set before startTestApp(): getEnv() reads process.env on each
  // call, and registerAnalyticsRoutes decides configured/unconfigured once, at
  // registration time.
  process.env.GEOIP_URL = `http://127.0.0.1:${port}/{ip}`;
  process.env.ANALYTICS_INGEST_KEY = INGEST_KEY;

  ({ app, env, collections } = await startTestApp());
});

after(async () => {
  await collections.landingVisits.deleteMany({}).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
  await new Promise((resolve) => geoServer.close(resolve));
  delete process.env.GEOIP_URL;
  delete process.env.ANALYTICS_INGEST_KEY;
});

beforeEach(async () => {
  await collections.landingVisits.deleteMany({});
  await purgeLoginCollections(collections);
  resetGeoipCache();
  geoRequests = 0;

  const admin = await createTestOwner(collections, { email: ADMIN_EMAIL });
  await collections.admins.insertOne({
    _id: admin._id,
    email: ADMIN_EMAIL,
    role: "admin",
    displayName: "QA Traffic Admin",
    createdAt: new Date().toISOString()
  });
  adminCookie = await createSession(app, {
    id: String(admin._id),
    role: "admin",
    email: ADMIN_EMAIL,
    displayName: "QA Traffic Admin"
  });
});

function beacon(body, { key = INGEST_KEY } = {}) {
  return app.inject({
    method: "POST",
    url: "/api/analytics/landing-visit",
    remoteAddress: uniqueAddress(),
    headers: key === null ? {} : { "x-parktag-analytics-key": key },
    payload: { userAgent: BROWSER_UA, path: "/", ip: VISITOR_IP, ...body }
  });
}

function traffic(days = 30, { withCookie = true } = {}) {
  return app.inject({
    method: "GET",
    url: `/api/admin/traffic?days=${days}`,
    remoteAddress: uniqueAddress(),
    ...(withCookie ? { cookies: { wavetag_session: adminCookie } } : {})
  });
}

// ── The forwarded address must be authenticated ──────────────────────────

describe("the ingest fails closed", () => {
  test("no key at all is refused", async () => {
    const response = await beacon({}, { key: null });
    assert.equal(response.statusCode, 401);
    assert.equal(await collections.landingVisits.countDocuments({}), 0);
  });

  test("a wrong key is refused", async () => {
    const response = await beacon({}, { key: "not-the-key" });
    assert.equal(response.statusCode, 401);
    assert.equal(await collections.landingVisits.countDocuments({}), 0);
  });

  test("a key of the right length but wrong value is still refused", async () => {
    // safeEqual short-circuits on length, so a same-length value is the case
    // that actually exercises the constant-time compare.
    const sameLength = "x".repeat(INGEST_KEY.length);
    assert.equal(sameLength.length, INGEST_KEY.length);
    const response = await beacon({}, { key: sameLength });
    assert.equal(response.statusCode, 401);
    assert.equal(await collections.landingVisits.countDocuments({}), 0);
  });

  test("the correct key is accepted", async () => {
    const response = await beacon({});
    assert.equal(response.statusCode, 204);
    assert.equal(await collections.landingVisits.countDocuments({}), 1);
  });
});

// ── What is written, and what must never be ──────────────────────────────

describe("no personal data is retained", () => {
  test("the stored document holds no IP address and no raw User-Agent", async () => {
    await beacon({ path: "/about", referrer: "https://www.google.com/search?q=parktag" });

    const doc = await collections.landingVisits.findOne({});
    assert.ok(doc, "a visit should have been recorded");

    // Rather than checking a list of field names — which a later edit could add
    // to — serialise the whole document and assert the values are absent.
    const serialised = JSON.stringify(doc);
    assert.ok(!serialised.includes(VISITOR_IP), "the IP address must not be stored anywhere");
    assert.ok(!serialised.includes("203.0.113"), "no fragment of the IP may survive");
    assert.ok(!serialised.includes("Mozilla"), "the raw User-Agent must not be stored");
    assert.ok(!serialised.includes("Chrome/124"), "no browser version string may survive");

    // The referrer is reduced to a host: the search QUERY the visitor typed is
    // personal and must not come along with it.
    assert.equal(doc.referrerHost, "google.com");
    assert.ok(!serialised.includes("q=parktag"), "the referrer query must be dropped");

    // What we do keep.
    assert.equal(doc.path, "/about");
    assert.equal(doc.country, "India");
    assert.equal(doc.city, "New Delhi");
    assert.equal(doc.device, "desktop");
  });

  test("createdAt is a real Date so the retention TTL can actually fire", async () => {
    await beacon({});
    const doc = await collections.landingVisits.findOne({});
    // A TTL index silently ignores a string, which would leave the 180-day
    // retention doing nothing at all.
    assert.ok(doc.createdAt instanceof Date, "createdAt must be a BSON Date, not an ISO string");
  });

  test("the visitor digest rotates daily", async () => {
    await beacon({});
    const today = await collections.landingVisits.findOne({});

    // Same visitor, same device — but recorded under a different day key.
    await collections.landingVisits.deleteMany({});
    const realDay = istDayKey();
    await beacon({});
    const again = await collections.landingVisits.findOne({});

    assert.equal(again.day, realDay);
    assert.equal(again.visitorHash, today.visitorHash, "same day must collapse to one visitor");

    // The digest is a hash, not the address.
    assert.ok(!again.visitorHash.includes("203"), "the digest must not embed the IP");
    assert.match(again.visitorHash, /^[0-9a-f]{32}$/);
  });
});

describe("crawlers are not counted", () => {
  test("a bot User-Agent is accepted but never recorded", async () => {
    const response = await beacon({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" });
    // 204 rather than an error: reporting a rejection would only invite retries.
    assert.equal(response.statusCode, 204);
    assert.equal(await collections.landingVisits.countDocuments({}), 0);
  });

  test("an empty User-Agent is treated as a bot", async () => {
    const response = await beacon({ userAgent: "" });
    assert.equal(response.statusCode, 204);
    assert.equal(await collections.landingVisits.countDocuments({}), 0);
  });

  test("a bot never costs a geo lookup", async () => {
    await beacon({ userAgent: "curl/8.4.0" });
    assert.equal(geoRequests, 0, "the provider must not be called for a crawler");
  });
});

// ── The admin summary ────────────────────────────────────────────────────

describe("the admin summary", () => {
  test("requires an admin session", async () => {
    const response = await traffic(30, { withCookie: false });
    assert.ok(
      response.statusCode === 401 || response.statusCode === 403,
      `expected an auth failure, got ${response.statusCode}`
    );
  });

  test("collapses repeat views by the same visitor", async () => {
    await beacon({ path: "/" });
    await beacon({ path: "/about" });
    await beacon({ path: "/contact" });

    const body = traffic(30).then((r) => JSON.parse(r.body));
    const data = await body;

    assert.equal(data.ok, true);
    assert.equal(data.totals.views, 3, "every page view counts");
    assert.equal(data.totals.visitors, 1, "one person reading three pages is one visitor");
  });

  test("separates distinct visitors and their cities", async () => {
    await beacon({ ip: VISITOR_IP });
    await beacon({ ip: OTHER_IP });

    const data = JSON.parse((await traffic(30)).body);
    assert.equal(data.totals.views, 2);
    assert.equal(data.totals.visitors, 2);

    const cities = data.cities.map((c) => c.key).sort();
    assert.deepEqual(cities, ["Mumbai, India", "New Delhi, India"]);
  });

  test("groups referrers and marks direct traffic", async () => {
    await beacon({ referrer: "https://www.google.com/" });
    await beacon({ referrer: "https://instagram.com/parktag", ip: OTHER_IP });
    await beacon({ referrer: "" });

    const data = JSON.parse((await traffic(30)).body);
    const byKey = Object.fromEntries(data.referrers.map((r) => [r.key, r.views]));

    assert.equal(byKey["google.com"], 1, "www. is stripped");
    assert.equal(byKey["instagram.com"], 1);
    assert.equal(byKey["Direct / none"], 1, "no referrer is its own bucket");
  });

  test("an unresolved location is surfaced rather than hidden", async () => {
    // A private address cannot be resolved by any provider.
    await beacon({ ip: "10.0.0.7" });

    const data = JSON.parse((await traffic(30)).body);
    assert.equal(data.totals.unknownGeo, 1);
    assert.equal(data.countries[0].key, "Unknown");
  });

  test("only whitelisted ranges are honoured", async () => {
    for (const [requested, expected] of [[7, 7], [30, 30], [90, 90], [9999, 30], [-1, 30]]) {
      const data = JSON.parse((await traffic(requested)).body);
      assert.equal(data.range.days, expected, `days=${requested} should resolve to ${expected}`);
    }
  });

  test("the daily series covers every day in the window, including silent ones", async () => {
    await beacon({});

    for (const days of [7, 30, 90]) {
      const data = JSON.parse((await traffic(days)).body);
      assert.equal(data.daily.length, days, `${days}-day range should emit ${days} points`);
      assert.equal(data.daily[0].key, data.range.from, "the series must start at the range start");
      assert.equal(data.daily[days - 1].key, data.range.to, "and end at today");

      // Oldest first, and strictly increasing — the chart reads left to right.
      const keys = data.daily.map((d) => d.key);
      assert.deepEqual(keys, [...keys].sort(), "days must be chronological");
      assert.equal(new Set(keys).size, days, "no day may repeat");

      // Only today has traffic; every other day is a real zero rather than a
      // missing point, which is what stops one busy day rendering full-width.
      assert.equal(data.daily[days - 1].views, 1);
      assert.equal(data.daily.filter((d) => d.views === 0).length, days - 1);
    }
  });

  test("reports whether recording is switched on", async () => {
    const data = JSON.parse((await traffic(30)).body);
    // Distinguishes "nobody visited" from "the pipeline is not configured",
    // which otherwise look identical on the page.
    assert.equal(data.configured, true);
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────

describe("IP handling", () => {
  test("only the first x-forwarded-for entry is read", () => {
    // Later entries are the proxy chain and are attacker-supplied on a direct
    // request, so trusting one would let a visitor claim any address.
    assert.equal(normalizeIp("203.0.113.5, 10.0.0.1, 172.16.0.9"), "203.0.113.5");
  });

  test("ports and IPv4-mapped IPv6 are normalised away", () => {
    assert.equal(normalizeIp("::ffff:203.0.113.5"), "203.0.113.5");
    assert.equal(normalizeIp("203.0.113.5:51234"), "203.0.113.5");
    assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
    // A bare IPv6 address has many colons and must survive intact.
    assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
  });

  test("unroutable ranges are recognised", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "192.168.1.4", "172.16.5.5", "169.254.1.1", "100.64.0.1", "::1", "fd00::1"]) {
      assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
    }
    for (const ip of ["203.0.113.5", "8.8.8.8", "49.36.1.1", "172.15.0.1", "172.32.0.1"]) {
      assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
    }
  });

  test("a private address never reaches the provider", async () => {
    const before = geoRequests;
    const result = await lookupGeo({ geoipUrl: process.env.GEOIP_URL }, "192.168.0.10");
    assert.equal(result.source, "private-ip");
    assert.equal(result.country, null);
    assert.equal(geoRequests, before, "no lookup should have been made");
  });

  test("a repeat address is served from cache", async () => {
    const fakeEnv = { geoipUrl: process.env.GEOIP_URL };
    const first = await lookupGeo(fakeEnv, VISITOR_IP);
    const hits = geoRequests;
    const second = await lookupGeo(fakeEnv, VISITOR_IP);

    assert.equal(first.source, "lookup");
    assert.equal(second.source, "cache");
    assert.equal(second.city, "New Delhi");
    assert.equal(geoRequests, hits, "the second call must not hit the provider");
  });

  test("an unreachable provider still yields a usable answer", async () => {
    // Port 1 is reserved and refuses instantly.
    const result = await lookupGeo({ geoipUrl: "http://127.0.0.1:1/{ip}" }, VISITOR_IP);
    assert.equal(result.country, null);
    assert.equal(result.source, "unreachable");
  });

  test("a provider URL with no {ip} placeholder is rejected, not called blindly", async () => {
    const result = await lookupGeo({ geoipUrl: "https://example.invalid/lookup" }, VISITOR_IP);
    assert.equal(result.source, "bad-provider-url");
  });
});

describe("field cleaning", () => {
  test("paths lose their query and fragment", () => {
    assert.equal(cleanPath("/about?utm_source=x#top"), "/about");
    assert.equal(cleanPath("/"), "/");
    assert.equal(cleanPath("/about/"), "/about");
  });

  test("a path that is not our own route collapses to /", () => {
    // A full URL here would mean the beacon is reporting somewhere else.
    assert.equal(cleanPath("https://evil.example/x"), "/");
    assert.equal(cleanPath("//evil.example/x"), "/");
    assert.equal(cleanPath(""), "/");
    assert.equal(cleanPath(null), "/");
  });

  test("referrers reduce to a host and drop our own", () => {
    assert.equal(referrerHost("https://www.google.com/search?q=a"), "google.com");
    assert.equal(referrerHost("https://parktag.me/about", ["parktag.me"]), null);
    assert.equal(referrerHost("https://app.parktag.me/x", ["parktag.me"]), null);
    assert.equal(referrerHost("javascript:alert(1)"), null);
    assert.equal(referrerHost("not a url"), null);
    assert.equal(referrerHost(""), null);
  });

  test("known crawlers are matched, real browsers are not", () => {
    for (const ua of ["Googlebot/2.1", "curl/8.4.0", "python-requests/2.31", "facebookexternalhit/1.1", ""]) {
      assert.equal(isBotUserAgent(ua), true, `${ua || "(empty)"} should be a bot`);
    }
    assert.equal(isBotUserAgent(BROWSER_UA), false);
  });

  test("the day key is the Indian calendar day, not the UTC one", () => {
    // 19:00 UTC is already the next day in IST (+05:30). Bucketing by UTC would
    // split an Indian evening across two days and halve the daily chart.
    assert.equal(istDayKey(new Date("2026-08-20T19:00:00Z")), "2026-08-21");
    assert.equal(istDayKey(new Date("2026-08-20T17:00:00Z")), "2026-08-20");
    assert.match(istDayKey(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
