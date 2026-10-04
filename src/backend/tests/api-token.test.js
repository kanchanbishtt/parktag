// Admin API tokens: what a token may call, and how a request's token is resolved. No database: the collections
// are small fakes, so the security rules are checked directly.
import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import {
  authenticateApiToken, bearerApiToken, hashApiToken, newApiToken, tokenMayCall
} from "../lib/auth/api-token.js";

const adminId = new ObjectId().toHexString();
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-01T10:00:00.000Z");

function world({ tokenRow, admin = { email: "girish@parktag.test", displayName: "Girish" } } = {}) {
  const calls = { findToken: 0, update: [] };
  return {
    calls,
    collections: {
      adminApiTokens: {
        findOne: async (q) => { calls.findToken += 1; return tokenRow && tokenRow.tokenHash === q.tokenHash ? tokenRow : null; },
        updateOne: async (...a) => { calls.update.push(a); }
      },
      admins: { findOne: async () => admin }
    }
  };
}

function row(token, overrides = {}) {
  return {
    _id: new ObjectId(), adminId, name: "mcp", scope: "read", tokenHash: hashApiToken(token),
    expiresAt: new Date(NOW + DAY).toISOString(), revokedAt: null, lastUsedAt: null, ...overrides
  };
}

const req = (token, method, route) => ({ method, routeOptions: { url: route }, headers: token ? { authorization: `Bearer ${token}` } : {} });

test("a new token is unguessable in shape, and only its hash is derived from it", () => {
  const a = newApiToken();
  const b = newApiToken();
  assert.match(a.token, /^ptk_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.tokenHash, hashApiToken(a.token));
  assert.equal(a.tokenPrefix, a.token.slice(0, 8));
  assert.ok(!a.tokenHash.includes(a.token));
});

test("only a well-formed Bearer token is picked up", () => {
  const { token } = newApiToken();
  assert.equal(bearerApiToken({ headers: { authorization: `Bearer ${token}` } }), token);
  assert.equal(bearerApiToken({ headers: { authorization: `bearer ${token}` } }), token);
  for (const bad of [undefined, "", `Basic ${token}`, "Bearer ptk_short", `Bearer ${token}x`, `Bearer ${token} extra`, "Bearer some-session-id"]) {
    assert.equal(bearerApiToken({ headers: { authorization: bad } }), null, String(bad));
  }
});

test("read tokens read, write tokens write, and everything else is refused", () => {
  assert.equal(tokenMayCall("GET", "/api/admin/overview/summary", "read"), true);
  assert.equal(tokenMayCall("HEAD", "/api/admin/overview/summary", "read"), true, "HEAD is a GET");
  assert.equal(tokenMayCall("POST", "/api/admin/promo-codes", "read"), false, "a read token cannot write");
  assert.equal(tokenMayCall("POST", "/api/admin/promo-codes", "write"), true);
  assert.equal(tokenMayCall("PATCH", "/api/admin/promo-codes/:code", "write"), true);
  assert.equal(tokenMayCall("POST", "/api/admin/promo-codes/:code/revoke", "write"), true);
  assert.equal(tokenMayCall("PATCH", "/api/admin/shop-settings", "write"), true);
  assert.equal(tokenMayCall("GET", "/api/admin/utm-sales", "write"), true, "write includes read");
  assert.equal(tokenMayCall("GET", "/api/admin/overview/summary", "admin"), false, "unknown scope");
});

test("the sensitive admin routes are out of reach even for a write token", () => {
  const refused = [
    ["DELETE", "/api/admin/tags/unclaimed/all"], ["DELETE", "/api/admin/tags/batch/:batchNumber"],
    ["DELETE", "/api/admin/etags/:tagId"], ["DELETE", "/api/admin/sticker-designs/:id"],
    ["POST", "/api/admin/sticker-designs"], ["PUT", "/api/admin/sticker-designs/:id"],
    ["GET", "/api/admin/admins"], ["DELETE", "/api/admin/admins/:id"], ["POST", "/api/admin/admins"],
    ["GET", "/api/admin/owners"], ["GET", "/api/admin/audit"], ["GET", "/api/admin/me"],
    ["POST", "/api/admin/print-queue/export"], ["POST", "/api/admin/print-queue/doorhangers"],
    ["GET", "/api/admin/tag-batches/:key/export.csv"],
    // a token must never mint, list or revoke tokens
    ["POST", "/api/admin/api-tokens"], ["GET", "/api/admin/api-tokens"], ["DELETE", "/api/admin/api-tokens/:id"],
    // not an admin route at all
    ["GET", "/api/owner/me"], ["GET", undefined]
  ];
  for (const scope of ["read", "write", "ops"]) {
    for (const [method, route] of refused) assert.equal(tokenMayCall(method, route, scope), false, `${scope} ${method} ${route}`);
  }
});

