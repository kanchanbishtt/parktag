// The remote admin MCP endpoint end to end over the real routes: register a client, sign in, consent, exchange the
// code, call tools on /mcp, refresh, revoke. Plus the ways it must refuse.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "oauth-mcp-admin@parktag.test";
const PASSWORD = "test-password-123";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

let app;
let collections;
let adminCookie;
const clientIds = [];

const asAdmin = (method, url, payload, headers = {}) =>
  app.inject({ method, url, payload, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN, cookie: adminCookie, ...headers } });
const anon = (method, url, payload, headers = {}) =>
  app.inject({ method, url, payload, remoteAddress: uniqueAddress(), headers });

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const newPkce = () => {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
};
const form = (obj) => new URLSearchParams(obj).toString();
const tokenCall = (obj) => anon("POST", "/oauth/token", form(obj), { "content-type": "application/x-www-form-urlencoded" });

async function register(name = "Claude", redirect = REDIRECT) {
  const res = await anon("POST", "/oauth/register", { client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: "none" });
  assert.equal(res.statusCode, 201, res.body);
  clientIds.push(res.json().client_id);
  return res.json().client_id;
}

const authorizeUrl = (clientId, pkce, extra = {}) =>
  `/oauth/authorize?${form({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce.challenge, code_challenge_method: "S256", state: "st8", ...extra })}`;

/** Drive consent as the signed-in admin. Returns the redirect Claude would be sent to. */
async function consent(clientId, pkce, { decision = "approve", scope = "ops" } = {}) {
  const page = await asAdmin("GET", authorizeUrl(clientId, pkce));
  assert.equal(page.statusCode, 200, page.body.slice(0, 300));
  const txn = /data-txn="([^"]+)"/.exec(page.body)?.[1];
  assert.ok(txn, "the consent page carries a transaction");
  const res = await asAdmin("POST", "/oauth/authorize", { txn, decision, scope });
  return { res, txn, page };
}

async function getTokens({ scope = "ops" } = {}) {
  const clientId = await register();
  const pkce = newPkce();
  const { res } = await consent(clientId, pkce, { scope });
  assert.equal(res.statusCode, 200, res.body);
  const code = new URL(res.json().redirect).searchParams.get("code");
  const tok = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pkce.verifier });
  assert.equal(tok.statusCode, 200, tok.body);
  return { clientId, ...tok.json() };
}

let rpcId = 0;
const rpc = (token, method, params) =>
  anon("POST", "/mcp", { jsonrpc: "2.0", id: ++rpcId, method, params }, {
    authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream"
  });
const toolNames = async (token) => (await rpc(token, "tools/list", {})).json().result.tools.map((t) => t.name);

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.admins.insertOne({
    email: ADMIN_EMAIL, role: "admin", passwordHash: await createPasswordHash(PASSWORD), createdAt: new Date().toISOString()
  });
  const login = await anon("POST", "/api/auth/admin/login", { email: ADMIN_EMAIL, password: PASSWORD }, { origin: TEST_ORIGIN });
  assert.equal(login.statusCode, 200, "admin fixture must be able to sign in");
  adminCookie = login.headers["set-cookie"];
});

after(async () => {
  await collections.adminApiTokens.deleteMany({ adminEmail: ADMIN_EMAIL });
  await collections.oauthClients.deleteMany({ clientId: { $in: clientIds } });
  await collections.oauthCodes.deleteMany({ clientId: { $in: clientIds } });
  await collections.oauthRefreshTokens.deleteMany({ clientId: { $in: clientIds } });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await collections.adminAudit.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("discovery documents are public and point at the OAuth endpoints", async () => {
  const as = (await anon("GET", "/.well-known/oauth-authorization-server")).json();
  assert.match(as.token_endpoint, /\/oauth\/token$/);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const rs = (await anon("GET", path)).json();
    assert.match(rs.resource, /\/mcp$/);
    assert.equal(rs.authorization_servers.length, 1);
  }
});

test("registration refuses redirect addresses that are not Claude or loopback", async () => {
  for (const redirect_uris of [["https://evil.example/cb"], ["https://claude.ai/cb", "http://evil.example/cb"], []]) {
    const res = await anon("POST", "/oauth/register", { client_name: "x", redirect_uris });
    assert.equal(res.statusCode, 400, JSON.stringify(redirect_uris));
    assert.equal(res.json().error, "invalid_redirect_uri");
  }
});

test("authorize: an unknown app or a foreign redirect gets an error page, never a redirect", async () => {
  const pkce = newPkce();
  const unknown = await asAdmin("GET", authorizeUrl("ptc_nope", pkce));
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.headers.location, undefined);

  const clientId = await register();
  const foreign = await asAdmin("GET", authorizeUrl(clientId, pkce, { redirect_uri: "https://claude.ai/other" }));
  assert.equal(foreign.statusCode, 400);
  assert.equal(foreign.headers.location, undefined);
});

