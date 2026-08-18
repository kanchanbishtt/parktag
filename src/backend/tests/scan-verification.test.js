// Tests for the plate-verification attempt ceilings on the contact-the-owner
// page (POST /api/tags/:token/verify).
//
// The last-4 check is the only gate in front of a masked call, the owner's SOS
// contact, and the plate itself, so both of its ceilings — three tries per
// scanner, thirty per tag per hour across every address — are load-bearing.
// They used to be counted by reading a document, incrementing in JS and writing
// the result back, which meant concurrent requests all read the same value and
// all wrote back the same value + 1: eight simultaneous wrong answers moved the
// per-tag counter by three.
//
// Everything here is therefore written against PARALLEL requests. A sequential
// version of these assertions passed before the fix as well, which is exactly
// why the gap survived.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import { hashIp } from "../lib/auth/security.js";

// Mirrors the constants in routes/public/index.js. Recomputed rather than
// imported (they are module-private) so that raising a ceiling without
// revisiting these expectations fails here loudly.
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_TAG_ATTEMPTS_PER_WINDOW = 30;

const PLATE = "DL01QA4821";
const RIGHT = "4821";
const WRONG = "0000";

let app;
let collections;

// Each test gets its own tag, so one test's counters can never be another
// test's starting state.
let tagCounter = 0;
const tokens = [];

async function createTag() {
  tagCounter += 1;
  const token = `qaverify${String(tagCounter).padStart(3, "0")}${"c3d4e5f6".repeat(6)}`;
  await collections.tags.insertOne({
    token,
    status: "active",
    plateNumber: PLATE,
    vehicleLabel: "QA Fixture Car",
    vehicleType: "car",
    createdAt: new Date().toISOString()
  });
  tokens.push(token);
  return token;
}

// The bucket ids are recomputed here for the same reason clearLoginLock
// recomputes the login-lockout key: a change to the scheme should break these
// assertions rather than quietly leave them inspecting nothing.
function ipBucketId(address, token) {
  return `ip:${hashIp(address, token)}`;
}

function tagBucketId(token) {
  return `tag:${token}`;
}

