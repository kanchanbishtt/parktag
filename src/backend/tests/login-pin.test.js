// Tests for the login PIN: the numeric credential that signs an owner in at
// their existing mobile number or email address.
//
// The rules being pinned here are the ones that make it safe to have a
// six-digit secret as a whole authentication factor. A PIN is a small enough
// space that the controls around it ARE the security — so this file cares much
// less about "the happy path works" and much more about the shapes that would
// quietly hand an attacker an edge: an enumeration oracle, a spray that no
// per-account counter can see, a credential change that a stolen cookie can
// make on its own, or the login PIN and the vault PIN collapsing into one
// secret and taking the vault's second factor with them.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  clearLoginLock,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { getSprayLock, recordSprayFailure } from "../lib/auth/spray-lockout.js";
import {
  isValidLoginPin,
  isWeakLoginPin,
  LOGIN_PIN_MIN_DIGITS,
  LOGIN_PIN_MAX_DIGITS
} from "../lib/auth/login-pin.js";

const PIN = "748193";
const NEW_PIN = "305826";
const PASSWORD = "login-pin-legacy-password-9f2a";

const PIN_OWNER_EMAIL = "login-pin-owner@parktag-test.invalid";
const MOBILE_OWNER_EMAIL = "login-pin-mobile@parktag-test.invalid";
const MOBILE_OWNER_NUMBER = "+919812345670";
const LEGACY_EMAIL = "login-pin-legacy@parktag-test.invalid";
const VAULT_EMAIL = "login-pin-vault@parktag-test.invalid";
const UNKNOWN_EMAIL = "login-pin-nobody@parktag-test.invalid";

let app;
let collections;

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

function post(url, payload, address = uniqueAddress(), cookie = null) {
  const headers = { origin: TEST_ORIGIN };
  if (cookie) headers.cookie = cookie;
  return app.inject({ method: "POST", url, remoteAddress: address, payload, headers });
}

function del(url, payload, cookie) {
  return app.inject({
    method: "DELETE",
    url,
    remoteAddress: uniqueAddress(),
    payload,
    headers: { origin: TEST_ORIGIN, cookie }
  });
}

function get(url, cookie) {
  return app.inject({
    method: "GET",
    url,
    remoteAddress: uniqueAddress(),
    headers: cookie ? { cookie } : {}
  });
}

function sessionCookie(response) {
  const cookie = response.cookies.find((c) => c.name === "wavetag_session");
  return cookie ? `wavetag_session=${cookie.value}` : null;
}

// Sign in with a password to obtain a session, then set a PIN through the API
// the screen uses. Deliberately NOT written straight into Mongo: the point is
// that the route produces a credential the login path accepts.
async function signInAndSetPin(email, password, pin) {
  await clearLoginLock(collections, email);

  const login = await post("/api/auth/login", { identifier: email, pin: password });
  assert.equal(login.statusCode, 200, `fixture sign-in failed: ${login.body}`);

  const cookie = sessionCookie(login);
  const set = await post("/api/owner/login-pin", { pin, confirmPin: pin }, uniqueAddress(), cookie);
  assert.equal(set.statusCode, 200, `fixture PIN set failed: ${set.body}`);

  return cookie;
}

describe("PIN rules", () => {
  test("six to eight digits, nothing else", () => {
    assert.equal(LOGIN_PIN_MIN_DIGITS, 6);
    assert.equal(LOGIN_PIN_MAX_DIGITS, 8);

    for (const bad of ["", "1234", "12345", "123456789", "12a456", "  123456", null, undefined]) {
      assert.equal(isValidLoginPin(bad), false, `${JSON.stringify(bad)} should be invalid`);
    }
    for (const good of ["748193", "7481930", "74819302"]) {
      assert.equal(isValidLoginPin(good), true, `${good} should be valid`);
    }
  });

  // A four-digit PIN is 10,000 values, which the per-account lockout's ~240
  // guesses a day exhausts in about three weeks. The minimum is what makes the
  // credential survive an unattended attacker, so it is asserted rather than
  // left as a constant somebody can lower without noticing.
  test("a four-digit PIN is refused outright", () => {
    assert.equal(isValidLoginPin("8419"), false);
  });

  test("predictable PINs are refused", () => {
    for (const weak of ["111111", "000000", "123456", "654321", "121212", "123123"]) {
      assert.equal(isWeakLoginPin(weak), true, `${weak} should be weak`);
    }
    assert.equal(isWeakLoginPin("748193"), false);
  });

  // The number is public to anyone who has it, so a PIN cut from it is the
  // identifier typed twice rather than a secret.
  test("digits taken from the owner's own number are refused", () => {
    assert.equal(isWeakLoginPin("812345", { mobile: "+919812345670" }), true);
    assert.equal(isWeakLoginPin("345670", { mobile: "+919812345670" }), true);
    assert.equal(isWeakLoginPin("748193", { mobile: "+919812345670" }), false);
  });
});

