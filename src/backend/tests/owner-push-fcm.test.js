// Native app push: the token routes, the FCM v1 sender and the hooks that fire
// it. FCM itself is never reached; globalThis.fetch is stubbed per test and
// the service account is a key pair generated here.
import test, { before, after, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, createTestOwner, purgeLoginCollections, uniqueAddress, TEST_ORIGIN } from "./helpers.js";
import { createSession, sessionHash } from "../lib/auth/session.js";
import { buildFcmMessage, isDeadTokenResponse, pushBody, sendOwnerPush } from "../lib/integrations/fcm.js";
import { createContactAction } from "../lib/core/contact-actions.js";
import { recordLockedAttempt } from "../lib/core/locked-tag-nudge.js";
import { MAX_PUSH_TOKENS_PER_OWNER } from "../routes/owner/push.js";

const MARK = `push-${Date.now()}`;
const PLATE = "MH12AB3456";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
  project_id: "parktag-test",
  client_email: "push@parktag-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" })
});

let app;
let env;
let collections;
let realFetch;
let fcmCalls;
let fcmReply; // (token) => { status, body }

before(async () => {
  ({ app, env, collections } = await startTestApp());
  realFetch = globalThis.fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  await purgeLoginCollections(collections);
  await collections.pushTokens.deleteMany({}).catch(() => {});
  await collections.tags.deleteMany({ testMarker: MARK }).catch(() => {});
  await collections.contactRequests.deleteMany({ testMarker: MARK }).catch(() => {});
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.pushTokens.deleteMany({});
  fcmCalls = [];
  fcmReply = () => ({ status: 200, body: { name: "projects/parktag-test/messages/1" } });
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "test-access", expires_in: 3600 });
    }
    if (href.startsWith("https://fcm.googleapis.com/")) {
      const body = JSON.parse(options.body);
      fcmCalls.push({ url: href, headers: options.headers, body });
      const { status, body: reply } = fcmReply(body.message.token);
      return Response.json(reply, { status });
    }
    // WhatsApp, geo lookups and anything else: down.
    return new Response("down", { status: 500 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const pushEnv = () => ({ ...env, fcmServiceAccountJson: SERVICE_ACCOUNT });

async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function ownerWithCookie(email) {
  const owner = await createTestOwner(collections, { email });
  const cookie = await createSession(app, { id: String(owner._id), role: "owner", email });
  return { owner, cookie };
}

function call(method, cookie, payload, headers = {}) {
  return app.inject({
    method,
    url: "/api/owner/push-tokens",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers,
    payload
  });
}

async function seedTokens(ownerId, tokens) {
  await collections.pushTokens.insertMany(
    tokens.map((token, i) => ({ token, ownerId, platform: "android", sessionHash: "x", createdAt: new Date(), updatedAt: new Date(Date.now() - (tokens.length - i) * 1000) }))
  );
}

describe("token routes", () => {
  test("a signed-in owner registers a token without an Origin header", async () => {
    const { owner, cookie } = await ownerWithCookie("push-a@parktag-test.invalid");
    const res = await call("POST", cookie, { token: "tok:A_1-x", platform: "android" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });

    const row = await collections.pushTokens.findOne({ token: "tok:A_1-x" });
    assert.equal(String(row.ownerId), String(owner._id));
    assert.equal(row.sessionHash, sessionHash(cookie));
    assert.ok(row.updatedAt instanceof Date);
  });

  test("a foreign Origin is refused and nothing is stored", async () => {
    const { cookie } = await ownerWithCookie("push-csrf@parktag-test.invalid");
    const res = await call("POST", cookie, { token: "tok-csrf", platform: "android" }, { origin: "https://evil.example" });
    assert.equal(res.statusCode, 403);
    assert.equal(await collections.pushTokens.countDocuments({ token: "tok-csrf" }), 0);
  });

  test("no session, or a malformed token, is refused", async () => {
    const anon = await app.inject({ method: "POST", url: "/api/owner/push-tokens", remoteAddress: uniqueAddress(), payload: { token: "t", platform: "android" } });
    assert.equal(anon.statusCode, 401);

    const { cookie } = await ownerWithCookie("push-bad@parktag-test.invalid");
    for (const payload of [{ token: "has space", platform: "android" }, { token: "", platform: "android" }, { token: "ok", platform: "pc" }, { token: { $ne: null }, platform: "android" }]) {
      const res = await call("POST", cookie, payload, { origin: TEST_ORIGIN });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
    }
    assert.equal(await collections.pushTokens.countDocuments({}), 0);
  });

  test("a token another owner held moves to the caller", async () => {
    const a = await ownerWithCookie("push-owner-a@parktag-test.invalid");
    const b = await ownerWithCookie("push-owner-b@parktag-test.invalid");
    await call("POST", a.cookie, { token: "shared-device", platform: "android" });
    await call("POST", b.cookie, { token: "shared-device", platform: "android" });

    const rows = await collections.pushTokens.find({ token: "shared-device" }).toArray();
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].ownerId), String(b.owner._id));
  });

  test("an owner never holds more than the cap; the oldest go", async () => {
    const { owner, cookie } = await ownerWithCookie("push-cap@parktag-test.invalid");
    await seedTokens(owner._id, Array.from({ length: MAX_PUSH_TOKENS_PER_OWNER }, (_, i) => `old-${i}`));

    const res = await call("POST", cookie, { token: "newest", platform: "android" });
    assert.equal(res.statusCode, 200);
    const tokens = (await collections.pushTokens.find({ ownerId: owner._id }).toArray()).map((r) => r.token);
    assert.equal(tokens.length, MAX_PUSH_TOKENS_PER_OWNER);
    assert.ok(tokens.includes("newest"));
    assert.ok(!tokens.includes("old-0"), "the oldest was dropped");
  });

  test("DELETE removes only the caller's own token", async () => {
    const a = await ownerWithCookie("push-del-a@parktag-test.invalid");
    const b = await ownerWithCookie("push-del-b@parktag-test.invalid");
    await seedTokens(a.owner._id, ["a-device"]);
    await seedTokens(b.owner._id, ["b-device"]);

    const other = await call("DELETE", a.cookie, { token: "b-device" });
    assert.equal(other.statusCode, 200);
    assert.equal(await collections.pushTokens.countDocuments({ token: "b-device" }), 1);

    const own = await call("DELETE", a.cookie, { token: "a-device" });
    assert.equal(own.statusCode, 200);
    assert.equal(await collections.pushTokens.countDocuments({ token: "a-device" }), 0);
  });

  test("logout deletes that session's tokens", async () => {
    const { cookie } = await ownerWithCookie("push-logout@parktag-test.invalid");
    await call("POST", cookie, { token: "logout-device", platform: "android" });

    const res = await app.inject({ method: "POST", url: "/api/auth/logout", remoteAddress: uniqueAddress(), cookies: { wavetag_session: cookie } });
    assert.ok(res.statusCode < 400);
    assert.equal(await collections.pushTokens.countDocuments({ token: "logout-device" }), 0);
  });

  test("revoke-others deletes the other sessions' tokens and keeps the caller's", async () => {
    const { owner, cookie } = await ownerWithCookie("push-revoke@parktag-test.invalid");
    const otherCookie = await createSession(app, { id: String(owner._id), role: "owner", email: owner.email });
    await call("POST", cookie, { token: "this-device", platform: "android" });
    await call("POST", otherCookie, { token: "other-device", platform: "android" });

    const res = await app.inject({ method: "POST", url: "/api/owner/sessions/revoke-others", remoteAddress: uniqueAddress(), cookies: { wavetag_session: cookie } });
    assert.equal(res.statusCode, 200);
    assert.equal(await collections.pushTokens.countDocuments({ token: "other-device" }), 0);
    assert.equal(await collections.pushTokens.countDocuments({ token: "this-device" }), 1);
  });
});