function verify(token, lastFour, address) {
  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/verify`,
    remoteAddress: address,
    payload: { lastFour }
  });
}

function statuses(responses) {
  return responses.map((r) => r.statusCode).sort((a, b) => a - b);
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await collections.rateLimits.deleteMany({}).catch(() => {});
});

after(async () => {
  for (const token of tokens) {
    await collections.tags.deleteMany({ token });
    await collections.verificationSessions.deleteMany({ token });
  }
  await collections.rateLimits.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

describe("per-scanner ceiling", () => {
  test("three wrong answers are compared, the fourth is refused", async () => {
    const token = await createTag();
    const address = uniqueAddress();

    const first = await verify(token, WRONG, address);
    assert.equal(first.statusCode, 401);
    assert.equal(first.json().attemptsRemaining, 2);

    const second = await verify(token, WRONG, address);
    assert.equal(second.statusCode, 401);
    assert.equal(second.json().attemptsRemaining, 1);

    // The third guess is still compared — three attempts has always meant three
    // real chances — but a wrong one closes the bucket behind it.
    const third = await verify(token, WRONG, address);
    assert.equal(third.statusCode, 423);
    assert.equal(third.json().locked, true);

    const fourth = await verify(token, WRONG, address);
    assert.equal(fourth.statusCode, 423);
  });

  test("a parallel burst cannot buy more comparisons than the allowance", async () => {
    const token = await createTag();
    const address = uniqueAddress();

    // Eight at once, from one address. Before the fix five of these came back
    // 401 — five guesses compared against a three-guess allowance.
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => verify(token, WRONG, address))
    );

    const compared = responses.filter((r) => r.statusCode === 401).length;
    const refused = responses.filter((r) => r.statusCode === 423).length;

    assert.equal(compared, MAX_VERIFY_ATTEMPTS - 1);
    assert.equal(refused, 8 - (MAX_VERIFY_ATTEMPTS - 1));
    assert.deepEqual(statuses(responses).slice(0, 2), [401, 401]);

    // One bucket, not one per racing request: a second document would be a
    // second full allowance, which is what a non-unique key permits.
    const docs = await collections.verificationSessions.countDocuments({
      _id: ipBucketId(address, token)
    });
    assert.equal(docs, 1);
  });

  test("malformed digits are rejected without spending an attempt", async () => {
    const token = await createTag();
    const address = uniqueAddress();

    const short = await verify(token, "12", address);
    assert.equal(short.statusCode, 400);

    const letters = await verify(token, "abcd", address);
    assert.equal(letters.statusCode, 400);

    // Nothing was reserved, so the bucket does not exist yet.
    const doc = await collections.verificationSessions.findOne({
      _id: ipBucketId(address, token)
    });
    assert.equal(doc, null);

    // ...and the full allowance is still there afterwards.
    assert.equal((await verify(token, WRONG, address)).json().attemptsRemaining, 2);
  });
});

describe("per-tag ceiling", () => {
  test("every parallel attempt is counted, whatever address it came from", async () => {
    const token = await createTag();

    // Eight distinct addresses, so no per-scanner lockout can absorb any of
    // them: the per-tag bucket is the only thing counting. It recorded three
    // before the fix.
    await Promise.all(
      Array.from({ length: 8 }, () => verify(token, WRONG, uniqueAddress()))
    );

    const bucket = await collections.verificationSessions.findOne({
      _id: tagBucketId(token)
    });

    assert.equal(bucket.attempts, 8);
    assert.equal(bucket.lockedUntil, null);

    const docs = await collections.verificationSessions.countDocuments({
      _id: tagBucketId(token)
    });
    assert.equal(docs, 1);
  });

  test("the ceiling locks the tag across every address", async () => {
    const token = await createTag();

    // One request per address, all at once — the shape an attacker rotating
    // source addresses produces, and the one the per-tag bucket exists for.
    await Promise.all(
      Array.from({ length: MAX_TAG_ATTEMPTS_PER_WINDOW }, () =>
        verify(token, WRONG, uniqueAddress())
      )
    );

    const bucket = await collections.verificationSessions.findOne({
      _id: tagBucketId(token)
    });
    assert.ok(bucket.lockedUntil, "per-tag bucket should be locked");
    assert.ok(new Date(bucket.lockedUntil) > new Date());

    // A scanner arriving from an address that has never been seen is still
    // refused, and the correct answer is refused too: the tag is shut, not the
    // address.
    const stranger = await verify(token, WRONG, uniqueAddress());
    assert.equal(stranger.statusCode, 423);

    const withRightAnswer = await verify(token, RIGHT, uniqueAddress());
    assert.equal(withRightAnswer.statusCode, 423);
  });
});

describe("successful verification", () => {
  test("issues a grant and returns both counters to zero", async () => {
    const token = await createTag();
    const address = uniqueAddress();

    assert.equal((await verify(token, WRONG, address)).statusCode, 401);
    assert.equal((await verify(token, WRONG, address)).statusCode, 401);

    const ok = await verify(token, RIGHT, address);
    assert.equal(ok.statusCode, 200);

    const body = ok.json();
    assert.equal(body.ok, true);
    assert.match(body.grant, /^[0-9a-f]{64}$/);
    assert.equal(body.maskedPlateNumber, "DL01QA####");

    const session = await collections.verificationSessions.findOne({
      _id: ipBucketId(address, token)
    });
    assert.equal(session.attempts, 0);
    assert.equal(session.verified, true);
    assert.equal(session.grantId, body.grant);
    assert.deepEqual(session.grantPhones, []);

    // The correct answer reserved a per-tag slot on its way through; it must not
    // leave that slot spent against the next scanner of the same vehicle.
    const bucket = await collections.verificationSessions.findOne({
      _id: tagBucketId(token)
    });
    assert.equal(bucket.attempts, 0);
    assert.equal(bucket.lockedUntil, null);
  });

  test("the grant is accepted by the contact endpoint", async () => {
    const token = await createTag();
    const address = uniqueAddress();

    const { grant } = (await verify(token, RIGHT, address)).json();

    // Not a contact attempt: this asks whether the grant resolves at all. An
    // unowned fixture tag stops at "Tag has no owner", which is past the
    // 403 that a rejected grant would produce.
    const contact = await app.inject({
      method: "POST",
      url: "/api/contact-requests",
      remoteAddress: address,
      payload: { token, grant, action: "message", messageChannel: "whatsapp" }
    });

    assert.notEqual(contact.statusCode, 403);
  });
});

describe("lockout expiry", () => {
  // The count is no longer zeroed at the moment a bucket is locked, because
  // doing that hands a fresh allowance to requests already in flight. That puts
  // the burden here instead: if a lapsed lock did not also clear the count, the
  // next attempt would overshoot the ceiling, re-lock immediately, and the
  // bucket would stay shut forever.
  test("a scanner bucket reopens with a full allowance", async () => {
    const token = await createTag();
    const address = uniqueAddress();

    await verify(token, WRONG, address);
    await verify(token, WRONG, address);
    assert.equal((await verify(token, WRONG, address)).statusCode, 423);

    const locked = await collections.verificationSessions.findOne({
      _id: ipBucketId(address, token)
    });
    assert.equal(locked.attempts, MAX_VERIFY_ATTEMPTS);

    // Fast-forward past the lockout rather than waiting fifteen minutes for it.
    await collections.verificationSessions.updateOne(
      { _id: ipBucketId(address, token) },
      { $set: { lockedUntil: new Date(Date.now() - 1000).toISOString() } }
    );

    const reopened = await verify(token, WRONG, address);
    assert.equal(reopened.statusCode, 401);
    assert.equal(reopened.json().attemptsRemaining, MAX_VERIFY_ATTEMPTS - 1);
  });

  test("a tag bucket reopens with a full allowance", async () => {
    const token = await createTag();

    // Straight to the state a lapsed per-tag lockout leaves behind: at the
    // ceiling, with the lock just run out.
    await collections.verificationSessions.insertOne({
      _id: tagBucketId(token),
      token,
      ipHash: "*",
      attempts: MAX_TAG_ATTEMPTS_PER_WINDOW,
      windowStart: new Date().toISOString(),
      lockedUntil: new Date(Date.now() - 1000).toISOString(),
      verified: false,
      grantId: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    const reopened = await verify(token, WRONG, uniqueAddress());
    assert.equal(reopened.statusCode, 401);

    const bucket = await collections.verificationSessions.findOne({
      _id: tagBucketId(token)
    });
    assert.equal(bucket.attempts, 1);
    assert.equal(bucket.lockedUntil, null);
  });
});
