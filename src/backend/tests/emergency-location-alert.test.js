// The car's position reaching the owner's emergency contact after an SOS call.
//
// The masked call itself is covered in contact-routing.test.js. This file pins
// what rides with it: a shared position is stored on the emergency row, named
// by the nearest landmark when Ola answers, and handed to the WhatsApp sender
// with a map link and the masked plate and never a phone number — and none of
// it can slow down or fail the call. Nothing here touches the network: the
// place lookup is a local fetch stub, and a test run refuses every WhatsApp
// send before it leaves the process (lib/core/external-guard.js), which is
// exactly the failure this module has to absorb.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Read once by getEnv() when the app starts, so it has to be in place before
// startTestApp() below. The route hands out this number; nothing dials it.
process.env.EXOTEL_CALLER_ID = "08000000000";

import { startTestApp, stopTestApp, createTestOwner, uniqueAddress } from "./helpers.js";
import { settleEmergencyAlerts, emergencyAlertText } from "../lib/core/emergency-alert.js";

const PLATE = "DL9CP4455";
const LAST_FOUR = "4455";
const OWNER_MOBILE = "+919000007720";
const EMERGENCY_NUMBER = "+919000007722";
const SHARED = { lat: 28.567712, lng: 77.323049, accuracy: 12 };
const MAP_LINK = "https://www.google.com/maps/search/?api=1&query=28.5677,77.323";

let app;
let collections;
let owner;
let fixtureCounter = 0;

// A fresh handset per call. A number one client already holds for another
// vehicle is refused by the hijack guard (CALLER_IN_USE), exactly as it should
// be — so reusing one here would test that guard instead of this feature.
function nextScannerPhone() {
  fixtureCounter += 1;
  return `90000${String(20000 + fixtureCounter).padStart(5, "0")}`;
}

const realFetch = globalThis.fetch;
// Every reverse-geocode the stub saw, and what it does next: a delay before a
// landmark answer, or a thrown error.
let placeLookups = [];
let placeDelayMs = 0;
let placeFails = false;

function stubOla() {
  process.env.OLA_MAPS_API_KEY = "qa";
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("/places/v1/reverse-geocode")) return realFetch(url, init);
    placeLookups.push(new URL(String(url)).searchParams.get("latlng"));
    if (placeFails) throw new Error("ola down");
    if (placeDelayMs) await new Promise((r) => setTimeout(r, placeDelayMs));
    return {
      ok: true,
      json: async () => ({ results: [{ name: "Wave Mall", types: ["shopping_mall"], distance_meters: 40, address_components: [
        { types: ["locality"], long_name: "Noida" }, { types: ["sublocality"], long_name: "Sector 18" }
      ] }] })
    };
  };
}

async function createTag({ emergencyContact = EMERGENCY_NUMBER } = {}) {
  fixtureCounter += 1;
  const token = `qasosloc${String(fixtureCounter).padStart(3, "0")}${"a1b2c3d4".repeat(6)}`;
  await collections.tags.insertOne({
    ownerId: owner._id,
    token,
    plateNumber: PLATE,
    vehicleLabel: "Car",
    status: "active",
    ...(emergencyContact ? { emergencyContact } : {}),
    createdAt: new Date().toISOString()
  });
  return token;
}

async function grantFor(token, address) {
  const res = await app.inject({ method: "POST", url: `/api/tags/${token}/verify`, remoteAddress: address, payload: { lastFour: LAST_FOUR } });
  assert.equal(res.statusCode, 200, "fixture verify should succeed");
  return res.json().grant;
}

async function sos(token, extra = {}) {
  const address = uniqueAddress();
  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/register-emergency-call`,
    remoteAddress: address,
    payload: { phone: nextScannerPhone(), grant: await grantFor(token, address), ...extra }
  });
}

const rowFor = (token) => collections.contactRequests.findOne({ token, action: "emergency_call" });

before(async () => {
  ({ app, collections } = await startTestApp());
  owner = await createTestOwner(collections, { email: "qa-sos-loc@parktag-test.invalid", mobile: OWNER_MOBILE });
  stubOla();
});

after(async () => {
  globalThis.fetch = realFetch;
  delete process.env.OLA_MAPS_API_KEY;
  await collections.contactRequests.deleteMany({ token: /^qasosloc/ }).catch(() => {});
  await collections.pendingCalls.deleteMany({ token: /^qasosloc/ }).catch(() => {});
  await collections.tags.deleteMany({ token: /^qasosloc/ }).catch(() => {});
  await collections.owners.deleteOne({ _id: owner._id }).catch(() => {});
  await stopTestApp(app);
});

beforeEach(() => {
  placeLookups = [];
  placeDelayMs = 0;
  placeFails = false;
});

test("the message names the masked plate, the landmark and a map link — nothing else", () => {
  const text = emergencyAlertText({ plateNumber: "DL 9CP 4455", vehicleLabel: "Car" }, { lat: 28.5677, lng: 77.323, place: "Wave Mall, Sector 18, Noida" });
  assert.equal(
    text,
    `EMERGENCY reported at vehicle DL9CP####, near Wave Mall, Sector 18, Noida. The person there is calling you through ParkTag. Car location: ${MAP_LINK}`
  );
  assert.doesNotMatch(text, /\n/, "a WhatsApp template variable may not hold a line break");

  // No landmark resolved, and no plate on file: the label stands in.
  assert.equal(
    emergencyAlertText({ vehicleLabel: "Bike" }, { lat: 28.5677, lng: 77.323 }),
    `EMERGENCY reported at vehicle Bike. The person there is calling you through ParkTag. Car location: ${MAP_LINK}`
  );
});