describe("the FCM sender", () => {
  test("message shape: tag and channel_id under android.notification only", () => {
    const msg = buildFcmMessage("t1", { title: "Title", body: "Body", data: { type: "contact", tagId: "a", requestId: "r", extra: "x" }, collapseKey: "r" }).message;
    assert.deepEqual(Object.keys(msg.notification).sort(), ["body", "title"]);
    assert.deepEqual(msg.data, { type: "contact", tagId: "a", requestId: "r" });
    assert.equal(msg.android.priority, "HIGH");
    assert.equal(msg.android.ttl, "600s");
    assert.equal(msg.android.collapse_key, "r");
    assert.deepEqual(msg.android.notification, { tag: "r", channel_id: "parktag_alerts" });
  });

  test("sends one request per token with the v1 shape", async () => {
    const ownerId = new ObjectId();
    await seedTokens(ownerId, ["d1", "d2"]);
    const result = await sendOwnerPush(pushEnv(), collections, ownerId, { title: "T", body: "B", data: { type: "contact", tagId: "x", requestId: "y" }, collapseKey: "y" });

    assert.deepEqual(result, { sent: 2 });
    assert.equal(fcmCalls.length, 2);
    assert.equal(fcmCalls[0].url, "https://fcm.googleapis.com/v1/projects/parktag-test/messages:send");
    assert.equal(fcmCalls[0].headers.authorization, "Bearer test-access");
    assert.deepEqual(Object.keys(fcmCalls[0].body.message.notification).sort(), ["body", "title"]);
    assert.equal(fcmCalls[0].body.message.android.notification.channel_id, "parktag_alerts");
  });

  test("dead tokens are pruned, a generic INVALID_ARGUMENT prunes nothing", async () => {
    const ownerId = new ObjectId();
    await seedTokens(ownerId, ["gone", "bad-field", "payload-bug", "fine"]);
    fcmReply = (token) => {
      if (token === "gone") return { status: 404, body: { error: { code: 404, status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } } };
      if (token === "bad-field") return { status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.token" }] }] } } };
      if (token === "payload-bug") return { status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "INVALID_ARGUMENT" }] } } };
      return { status: 200, body: {} };
    };

    const result = await sendOwnerPush(pushEnv(), collections, ownerId, { title: "T", body: "B", data: {} });
    assert.deepEqual(result, { sent: 1 });
    const left = (await collections.pushTokens.find({ ownerId }).toArray()).map((r) => r.token).sort();
    assert.deepEqual(left, ["fine", "payload-bug"]);
  });

  test("a generic 400 for every token leaves every row", async () => {
    const ownerId = new ObjectId();
    await seedTokens(ownerId, ["k1", "k2"]);
    fcmReply = () => ({ status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } } });
    await sendOwnerPush(pushEnv(), collections, ownerId, { title: "T", body: "B", data: {} });
    assert.equal(await collections.pushTokens.countDocuments({ ownerId }), 2);
    assert.equal(isDeadTokenResponse(404, { error: { status: "NOT_FOUND" } }), false);
  });

  test("without FCM_SERVICE_ACCOUNT_JSON nothing is sent and nothing throws", async () => {
    const ownerId = new ObjectId();
    await seedTokens(ownerId, ["n1"]);
    assert.deepEqual(await sendOwnerPush({ ...env, fcmServiceAccountJson: "" }, collections, ownerId, { title: "T", body: "B" }), { sent: 0 });
    assert.deepEqual(await sendOwnerPush({ ...env, fcmServiceAccountJson: "{not json" }, collections, ownerId, { title: "T", body: "B" }), { sent: 0 });
    assert.equal(fcmCalls.length, 0);
  });

  test("a 401 drops the cached access token and retries once with a fresh one; a rotated key never reuses a token", async () => {
    const ownerId = new ObjectId();
    await seedTokens(ownerId, ["r1", "r2"]);
    // Same client_email, new private key: must not reuse the cached token.
    const rotated = JSON.stringify({
      ...JSON.parse(SERVICE_ACCOUNT),
      private_key: crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" })
    });
    let exchanges = 0;
    const bearers = [];
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        exchanges += 1;
        return Response.json({ access_token: `fresh-${exchanges}`, expires_in: 3600 });
      }
      bearers.push(options.headers.authorization);
      const ok = options.headers.authorization !== "Bearer fresh-1";
      return Response.json(ok ? {} : { error: { code: 401, status: "UNAUTHENTICATED" } }, { status: ok ? 200 : 401 });
    };

    const result = await sendOwnerPush({ ...env, fcmServiceAccountJson: rotated }, collections, ownerId, { title: "T", body: "B" });
    assert.deepEqual(result, { sent: 2 });
    assert.equal(exchanges, 2);
    assert.deepEqual(bearers, ["Bearer fresh-1", "Bearer fresh-1", "Bearer fresh-2", "Bearer fresh-2"]);
    assert.equal(await collections.pushTokens.countDocuments({ ownerId }), 2, "an auth failure prunes nothing");

    // The original key gets its own token, not the rotated key's cached one.
    await sendOwnerPush(pushEnv(), collections, ownerId, { title: "T", body: "B" });
    assert.equal(exchanges, 3);
  });

  test("a network failure resolves, never rejects", async () => {
    const ownerId = new ObjectId();
    await seedTokens(ownerId, ["net"]);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.deepEqual(await sendOwnerPush(pushEnv(), collections, ownerId, { title: "T", body: "B" }), { sent: 0 });
  });

  test("the body is the masked plate, and never a phone-length digit run", () => {
    assert.equal(pushBody(PLATE, "Koregaon Park"), "MH12AB#### · Near Koregaon Park");
    assert.equal(pushBody(PLATE, "call 9876543210 now"), "MH12AB#### · Near call now");
  });
});

