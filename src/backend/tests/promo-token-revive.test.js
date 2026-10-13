// A token cannot bring a big promo code back to life.
//
// Tokens (hand-minted or OAuth, e.g. Claude through the admin MCP) are held to
// lib/auth/token-limits.js when they create or edit a code: at most 50% or
// Rs 500 off, a use limit, an expiry, never a website offer. Two doors around
// that: the activate route skipped the check, so a code an admin had made big
// and revoked could be switched back on; and an edit was judged field by
// field, so a used-up, expired 100%-off code came back for 1000 uses until 2030
// through maxUses: 1000 and a later expiresAt, each fine on its own. A
// signed-in admin is still not limited.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "promo-activate-limits@parktag.test";
const PASSWORD = "test-password-123";
const STAMP = Date.now().toString(36).toUpperCase().slice(-6);
const BIG = `PABIG${STAMP}`;
const SMALL = `PASML${STAMP}`;
const FUTURE = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

let app;
let collections;
let adminCookie;
let token;

const asAdmin = (method, url, payload) =>
  app.inject({ method, url, payload, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN, cookie: adminCookie } });
const withToken = (method, url, payload) =>
  app.inject({ method, url, payload, remoteAddress: uniqueAddress(), headers: { authorization: `Bearer ${token}` } });
const isActive = async (code) => (await collections.promoCodes.findOne({ code })).active;

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.admins.insertOne({
    email: ADMIN_EMAIL, role: "admin", passwordHash: await createPasswordHash(PASSWORD), createdAt: new Date().toISOString()
  });
  const login = await app.inject({
    method: "POST", url: "/api/auth/admin/login", remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN }, payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200, "admin fixture must be able to sign in");
  adminCookie = login.headers["set-cookie"];
  const minted = await asAdmin("POST", "/api/admin/api-tokens", { name: "promo activate", scope: "write", days: 1 });
  assert.equal(minted.statusCode, 200, minted.body);
  token = minted.json().data.token;
});

beforeEach(async () => {
  await collections.promoCodes.deleteMany({ code: { $in: [BIG, SMALL] } });
});

after(async () => {
  await collections.promoCodes.deleteMany({ code: { $in: [BIG, SMALL] } });
  await collections.adminApiTokens.deleteMany({ adminEmail: ADMIN_EMAIL });
  await collections.mcpCalls.deleteMany({ email: ADMIN_EMAIL });
  await collections.adminAudit.deleteMany({ email: ADMIN_EMAIL });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

// What an admin may make in the panel and a token may not: 100% off, no use
// limit, no expiry, on the whole website. Made, then revoked.
async function revokedBigCode() {
  const made = await asAdmin("POST", "/api/admin/promo-codes", { code: BIG, discountMode: "percent", discountPercent: 100, autoApply: true });
  assert.equal(made.statusCode, 200, made.body);
  assert.equal((await asAdmin("POST", `/api/admin/promo-codes/${BIG}/revoke`)).statusCode, 200);
}

test("a token cannot switch on a revoked code that is beyond its limits", async () => {
  await revokedBigCode();
  const res = await withToken("POST", `/api/admin/promo-codes/${BIG}/activate`);
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error, /A token cannot switch .* on\. .*admin panel/);
  assert.equal(await isActive(BIG), false, "the code went back on sale");
});

test("each limit is judged on its own", async () => {
  const cases = [
    { discountMode: "percent", discountPercent: 60, maxUses: 10, expiresAt: FUTURE() },
    { discountMode: "flat", discountPaise: 60_000, maxUses: 10, expiresAt: FUTURE() },
    { discountMode: "flat", discountPaise: 5_000, expiresAt: FUTURE() },
    { discountMode: "flat", discountPaise: 5_000, maxUses: 10 },
    { discountMode: "flat", discountPaise: 5_000, maxUses: 10, expiresAt: FUTURE(), autoApply: true }
  ];
  for (const fields of cases) {
    await collections.promoCodes.deleteMany({ code: BIG });
    assert.equal((await asAdmin("POST", "/api/admin/promo-codes", { code: BIG, ...fields })).statusCode, 200);
    await asAdmin("POST", `/api/admin/promo-codes/${BIG}/revoke`);
    assert.equal((await withToken("POST", `/api/admin/promo-codes/${BIG}/activate`)).statusCode, 400, JSON.stringify(fields));
    assert.equal(await isActive(BIG), false, JSON.stringify(fields));
  }
});

test("a token can still switch on a code within its limits, such as one it made", async () => {
  const made = await withToken("POST", "/api/admin/promo-codes", {
    code: SMALL, discountMode: "flat", discountPaise: 10_000, maxUses: 25, expiresAt: FUTURE()
  });
  assert.equal(made.statusCode, 200, made.body);
  assert.equal((await withToken("POST", `/api/admin/promo-codes/${SMALL}/revoke`)).statusCode, 200);
  assert.equal((await withToken("POST", `/api/admin/promo-codes/${SMALL}/activate`)).statusCode, 200);
  assert.equal(await isActive(SMALL), true);
});

test("a signed-in admin is not limited, and an unknown code is still 404", async () => {
  await revokedBigCode();
  assert.equal((await asAdmin("POST", `/api/admin/promo-codes/${BIG}/activate`)).statusCode, 200);
  assert.equal(await isActive(BIG), true);
  assert.equal((await withToken("POST", "/api/admin/promo-codes/NOSUCHCODE1/activate")).statusCode, 404);
});

test("the MCP tool gets the refusal, and the code stays off", async () => {
  await revokedBigCode();
  const res = await app.inject({
    method: "POST", url: "/mcp", remoteAddress: uniqueAddress(),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "parktag_set_promo_active", arguments: { code: BIG, active: true } } }
  });
  const result = res.json().result;
  assert.equal(result.isError, true, result.content[0].text);
  assert.match(result.content[0].text, /cannot switch/);
  assert.equal(await isActive(BIG), false);
});