describe("signing in with a PIN", () => {
  let cookie;

  before(async () => {
    await createTestOwner(collections, { email: PIN_OWNER_EMAIL, password: PASSWORD });
    cookie = await signInAndSetPin(PIN_OWNER_EMAIL, PASSWORD, PIN);
  });

  after(async () => {
    await collections.owners.deleteMany({ email: PIN_OWNER_EMAIL });
  });

  test("the PIN signs the owner in", async () => {
    await clearLoginLock(collections, PIN_OWNER_EMAIL);

    const response = await post("/api/auth/login", { identifier: PIN_OWNER_EMAIL, pin: PIN });

    assert.equal(response.statusCode, 200, response.body);
    assert.ok(sessionCookie(response), "no session cookie was issued");
  });

  test("a wrong PIN is a 401", async () => {
    await clearLoginLock(collections, PIN_OWNER_EMAIL);

    const response = await post("/api/auth/login", { identifier: PIN_OWNER_EMAIL, pin: "999888" });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "Invalid credentials");
    assert.equal(response.headers["set-cookie"], undefined);
  });

  // The whole reason one field takes both credentials. If the response, the
  // status or the route differed by which credential an account holds, that
  // difference would answer "does this account have a PIN?" for anyone who
  // asked, without ever authenticating.
  test("an unknown account and a wrong PIN are indistinguishable", async () => {
    await clearLoginLock(collections, PIN_OWNER_EMAIL);
    await clearLoginLock(collections, UNKNOWN_EMAIL);

    const wrong = await post("/api/auth/login", { identifier: PIN_OWNER_EMAIL, pin: "999888" });
    const unknown = await post("/api/auth/login", { identifier: UNKNOWN_EMAIL, pin: "999888" });

    assert.equal(wrong.statusCode, unknown.statusCode);
    assert.deepEqual(wrong.json(), unknown.json());
  });

  test("the old field names still work", async () => {
    // A browser holding the pre-deploy login page posts email/password. It has
    // to keep signing in, or shipping this logs those tabs out until they reload.
    await clearLoginLock(collections, PIN_OWNER_EMAIL);

    const response = await post("/api/auth/login", { email: PIN_OWNER_EMAIL, password: PIN });

    assert.equal(response.statusCode, 200, response.body);
  });

  test("the account password still signs in through the PIN field", async () => {
    // Accounts that predate PINs must not lose credential sign-in.
    await clearLoginLock(collections, PIN_OWNER_EMAIL);

    const response = await post("/api/auth/login", { identifier: PIN_OWNER_EMAIL, pin: PASSWORD });

    assert.equal(response.statusCode, 200, response.body);
  });
});

