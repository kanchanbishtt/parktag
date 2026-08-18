// The two MEDIUM findings from the owner-dashboard QA pass.
//
// #2, real: the CSRF origin check only ever covered /api/auth/*, so every
// state-changing signed-in action — tag status, emergency contact, delete
// vehicle, delete account — had no origin check at all. SameSite=Lax hides that
// in a current browser by withholding the cookie, but Lax is same-SITE: a
// foothold on any parktag.me subdomain is same-site and keeps the cookie, and
// then nothing is checking. Fixed by widening the hook.
//
// #3, NOT real, and these tests are what establishes that: the finding said the
// vault PIN had "no lockout, no backoff". It has both — reused from the sign-in
// lockout under its own "vault" role, in the vault's original commit. The
// finding counted ten wrong PINs and saw no lock because the lock is checked
// BEFORE the failure is recorded, so the tenth attempt still answers "incorrect"
// and the eleventh is the one that is refused. Rather than change working code,
// the behaviour is pinned here so it cannot regress unnoticed.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-csrf-owner@parktag-test.invalid");
const EVIL_ORIGIN = "https://evil.example.com";
const VAULT_PIN = "8317";

let app;
let collections;
let owner;
let cookie;
let tagId;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});

  owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });

  const tag = await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: "QA01CS0001",
    status: "active",
    token: "qa-csrf-token-0001",
    createdAt: new Date().toISOString()
  });
  tagId = String(tag.insertedId);
});

function call(method, url, { origin, payload } = {}) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    ...(origin ? { headers: { origin } } : {}),
    ...(payload === undefined ? {} : { payload })
  });
}

describe("finding #2 — the origin check reaches the signed-in actions", () => {
  // Each of these is a real state-changing owner route, one per HTTP method the
  // dashboard actually uses, so a method slipping out of the guard is caught.
  const forgeable = [
    ["POST", () => `/api/owner/tags/${tagId}/status`, { status: "inactive" }],
    ["POST", () => `/api/owner/tags/${tagId}/emergency-contact`, { emergencyContact: "+919812345678" }],
    ["DELETE", () => `/api/owner/tags/${tagId}`, undefined],
    ["PATCH", () => "/api/owner/profile", { displayName: "Attacker" }],
    ["DELETE", () => "/api/owner/account", {}]
  ];

  for (const [method, path, payload] of forgeable) {
    test(`${method} ${path().replace(tagId, ":tagId")} is refused from another origin`, async () => {
      const response = await call(method, path(), { origin: EVIL_ORIGIN, payload });

      assert.equal(
        response.statusCode,
        403,
        `a cross-origin ${method} was allowed through: ${response.statusCode} ${response.body}`
      );
      assert.match(response.json().error, /did not come from the ParkTag site/);
    });
  }

  test("the forged call really would have worked without the guard", async () => {
    // Otherwise the 403s above could be any old rejection — a 404, a validation
    // error — and would still pass. Same request, honest origin, must succeed.
    const response = await call("POST", `/api/owner/tags/${tagId}/status`, {
      origin: "http://localhost",
      payload: { status: "inactive" }
    });

    assert.equal(response.statusCode, 200, `same-origin call failed: ${response.body}`);
    assert.equal(response.json().ok, true);
  });

  test("the site's own pages still work", async () => {
    // The dashboard sends Origin on every fetch it makes. If self-origin were
    // not accepted, this guard would break the whole signed-in app.
    const response = await call("PATCH", "/api/owner/profile", {
      origin: "http://localhost",
      payload: { displayName: "Kanchan" }
    });

    assert.equal(response.statusCode, 200, `the app blocked itself: ${response.body}`);
  });

  test("a caller that sends no Origin or Referer is still allowed", async () => {
    // curl, the operational scripts, server-to-server. These are not requests an
    // attacker can make a victim's browser send, and blocking them would break
    // tooling while stopping nothing.
    const response = await call("POST", `/api/owner/tags/${tagId}/status`, {
      payload: { status: "inactive" }
    });

    assert.equal(response.statusCode, 200, `a headerless call was blocked: ${response.body}`);
  });

  test("GET is not swept in", async () => {
    // Reading is not state-changing, and blocking cross-site GET would break
    // ordinary navigation into the app.
    const response = await call("GET", "/api/owner/dashboard", { origin: EVIL_ORIGIN });

    assert.notEqual(response.statusCode, 403, "a cross-site GET was blocked");
  });

  test("admin actions are covered too", async () => {
    // Same defect, higher privilege. 403 is the origin check; anything else
    // means the request got as far as the admin session guard, i.e. past it.
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/tags/issue",
      remoteAddress: uniqueAddress(),
      headers: { origin: EVIL_ORIGIN },
      payload: { count: 1 }
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.json().error, /did not come from the ParkTag site/);
  });

  test("the provider webhooks are NOT covered", async () => {
    // Exotel and Meta post from their own origins by design and authenticate
    // with their own secrets. Sweeping them in would reject every callback and
    // silently break masked calling.
    const response = await app.inject({
      method: "POST",
      url: "/api/provider/exotel/webhook",
      remoteAddress: uniqueAddress(),
      headers: { origin: EVIL_ORIGIN },
      payload: {}
    });

    assert.notEqual(
      response.statusCode,
      403,
      "the origin check reached a webhook — provider callbacks would stop working"
    );
  });
});

