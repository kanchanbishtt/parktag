// The scanner location, end to end: a real contact through a real route, to a
// real database, read back through the owner's real dashboard payload.
//
// scan-location.test.js pins the resolver's rule in isolation. This file pins
// the WIRING, which is where this feature can fail silently: three separate
// routes write a contact row, and a field that is resolved but never stored, or
// stored but never sent, looks exactly like a tag that was not entitled. Only
// an end-to-end read can tell those apart.
//
// The geo provider is a local stub, so no test here touches the network.

import test, { describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, createTestOwner, TEST_ORIGIN } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import { resetGeoipCache } from "../lib/integrations/geoip.js";

let app;
let collections;
let geoServer;
let geoRequests = [];

// Public, so it survives geoip's private-address short circuit and actually
// reaches the stub. The test helpers' own uniqueAddress() is 10.x, which would
// resolve to nothing and make every assertion below vacuously pass.
const SCANNER_IP = "49.36.183.22";

const PLATE = "DL9CP4455";
const RIGHT = "4455";
const OWNER_MOBILE = "+919000007710";
const SCANNER_PHONE = "+919000007711";
const EMERGENCY_NUMBER = "+919000007712";

let owner;
let cookie;
const tokens = [];
let fixtureCounter = 0;

function startGeoStub() {
  geoServer = http.createServer((req, res) => {
    geoRequests.push(decodeURIComponent(req.url.replace(/^\//, "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        country: "India",
        country_code: "IN",
        region: "Maharashtra",
        city: "Andheri East"
      })
    );
  });
  return new Promise((resolve) => {
    geoServer.listen(0, "127.0.0.1", () => resolve(geoServer.address().port));
  });
}

// `premiumSince` is what callEntitlement reads for the 45-day window, so it is
// the single knob that moves a fixture up and down the ladder.
async function createTag({ premium = false, premiumSince = null, emergencyContact = null } = {}) {
  fixtureCounter += 1;
  const token = `scanloc${String(fixtureCounter).padStart(3, "0")}${"a1b2c3d4".repeat(6)}`;

  const doc = {
    token,
    ownerId: owner._id,
    status: "active",
    premium,
    plateNumber: PLATE,
    vehicleLabel: "Scan Location Fixture",
    vehicleType: "car",
    createdAt: new Date().toISOString()
  };
  if (premiumSince) doc.premiumSince = premiumSince;
  if (emergencyContact) doc.emergencyContact = emergencyContact;

  await collections.tags.insertOne(doc);
  tokens.push(token);
  return token;
}

async function grantFor(token) {
  const res = await app.inject({
    method: "POST",
    url: `/api/tags/${token}/verify`,
    remoteAddress: SCANNER_IP,
    payload: { lastFour: RIGHT }
  });
  assert.equal(res.statusCode, 200, "fixture verify should succeed");
  return res.json().grant;
}

function rowFor(token) {
  return collections.contactRequests.findOne({ token });
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

before(async () => {
  const port = await startGeoStub();
  // Must precede startTestApp(): getEnv() reads process.env when the app builds.
  process.env.GEOIP_URL = `http://127.0.0.1:${port}/{ip}`;

  ({ app, collections } = await startTestApp());
  await collections.rateLimits.deleteMany({}).catch(() => {});

  owner = await createTestOwner(collections, {
    email: "scan-location@example.invalid",
    displayName: "Scan Location Owner"
  });
  await collections.owners.updateOne(
    { _id: owner._id },
    { $set: { mobile: OWNER_MOBILE, phone: OWNER_MOBILE, mobileVerified: true } }
  );

  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: "scan-location@example.invalid"
  });
});

beforeEach(async () => {
  geoRequests = [];
  // The resolver caches by address for 12 hours; without this the second test
  // would be answered by the first one's lookup and the request-count
  // assertions would be meaningless.
  resetGeoipCache();
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});
  await collections.rateLimits.deleteMany({}).catch(() => {});
});

after(async () => {
  for (const token of tokens) {
    await collections.tags.deleteMany({ token });
    await collections.verificationSessions.deleteMany({ token });
    await collections.contactRequests.deleteMany({ token });
    await collections.pendingCalls.deleteMany({ token });
  }
  await collections.contactRequests.deleteMany({ ownerId: owner._id });
  await collections.owners.deleteOne({ _id: owner._id });
  await collections.rateLimits.deleteMany({}).catch(() => {});
  await stopTestApp(app);
  await new Promise((resolve) => geoServer.close(resolve));
  delete process.env.GEOIP_URL;
});

