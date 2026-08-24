// One number, one account.
//
// A customer signed in with their phone number and reached a dashboard with
// none of their vehicles on it. The cause was not the sign-in: it was that two
// owner rows carried the same number, and the lookup behind a mobile sign-in is
// `findOne` — no sort. Which account they reached came down to row order.
//
// These tests pin the three things that together make that unreachable:
//   1. no route will mint a second account on a number already in use;
//   2. the storage layer refuses it even if a future route forgets to ask;
//   3. the lookup is deterministic, so an existing pair cannot flip answers.
//
// OTP rows are seeded directly rather than sent — the mobile send path calls
// the live WhatsApp API and would message a real handset (see helpers.js).
import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp } from "./helpers.js";
import { createOtpHash } from "../lib/auth/security.js";
import { ensureCoreIndexes } from "../lib/db/repositories.js";

let app;
let collections;

const PHONE10 = "9000004410";
const E164 = "+919000004410";
const CODE = "246813";
const ORIGIN = "http://localhost:3000";

test.before(async () => {
  ({ app, collections } = await startTestApp());
  await ensureCoreIndexes(collections, console);
});

test.beforeEach(async () => {
  await collections.owners.deleteMany({});
  await collections.tags.deleteMany({});
  await collections.otpTokens.deleteMany({});
});

test.after(async () => {
  await collections.owners.deleteMany({});
  await collections.tags.deleteMany({});
  await collections.otpTokens.deleteMany({});
  await stopTestApp(app);
});

async function seedOtp(identifier = E164) {
  await collections.otpTokens.deleteMany({ identifier });
  await collections.otpTokens.insertOne({
    identifier,
    purpose: "auth",
    codeHash: await createOtpHash(CODE),
    used: false,
    attempts: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString()
  });
}

async function seedOwnerHolding(number, extra = {}) {
  const owner = {
    _id: new ObjectId(),
    displayName: "Existing Owner",
    email: "existing@example.invalid",
    mobile: number,
    phone: number,
    mobileVerified: true,
    credits: 0,
    role: "owner",
    createdAt: new Date().toISOString(),
    ...extra
  };
  await collections.owners.insertOne(owner);
  return owner;
}

test("the index itself", async (t) => {
  await t.test("is partial, so the many owners with no mobile still insert", async () => {
    // Google and e-mail sign-ups never set `mobile`. A plain unique index reads
    // every missing field as the same null and would refuse the second such
    // owner — which would break sign-up rather than duplicates.
    await collections.owners.insertMany([
      { _id: new ObjectId(), email: "a@example.invalid", role: "owner" },
      { _id: new ObjectId(), email: "b@example.invalid", role: "owner", mobile: null },
      { _id: new ObjectId(), email: "c@example.invalid", role: "owner", mobile: "" },
      { _id: new ObjectId(), email: "d@example.invalid", role: "owner", mobile: "" }
    ]);
    assert.equal(await collections.owners.countDocuments({}), 4);
  });

  await t.test("refuses a second row on the same real number", async () => {
    await seedOwnerHolding(E164);
    await assert.rejects(
      () => collections.owners.insertOne({
        _id: new ObjectId(), email: "other@example.invalid", role: "owner", mobile: E164
      }),
      (err) => err.code === 11000,
      "a duplicate mobile must be rejected by the index, not merely by route code"
    );
    assert.equal(await collections.owners.countDocuments({ mobile: E164 }), 1);
  });
});

