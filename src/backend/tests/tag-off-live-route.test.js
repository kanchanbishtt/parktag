// A call route outlives the switch that should have stopped it.
//
// register-call and register-emergency-call check the tag, then leave a route
// that Dial Whom honours for ten minutes. The owner can take the tag down inside
// that window (Tag Active off, Calls Active off, the vehicle deleted), and the
// route used to ring them anyway, because Dial Whom never looked at the tag
// again. These tests register a real route, flip the switch, and dial.
//
// Also here: a deleted tag cannot be switched back on through the owner's
// status route, which used to revive it as a scannable tag the owner could no
// longer see.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";

// register-call refuses with 503 without a virtual number; nothing dials.
process.env.EXOTEL_CALLER_ID = "08000000000";

const PLATE = "DL09QA7310";
const RIGHT = "7310";
const OWNER_MOBILE = "+919000007310";
const EMERGENCY_NUMBER = "+919000007312";

let app;
let collections;
let owner;
let cookie;
let token;
let tagId;
let counter = 0;

function nextScannerPhone() {
  counter += 1;
  return `9173${String(counter).padStart(6, "0")}`;
}

function ownerRequest(method, url, payload) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: TEST_ORIGIN },
    ...(payload === undefined ? {} : { payload })
  });
}

const setStatus = (status) => ownerRequest("POST", `/api/owner/tags/${tagId}/status`, { status });
const setCalls = (active) => ownerRequest("POST", `/api/owner/tags/${tagId}/calls`, { active });
const deleteTag = () => ownerRequest("DELETE", `/api/owner/tags/${tagId}`);

async function grantFor(address) {
  const res = await app.inject({
    method: "POST",
    url: `/api/tags/${token}/verify`,
    remoteAddress: address,
    payload: { lastFour: RIGHT }
  });
  assert.equal(res.statusCode, 200, "fixture verify should succeed");
  return res.json().grant;
}

async function register(kind, phone) {
  const address = uniqueAddress();
  const res = await app.inject({
    method: "POST",
    url: `/api/tags/${token}/${kind}`,
    remoteAddress: address,
    payload: { phone, grant: await grantFor(address) }
  });
  assert.equal(res.statusCode, 200, `fixture ${kind} should succeed: ${res.body}`);
}

function dial(callerPhone) {
  return app.inject({
    method: "GET",
    url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(callerPhone)}&CallSid=qa-tag-off-sid`
  });
}

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.tags.deleteMany({ token }).catch(() => {});
  await collections.contactRequests.deleteMany({ token }).catch(() => {});
  await collections.pendingCalls.deleteMany({ token }).catch(() => {});
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  counter += 1;
  await purgeLoginCollections(collections);
  if (token) {
    await collections.tags.deleteMany({ token });
    await collections.contactRequests.deleteMany({ token });
    await collections.pendingCalls.deleteMany({ token });
  }
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE });

  owner = await createTestOwner(collections, {
    email: "qa-tag-off-route@parktag-test.invalid",
    mobile: OWNER_MOBILE
  });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });

  token = `qatagoff${String(counter).padStart(3, "0")}${"b7c8d9e0".repeat(6)}`;
  const { insertedId } = await collections.tags.insertOne({
    ownerId: owner._id,
    token,
    plateNumber: PLATE,
    vehicleLabel: "QA Tag Off Car",
    vehicleType: "car",
    status: "active",
    premium: true,
    emergencyContact: EMERGENCY_NUMBER,
    createdAt: new Date().toISOString()
  });
  tagId = String(insertedId);
});

describe("a private call registered before the owner switched off", () => {
  test("rings the owner while nothing has changed", async () => {
    const scanner = nextScannerPhone();
    await register("register-call", scanner);
    assert.equal((await dial(scanner)).body, OWNER_MOBILE);
  });

  test("Tag Active off: busy tone", async () => {
    const scanner = nextScannerPhone();
    await register("register-call", scanner);
    assert.equal((await setStatus("inactive")).statusCode, 200);
    assert.equal((await dial(scanner)).body, "");
  });

  test("Calls Active off: busy tone", async () => {
    const scanner = nextScannerPhone();
    await register("register-call", scanner);
    assert.equal((await setCalls(false)).statusCode, 200);
    assert.equal((await dial(scanner)).body, "");
  });

  test("vehicle deleted: busy tone", async () => {
    const scanner = nextScannerPhone();
    await register("register-call", scanner);
    assert.equal((await deleteTag()).statusCode, 200);
    assert.equal((await dial(scanner)).body, "");
  });

  test("switched back on inside the window: rings again", async () => {
    const scanner = nextScannerPhone();
    await register("register-call", scanner);
    assert.equal((await setStatus("inactive")).statusCode, 200);
    assert.equal((await dial(scanner)).body, "");
    assert.equal((await setStatus("active")).statusCode, 200);
    assert.equal((await dial(scanner)).body, OWNER_MOBILE);
  });
});

describe("an emergency call registered before the owner switched off", () => {
  test("Calls Active off does not stop it: that switch is the private call only", async () => {
    const scanner = nextScannerPhone();
    await register("register-emergency-call", scanner);
    assert.equal((await setCalls(false)).statusCode, 200);
    assert.equal((await dial(scanner)).body, EMERGENCY_NUMBER);
  });

  test("Tag Active off: busy tone", async () => {
    const scanner = nextScannerPhone();
    await register("register-emergency-call", scanner);
    assert.equal((await setStatus("inactive")).statusCode, 200);
    assert.equal((await dial(scanner)).body, "");
  });

  test("vehicle deleted: busy tone", async () => {
    const scanner = nextScannerPhone();
    await register("register-emergency-call", scanner);
    assert.equal((await deleteTag()).statusCode, 200);
    assert.equal((await dial(scanner)).body, "");
  });
});

describe("the owner's status switch on a deleted tag", () => {
  test("refuses to switch it back on and leaves it off", async () => {
    assert.equal((await deleteTag()).statusCode, 200);

    const res = await setStatus("active");
    assert.equal(res.statusCode, 404);

    const stored = await collections.tags.findOne({ token });
    assert.equal(stored.status, "inactive");
    assert.ok(stored.deletedAt, "the tag should still be deleted");
  });

  test("still works on a tag that is not deleted", async () => {
    assert.equal((await setStatus("inactive")).statusCode, 200);
    const res = await setStatus("active");
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().tag.status, "active");
  });
});
