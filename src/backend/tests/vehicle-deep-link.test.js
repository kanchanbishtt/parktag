// /v/:tagId — the one short URL a WhatsApp template can carry.
//
// WHY THIS ROUTE NEEDS ITS OWN SUITE.
//
// It is linked from a message. That makes it the most exposed route in the app
// after the scan page: the URL travels through WhatsApp and e-mail, it can be
// forwarded, and it can be guessed at. Three things must hold, and only the
// first is about convenience.
//
//   1. It resolves to the owner's own vehicle.
//   2. Somebody else's tag is INDISTINGUISHABLE from a tag that does not
//      exist. If the two answered differently, this route would be an oracle
//      for testing whether an id is real.
//   3. Signed out, it parks the intent and sends them to sign in, rather than
//      404ing somebody who has just been told a stranger is at their car.
//
// The redirect targets are asserted exactly, because a redirect that lands
// somewhere plausible but wrong is the failure that looks fine in a screenshot.

import test, { describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import {
  assertDisposableDatabase,
  startTestApp,
  stopTestApp,
  createTestOwner,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";
assertDisposableDatabase();

let app;
let collections;

const MARK = `deeplink-${Date.now()}`;

async function seedTag(ownerId) {
  const { insertedId } = await collections.tags.insertOne({
    token: `${MARK}-${Math.random().toString(36).slice(2, 10)}`,
    ownerId,
    status: "active",
    vehicleLabel: "Honda City",
    plateNumber: "DL3CAB1234",
    testMarker: MARK
  });
  return insertedId;
}

// Sign in the way the app does, so the cookie under test is a real one.
//
// uniqueAddress() per call is not optional. /api/auth/login is rate limited per
// IP and those counters live in MONGO, so they outlive the process: without a
// fresh source address every run inherits the previous run's allowance and the
// third sign-in comes back 429. The failure then surfaces as a redirect
// assertion, which reads like a broken route rather than an exhausted quota.
async function ownerCookie(email, password) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: TEST_ORIGIN, "x-forwarded-for": uniqueAddress() },
    remoteAddress: uniqueAddress(),
    payload: { email, password }
  });

  assert.equal(res.statusCode, 200, `sign-in failed (${res.statusCode}), so the cookie under test is not real`);
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map((c) => String(c).split(";")[0]).join("; ");
}

before(async () => {
  // startTestApp returns { app, env, collections } -- not the app itself.
  ({ app, collections } = await startTestApp());
});

beforeEach(async () => {
  await collections.tags.deleteMany({ testMarker: MARK });
});

after(async () => {
  await collections.tags.deleteMany({ testMarker: MARK });
  await collections.owners.deleteMany({ email: { $regex: `^${MARK}` } });
  await stopTestApp(app);
});

describe("signed out", () => {
  test("parks the tag id and sends them to sign in", async () => {
    const id = new ObjectId();
    const res = await app.inject({ method: "GET", url: `/v/${id}` });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `/owner-login?next=vehicle&tag=${id}`);
  });

  test("a malformed id still reaches the login page, without carrying junk", async () => {
    // Somebody who mangles the URL should not be dropped on an error page. The
    // id is dropped instead, because it is about to be written into a query
    // string that login.js will read back.
    const res = await app.inject({ method: "GET", url: "/v/not-an-object-id" });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "/owner-login?next=vehicle");
  });
});

describe("signed in", () => {
  test("the owner's own tag resolves to the dashboard, flagged", async () => {
    const email = `${MARK}-mine@example.com`;
    const owner = await createTestOwner(collections, { email, password: "Str0ngPassw0rd!" });
    const tagId = await seedTag(owner._id);
    const cookie = await ownerCookie(email, "Str0ngPassw0rd!");

    const res = await app.inject({ method: "GET", url: `/v/${tagId}`, headers: { cookie } });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `/owner-welcome?v=${tagId}`);
  });

  test("somebody else's tag is indistinguishable from one that does not exist", async () => {
    // THE property. If these two answers ever diverge, a person who receives a
    // forwarded alert can probe which tag ids are real.
    const email = `${MARK}-other@example.com`;
    const owner = await createTestOwner(collections, { email, password: "Str0ngPassw0rd!" });
    const cookie = await ownerCookie(email, "Str0ngPassw0rd!");

    // A real tag owned by somebody else.
    const strangersTag = await seedTag(new ObjectId());
    const theirs = await app.inject({ method: "GET", url: `/v/${strangersTag}`, headers: { cookie } });

    // An id that has never existed.
    const ghost = await app.inject({ method: "GET", url: `/v/${new ObjectId()}`, headers: { cookie } });

    assert.equal(theirs.statusCode, ghost.statusCode);
    assert.equal(theirs.headers.location, ghost.headers.location);
    assert.equal(theirs.headers.location, "/owner-welcome");
    assert.ok(
      !theirs.headers.location.includes(String(strangersTag)),
      "the redirect echoes back a tag id the signed-in owner does not own"
    );
  });

  test("an unowned tag is not treated as everyone's", async () => {
    // A tag with no ownerId at all (printed, never activated). A truthiness
    // check that read `undefined === undefined` as a match would hand every
    // unactivated tag to the first person who guessed its id.
    const email = `${MARK}-unowned@example.com`;
    const owner = await createTestOwner(collections, { email, password: "Str0ngPassw0rd!" });
    const cookie = await ownerCookie(email, "Str0ngPassw0rd!");

    const { insertedId } = await collections.tags.insertOne({
      token: `${MARK}-unowned`,
      status: "unclaimed",
      testMarker: MARK
    });

    const res = await app.inject({ method: "GET", url: `/v/${insertedId}`, headers: { cookie } });
    assert.equal(res.headers.location, "/owner-welcome");
  });
});