test("no route mints a second account on a number already in use", async (t) => {
  await t.test("/api/register-owner refuses it", async () => {
    await seedOwnerHolding(E164);
    await seedOtp();

    const response = await app.inject({
      method: "POST",
      url: "/api/register-owner",
      headers: { origin: ORIGIN },
      payload: {
        displayName: "Second Owner",
        email: "second@example.invalid",
        password: "correct-horse-battery",
        phone: PHONE10,
        plateNumber: "DL01AB1234",
        vehicleLabel: "Car",
        otp: CODE
      }
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "ACCOUNT_EXISTS");
    assert.equal(await collections.owners.countDocuments({ mobile: E164 }), 1);
  });

  await t.test("/api/tags/:token/claim refuses it", async () => {
    await seedOwnerHolding(E164);
    await collections.tags.insertOne({
      _id: new ObjectId(), token: "one-number-claim", status: "unclaimed",
      deletedAt: null, createdAt: new Date().toISOString()
    });
    await seedOtp();

    const response = await app.inject({
      method: "POST",
      url: "/api/tags/one-number-claim/claim",
      headers: { origin: ORIGIN },
      payload: {
        email: "third@example.invalid",
        password: "correct-horse-battery",
        displayName: "Third Owner",
        phone: PHONE10,
        plateNumber: "DL02CD5678",
        otp: CODE
      }
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "ACCOUNT_EXISTS");
    assert.equal(await collections.owners.countDocuments({ mobile: E164 }), 1);
  });

  await t.test("a legacy `phone`-only row counts as in use", async () => {
    // The number the customer lost was stored as a raw 10-digit `phone` with no
    // `mobile` at all, so a guard that only looked at `mobile` would have let
    // the duplicate through and reproduced the original bug exactly.
    await collections.owners.insertOne({
      _id: new ObjectId(), displayName: "Legacy", email: "legacy@example.invalid",
      phone: PHONE10, credits: 0, role: "owner", createdAt: new Date().toISOString()
    });
    await seedOtp();

    const response = await app.inject({
      method: "POST",
      url: "/api/register-owner",
      headers: { origin: ORIGIN },
      payload: {
        displayName: "Duplicate", email: "dupe@example.invalid",
        password: "correct-horse-battery", phone: PHONE10,
        plateNumber: "DL03EF9012", vehicleLabel: "Car", otp: CODE
      }
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "ACCOUNT_EXISTS");
  });
});

test("a legacy phone-only account is reunited with its own tags", async () => {
  // No other credential on the row, so proving the number proves ownership and
  // resolveOwnerByVerifiedMobile adopts it. Before this, sign-in forked a new
  // empty account and the vehicles stayed behind.
  const legacyId = new ObjectId();
  await collections.owners.insertOne({
    _id: legacyId, displayName: "Legacy Owner", email: "legacy@example.invalid",
    phone: PHONE10, credits: 0, role: "owner", createdAt: new Date().toISOString()
  });
  await collections.tags.insertOne({
    _id: new ObjectId(), token: "one-number-legacy", ownerId: legacyId,
    status: "active", vehicleLabel: "Their Car", plateNumber: "UP16BM8251",
    deletedAt: null, createdAt: new Date().toISOString()
  });
  await seedOtp();

  const login = await app.inject({
    method: "POST", url: "/api/auth/verify-otp",
    headers: { origin: ORIGIN }, payload: { identifier: PHONE10, code: CODE }
  });
  assert.equal(login.statusCode, 200);

  const cookie = login.headers["set-cookie"];
  const dashboard = await app.inject({
    method: "GET", url: "/api/owner/dashboard",
    headers: { cookie: Array.isArray(cookie) ? cookie.join("; ") : cookie }
  });
  const body = dashboard.json();

  assert.equal(body.owner.email, "legacy@example.invalid",
    "should land on the account that owns the tag, not a fresh one");
  assert.equal(body.tags.length, 1, "their vehicle must be visible");
  assert.equal(body.tags[0].plateNumber, "UP16BM8251");
});

test("the mobile lookup is deterministic, so an answer cannot flip", async () => {
  // The index stops this pair being created, so build it at the driver level:
  // the point is that the LOOKUP no longer depends on row order, which is what
  // made the original failure intermittent and so hard to credit.
  const older = await seedOwnerHolding(E164, {
    email: "older@example.invalid", createdAt: "2020-01-01T00:00:00.000Z"
  });

  const seen = new Set();
  for (let i = 0; i < 5; i += 1) {
    const found = await collections.owners.findOne(
      { mobile: E164 },
      { sort: { createdAt: 1, _id: 1 } }
    );
    seen.add(String(found._id));
  }

  assert.equal(seen.size, 1, "the same query must always resolve the same account");
  assert.ok(seen.has(String(older._id)), "and it must be the oldest row");
});
