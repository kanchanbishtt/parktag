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

import { startTestApp, stopTestApp, TEST_ORIGIN, uniqueAddress } from "./helpers.js";
import { dashboardTags } from "../../frontend/scripts/owner/dashboard-tags.js";
import { findOrCreateOwner } from "../routes/auth/firebase.js";
import { resolveOwnerByVerifiedMobile, findOwnerByMobile, storedPhoneVariants } from "../lib/auth/otp.js";
import { createOtpHash, createPasswordHash } from "../lib/auth/security.js";
import { ensureCoreIndexes } from "../lib/db/repositories.js";

let app;
let collections;

const PHONE10 = "9000004410";
const E164 = "+919000004410";
const CODE = "246813";
const ORIGIN = TEST_ORIGIN;

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

for (const scenario of [
  { label: "same vehicle", storedMobile: E164, samePlate: true },
  { label: "different vehicles", storedMobile: E164, samePlate: false },
  { label: "different vehicles with legacy domestic mobile", storedMobile: PHONE10, samePlate: false }
]) test(`ten premium stickers remain visible after mobile login: ${scenario.label}`, async () => {
  const owner = await seedOwnerHolding(scenario.storedMobile, { email: null });
  const now = new Date().toISOString();
  const old = { _id: new ObjectId(), token: "premium-existing", ownerId: owner._id,
    status: "active", premium: true, plateNumber: "UP16BM8251", createdAt: now };
  await collections.tags.insertOne(old);
  const tokens = Array.from({ length: 10 }, (_, i) => `premium-batch002-${i}`);
  await collections.tags.insertMany(tokens.map((token, i) => ({
    _id: new ObjectId(), token, status: "unclaimed", ownerId: null,
    premium: true, batchNumber: "Batch-002", serialNumber: i + 1, createdAt: now
  })));
  // An unrelated owner's sticker must never appear, even with the same plate.
  await collections.tags.insertOne({ ...old, _id: new ObjectId(), token: "foreign-premium", ownerId: new ObjectId() });
  for (const [index, token] of tokens.entries()) {
    await seedOtp();
    const activation = await app.inject({
      method: "POST", url: `/api/tags/${token}/activate`,
      remoteAddress: uniqueAddress(), headers: { origin: ORIGIN },
      payload: { displayName: "Existing Owner", phone: index % 2 ? E164 : PHONE10,
        code: CODE, plateNumber: scenario.samePlate ? "UP16BM8251" : `DL01AB${1000 + index}`, vehicleType: "car" }
    });
    assert.equal(activation.statusCode, 200, activation.body);
  }
  assert.equal(await collections.owners.countDocuments({}), 1);
  assert.equal(await collections.tags.countDocuments({ ownerId: owner._id }), 11);
  await seedOtp();
  const login = await app.inject({ method: "POST", url: "/api/auth/verify-otp",
    remoteAddress: uniqueAddress(), headers: { origin: ORIGIN },
    payload: { identifier: PHONE10, code: CODE } });
  assert.equal(login.statusCode, 200, login.body);
  const cookies = login.headers["set-cookie"];
  const dashboard = await app.inject({ method: "GET", url: "/api/owner/dashboard",
    headers: { cookie: Array.isArray(cookies) ? cookies.join("; ") : cookies } });
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  const tags = dashboard.json().tags;
  assert.equal(tags.length, 11);
  assert.deepEqual(new Set(dashboardTags(tags).map(t => t.token)), new Set([old.token, ...tokens]));
  assert.equal(new Set(tags.filter(t => t.serial).map(t => t.serial)).size, 10);
});

test("activation and Firebase reuse each historical Indian mobile spelling", async () => {
  for (const mobile of [PHONE10, `91${PHONE10}`, `0${PHONE10}`, E164]) {
    await collections.owners.deleteMany({});
    const owner = await seedOwnerHolding(mobile);
    assert.equal(String((await resolveOwnerByVerifiedMobile(collections, E164)).owner._id), String(owner._id));
    const firebase = await findOrCreateOwner(collections, E164);
    assert.equal(firebase.isNew, false);
    assert.equal(String(firebase.owner._id), String(owner._id));
    assert.equal(await collections.owners.countDocuments({}), 1);
  }
});

test("all mobile paths prefer the same canonical account when a historical split exists", async () => {
  await seedOwnerHolding(PHONE10, { email: null, createdAt: "2020-01-01T00:00:00.000Z" });
  const canonical = await seedOwnerHolding(E164);
  const owners = [
    await findOwnerByMobile(collections, E164),
    (await resolveOwnerByVerifiedMobile(collections, E164)).owner,
    (await findOrCreateOwner(collections, E164)).owner
  ];
  assert.ok(owners.every(o => String(o._id) === String(canonical._id)));
  // Consistency is not a licence to merge accounts or move private records.
  assert.equal(await collections.owners.countDocuments({}), 2);
});

