// Google redirect sign-in: the callback only completes in the browser that
// started it.
//
// The OAuth `state` was stored server-side and checked at the callback, which
// proved that somebody had started a sign-in, not who. Anyone could start one,
// approve it with their own Google account, stop before the callback and send
// the link on: opening it signed the other person's browser into the sender's
// account (login CSRF). Each browser now carries a random id in a cookie, every
// state is stored with a hash of it, and the callback only consumes a state
// started by the browser presenting it. Tabs in one browser share the id, so
// two sign-ins started side by side both complete.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, purgeLoginCollections } from "./helpers.js";

// Set after helpers.js has swept the ambient GOOGLE_* variables (imports run
// first). Placeholders: Google's token and profile calls are stubbed below.
process.env.GOOGLE_CLIENT_ID = "qa-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "qa-client-secret";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/api/auth/google/callback";

const ADMIN_EMAIL = "qa-google-admin@parktag-test.invalid";

let app;
let collections;
let realFetch;

before(async () => {
  ({ app, collections } = await startTestApp());
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "qa-access-token" }), { status: 200 });
    }
    if (href.startsWith("https://www.googleapis.com/oauth2/v3/userinfo")) {
      return new Response(JSON.stringify({ sub: "qa-sub", email: ADMIN_EMAIL, email_verified: true, name: "QA Admin" }), { status: 200 });
    }
    return realFetch(url, options);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await collections.admins.deleteMany({ email: ADMIN_EMAIL }).catch(() => {});
  await collections.oauthStates.deleteMany({}).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.oauthStates.deleteMany({});
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await collections.admins.insertOne({ email: ADMIN_EMAIL, displayName: "QA Admin", createdAt: new Date().toISOString() });
});

// What the admin page's "Continue with Google" button does. `browserId` is
// the cookie this browser already holds, if any.
async function startSignIn(browserId = null) {
  const res = await app.inject({
    method: "GET",
    url: "/api/auth/admin/google",
    ...(browserId ? { cookies: { pt_google_browser: browserId } } : {})
  });
  assert.equal(res.statusCode, 302, res.body);
  const state = new URL(res.headers.location).searchParams.get("state");
  const cookie = res.cookies.find((c) => c.name === "pt_google_browser");
  return { state, cookie };
}

const callback = (state, browserId) => app.inject({
  method: "GET",
  url: `/api/auth/google/callback?code=qa-code&state=${state}`,
  ...(browserId ? { cookies: { pt_google_browser: browserId } } : {})
});

const sessionCookie = (res) => res.cookies.find((c) => c.name === "wavetag_session" && c.value);

describe("starting a sign-in", () => {
  test("gives this browser an id, sent to the callback only", async () => {
    const { state, cookie } = await startSignIn();
    assert.ok(state);
    assert.ok(cookie, "no browser cookie was set");
    assert.match(cookie.value, /^[a-f0-9]{64}$/);
    assert.notEqual(cookie.value, state, "the cookie is the browser's, not one sign-in's");
    assert.equal(cookie.path, "/api/auth/google/callback");
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "Lax", "Strict would drop the cookie on Google's redirect back");
    assert.equal(cookie.maxAge, 600);

    const stored = await collections.oauthStates.findOne({ _id: state });
    assert.ok(stored.browser && !JSON.stringify(stored).includes(cookie.value), "the id itself must not be stored");
  });

  test("a second sign-in in the same browser keeps the same id", async () => {
    const first = await startSignIn();
    const second = await startSignIn(first.cookie.value);
    assert.equal(second.cookie.value, first.cookie.value);
  });
});

describe("the callback", () => {
  test("the browser that started it is signed in", async () => {
    const { state, cookie } = await startSignIn();
    const res = await callback(state, cookie.value);
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "/admin/overview");
    assert.ok(sessionCookie(res), "no session was created");
  });

  test("a callback link opened in another browser is refused (login CSRF)", async () => {
    const { state } = await startSignIn();
    const res = await callback(state, null);
    assert.equal(res.headers.location, "/owner-login?error=invalid_state");
    assert.equal(sessionCookie(res), undefined, "the link signed a stranger's browser in");
  });

  test("a refused link does not burn the state for the browser it belongs to", async () => {
    const { state, cookie } = await startSignIn();
    await callback(state, null);
    const res = await callback(state, cookie.value);
    assert.equal(res.headers.location, "/admin/overview");
  });

  test("another browser's id does not match", async () => {
    const theirs = await startSignIn();
    const mine = await startSignIn();
    assert.notEqual(mine.cookie.value, theirs.cookie.value);
    const res = await callback(theirs.state, mine.cookie.value);
    assert.equal(res.headers.location, "/owner-login?error=invalid_state");
    assert.equal(sessionCookie(res), undefined);
  });

  test("sign-ins started in two tabs both complete", async () => {
    const tabOne = await startSignIn();
    const tabTwo = await startSignIn(tabOne.cookie.value);

    const second = await callback(tabTwo.state, tabOne.cookie.value);
    assert.equal(second.headers.location, "/admin/overview");
    const first = await callback(tabOne.state, tabOne.cookie.value);
    assert.equal(first.headers.location, "/admin/overview", "the older tab's sign-in was lost");
  });

  test("a used state cannot be replayed", async () => {
    const { state, cookie } = await startSignIn();
    assert.equal((await callback(state, cookie.value)).headers.location, "/admin/overview");

    const replay = await callback(state, cookie.value);
    assert.equal(replay.headers.location, "/owner-login?error=invalid_state");
    assert.equal(sessionCookie(replay), undefined);
  });
});