describe("a masked call records where the scanner was", () => {
  test("an entitled premium tag stores the resolved city", async () => {
    const token = await createTag({ premium: true, premiumSince: daysAgo(1) });

    const res = await app.inject({
      method: "POST",
      url: `/api/tags/${token}/register-call`,
      remoteAddress: SCANNER_IP,
      payload: { phone: SCANNER_PHONE, grant: await grantFor(token) }
    });

    // 503 when no virtual number is configured — the row is still written, which
    // is what this file is about, so the assertion is on the row not the status.
    assert.ok([200, 503].includes(res.statusCode), `unexpected status ${res.statusCode}`);

    const row = await rowFor(token);
    assert.ok(row, "a contact row should exist");
    assert.deepEqual(row.scannerLocation, {
      country: "India",
      countryCode: "IN",
      region: "Maharashtra",
      city: "Andheri East"
    });
    assert.equal(geoRequests.length, 1);
    assert.equal(geoRequests[0], SCANNER_IP);
  });

  test("an E-Tag's one free contact carries a location too", async () => {
    const token = await createTag({ premium: false });

    await app.inject({
      method: "POST",
      url: `/api/tags/${token}/register-call`,
      remoteAddress: SCANNER_IP,
      payload: { phone: SCANNER_PHONE, grant: await grantFor(token) }
    });

    const row = await rowFor(token);
    assert.ok(row, "a contact row should exist");
    assert.equal(row.scannerLocation?.city, "Andheri East");
  });

  test("the raw address is on the row but the location is what is derived", async () => {
    // ipAddress was already stored before this feature and stays stored — the
    // change is that it must never be what the owner is shown. That half is
    // asserted against the dashboard payload below.
    const token = await createTag({ premium: true, premiumSince: daysAgo(1) });
    await app.inject({
      method: "POST",
      url: `/api/tags/${token}/register-call`,
      remoteAddress: SCANNER_IP,
      payload: { phone: SCANNER_PHONE, grant: await grantFor(token) }
    });

    const row = await rowFor(token);
    assert.equal(row.ipAddress, SCANNER_IP);
    assert.equal(JSON.stringify(row.scannerLocation).includes(SCANNER_IP), false);
  });
});

describe("an SOS on a lapsed tag still connects, and carries no location", () => {
  test("the emergency route writes a row with no location and makes no lookup", async () => {
    // The one path that reaches a contact insert without a masking check. If the
    // gate were assumed from call position rather than checked in the resolver,
    // this is where it would leak.
    const token = await createTag({
      premium: true,
      premiumSince: daysAgo(60),
      emergencyContact: EMERGENCY_NUMBER
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/tags/${token}/register-emergency-call`,
      remoteAddress: SCANNER_IP,
      payload: { phone: SCANNER_PHONE, grant: await grantFor(token) }
    });

    // The SOS is not refused for being out of subscription — that is the point.
    assert.notEqual(res.statusCode, 402);

    const row = await collections.contactRequests.findOne({ token, action: "emergency_call" });
    assert.ok(row, "an emergency contact row should exist");
    assert.equal(row.scannerLocation, null);
    assert.equal(geoRequests.length, 0, "a lapsed tag must not be looked up at all");
  });
});

describe("what the owner's dashboard sends", () => {
  function dashboard() {
    return app.inject({
      method: "GET",
      url: "/api/owner/dashboard",
      headers: { origin: TEST_ORIGIN, cookie: `wavetag_session=${cookie}` }
    });
  }

  test("the row carries a ready-made label and never the IP", async () => {
    await collections.contactRequests.insertOne({
      _id: new ObjectId(),
      token: "scanloc-dash",
      ownerId: owner._id,
      phone: SCANNER_PHONE,
      action: "call",
      status: "connecting",
      ipAddress: SCANNER_IP,
      scannerLocation: {
        country: "India",
        countryCode: "IN",
        region: "Maharashtra",
        city: "Andheri East"
      },
      createdAt: new Date().toISOString()
    });

    const res = await dashboard();
    assert.equal(res.statusCode, 200);

    const body = res.json();
    const row = body.requests.find((r) => r.token === "scanloc-dash");
    assert.ok(row, "the seeded contact should be in the payload");
    assert.equal(row.scannerLocationLabel, "Andheri East, Maharashtra, India");
    assert.equal(row.scannerLocation.city, "Andheri East");

    // The privacy line of the whole feature, asserted against the serialised
    // payload rather than the mapped object so a field added anywhere in the
    // response cannot reintroduce it unnoticed.
    assert.equal(row.ipAddress, undefined);
    assert.equal(JSON.stringify(body).includes(SCANNER_IP), false);
  });

  test("a row with no location sends null rather than an empty label", async () => {
    // Rows written before this shipped, and rows from unentitled tags, both look
    // like this. The page branches on the label, so it must be falsy, not "".
    await collections.contactRequests.insertOne({
      _id: new ObjectId(),
      token: "scanloc-dash-old",
      ownerId: owner._id,
      phone: SCANNER_PHONE,
      action: "call",
      status: "connecting",
      createdAt: new Date().toISOString()
    });

    const res = await dashboard();
    const row = res.json().requests.find((r) => r.token === "scanloc-dash-old");
    assert.ok(row, "the seeded contact should be in the payload");
    assert.equal(row.scannerLocation, null);
    assert.equal(row.scannerLocationLabel, null);
  });
});