test("no bearer token means no lookup at all", async () => {
  const { collections, calls } = world();
  assert.equal(await authenticateApiToken(collections, req(null, "GET", "/api/admin/overview")), null);
  assert.equal(await authenticateApiToken(collections, req("Bearer garbage", "GET", "/api/admin/overview")), null);
  assert.equal(calls.findToken, 0);
});

test("unknown, revoked, expired and orphaned tokens are all just invalid", async () => {
  const { token } = newApiToken();
  const good = row(token);
  const cases = {
    unknown: world({ tokenRow: null }),
    revoked: world({ tokenRow: { ...good, revokedAt: new Date(NOW - 1).toISOString() } }),
    expired: world({ tokenRow: { ...good, expiresAt: new Date(NOW - 1).toISOString() } }),
    "admin removed": world({ tokenRow: good, admin: null })
  };
  for (const [label, w] of Object.entries(cases)) {
    const r = await authenticateApiToken(w.collections, req(token, "GET", "/api/admin/overview"), NOW);
    assert.deepEqual(r, { denied: "invalid" }, label);
  }
});

test("a good token becomes an admin session that says how it got in", async () => {
  const { token } = newApiToken();
  const w = world({ tokenRow: row(token) });
  const r = await authenticateApiToken(w.collections, req(token, "GET", "/api/admin/etags/:tagId"), NOW);
  assert.equal(r.session.role, "admin");
  assert.equal(r.session.userId, adminId);
  assert.equal(r.session.email, "girish@parktag.test");
  assert.equal(r.session.via, "api-token");
  assert.equal(r.session.scope, "read");
});

test("a valid token asking for a route its scope does not cover is denied, not invalid", async () => {
  const { token } = newApiToken();
  const w = world({ tokenRow: row(token, { scope: "read" }) });
  assert.deepEqual(await authenticateApiToken(w.collections, req(token, "POST", "/api/admin/promo-codes"), NOW), { denied: "route" });
  assert.deepEqual(await authenticateApiToken(w.collections, req(token, "GET", "/api/admin/api-tokens"), NOW), { denied: "route" });
});

test("lastUsedAt is stamped, but not on every request", async () => {
  const { token } = newApiToken();
  const stored = row(token);
  const w = world({ tokenRow: stored });
  await authenticateApiToken(w.collections, req(token, "GET", "/api/admin/overview"), NOW);
  assert.equal(w.calls.update.length, 1, "first use stamps");

  stored.lastUsedAt = new Date(NOW).toISOString();
  await authenticateApiToken(w.collections, req(token, "GET", "/api/admin/overview"), NOW + 60 * 1000);
  assert.equal(w.calls.update.length, 1, "a minute later does not");

  await authenticateApiToken(w.collections, req(token, "GET", "/api/admin/overview"), NOW + 6 * 60 * 1000);
  assert.equal(w.calls.update.length, 2, "six minutes later does");
});

test("ops is the top scope: it covers read, write and the operations writes, and nothing below it does", () => {
  const ops = [
    ["POST", "/api/admin/tags/issue"], ["POST", "/api/admin/etags/:tagId/status"],
    ["POST", "/api/admin/print-queue/:tagId/mark-printed"], ["POST", "/api/admin/print-queue/mark-run-printed"],
    ["POST", "/api/admin/marketing/add"], ["POST", "/api/admin/marketing/:tagId/sold"], ["POST", "/api/admin/marketing/:tagId/deactivate"],
    ["POST", "/api/admin/reviews/:id/approve"], ["POST", "/api/admin/activations/:orderId/reminder"],
    ["POST", "/api/admin/sticker-designs/:id/publish"], ["POST", "/api/admin/sticker-designs/unpublish"]
  ];
  for (const [method, route] of ops) {
    assert.equal(tokenMayCall(method, route, "ops"), true, `ops ${method} ${route}`);
    assert.equal(tokenMayCall(method, route, "write"), false, `write ${method} ${route}`);
    assert.equal(tokenMayCall(method, route, "read"), false, `read ${method} ${route}`);
  }
  assert.equal(tokenMayCall("GET", "/api/admin/overview/summary", "ops"), true, "ops includes read");
  assert.equal(tokenMayCall("POST", "/api/admin/promo-codes", "ops"), true, "ops includes write");
});
