// Removing an admin must take their access with it. It used to delete the admin
// row only: every session that admin held kept full admin rights (API and pages)
// until it expired, seven days later.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const PASSWORD = "Removal-Test-Pass-1";
const KEEPER = "removal-keeper-admin@parktag.test";
const REMOVED = "removal-removed-admin@parktag.test";
const DROPPED = "removal-dropped-admin@parktag.test";
const EMAILS = [KEEPER, REMOVED, DROPPED];

let app;
let collections;
const ids = {};
const cookies = {};

function request(method, url, cookie) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) }
  });
}

async function signIn(email) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/admin/login",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN },
    payload: { email, password: PASSWORD }
  });
  assert.equal(response.statusCode, 200, `${email} must be able to sign in`);
  return response.headers["set-cookie"];
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.admins.deleteMany({ email: { $in: EMAILS } });

  const passwordHash = await createPasswordHash(PASSWORD);
  for (const email of EMAILS) {
    const { insertedId } = await collections.admins.insertOne({
      email,
      passwordHash,
      displayName: email.split("@")[0],
      role: "admin",
      createdAt: new Date().toISOString()
    });
    ids[email] = String(insertedId);
    cookies[email] = await signIn(email);
  }
});

after(async () => {
  await collections.admins.deleteMany({ email: { $in: EMAILS } });
  await collections.sessions.deleteMany({ userId: { $in: Object.values(ids) } });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("a removed admin is signed out of the API and the pages at once", async () => {
  const cookie = cookies[REMOVED];
  assert.equal((await request("GET", "/api/admin/me", cookie)).statusCode, 200, "signed in before removal");

  const removal = await request("DELETE", `/api/admin/admins/${ids[REMOVED]}`, cookies[KEEPER]);
  assert.equal(removal.statusCode, 200);

  assert.equal((await request("GET", "/api/admin/me", cookie)).statusCode, 401);
  assert.equal((await request("GET", "/api/admin/owners", cookie)).statusCode, 401);

  const page = await request("GET", "/admin/overview", cookie);
  assert.equal(page.statusCode, 302);
  assert.equal(page.headers.location, "/admin");

  const login = await request("GET", "/admin", cookie);
  assert.equal(login.statusCode, 200, "the login page is served, not a redirect back into the console");

  assert.equal(await collections.sessions.countDocuments({ userId: ids[REMOVED] }), 0, "every session row is gone");
});

test("an admin row deleted outside the app stops working too", async () => {
  const cookie = cookies[DROPPED];
  // Warm this instance's session cache first: the check must not rely on it.
  assert.equal((await request("GET", "/api/admin/me", cookie)).statusCode, 200);

  await collections.admins.deleteOne({ email: DROPPED });

  assert.equal((await request("GET", "/api/admin/me", cookie)).statusCode, 401);
  assert.equal((await request("GET", "/admin/etags", cookie)).statusCode, 302);
  assert.equal((await request("GET", "/admin/sticker/abcdef123456", cookie)).statusCode, 302);
});

test("the admin who did the removing keeps working", async () => {
  const cookie = cookies[KEEPER];
  assert.equal((await request("GET", "/api/admin/me", cookie)).statusCode, 200);
  assert.equal((await request("GET", "/admin/overview", cookie)).statusCode, 200);
  const login = await request("GET", "/admin", cookie);
  assert.equal(login.statusCode, 302);
  assert.equal(login.headers.location, "/admin/overview");
});