describe("signing in at a mobile number", () => {
  before(async () => {
    await createTestOwner(collections, {
      email: MOBILE_OWNER_EMAIL,
      password: PASSWORD,
      mobile: MOBILE_OWNER_NUMBER,
      mobileVerified: true
    });
    await signInAndSetPin(MOBILE_OWNER_EMAIL, PASSWORD, PIN);
  });

  after(async () => {
    await collections.owners.deleteMany({ email: MOBILE_OWNER_EMAIL });
  });

  // Credential sign-in resolved by e-mail only before this, so an owner who
  // registered by phone could not authenticate here under any circumstances —
  // which would have made a login PIN useless for most of the userbase.
  test("the number signs in, in any of its spellings", async () => {
    // The spellings the sign-in page can actually produce. A leading zero is
    // NOT among them: normalizePhone in otp.js passes "0..." through unchanged
    // — shared with the OTP path, so it is not this feature's to redefine — and
    // the page's own validator refuses an 11-digit number before sending it.
    for (const spelling of ["9812345670", "+919812345670", "919812345670", "98 1234 5670"]) {
      await clearLoginLock(collections, MOBILE_OWNER_NUMBER);

      const response = await post("/api/auth/login", { identifier: spelling, pin: PIN });
      assert.equal(response.statusCode, 200, `${spelling} failed: ${response.body}`);
    }
  });

  // Otherwise each spelling is its own budget, and an attacker resets their
  // allowance by reformatting the number they are already guessing against.
  test("every spelling shares one lockout counter", async () => {
    await clearLoginLock(collections, MOBILE_OWNER_NUMBER);

    // Ten failures is the per-account threshold; spread them across spellings.
    const spellings = ["9812345670", "+919812345670", "98 1234 5670"];
    for (let i = 0; i < 10; i += 1) {
      await post("/api/auth/login", {
        identifier: spellings[i % spellings.length],
        pin: "999888"
      });
    }

    const response = await post("/api/auth/login", { identifier: "9812345670", pin: PIN });
    assert.equal(response.statusCode, 429, `expected a lockout, got ${response.body}`);

    await clearLoginLock(collections, MOBILE_OWNER_NUMBER);
  });
});

describe("managing the PIN", () => {
  let cookie;

  before(async () => {
    await createTestOwner(collections, { email: LEGACY_EMAIL, password: PASSWORD });
    cookie = await signInAndSetPin(LEGACY_EMAIL, PASSWORD, PIN);
  });

  after(async () => {
    await collections.owners.deleteMany({ email: LEGACY_EMAIL });
  });

  test("the status endpoint needs a session", async () => {
    const response = await get("/api/owner/login-pin", null);
    assert.equal(response.statusCode, 401);
  });

  test("the status endpoint never returns the hash", async () => {
    const response = await get("/api/owner/login-pin", cookie);

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.hasPin, true);
    assert.equal(body.loginPinHash, undefined);
    assert.ok(!JSON.stringify(body).includes("$2"), "a bcrypt hash reached the client");
  });

  // A mismatched pair that reached the database would set a credential the
  // owner has never typed and cannot guess — a self-inflicted lockout.
  test("a mismatched confirmation is refused", async () => {
    const response = await post(
      "/api/owner/login-pin",
      { pin: NEW_PIN, confirmPin: "111222", currentPin: PIN },
      uniqueAddress(),
      cookie
    );

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /do not match/i);
  });

  test("a weak PIN is refused by the route, not only the form", async () => {
    const response = await post(
      "/api/owner/login-pin",
      { pin: "123456", confirmPin: "123456", currentPin: PIN },
      uniqueAddress(),
      cookie
    );

    assert.equal(response.statusCode, 400);
  });

  // A stolen cookie must not be enough to replace the credential — otherwise
  // an attacker converts a session that expires into one that does not.
  test("changing a PIN requires the current one", async () => {
    const response = await post(
      "/api/owner/login-pin",
      { pin: NEW_PIN, confirmPin: NEW_PIN, currentPin: "000111" },
      uniqueAddress(),
      cookie
    );

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /current pin/i);
  });

  test("removing a PIN requires the current one", async () => {
    const response = await del("/api/owner/login-pin", { currentPin: "000111" }, cookie);

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /current pin/i);

    const still = await get("/api/owner/login-pin", cookie);
    assert.equal(still.json().hasPin, true, "the PIN was removed without the current one");
  });

  test("the right current PIN changes it, and the new one signs in", async () => {
    const change = await post(
      "/api/owner/login-pin",
      { pin: NEW_PIN, confirmPin: NEW_PIN, currentPin: PIN },
      uniqueAddress(),
      cookie
    );
    assert.equal(change.statusCode, 200, change.body);

    await clearLoginLock(collections, LEGACY_EMAIL);
    const withNew = await post("/api/auth/login", { identifier: LEGACY_EMAIL, pin: NEW_PIN });
    assert.equal(withNew.statusCode, 200, withNew.body);

    await clearLoginLock(collections, LEGACY_EMAIL);
    const withOld = await post("/api/auth/login", { identifier: LEGACY_EMAIL, pin: PIN });
    assert.equal(withOld.statusCode, 401, "the replaced PIN still signs in");
  });
});