// ── Editing ──────────────────────────────────────────────────────────────────

// An admin's 100%-off code: one use, expired, tied to one phone and one pack,
// starting on a date, for in-person sales only.
async function bigCode(extra = {}) {
  const made = await asAdmin("POST", "/api/admin/promo-codes", {
    code: BIG, discountMode: "percent", discountPercent: 100, maxUses: 1,
    startsAt: "2019-06-01T00:00:00.000Z", expiresAt: "2020-01-01T00:00:00.000Z",
    boundPhone: "+919812345678", productIds: ["pt-car-2"], fulfilment: "handover", ...extra
  });
  assert.equal(made.statusCode, 200, made.body);
}
const edit = (body) => withToken("PATCH", `/api/admin/promo-codes/${BIG}`, body);

test("an edit cannot revive a used-up, expired big code field by field", async () => {
  await bigCode();
  const before = await collections.promoCodes.findOne({ code: BIG });
  const res = await edit({ maxUses: 1000, expiresAt: "2030-01-01T00:00:00.000Z" });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error, /cannot widen the number of uses/);
  const after = await collections.promoCodes.findOne({ code: BIG });
  assert.deepEqual([after.maxUses, after.expiresAt], [before.maxUses, before.expiresAt], "the code changed");
});

test("each way of widening a big code is refused", async () => {
  const widen = [
    [{ maxUses: 5 }, /number of uses/],
    [{ expiresAt: "2030-01-01T00:00:00.000Z" }, /expiry/],
    [{ startsAt: "2019-01-01T00:00:00.000Z" }, /start date/],
    [{ boundPhone: null }, /mobile number/],
    [{ boundPhone: "+919800000000" }, /mobile number/],
    [{ productIds: [] }, /packs/],
    [{ productIds: ["pt-car-2", "pt-car-4"] }, /packs/],
    [{ fulfilment: "ship" }, /where it can be used/]
  ];
  for (const [body, why] of widen) {
    await collections.promoCodes.deleteMany({ code: BIG });
    await bigCode();
    const res = await edit(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.match(res.json().error, why, JSON.stringify(body));
  }
  // Single-use caps a code at one use whatever maxUses says; switching it off is widening too.
  await collections.promoCodes.deleteMany({ code: BIG });
  await bigCode({ singleUse: true, maxUses: 1000 });
  assert.match((await edit({ singleUse: false })).json().error, /number of uses/);
});

test("narrowing a big code, or adjusting its shipping, still works", async () => {
  await bigCode({ maxUses: null, expiresAt: null, startsAt: null });
  for (const body of [
    { shippingFeePaise: 0 },
    { maxUses: 10 },
    { expiresAt: "2030-01-01T00:00:00.000Z" },
    { expiresAt: "2029-01-01T00:00:00.000Z" },
    { productIds: ["pt-car-2"] },
    { startsAt: "2026-01-01T00:00:00.000Z" }
  ]) {
    const res = await edit(body);
    assert.equal(res.statusCode, 200, `${JSON.stringify(body)}: ${res.body}`);
  }
});

test("an edit that brings a code within the limits as a whole is a code the token could make, so it goes through", async () => {
  await bigCode({ boundPhone: null, productIds: [], fulfilment: "ship" });
  const res = await edit({ discountPercent: 50, maxUses: 1000, expiresAt: "2030-01-01T00:00:00.000Z" });
  assert.equal(res.statusCode, 200, res.body);
});

test("a token's own code within the limits can be widened within them, and the admin is never limited", async () => {
  assert.equal((await withToken("POST", "/api/admin/promo-codes", {
    code: SMALL, discountMode: "flat", discountPaise: 10_000, maxUses: 25, expiresAt: FUTURE()
  })).statusCode, 200);
  assert.equal((await withToken("PATCH", `/api/admin/promo-codes/${SMALL}`, { maxUses: 500 })).statusCode, 200);

  await bigCode();
  assert.equal((await asAdmin("PATCH", `/api/admin/promo-codes/${BIG}`, { maxUses: null, expiresAt: null })).statusCode, 200);
});
