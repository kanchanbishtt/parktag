// Admin API tokens over the real routes: created by a signed-in admin, honoured on the allowlisted admin routes
// only, scoped, revocable, and audited.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "api-tokens-admin@parktag.test";
const PASSWORD = "test-password-123";
const PROMO = `TKN${Date.now().toString(36).toUpperCase()}`.slice(0, 16);

let app;
let collections;
let adminCookie;

// A signed-in admin, the way the panel calls the API.
const asAdmin = (method, url, payload) =>
  app.inject({ method, url, payload, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN, cookie: adminCookie } });

// A tool holding only a token: no cookie, no Origin, like the MCP server.
const withToken = (token, method, url, payload) =>
  app.inject({ method, url, payload, remoteAddress: uniqueAddress(), headers: { authorization: `Bearer ${token}` } });

async function createToken(body) {
  const res = await asAdmin("POST", "/api/admin/api-tokens", body);
  assert.equal(res.statusCode, 200, res.body);
  return res.json().data;
}

async function auditEvent(event) {
  // The audit write is fire-and-forget, so give it a moment.
  for (let i = 0; i < 20; i += 1) {
    const row = await collections.adminAudit.findOne({ event, email: ADMIN_EMAIL });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

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
});

after(async () => {
  await collections.adminApiTokens.deleteMany({ adminEmail: ADMIN_EMAIL });
  await collections.promoCodes.deleteMany({ code: PROMO });
  await collections.adminAudit.deleteMany({ email: ADMIN_EMAIL });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("creating a token needs a signed-in admin, and validates what it is given", async () => {
  const anon = await app.inject({ method: "POST", url: "/api/admin/api-tokens", payload: { name: "x" }, remoteAddress: uniqueAddress() });
  assert.equal(anon.statusCode, 401);

  for (const bad of [{}, { name: "" }, { name: "x", scope: "admin" }, { name: "x", days: 0 }, { name: "x", days: 91 }, { name: "x", days: 1.5 }]) {
    assert.equal((await asAdmin("POST", "/api/admin/api-tokens", bad)).statusCode, 400, JSON.stringify(bad));
  }
});

test("a read token reads, is scoped to read, and stores only a hash", async () => {
  const created = await createToken({ name: "mcp read", scope: "read", days: 7 });
  assert.match(created.token, /^ptk_/);

  const stored = await collections.adminApiTokens.findOne({ adminEmail: ADMIN_EMAIL, name: "mcp read" });
  assert.notEqual(stored.tokenHash, created.token);
  assert.ok(!JSON.stringify(stored).includes(created.token), "the token itself is never stored");

  assert.equal((await withToken(created.token, "GET", "/api/admin/overview/summary")).statusCode, 200);
  assert.equal((await withToken(created.token, "GET", "/api/admin/promo-codes")).statusCode, 200);

  const write = await withToken(created.token, "POST", "/api/admin/promo-codes", { code: PROMO, discountMode: "flat", discountPaise: 10000 });
  assert.equal(write.statusCode, 403, "a read token cannot write");
  assert.equal(await collections.promoCodes.countDocuments({ code: PROMO }), 0);
});

test("a write token can manage promo codes and the change is audited", async () => {
  const created = await createToken({ name: "mcp write", scope: "write", days: 7 });

  const res = await withToken(created.token, "POST", "/api/admin/promo-codes", {
    code: PROMO, discountMode: "flat", discountPaise: 10000, productIds: ["pt-car-2"],
    // tokens must give a code a use limit and an expiry (lib/auth/token-limits.js)
    maxUses: 25, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await withToken(created.token, "POST", `/api/admin/promo-codes/${PROMO}/revoke`)).statusCode, 200);

  const row = await auditEvent("api_token_write");
  assert.ok(row, "the write is in the audit log");
  assert.match(row.target, /mcp write/);
});

test("an ops token reaches the operations routes, a write token does not", async () => {
  const ops = await createToken({ name: "mcp ops", scope: "ops", days: 7 });
  const write = await createToken({ name: "mcp ops-denied", scope: "write", days: 7 });
  // A malformed id: the route answers 400 itself, so 400 means "got in", 403 means "turned away at the door".
  const url = "/api/admin/reviews/not-an-id/approve";
  assert.equal((await withToken(ops.token, "POST", url, { approved: true })).statusCode, 400);
  assert.equal((await withToken(write.token, "POST", url, { approved: true })).statusCode, 403);
  assert.equal((await withToken(ops.token, "DELETE", "/api/admin/tags/unclaimed/all")).statusCode, 403, "deletes stay cookie-only");
});

test("even a write token cannot reach the sensitive routes or manage tokens", async () => {
  const { token } = await createToken({ name: "mcp write 2", scope: "write", days: 7 });
  const refused = [
    ["POST", "/api/admin/tags/issue", { quantity: 1 }],
    ["GET", "/api/admin/admins"],
    ["GET", "/api/admin/owners"],
    ["GET", "/api/admin/api-tokens"],
    ["POST", "/api/admin/api-tokens", { name: "escalate", scope: "write" }],
    ["DELETE", "/api/admin/tags/unclaimed/all"]
  ];
  for (const [method, url, body] of refused) {
    assert.equal((await withToken(token, method, url, body)).statusCode, 403, `${method} ${url}`);
  }
  assert.equal(await collections.adminApiTokens.countDocuments({ adminEmail: ADMIN_EMAIL, name: "escalate" }), 0);
});

test("a token is not accepted as a cookie, and a bad one gets a plain 401", async () => {
  const { token } = await createToken({ name: "mcp cookie", scope: "read", days: 7 });
  const asCookie = await app.inject({
    method: "GET", url: "/api/admin/overview/summary", remoteAddress: uniqueAddress(), headers: { cookie: `wavetag_session=${token}` }
  });
  assert.equal(asCookie.statusCode, 401);
  assert.equal((await withToken(`ptk_${"A".repeat(43)}`, "GET", "/api/admin/overview/summary")).statusCode, 401);
});

test("revoking takes effect at once, and expiry is honoured", async () => {
  const revoked = await createToken({ name: "to revoke", scope: "read", days: 7 });
  assert.equal((await withToken(revoked.token, "GET", "/api/admin/overview/summary")).statusCode, 200);
  assert.equal((await asAdmin("DELETE", `/api/admin/api-tokens/${revoked.id}`)).statusCode, 200);
  assert.equal((await withToken(revoked.token, "GET", "/api/admin/overview/summary")).statusCode, 401);
  assert.ok(await auditEvent("api_token_revoked"));

  const expiring = await createToken({ name: "to expire", scope: "read", days: 1 });
  await collections.adminApiTokens.updateOne({ tokenPrefix: expiring.tokenPrefix, name: "to expire" }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
  assert.equal((await withToken(expiring.token, "GET", "/api/admin/overview/summary")).statusCode, 401);
});

test("the list never shows a secret, and a removed admin's tokens stop working", async () => {
  const list = (await asAdmin("GET", "/api/admin/api-tokens")).json().data;
  assert.ok(list.length >= 1);
  for (const t of list) {
    assert.equal(t.token, undefined);
    assert.equal(t.tokenHash, undefined);
  }

  const { token } = await createToken({ name: "orphan", scope: "read", days: 7 });
  const admin = await collections.admins.findOne({ email: ADMIN_EMAIL });
  await collections.admins.deleteOne({ _id: admin._id });
  assert.equal((await withToken(token, "GET", "/api/admin/overview/summary")).statusCode, 401);
  await collections.admins.insertOne(admin); // restore for cleanup
});
