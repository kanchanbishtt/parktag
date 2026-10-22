// Firebase App Check as the native app's alternative to reCAPTCHA on
// POST /api/auth/send-otp.
//
// The JWKS is stubbed with a locally generated RSA key, so nothing here talks
// to Google. The route runs against a production-mode env with reCAPTCHA
// configured, which is the only setting where the bypass matters: a token that
// fails ANY check must land on the existing reCAPTCHA path, and with no
// recaptchaToken that path refuses with code CAPTCHA_REQUIRED.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";

import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { registerOtpAuthRoutes } from "../routes/auth/otp.js";
import { APPCHECK_JWKS_URL, resetAppCheckJwksCache } from "../lib/integrations/appcheck.js";
import { assertDisposableDatabase, assertUndeliverableIdentifier, uniqueAddress } from "./helpers.js";

const PROJECT_NUMBER = "123456789012";
const RELEASE_APP_ID = "1:123456789012:android:release";
const DEBUG_APP_ID = "1:123456789012:android:debug";
const KID = "test-kid";

const signingKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...signingKey.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

let app;
let env;
let collections;
let realFetch;
let recaptchaResponse;
let recaptchaCalls;
let jwksKeys = [jwk];
let jwksFetches = 0;

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeToken(overrides = {}, { key = signingKey.privateKey, header = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
    aud: [`projects/${PROJECT_NUMBER}`, "projects/parktag-test"],
    sub: RELEASE_APP_ID,
    iat: now,
    exp: now + 3600,
    jti: crypto.randomUUID(),
    ...overrides
  };
  const signingInput = `${b64url({ alg: "RS256", typ: "JWT", kid: KID, ...header })}.${b64url(payload)}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), key).toString("base64url");
  return `${signingInput}.${signature}`;
}

let emailCounter = 0;
function freshEmail() {
  emailCounter += 1;
  return assertUndeliverableIdentifier(`appcheck-${Date.now()}-${emailCounter}@parktag-test.invalid`);
}

function sendOtp({ identifier = freshEmail(), recaptchaToken, appCheck } = {}) {
  const headers = appCheck ? { "x-firebase-appcheck": appCheck } : {};
  const payload = { identifier };
  if (recaptchaToken !== undefined) payload.recaptchaToken = recaptchaToken;
  return app.inject({ method: "POST", url: "/api/auth/send-otp", remoteAddress: uniqueAddress(), headers, payload });
}

before(async () => {
  assertDisposableDatabase();
  env = {
    ...getEnv(),
    runtimeMode: "production",
    recaptchaSiteKey: "site-key",
    recaptchaSecret: "secret",
    firebaseProjectNumber: PROJECT_NUMBER,
    appCheckAppIds: RELEASE_APP_ID
  };
  collections = await getCollections(env);
  await collections.appCheckJti.createIndex({ jti: 1 }, { unique: true, name: "jti_unique" });

  realFetch = global.fetch;
  global.fetch = async url => {
    if (String(url) === APPCHECK_JWKS_URL) {
      jwksFetches += 1;
      return new Response(JSON.stringify({ keys: jwksKeys }));
    }
    if (String(url).includes("recaptcha/api/siteverify")) {
      recaptchaCalls += 1;
      return new Response(JSON.stringify(recaptchaResponse));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  resetAppCheckJwksCache();

  app = Fastify();
  registerOtpAuthRoutes(app, env);
  await app.ready();
});

beforeEach(() => {
  recaptchaCalls = 0;
  recaptchaResponse = { success: false, "error-codes": ["invalid-input-response"] };
});

after(async () => {
  global.fetch = realFetch;
  await collections.otpTokens.deleteMany({ identifier: /@parktag-test\.invalid$/ }).catch(() => {});
  await collections.appCheckJti.deleteMany({}).catch(() => {});
  await app.close();
  await closeMongoConnection();
});

describe("a valid App Check token", () => {
  test("sends the code without a recaptchaToken in production", async () => {
    const res = await sendOtp({ appCheck: makeToken() });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().ok, true);
    assert.equal(recaptchaCalls, 0, "reCAPTCHA must be skipped");
  });

  test("does not lift the per-destination 5/hour cap", async () => {
    const identifier = freshEmail();
    // Spread past the 20s duplicate-submit reuse window so each one counts.
    const base = Date.now() - 30 * 60 * 1000;
    await collections.otpTokens.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        identifier,
        purpose: "auth",
        codeHash: "x",
        used: true,
        attempts: 0,
        createdAt: new Date(base + i * 60 * 1000).toISOString(),
        expiresAt: new Date(base + i * 60 * 1000 + 600000).toISOString()
      }))
    );
    const res = await sendOtp({ identifier, appCheck: makeToken() });
    assert.equal(res.statusCode, 500);
    assert.match(res.json().error, /Too many verification codes/);
  });
});

describe("a bad App Check token falls through to reCAPTCHA", () => {
  const cases = {
    expired: () => makeToken({ exp: Math.floor(Date.now() / 1000) - 10 }),
    "wrong aud": () => makeToken({ aud: ["projects/999"] }),
    "wrong iss": () => makeToken({ iss: "https://firebaseappcheck.googleapis.com/999" }),
    "wrong sub (debug app id in production)": () => makeToken({ sub: DEBUG_APP_ID }),
    "bad signature": () => makeToken({}, { key: otherKey.privateKey }),
    "wrong alg": () => makeToken({}, { header: { alg: "HS256" } }),
    "unknown kid": () => makeToken({}, { header: { kid: "nope" } }),
    garbage: () => "not.a.jwt"
  };

  for (const [name, build] of Object.entries(cases)) {
    test(`${name}: 400 CAPTCHA_REQUIRED without a recaptchaToken`, async () => {
      const res = await sendOtp({ appCheck: build() });
      assert.equal(res.statusCode, 400, res.body);
      assert.equal(res.json().code, "CAPTCHA_REQUIRED");
    });
  }

  test("a reused jti is refused the second time", async () => {
    const token = makeToken();
    const first = await sendOtp({ appCheck: token });
    assert.equal(first.statusCode, 200, first.body);
    const second = await sendOtp({ appCheck: token });
    assert.equal(second.statusCode, 400);
    assert.equal(second.json().code, "CAPTCHA_REQUIRED");
  });

  test("a bad token with a passing recaptchaToken still sends", async () => {
    recaptchaResponse = { success: true, score: 0.9, action: "send_otp" };
    const res = await sendOtp({ appCheck: makeToken({ sub: DEBUG_APP_ID }), recaptchaToken: "rc" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(recaptchaCalls, 1);
  });
});

describe("the web flow is unchanged", () => {
  test("a passing recaptchaToken with no header sends", async () => {
    recaptchaResponse = { success: true, score: 0.9, action: "send_otp" };
    const res = await sendOtp({ recaptchaToken: "rc" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(recaptchaCalls, 1);
  });

  test("a failing recaptchaToken is refused with CAPTCHA_REQUIRED", async () => {
    const res = await sendOtp({ recaptchaToken: "rc" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, "CAPTCHA_REQUIRED");
  });

  test("a missing recaptchaToken is refused with CAPTCHA_REQUIRED", async () => {
    const res = await sendOtp();
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, "CAPTCHA_REQUIRED");
  });

  test("'identifier required' carries no CAPTCHA_REQUIRED code", async () => {
    const res = await sendOtp({ identifier: "", appCheck: makeToken() });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, undefined);
    assert.match(res.json().error, /required/);
  });

  test("a User-Agent claiming to be the app bypasses nothing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/send-otp",
      remoteAddress: uniqueAddress(),
      headers: { "user-agent": "ParkTag-Android/1.0 me.parktag.app" },
      payload: { identifier: freshEmail() }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, "CAPTCHA_REQUIRED");
  });
});

describe("Google rotates its App Check signing key", () => {
  test("an unknown kid refetches the JWKS once, then waits out the cooldown", async () => {
    resetAppCheckJwksCache();
    jwksKeys = [jwk];
    jwksFetches = 0;
    try {
      const primed = await sendOtp({ appCheck: makeToken() });
      assert.equal(primed.statusCode, 200, primed.body);
      assert.equal(jwksFetches, 1);

      // A key published after our cached fetch is accepted without waiting 6h.
      const rotatedKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const rotatedJwk = { ...rotatedKey.publicKey.export({ format: "jwk" }), kid: "rotated-kid", alg: "RS256", use: "sig" };
      jwksKeys = [jwk, rotatedJwk];
      const rotated = await sendOtp({
        appCheck: makeToken({}, { key: rotatedKey.privateKey, header: { kid: "rotated-kid" } })
      });
      assert.equal(rotated.statusCode, 200, rotated.body);
      assert.equal(jwksFetches, 2);

      // A forged kid inside the cooldown does not reach Google again.
      const forged = await sendOtp({ appCheck: makeToken({}, { header: { kid: "forged" } }) });
      assert.equal(forged.statusCode, 400);
      assert.equal(forged.json().code, "CAPTCHA_REQUIRED");
      assert.equal(jwksFetches, 2);
    } finally {
      jwksKeys = [jwk];
      resetAppCheckJwksCache();
    }
  });
});