describe("the login PIN and the vault PIN stay different secrets", () => {
  let cookie;

  before(async () => {
    await createTestOwner(collections, {
      email: VAULT_EMAIL,
      password: PASSWORD,
      // A 6-digit vault PIN, so it is a legal login PIN too and the clash is
      // reachable. The vault's own minimum is four, which cannot collide.
      vaultPinHash: await createPasswordHash("419273")
    });

    await clearLoginLock(collections, VAULT_EMAIL);
    const login = await post("/api/auth/login", { identifier: VAULT_EMAIL, pin: PASSWORD });
    assert.equal(login.statusCode, 200, login.body);
    cookie = sessionCookie(login);
  });

  after(async () => {
    await collections.owners.deleteMany({ email: VAULT_EMAIL });
  });

  // The vault PIN is a second factor over an already-signed-in session. Sharing
  // one value would mean the credential that gets you in also opens the
  // documents, and the vault would stop being a second factor at all.
  test("the vault PIN cannot be reused as the login PIN", async () => {
    const response = await post(
      "/api/owner/login-pin",
      { pin: "419273", confirmPin: "419273" },
      uniqueAddress(),
      cookie
    );

    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().error, /vault/i);
  });

  test("a different PIN is accepted", async () => {
    const response = await post(
      "/api/owner/login-pin",
      { pin: "560284", confirmPin: "560284" },
      uniqueAddress(),
      cookie
    );

    assert.equal(response.statusCode, 200, response.body);
  });
});

describe("setting a PIN ends other sessions", () => {
  const email = "login-pin-sessions@parktag-test.invalid";

  before(async () => {
    await createTestOwner(collections, { email, password: PASSWORD });
  });

  after(async () => {
    await collections.owners.deleteMany({ email });
  });

  // Two things at once: the owner is not ejected from the screen they are
  // standing at, and anyone holding a second session loses it the moment a
  // credential is created — which is how a stolen cookie becomes visible
  // immediately rather than months later.
  test("the caller stays signed in and the other device does not", async () => {
    await clearLoginLock(collections, email);
    const first = await post("/api/auth/login", { identifier: email, pin: PASSWORD });
    const firstCookie = sessionCookie(first);

    await clearLoginLock(collections, email);
    const second = await post("/api/auth/login", { identifier: email, pin: PASSWORD });
    const secondCookie = sessionCookie(second);

    assert.notEqual(firstCookie, secondCookie, "the two sign-ins shared a session");

    const set = await post(
      "/api/owner/login-pin",
      { pin: "692471", confirmPin: "692471" },
      uniqueAddress(),
      secondCookie
    );
    assert.equal(set.statusCode, 200, set.body);
    assert.ok(set.json().signedOutElsewhere >= 1, "no other session was revoked");

    const caller = await get("/api/owner/login-pin", secondCookie);
    assert.equal(caller.statusCode, 200, "the session that set the PIN was signed out");

    const other = await get("/api/owner/login-pin", firstCookie);
    assert.equal(other.statusCode, 401, "the other session survived a credential change");
  });
});

describe("credential spraying", () => {
  // Driven against the module rather than the route. /api/auth/login is rate
  // limited to 5 requests a minute per address, and this control is keyed on
  // the address — so twelve attempts from the one source it counts cannot be
  // pushed through HTTP inside a test. The route's use of it is one call
  // (see routes/auth/credentials.js); the rule is what needs pinning.
  const ip = "203.0.113.77";

  test("one source failing against many accounts is stopped", async () => {
    const before = await getSprayLock(collections, ip);
    assert.equal(before.locked, false, "the fixture address started out locked");

    // Twelve distinct identifiers is the threshold.
    for (let i = 0; i < 12; i += 1) {
      await recordSprayFailure(collections, ip, `spray-${i}@parktag-test.invalid`);
    }

    const after = await getSprayLock(collections, ip);
    assert.equal(after.locked, true, "twelve sprayed accounts did not lock the source");
    assert.ok(after.retryAfterSeconds > 0);
  });

  // A person mistyping their own PIN produces many failures against ONE
  // identifier. That is the per-account counter's job, and tripping this on it
  // would lock out everyone behind a shared office or campus address.
  test("repeated failures against one account do not trip it", async () => {
    const single = "198.51.100.42";

    for (let i = 0; i < 40; i += 1) {
      await recordSprayFailure(collections, single, "spray-single@parktag-test.invalid");
    }

    const lock = await getSprayLock(collections, single);
    assert.equal(lock.locked, false, "one account failing repeatedly tripped the spray lock");
  });
});