describe("hooks", () => {
  async function ownerAndTag(extraOwner = {}, extraTag = {}) {
    const owner = await createTestOwner(collections, { email: `${MARK}-${crypto.randomBytes(4).toString("hex")}@parktag-test.invalid`, mobile: "+919812345678", ...extraOwner });
    const tag = {
      _id: new ObjectId(),
      token: `${MARK}-${crypto.randomBytes(6).toString("hex")}`,
      ownerId: owner._id,
      plateNumber: PLATE,
      status: "active",
      testMarker: MARK,
      createdAt: new Date().toISOString(),
      ...extraTag
    };
    await collections.tags.insertOne(tag);
    await seedTokens(owner._id, ["hook-1", "hook-2"]);
    return { owner, tag };
  }

  function assertPrivate(calls, tag) {
    for (const c of calls) {
      const text = JSON.stringify(c.body);
      assert.ok(!/\d{10,}/.test(text), "no phone-length digit run");
      assert.ok(!text.includes(PLATE), "no full plate");
      assert.ok(!text.includes(tag.token), "no tag token");
      assert.deepEqual(Object.keys(c.body.message.data).filter((k) => !["type", "tagId", "requestId"].includes(k)), []);
    }
  }

  test("a contact request pushes even when WhatsApp and e-mail both fail, and push changes nothing else", async () => {
    const { tag } = await ownerAndTag();
    // WhatsApp configured but its fetch fails; e-mail unconfigured in production throws.
    const failingEnv = { ...pushEnv(), runtimeMode: "production", metaWhatsappPhoneNumberId: "1", metaWhatsappAccessToken: "x" };

    await assert.rejects(
      createContactAction(failingEnv, { token: tag.token, action: "message", messageChannel: "whatsapp", reason: "lights" }),
      /Could not reach the owner/
    );
    await waitFor(() => fcmCalls.length >= 2);
    assert.equal(fcmCalls.length, 2, "one FCM call per token");
    assert.equal(fcmCalls[0].body.message.notification.title, "The vehicle's lights appear to be on");
    assert.equal(fcmCalls[0].body.message.data.type, "contact");
    assertPrivate(fcmCalls, tag);

    const row = await collections.contactRequests.findOne({ token: tag.token });
    assert.equal(row.status, "provider_failed");
    await collections.contactRequests.deleteMany({ token: tag.token });
  });

  test("an FCM failure leaves a delivered contact request as it was", async () => {
    const { owner, tag } = await ownerAndTag({ mobile: null });
    fcmReply = () => ({ status: 500, body: { error: { status: "INTERNAL" } } });

    // Dev mode with no e-mail transport logs and resolves, so e-mail "reaches" the owner.
    const result = await createContactAction(pushEnv(), { token: tag.token, action: "message", messageChannel: "whatsapp", reason: "towing" });
    await waitFor(() => fcmCalls.length >= 2);
    assert.equal(fcmCalls.length, 2);
    const row = await collections.contactRequests.findOne({ token: tag.token });
    assert.equal(row.status, "provider_started");
    assert.ok(result);
    assert.equal(await collections.pushTokens.countDocuments({ ownerId: owner._id }), 2, "a 500 prunes nothing");
    await collections.contactRequests.deleteMany({ token: tag.token });
  });

  test("a locked attempt pushes without WhatsApp consent, once a day", async () => {
    const { tag } = await ownerAndTag({ messagingHardStop: true });
    const send = async () => false; // the WhatsApp/e-mail nudge: refused
    const now = Date.now();

    await recordLockedAttempt(pushEnv(), collections, tag, null, { send, now });
    await waitFor(() => fcmCalls.length >= 2);
    assert.equal(fcmCalls.length, 2);
    assert.equal(fcmCalls[0].body.message.data.type, "locked");
    assertPrivate(fcmCalls, tag);

    // The nudge stamp is released (nothing reached the owner), but the push
    // keeps its own: a second scan inside the day pushes nothing.
    await recordLockedAttempt(pushEnv(), collections, tag, null, { send, now: now + 60 * 60 * 1000 });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fcmCalls.length, 2);

    await recordLockedAttempt(pushEnv(), collections, tag, null, { send, now: now + 25 * 60 * 60 * 1000 });
    await waitFor(() => fcmCalls.length >= 4);
    assert.equal(fcmCalls.length, 4, "a day later it pushes again");
  });
});