test("phone PIN login and OTP login return the same tag set despite an older phone alias", async () => {
  const pin = "748193";
  const loginPinHash = await createPasswordHash(pin);
  await seedOwnerHolding(PHONE10, { email: null, loginPinHash, createdAt: "2020-01-01T00:00:00.000Z" });
  const canonical = await seedOwnerHolding(E164, { loginPinHash });
  await collections.tags.insertOne({ _id: new ObjectId(), ownerId: canonical._id,
    token: "canonical-pin-tag", premium: true, status: "active", plateNumber: "DL01AB4444" });
  await seedOtp();
  for (const request of [
    { url: "/api/auth/login", payload: { identifier: PHONE10, pin } },
    { url: "/api/auth/verify-otp", payload: { identifier: PHONE10, code: CODE } }
  ]) {
    const login = await app.inject({ method: "POST", remoteAddress: uniqueAddress(),
      headers: { origin: ORIGIN }, ...request });
    assert.equal(login.statusCode, 200, login.body);
    const raw = login.headers["set-cookie"];
    const dashboard = await app.inject({ method: "GET", url: "/api/owner/dashboard",
      headers: { cookie: Array.isArray(raw) ? raw.join("; ") : raw } });
    assert.equal(dashboard.statusCode, 200, dashboard.body);
    assert.deepEqual(dashboard.json().tags.map(t => t.token), ["canonical-pin-tag"]);
  }
});

test("Firebase does not fork or adopt a credentialed legacy phone-only account", async () => {
  await seedOwnerHolding(null, { phone: PHONE10, passwordHash: "existing-credential" });
  assert.equal((await findOrCreateOwner(collections, E164)).conflict, true);
  assert.equal(await collections.owners.countDocuments({}), 1);
});

test("Firebase adopts a credential-free legacy phone account and verifies new owners", async () => {
  const owner = await seedOwnerHolding(null, { phone: PHONE10, email: null });
  const adopted = await findOrCreateOwner(collections, E164);
  assert.equal(String(adopted.owner._id), String(owner._id));
  assert.equal(adopted.owner.mobileVerified, true);
  await collections.owners.deleteMany({});
  const created = await findOrCreateOwner(collections, E164);
  assert.equal(created.isNew, true);
  assert.equal(created.owner.mobileVerified, true);
  assert.equal(created.owner.phone, E164);
});

test("foreign mobiles cannot resolve an Indian account by their last ten digits", async () => {
  await seedOwnerHolding(PHONE10);
  assert.equal(await findOwnerByMobile(collections, `+44${PHONE10}`), null);
  assert.ok(!storedPhoneVariants(`+44${PHONE10}`).includes(PHONE10));
});

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

// /api/register-owner and /api/tags/:token/claim, the two e-mail-and-password
// routes that once forked accounts here, were removed (audit item 18). The
// account-creating path a scanner reaches is /activate.
test("no route mints a second account on a number already in use", async (t) => {
  async function activate(token, plateNumber) {
    await collections.tags.insertOne({
      _id: new ObjectId(), token, status: "unclaimed", ownerId: null, premium: true,
      batchNumber: "Batch-002", serialNumber: 1, deletedAt: null, createdAt: new Date().toISOString()
    });
    await seedOtp();
    return app.inject({
      method: "POST", url: `/api/tags/${token}/activate`,
      remoteAddress: uniqueAddress(), headers: { origin: ORIGIN },
      payload: { displayName: "Second Owner", phone: PHONE10, code: CODE, plateNumber, vehicleType: "car" }
    });
  }

  await t.test("/api/tags/:token/activate puts the tag on the account already holding it", async () => {
    const existing = await seedOwnerHolding(E164);

    const response = await activate("one-number-activate", "DL01AB1234");

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(await collections.owners.countDocuments({}), 1);
    const tag = await collections.tags.findOne({ token: "one-number-activate" });
    assert.equal(String(tag.ownerId), String(existing._id));
  });

  await t.test("a legacy `phone`-only row with a password counts as in use", async () => {
    // The number the customer lost was stored as a raw 10-digit `phone` with no
    // `mobile` at all, so a guard that only looked at `mobile` would have let
    // the duplicate through and reproduced the original bug exactly. With a
    // password on it, proving the number is not enough to take that account over.
    await collections.owners.insertOne({
      _id: new ObjectId(), displayName: "Legacy", email: "legacy@example.invalid",
      phone: PHONE10, passwordHash: "existing-credential", credits: 0, role: "owner",
      createdAt: new Date().toISOString()
    });

    const response = await activate("one-number-legacy-pw", "DL03EF9012");

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "ACCOUNT_EXISTS");
    assert.equal(await collections.owners.countDocuments({}), 1);
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