test("authorize: missing PKCE or a wrong response type goes back to the app as an OAuth error", async () => {
  const clientId = await register();
  const pkce = newPkce();
  const plain = await asAdmin("GET", authorizeUrl(clientId, pkce, { code_challenge_method: "plain" }));
  assert.equal(plain.statusCode, 302);
  assert.equal(new URL(plain.headers.location).searchParams.get("error"), "invalid_request");
  assert.equal(new URL(plain.headers.location).searchParams.get("state"), "st8");
  const implicit = await asAdmin("GET", authorizeUrl(clientId, pkce, { response_type: "token" }));
  assert.equal(new URL(implicit.headers.location).searchParams.get("error"), "unsupported_response_type");
});

test("signed out: sent to sign in, then back to the consent screen after /admin", async () => {
  const clientId = await register();
  const url = authorizeUrl(clientId, newPkce());
  const res = await anon("GET", url);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "/admin");
  const pending = res.cookies.find((c) => c.name === "pt_oauth_next");
  assert.ok(pending && pending.httpOnly, "the waiting request is held in an HttpOnly cookie");

  const back = await asAdmin("GET", "/admin", undefined, { cookie: `${adminCookie.toString().split(";")[0]}; pt_oauth_next=${encodeURIComponent(pending.value)}` });
  assert.equal(back.statusCode, 302);
  assert.equal(back.headers.location, url);

  const junk = await asAdmin("GET", "/admin", undefined, { cookie: `${adminCookie.toString().split(";")[0]}; pt_oauth_next=${encodeURIComponent("https://evil.example/")}` });
  assert.equal(junk.headers.location, "/admin/overview", "a pending value that is not our authorize URL is ignored");
});

test("the consent screen escapes an app's name and shows where approval sends you", async () => {
  const clientId = await register(`<img src=x onerror=alert(1)>`);
  const { page } = await consent(clientId, newPkce(), { decision: "deny" });
  assert.ok(!page.body.includes("<img src=x"), "client name must be escaped");
  assert.ok(page.body.includes("&lt;img src=x"));
  assert.ok(page.body.includes("claude.ai"), "redirect host is shown");
  assert.match(page.headers["cache-control"], /no-store/);
});

test("deciding needs this site's Origin, a signed-in admin, and a live one-time transaction", async () => {
  const clientId = await register();
  const pkce = newPkce();
  const page = await asAdmin("GET", authorizeUrl(clientId, pkce));
  const txn = /data-txn="([^"]+)"/.exec(page.body)[1];

  const noOrigin = await anon("POST", "/oauth/authorize", { txn, decision: "approve" }, { cookie: adminCookie });
  assert.equal(noOrigin.statusCode, 403);
  const foreign = await asAdmin("POST", "/oauth/authorize", { txn, decision: "approve" }, { origin: "https://evil.example" });
  assert.equal(foreign.statusCode, 403);
  const signedOut = await anon("POST", "/oauth/authorize", { txn, decision: "approve" }, { origin: TEST_ORIGIN });
  assert.equal(signedOut.statusCode, 401);

  const ok = await asAdmin("POST", "/oauth/authorize", { txn, decision: "approve", scope: "read" });
  assert.equal(ok.statusCode, 200);
  const replay = await asAdmin("POST", "/oauth/authorize", { txn, decision: "approve", scope: "read" });
  assert.equal(replay.statusCode, 400, "a transaction works once");
  const bogus = await asAdmin("POST", "/oauth/authorize", { txn: "nope", decision: "approve" });
  assert.equal(bogus.statusCode, 400);
});