describe("the Login PIN page itself", () => {
  const email = "login-pin-page@parktag-test.invalid";
  let cookie;

  before(async () => {
    await createTestOwner(collections, { email, password: PASSWORD });
    await clearLoginLock(collections, email);

    const login = await post("/api/auth/login", { identifier: email, pin: PASSWORD });
    assert.equal(login.statusCode, 200, login.body);
    cookie = sessionCookie(login);
  });

  after(async () => {
    await collections.owners.deleteMany({ email });
  });

  // It manages a credential, so it must not render for someone who is not
  // already signed in.
  test("it is not served without a session", async () => {
    const response = await get("/owner-login-pin", null);

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "/owner-login");
  });

  // The sibling assertion in account-identity.test.js covers the pages that
  // render signed-OUT, and cannot reach this one — it answers a 302 without a
  // cookie. The check has to live here, or the strictest CSP in the app applies
  // to a page nothing verifies against it.
  test("its markup satisfies the tightened policy it is served with", async () => {
    const response = await get("/owner-login-pin", cookie);
    assert.equal(response.statusCode, 200, "the page did not render for a signed-in owner");

    const csp = response.headers["content-security-policy"] || "";
    const directive = (name) =>
      csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

    const scriptSrc = directive("script-src");
    assert.ok(scriptSrc && !scriptSrc.includes("'unsafe-inline'"), `script-src: ${scriptSrc}`);
    assert.match(csp, /script-src-attr 'none'/, "inline handlers are still permitted here");

    const styleSrc = directive("style-src");
    assert.ok(styleSrc && !styleSrc.includes("'unsafe-inline'"), `style-src: ${styleSrc}`);
    assert.match(csp, /style-src-attr 'unsafe-inline'/, "the header would lose its style attributes");

    // The markup has to actually satisfy what the header promises. An inline
    // <style> here is dropped silently and the screen renders unstyled — which
    // is exactly what happened when this page was first written.
    assert.ok(
      !/<style[^>]*>/i.test(response.body),
      "the page contains a <style> element that its own CSP blocks"
    );
    assert.ok(
      !/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/i.test(response.body),
      "the page contains an inline <script> that its own CSP blocks"
    );
    assert.ok(
      !/\son(click|input|change|submit)\s*=/i.test(response.body),
      "the page uses an inline handler that script-src-attr 'none' blocks"
    );

    // Its stylesheet has to be reachable, or the extraction that satisfied the
    // policy just moved the breakage somewhere the assertions above cannot see.
    const css = await get("/styles/owner-login-pin.css", null);
    assert.equal(css.statusCode, 200, "the page's stylesheet is not served");
  });

  // On a shared or borrowed phone, tapping Back after signing out must not
  // re-render a screen that manages a credential.
  test("it is never cached or kept in the back/forward store", async () => {
    const response = await get("/owner-login-pin", cookie);
    assert.match(response.headers["cache-control"] || "", /no-store/);
  });
});

describe("both sign-in screens offer a PIN, not a password", () => {
  // /owner-login and /owner-verify each carry their own copy of the "use your
  // credential instead of a code" control. They were worded independently and
  // drifted: one said "Sign in with password", the other "Know your password?
  // Sign in", and updating one is an easy way to leave the other behind.
  const pages = ["/owner-login", "/owner-verify"];

  for (const page of pages) {
    test(`${page} asks for a PIN`, async () => {
      const response = await get(page, null);
      assert.equal(response.statusCode, 200, `${page} did not render`);

      const body = response.body;

      assert.ok(
        /Sign in (with|using) PIN/i.test(body),
        `${page} does not offer the PIN sign-in control`
      );
      assert.ok(
        /placeholder="Enter your PIN"/.test(body),
        `${page} still prompts for a password in the credential field`
      );
      assert.ok(
        !/Know your password/i.test(body),
        `${page} still asks "Know your password?"`
      );

      // The password is still ACCEPTED — accounts that predate PINs would
      // otherwise lose credential sign-in — so the page has to say so. A field
      // labelled PIN that silently also takes a password is a screen those
      // owners read as "this is not for me".
      assert.ok(
        /Registered with a password/i.test(body),
        `${page} does not tell legacy accounts their password still works`
      );
    });
  }
});