test("a shared position is stored on the SOS row, named, and handed to WhatsApp", async () => {
  const token = await createTag();

  const res = await sos(token, { carLocation: SHARED });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().virtualNumber, "08000000000");

  await settleEmergencyAlerts();

  const row = await rowFor(token);
  assert.ok(row, "the SOS row exists");
  // Rounded to ~11 m before it goes anywhere, and the phone's accuracy figure
  // is not kept. Only the rounded point reached the place lookup.
  assert.equal(row.carLocation.lat, 28.5677);
  assert.equal(row.carLocation.lng, 77.323);
  assert.equal("accuracy" in row.carLocation, false);
  assert.deepEqual(placeLookups, ["28.5677,77.323"]);
  assert.equal(row.carLocation.place, "Wave Mall, Sector 18, Noida");
  assert.match(row.carLocation.mapToken, /^[A-Za-z0-9_-]{16}$/);
  // Meta is not configured in a test run, so the send is skipped — and had it
  // been, the test guard would have refused it. Either way it is recorded.
  assert.equal(row.emergencyAlert.whatsapp, "skipped");
  assert.equal(typeof row.emergencyAlert.sentAt, "string");
});

test("no position shared: the call is unchanged and nothing is looked up or sent", async () => {
  const token = await createTag();

  assert.equal((await sos(token)).statusCode, 200);
  await settleEmergencyAlerts();

  const row = await rowFor(token);
  assert.ok(row);
  assert.equal("carLocation" in row, false);
  assert.equal("emergencyAlert" in row, false);
  assert.equal(placeLookups.length, 0);
});

test("an unreadable position is dropped, never sent, and never fails the call", async () => {
  for (const junk of [{ lat: "x", lng: 1 }, { lat: 0, lng: 0 }, { lat: 91, lng: 10 }, "28.5,77.3"]) {
    const token = await createTag();
    assert.equal((await sos(token, { carLocation: junk })).statusCode, 200);
    await settleEmergencyAlerts();
    const row = await rowFor(token);
    assert.equal("carLocation" in row, false);
    assert.equal("emergencyAlert" in row, false);
  }
  assert.equal(placeLookups.length, 0);
});

test("a dead place lookup keeps the point and the call, just without a name", async () => {
  const token = await createTag();
  placeFails = true;

  assert.equal((await sos(token, { carLocation: SHARED })).statusCode, 200);
  await settleEmergencyAlerts();

  const row = await rowFor(token);
  assert.equal(row.carLocation.lat, 28.5677, "the position is still on the row for the owner");
  assert.equal(row.carLocation.place, null);
  assert.equal(row.emergencyAlert.whatsapp, "skipped");
  // The pending route the webhook dials is untouched by the failed lookup.
  assert.equal(await collections.pendingCalls.countDocuments({ token, type: "scanner_to_emergency" }), 1);
});

test("the number is handed over before the alert is anywhere near done", async () => {
  const token = await createTag();
  placeDelayMs = 1500;

  const started = Date.now();
  const res = await sos(token, { carLocation: SHARED });
  const elapsed = Date.now() - started;
  assert.equal(res.statusCode, 200);
  assert.ok(elapsed < 700, `answered in ${elapsed}ms while the lookup was still running`);

  await settleEmergencyAlerts();
  assert.equal((await rowFor(token)).carLocation.place, "Wave Mall, Sector 18, Noida");
});

test("a tag with no emergency contact is refused before any of this runs", async () => {
  const token = await createTag({ emergencyContact: null });

  const res = await sos(token, { carLocation: SHARED });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, "NO_EMERGENCY_CONTACT");

  await settleEmergencyAlerts();
  assert.equal(await collections.contactRequests.countDocuments({ token }), 0);
  assert.equal(placeLookups.length, 0);
});