test("the consent screen preselects read, shows the full redirect address and says the name is unverified", async () => {
  const clientId = await register();
  const page = await asAdmin("GET", authorizeUrl(clientId, newPkce()));
  assert.match(page.body, /<option value="read" selected>/);
  assert.ok(!/<option value="ops" selected>/.test(page.body));
  assert.ok(page.body.includes(REDIRECT), "the whole redirect address is shown, not just the host");
  assert.match(page.body, /not verified by ParkTag/);
  const asked = await asAdmin("GET", authorizeUrl(clientId, newPkce(), { scope: "write" }));
  assert.match(asked.body, /<option value="write" selected>/, "a requested scope is preselected, never beyond what the admin then picks");
});

test("denying sends the app back with access_denied and its state", async () => {
  const { res } = await consent(await register(), newPkce(), { decision: "deny" });
  const url = new URL(res.json().redirect);
  assert.equal(url.origin + url.pathname, REDIRECT);
  assert.equal(url.searchParams.get("error"), "access_denied");
  assert.equal(url.searchParams.get("state"), "st8");
  assert.equal(url.searchParams.get("code"), null);
});

test("the code is single use, bound to its PKCE verifier, redirect and client", async () => {
  const clientId = await register();
  const other = await register();
  const attempt = async (mutate) => {
    const pkce = newPkce();
    const { res } = await consent(clientId, pkce);
    const code = new URL(res.json().redirect).searchParams.get("code");
    return tokenCall({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pkce.verifier, ...mutate({ code, pkce }) });
  };
  assert.equal((await attempt(({ pkce }) => ({ code_verifier: newPkce().verifier }))).json().error, "invalid_grant", "wrong verifier");
  assert.equal((await attempt(() => ({ redirect_uri: "https://claude.ai/other" }))).json().error, "invalid_grant", "wrong redirect");
  assert.equal((await attempt(() => ({ client_id: other }))).json().error, "invalid_grant", "another client's code");
  assert.equal((await attempt(() => ({ client_id: "ptc_nope" }))).statusCode, 401, "unknown client");

  const pkce = newPkce();
  const { res } = await consent(clientId, pkce);
  const code = new URL(res.json().redirect).searchParams.get("code");
  const args = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pkce.verifier };
  assert.equal((await tokenCall(args)).statusCode, 200);
  assert.equal((await tokenCall(args)).json().error, "invalid_grant", "replaying a used code fails");
  assert.equal((await tokenCall({ ...args, grant_type: "password" })).json().error, "unsupported_grant_type");
});