describe("finding #3 — the vault PIN lockout that the audit reported missing", () => {
  async function unlock(pin) {
    return app.inject({
      method: "POST",
      url: "/api/owner/vault/unlock",
      // A fresh source address per attempt on purpose: it takes the per-IP rate
      // limit out of the picture, so what is measured is the per-ACCOUNT
      // lockout. That is the control that matters — credential stuffing runs
      // from a rotating pool of addresses and a per-IP limit never sees it.
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      payload: { pin }
    });
  }

  beforeEach(async () => {
    await app.inject({
      method: "POST",
      url: "/api/owner/vault/pin",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie },
      payload: { pin: VAULT_PIN }
    });
  });

  test("wrong PINs lock the account, and rotating IPs does not help", async () => {
    const codes = [];
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      codes.push((await unlock("0000")).statusCode);
    }

    // The first ten are answered "incorrect": the lock is read before the
    // failure is recorded, so the tenth attempt — the one that trips it — still
    // gets the ordinary answer. Counting ten and stopping is what made the audit
    // report no lockout at all.
    assert.deepEqual(
      codes.slice(0, 10),
      Array(10).fill(401),
      `expected ten 401s before the lock, got ${codes.join(",")}`
    );
    assert.equal(
      codes[10],
      429,
      `the 11th wrong PIN was not refused — there is no account lockout: ${codes.join(",")}`
    );
  });

  test("the lockout carries a retry delay rather than just refusing", async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) await unlock("0000");

    const locked = await unlock("0000");
    const body = locked.json();

    assert.equal(locked.statusCode, 429);
    assert.ok(
      body.retryAfterSeconds > 0,
      "no retryAfterSeconds, so the client cannot tell the owner when to come back"
    );
    // 15 minutes is the base lockout; the backoff doubles it for repeat rounds.
    assert.ok(
      body.retryAfterSeconds > 60,
      `backoff is only ${body.retryAfterSeconds}s — too short to slow a brute force`
    );
  });

  test("a locked vault refuses the CORRECT PIN too", async () => {
    // A lockout that still opens for the right PIN is not a lockout: an attacker
    // who guesses it on attempt 11 would be let in.
    for (let attempt = 1; attempt <= 11; attempt += 1) await unlock("0000");

    const response = await unlock(VAULT_PIN);

    assert.equal(response.statusCode, 429, "the correct PIN opened a locked vault");
  });

  test("the vault counter is separate from the sign-in counter", async () => {
    // Failing your PIN must not lock you out of the app itself, or a nuisance
    // becomes a denial of service on the whole account.
    for (let attempt = 1; attempt <= 11; attempt += 1) await unlock("0000");

    assert.equal((await unlock("0000")).statusCode, 429, "precondition: vault is locked");

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/owner/dashboard",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie }
    });

    assert.equal(dashboard.statusCode, 200, "a locked vault locked the owner out of the app");
  });

  test("a correct PIN clears the failure counter", async () => {
    for (let attempt = 1; attempt <= 9; attempt += 1) await unlock("0000");

    assert.equal((await unlock(VAULT_PIN)).statusCode, 200, "the right PIN was refused");

    // If the nine failures still stood, two more would lock the account.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      assert.equal(
        (await unlock("0000")).statusCode,
        401,
        "the counter survived a successful unlock, so ordinary typos accumulate forever"
      );
    }
  });
});
