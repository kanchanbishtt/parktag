// The pure parts of the admin MCP OAuth flow: who may be redirected to, PKCE, registration, discovery documents.
import test from "node:test";
import assert from "node:assert/strict";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

import {
  authorizationServerMetadata, isAllowedRedirectUri, isChallenge, pickScope, pkceMatches, protectedResourceMetadata, readRegistration
} from "../lib/auth/oauth.js";

test("only Claude's callback and loopback addresses may be redirected to", () => {
  for (const ok of ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback", "http://localhost:6274/callback", "http://127.0.0.1:33418/cb", "http://[::1]:5000/cb"]) {
    assert.equal(isAllowedRedirectUri(ok), true, ok);
  }
  for (const bad of [
    "https://evil.example/cb", "https://claude.ai.evil.example/cb", "https://evil.example/https://claude.ai/",
    "https://claude.ai/cb", "https://claude.ai/api/mcp/auth_callback/extra", "https://claude.ai/api/mcp/auth_callback?next=//evil.example",
    "http://claude.ai/api/mcp/auth_callback", "https://user:pw@claude.ai/cb", "https://claude.ai/cb#frag",
    "http://localhost.evil.example/cb", "javascript:alert(1)", "claude://callback", "", undefined, 42
  ]) {
    assert.equal(isAllowedRedirectUri(bad), false, String(bad));
  }
});

test("PKCE S256 matches the RFC 7636 reference pair and nothing else", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(pkceMatches(verifier, challenge), true);
  assert.equal(pkceMatches(verifier.replace("d", "e"), challenge), false, "wrong verifier");
  assert.equal(pkceMatches("short", challenge), false, "verifier under 43 characters");
  assert.equal(pkceMatches(verifier, verifier), false, "plain (verifier as challenge) is not S256");
  assert.equal(pkceMatches(undefined, undefined), false);
  assert.equal(isChallenge(challenge), true);
  assert.equal(isChallenge("nope"), false);
});

test("client registration: public clients with allowed redirects only, name cleaned", () => {
  const good = readRegistration({ client_name: "  Claude\n\u0007  ", redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" });
  assert.equal(good.ok, true);
  assert.deepEqual(good.client.redirectUris, ["https://claude.ai/api/mcp/auth_callback"], "deduplicated");
  assert.equal(good.client.name, "Claude");
  assert.equal(readRegistration({ redirect_uris: [REDIRECT] }).client.name, "MCP client", "name falls back");
  const sneaky = readRegistration({ client_name: "Cla\u202Eude\u200B  Offi\u2066cial", redirect_uris: [REDIRECT] });
  assert.equal(sneaky.client.name, "Cla ude Offi cial", "bidi overrides and zero-width characters are removed");

  for (const [body, error] of [
    [{}, "invalid_redirect_uri"], [{ redirect_uris: [] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["https://evil.example/cb"] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["https://claude.ai/cb", "https://evil.example/cb"] }, "invalid_redirect_uri"],
    [{ redirect_uris: ["https://claude.ai/some/other/page"] }, "invalid_redirect_uri"],
    [{ redirect_uris: Array(6).fill(REDIRECT) }, "invalid_redirect_uri"],
    [{ redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" }, "invalid_client_metadata"],
    [null, "invalid_redirect_uri"]
  ]) {
    const r = readRegistration(body);
    assert.deepEqual([r.ok, r.error], [false, error], JSON.stringify(body));
  }
});

test("discovery documents point at this host and advertise PKCE S256, public clients and refresh", () => {
  const as = authorizationServerMetadata("https://app.parktag.me/");
  assert.equal(as.issuer, "https://app.parktag.me");
  assert.equal(as.authorization_endpoint, "https://app.parktag.me/oauth/authorize");
  assert.equal(as.token_endpoint, "https://app.parktag.me/oauth/token");
  assert.equal(as.registration_endpoint, "https://app.parktag.me/oauth/register");
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
  assert.ok(as.grant_types_supported.includes("refresh_token"));

  const rs = protectedResourceMetadata("https://app.parktag.me");
  assert.equal(rs.resource, "https://app.parktag.me/mcp");
  assert.deepEqual(rs.authorization_servers, ["https://app.parktag.me"]);
});

test("the scope picker never widens: anything unknown or missing is read", () => {
  assert.equal(pickScope("read"), "read");
  assert.equal(pickScope("write"), "write");
  assert.equal(pickScope("ops"), "ops");
  assert.equal(pickScope("admin"), "read");
  assert.equal(pickScope(undefined), "read");
});