test("/mcp without a token is a 401 that points at the OAuth metadata", async () => {
  const res = await anon("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "content-type": "application/json", accept: "application/json, text/event-stream" });
  assert.equal(res.statusCode, 401);
  assert.match(res.headers["www-authenticate"], /^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"$/);
  const bad = await rpc("ptk_" + "A".repeat(43), "tools/list", {});
  assert.equal(bad.statusCode, 401);
});

test("an ops grant works on /mcp: tools are listed and a call goes through the admin API", async () => {
  const { access_token, scope, token_type, expires_in } = await getTokens({ scope: "ops" });
  assert.deepEqual([token_type, scope, expires_in], ["Bearer", "ops", 3600]);
  assert.match(access_token, /^ptk_/);

  const init = await rpc(access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.equal(init.statusCode, 200);
  assert.equal(init.json().result.serverInfo.name, "parktag-admin");

  const names = await toolNames(access_token);
  for (const n of ["parktag_overview", "parktag_create_promo_code", "parktag_issue_tags", "parktag_approve_review"]) assert.ok(names.includes(n), n);

  const call = await rpc(access_token, "tools/call", { name: "parktag_overview", arguments: { days: 7 } });
  const out = call.json().result;
  assert.notEqual(out.isError, true, JSON.stringify(out));
  assert.equal(JSON.parse(out.content[0].text).ok, true);

  const get = await anon("GET", "/mcp", undefined, { authorization: `Bearer ${access_token}` });
  assert.equal(get.statusCode, 405);
});

test("the granted scope limits the tools: a read grant sees no write tools and cannot call one", async () => {
  const { access_token, scope } = await getTokens({ scope: "read" });
  assert.equal(scope, "read");
  const names = await toolNames(access_token);
  assert.ok(names.includes("parktag_overview"));
  assert.ok(!names.some((n) => /create|update|set_|issue|approve|publish|mark_|marketing_add/.test(n)), names.join());
  const attempt = await rpc(access_token, "tools/call", { name: "parktag_create_promo_code", arguments: { code: "NOPE1234", discountMode: "flat", discountRupees: 1 } });
  assert.ok(attempt.json().error || attempt.json().result?.isError, "an unregistered tool cannot be called");
});

test("a tool write made through /mcp is attributed to the connection in the audit log", async () => {
  const { access_token } = await getTokens({ scope: "write" });
  const code = `OA${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
  const res = await rpc(access_token, "tools/call", { name: "parktag_create_promo_code", arguments: { code, discountMode: "flat", discountRupees: 5 } });
  assert.equal(res.statusCode, 200, res.body);
  assert.notEqual(res.json().result.isError, true, JSON.stringify(res.json()));
  let row;
  for (let i = 0; i < 20 && !row; i += 1) {
    row = await collections.adminAudit.findOne({ event: "api_token_write", email: ADMIN_EMAIL, target: /post \/api\/admin\/promo-codes via claude \(oauth\)/ });
    if (!row) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(row, "the write lands in the audit log under the OAuth connection's name");
  await collections.promoCodes.deleteMany({ code });
});

test("approving and declining are both audited", async () => {
  await getTokens({ scope: "read" });
  await consent(await register(), newPkce(), { decision: "deny" });
  const events = new Set();
  for (let i = 0; i < 20 && events.size < 2; i += 1) {
    for (const e of await collections.adminAudit.find({ email: ADMIN_EMAIL, event: { $in: ["oauth_authorized", "oauth_denied"] } }).toArray()) events.add(e.event);
    if (events.size < 2) await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual([...events].sort(), ["oauth_authorized", "oauth_denied"]);
});

test("refresh rotates in place: one row per connection, old access and refresh tokens die", async () => {
  const first = await getTokens({ scope: "ops" });
  const rowsBefore = await collections.adminApiTokens.countDocuments({ oauthClientId: first.clientId });
  assert.equal(rowsBefore, 1);

  const refreshed = await tokenCall({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.clientId });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  const next = refreshed.json();
  assert.notEqual(next.access_token, first.access_token);
  assert.notEqual(next.refresh_token, first.refresh_token);
  assert.equal(next.scope, "ops");
  assert.equal(await collections.adminApiTokens.countDocuments({ oauthClientId: first.clientId }), 1, "same row, not a new one");

  assert.equal((await rpc(first.access_token, "tools/list", {})).statusCode, 401, "the old access token stopped working");
  assert.equal((await rpc(next.access_token, "tools/list", {})).statusCode, 200);
  const wrongClient = await tokenCall({ grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: await register() });
  assert.equal(wrongClient.json().error, "invalid_grant", "another client cannot redeem it");
  assert.equal((await rpc(next.access_token, "tools/list", {})).statusCode, 200, "a wrong-client attempt does not hurt the real connection");
});

test("presenting a refresh token that was already used revokes the whole connection", async () => {
  const first = await getTokens({ scope: "ops" });
  const refreshed = (await tokenCall({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.clientId })).json();
  assert.equal((await rpc(refreshed.access_token, "tools/list", {})).statusCode, 200);

  // The old token comes back (a thief, or a client that kept it). Two holders share the chain: end it.
  const replay = await tokenCall({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.clientId });
  assert.equal(replay.json().error, "invalid_grant");
  assert.equal((await rpc(refreshed.access_token, "tools/list", {})).statusCode, 401, "the newest access token is dead too");
  const next = await tokenCall({ grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: first.clientId });
  assert.equal(next.json().error, "invalid_grant", "and so is the newest refresh token");
  assert.ok((await collections.adminApiTokens.findOne({ oauthClientId: first.clientId })).revokedAt, "the Tokens page shows it revoked");
});

test("a connection has an absolute end that refreshing does not extend", async () => {
  const grant = await getTokens({ scope: "ops" });
  const row = await collections.oauthRefreshTokens.findOne({ clientId: grant.clientId });
  const ninety = 90 * 86_400_000;
  assert.ok(Math.abs(new Date(row.connectionEndsAt).getTime() - (Date.now() + ninety)) < 60_000, "set to the 90 day ceiling at consent");

  const refreshed = (await tokenCall({ grant_type: "refresh_token", refresh_token: grant.refresh_token, client_id: grant.clientId })).json();
  const rotated = await collections.oauthRefreshTokens.findOne({ clientId: grant.clientId, consumedAt: null });
  assert.equal(new Date(rotated.connectionEndsAt).getTime(), new Date(row.connectionEndsAt).getTime(), "the end date is carried over, not reset");

  await collections.oauthRefreshTokens.updateOne({ _id: rotated._id }, { $set: { connectionEndsAt: new Date(Date.now() - 1000) } });
  const late = await tokenCall({ grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: grant.clientId });
  assert.equal(late.json().error, "invalid_grant", "past its end, a refresh fails and the admin must consent again");
});

test("when the client table is full, never-used clients are evicted and used ones are kept", async () => {
  const MARK = `evict-test-${Date.now()}`;
  const base = Date.now() - 3_600_000;
  const docs = Array.from({ length: 2000 }, (_, i) => ({
    clientId: `ptc_${MARK}_${i}`, name: MARK, redirectUris: [REDIRECT], createdAt: new Date(base + i), lastActiveAt: new Date(base + i), used: i === 0
  }));
  await collections.oauthClients.insertMany(docs);
  try {
    const res = await anon("POST", "/oauth/register", { client_name: "late", redirect_uris: [REDIRECT] });
    assert.equal(res.statusCode, 201, "registration still works when full");
    clientIds.push(res.json().client_id);
    assert.ok(await collections.oauthClients.findOne({ clientId: `ptc_${MARK}_0` }), "a used client is never evicted");
    assert.equal(await collections.oauthClients.countDocuments({ clientId: `ptc_${MARK}_1` }), 0, "the oldest never-used client went");
  } finally {
    await collections.oauthClients.deleteMany({ name: MARK });
  }
});

test("revoking the connection on the Tokens page ends it: access and refresh both stop", async () => {
  const grant = await getTokens({ scope: "ops" });
  const stored = await collections.adminApiTokens.findOne({ oauthClientId: grant.clientId });
  const listed = (await asAdmin("GET", "/api/admin/api-tokens")).json().data.find((t) => t.id === String(stored._id));
  assert.ok(listed && listed.name === "Claude (OAuth)", "the connection is listed on the Tokens page by name");

  const revoked = await asAdmin("DELETE", `/api/admin/api-tokens/${listed.id}`);
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await rpc(grant.access_token, "tools/list", {})).statusCode, 401);
  const refresh = await tokenCall({ grant_type: "refresh_token", refresh_token: grant.refresh_token, client_id: grant.clientId });
  assert.equal(refresh.json().error, "invalid_grant");
});

test("removing the admin ends their connections", async () => {
  const grant = await getTokens({ scope: "read" });
  await collections.adminApiTokens.updateOne({ oauthClientId: grant.clientId }, { $set: { adminId: "000000000000000000000000" } });
  assert.equal((await rpc(grant.access_token, "tools/list", {})).statusCode, 401);
  const refresh = await tokenCall({ grant_type: "refresh_token", refresh_token: grant.refresh_token, client_id: grant.clientId });
  assert.equal(refresh.json().error, "invalid_grant");
});
