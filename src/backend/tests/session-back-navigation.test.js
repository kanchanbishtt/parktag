// Pressing Back after signing out must not show the signed-in page again.
//
// Three things have to hold together for that, and only the first two were in
// place: the page is not stored by a cache, the session is genuinely gone on the
// server, and the page re-checks when the browser resurrects it from the
// back/forward cache. The third is the one that was missing — a bfcache restore
// makes no request at all, so `Cache-Control: no-store` and the server-side
// redirect never get a chance to run. Chrome restores no-store pages from
// bfcache today, which is why the header alone did not fix this.
//
// The restore itself needs a real browser to exercise. What is asserted here is
// the contract the page-side guard depends on: that it is loaded, and that
// /api/session tells it the truth after a sign-out.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  clearLoginLock,
  uniqueAddress
} from "./helpers.js";

const PASSWORD = "QA-back-nav-password-6a4c";
const OWNER_EMAIL = "qa-back-nav@parktag-test.invalid";

let app;
let collections;

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await createTestOwner(collections, { email: OWNER_EMAIL, password: PASSWORD });
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

async function signIn() {
  await clearLoginLock(collections, OWNER_EMAIL);
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: uniqueAddress(),
    payload: { email: OWNER_EMAIL, password: PASSWORD }
  });
  assert.equal(response.statusCode, 200, `sign-in failed: ${response.body}`);
  return response.cookies.find((c) => c.name === "wavetag_session").value;
}

function session(cookie) {
  return app.inject({
    method: "GET",
    url: "/api/session",
    remoteAddress: uniqueAddress(),
    ...(cookie ? { cookies: { wavetag_session: cookie } } : {})
  });
}

describe("signing out really ends the session", () => {
  test("/api/session reports no session once signed out", async () => {
    const cookie = await signIn();

    const before = await session(cookie);
    assert.equal(before.json().session?.role, "owner", "precondition: should be signed in");

    const loggedOut = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie }
    });
    assert.equal(loggedOut.statusCode, 200);

    // This is what the page-side guard asks after a bfcache restore. If it kept
    // answering with a session, the guard would leave the restored page up.
    const afterLogout = await session(cookie);
    assert.equal(afterLogout.statusCode, 200);
    assert.equal(
      afterLogout.json().session,
      null,
      "the old cookie still resolves to a session after sign-out — a restored " +
        "page would stay visible and keep working"
    );
  });

  test("the signed-in page redirects a signed-out visitor", async () => {
    // The path a real reload takes. Unchanged by this fix, asserted so the two
    // halves cannot drift apart.
    const response = await app.inject({
      method: "GET",
      url: "/owner-welcome",
      remoteAddress: uniqueAddress()
    });

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "/owner-login");
  });
});

describe("the page-side guard is actually on the signed-in pages", () => {
  const guardedPages = ["/owner-welcome", "/owner-documents"];

  test("the guard script is served", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/scripts/owner/session-guard.js",
      remoteAddress: uniqueAddress()
    });

    assert.equal(response.statusCode, 200, "session-guard.js is not being served");
    assert.match(
      response.body,
      /addEventListener\("pageshow"/,
      "the guard does not listen for pageshow, so a bfcache restore is not noticed"
    );
    assert.match(
      response.body,
      /event\.persisted/,
      "the guard must act only on a restore, not on every normal page load"
    );
    assert.match(
      response.body,
      /location\.replace/,
      "redirecting with assign() would leave the restored page one Back press away"
    );
  });

  for (const page of guardedPages) {
    test(`${page} loads the guard`, async () => {
      // Signed in, so the page body is returned rather than a redirect.
      const cookie = await signIn();
      const response = await app.inject({
        method: "GET",
        url: page,
        remoteAddress: uniqueAddress(),
        cookies: { wavetag_session: cookie }
      });

      assert.equal(response.statusCode, 200, `${page} did not render: ${response.statusCode}`);
      assert.match(
        response.body,
        /session-guard\.js/,
        `${page} does not load the guard, so Back after sign-out still shows it`
      );
      assert.match(
        response.headers["cache-control"] || "",
        /no-store/,
        `${page} lost its no-store header`
      );
    });
  }

  test("sign-out replaces the history entry rather than adding one", async () => {
    // Asserted against the served scripts: assigning to location.href on
    // sign-out leaves the signed-in page as the previous history entry, which is
    // exactly what "press Back and the dashboard is there" was.
    for (const script of ["/scripts/owner/welcome.js", "/scripts/owner/login.js"]) {
      const response = await app.inject({
        method: "GET",
        url: script,
        remoteAddress: uniqueAddress()
      });
      assert.equal(response.statusCode, 200, `${script} is not being served`);

      const signOutBlock = response.body.match(
        /(?:async function (?:signOut|logoutOwner)\s*\([^)]*\)\s*\{[\s\S]*?\n\})/
      );
      assert.ok(signOutBlock, `no sign-out function found in ${script}`);
      assert.ok(
        !/window\.location\.href\s*=/.test(signOutBlock[0]),
        `${script} sign-out assigns location.href; it must use location.replace`
      );
      assert.match(
        signOutBlock[0],
        /window\.location\.replace\(/,
        `${script} sign-out does not use location.replace`
      );
    }
  });
});
