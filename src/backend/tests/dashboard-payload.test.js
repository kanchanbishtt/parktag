// The LOW finding from the owner-dashboard QA pass: what /api/owner/dashboard
// hands to the browser.
//
// /api/session deliberately withholds the owner's ObjectId — "it is the ObjectId
// every /api/owner/* route keys off, and no client needs it" — and the dashboard
// was returning the same value anyway, so the restraint bought nothing. It
// matters more on this route than most: /owner-welcome is not one of the
// STRICT_SCRIPT_PAGES, so its CSP still permits inline script, and a script on
// the page could read whatever the page fetched.
//
// `tag.token` is NOT treated as a leak and is asserted to stay. It is printed on
// the owner's own sticker, encoded in the QR the same response returns, and
// spelled out in `scanUrl` beside it — and contact requests reference their tag
// by token, so the page matches on it. Dropping it would break the page while
// leaking nothing. The test states that so the field is not "fixed" later by
// someone reading the finding without the context.
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

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-payload@parktag-test.invalid");
const TAG_TOKEN = "qa-payload-token-0001";

let app;
let collections;
let owner;
let cookie;

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

  owner = await createTestOwner(collections, { email: OWNER_EMAIL, mobile: "+919812345678" });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });

  await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: "QA01PL0001",
    status: "active",
    token: TAG_TOKEN,
    createdAt: new Date().toISOString()
  });
});

function dashboard() {
  return app.inject({
    method: "GET",
    url: "/api/owner/dashboard",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie }
  });
}

describe("the dashboard does not hand out the owner's internal id", () => {
  test("the owner object carries no _id", async () => {
    const response = await dashboard();
    assert.equal(response.statusCode, 200, response.body);

    const body = response.json();
    assert.equal(body.owner._id, undefined, "the owner ObjectId is still being sent");
    assert.equal(body.owner.id, undefined, "the ObjectId came back under another name");
  });

  test("the id does not appear anywhere in the response body", async () => {
    // Broader than reading one field: it catches the value being reintroduced
    // somewhere else in the payload — nested under a tag, a request, a future
    // block — which a single-field assertion would sail straight past.
    const response = await dashboard();

    assert.ok(
      !response.body.includes(String(owner._id)),
      "the owner ObjectId is present somewhere in the dashboard response"
    );
  });

  test("/api/session still withholds it too", async () => {
    // The rule this route was breaking. Asserted here so the two cannot drift
    // apart again.
    const response = await app.inject({
      method: "GET",
      url: "/api/session",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie }
    });

    const session = response.json().session;
    assert.equal(session.role, "owner", "precondition: should be signed in");
    assert.ok(
      !response.body.includes(String(owner._id)),
      "/api/session is leaking the owner ObjectId"
    );
  });

  test("the page still gets what it needs to identify the owner", async () => {
    // The browser keys its local vehicle cache on email-or-mobile. If both went
    // missing the key would collapse to a shared constant across accounts, so
    // removing _id must not have taken these with it.
    const body = (await dashboard()).json();

    assert.equal(body.owner.email, OWNER_EMAIL);
    assert.equal(body.owner.mobile, "+919812345678");
  });

  test("the page itself no longer reaches for the id", async () => {
    // The other half of the change. If the field came back and the script
    // started reading it again, the payload assertions above would fail — but if
    // only the script regressed, nothing else would notice until the field was
    // restored to match it.
    const response = await app.inject({
      method: "GET",
      url: "/scripts/owner/welcome.js",
      remoteAddress: uniqueAddress()
    });

    assert.equal(response.statusCode, 200, "welcome.js is not being served");
    assert.ok(
      !/owner\._id/.test(response.body),
      "welcome.js still reads owner._id, so the field is on its way back"
    );
  });
});

describe("the tag token stays, deliberately", () => {
  test("tags still carry their token and scan URL", async () => {
    const body = (await dashboard()).json();
    const tag = body.tags[0];

    assert.equal(tag.token, TAG_TOKEN, "the page matches contact requests on this");
    assert.ok(tag.scanUrl.includes(TAG_TOKEN), "scanUrl carries the same value regardless");
  });
});
