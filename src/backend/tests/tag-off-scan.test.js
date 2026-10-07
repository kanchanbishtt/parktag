// A tag its owner has switched off (Tag Active, owner's rule, 7 Oct 2026):
//
//   ONLY THE DASHBOARD TURNS IT BACK ON. Scanning a switched-off tag used to
//   open the activation wizard, which took the scanner's details and then
//   failed with "Tag is not claimable". The scan page now shows a polite
//   "this tag is inactive" card with a link to /get, and no wizard.
//
//   THE TAG STAYS THE OWNER'S. Switched off, it keeps its owner, stays on the
//   dashboard, cannot be claimed by anybody else, and the same switch brings
//   it back.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";

const read = (path) => readFile(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
const appJs = await read("scripts/scanner/app.js");
const html = await read("pages/scanner/index.html");

// A whole function declaration, found by matching braces.
function wholeFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `could not find ${signature}`);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${signature}`);
}

const OWNER_MOBILE = "+919000007070";
const PLATE = "DL09QA7070";

let app;
let collections;
let owner;
let cookie;
let token;
let tagId;
let counter = 0;

function setStatus(status) {
  return app.inject({
    method: "POST",
    url: `/api/owner/tags/${tagId}/status`,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: TEST_ORIGIN },
    payload: { status }
  });
}

function dashboardTag() {
  return app
    .inject({
      method: "GET",
      url: "/api/owner/dashboard?qr=0",
      remoteAddress: uniqueAddress(),
      cookies: { wavetag_session: cookie }
    })
    .then((res) => res.json().tags.find((t) => t.id === tagId));
}

function scan() {
  return app.inject({ method: "GET", url: `/api/tags/${token}`, remoteAddress: uniqueAddress() });
}

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.tags.deleteMany({ token }).catch(() => {});
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  counter += 1;
  await purgeLoginCollections(collections);
  if (token) await collections.tags.deleteMany({ token });
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE });

  owner = await createTestOwner(collections, {
    email: "qa-tag-off@parktag-test.invalid",
    mobile: OWNER_MOBILE
  });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });

  token = `qatagoff${String(counter).padStart(3, "0")}${"a7b7c7d7".repeat(6)}`;
  const { insertedId } = await collections.tags.insertOne({
    ownerId: owner._id,
    token,
    plateNumber: PLATE,
    vehicleLabel: "QA Off Car",
    vehicleType: "car",
    status: "active",
    premium: false,
    freeContactUsed: false,
    createdAt: new Date().toISOString()
  });
  tagId = String(insertedId);
});

describe("the server", () => {
  test("switched off, the tag stays the owner's and stays on the dashboard", async () => {
    const off = await setStatus("inactive");
    assert.equal(off.statusCode, 200);

    const stored = await collections.tags.findOne({ token });
    assert.equal(String(stored.ownerId), String(owner._id));
    assert.equal(stored.status, "inactive");
    assert.ok(!stored.deletedAt);

    const listed = await dashboardTag();
    assert.ok(listed, "a switched-off tag must not vanish from the dashboard");
    assert.equal(listed.status, "inactive");
  });

  test("the scan lookup says inactive and not claimable, and shows no owner data", async () => {
    await setStatus("inactive");
    const res = await scan();
    assert.equal(res.statusCode, 200);
    const { tag } = res.json();
    assert.equal(tag.status, "inactive");
    assert.equal(tag.claimable, false);
    assert.equal(tag.maskedPlateNumber, null);
    assert.equal(tag.callPreviewNumber, null);
    assert.equal(tag.emergencyAvailable, false);
  });

  test("nobody can activate it, and the owner keeps it", async () => {
    await setStatus("inactive");
    const res = await app.inject({
      method: "POST",
      url: `/api/tags/${token}/activate`,
      remoteAddress: uniqueAddress(),
      payload: { displayName: "Someone Else", phone: "9000007071", code: "123456", plateNumber: "DL09QA7071", vehicleType: "car" }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /not claimable/);
    assert.equal(String((await collections.tags.findOne({ token })).ownerId), String(owner._id));
  });

  test("the same dashboard switch turns it back on", async () => {
    await setStatus("inactive");
    const on = await setStatus("active");
    assert.equal(on.statusCode, 200);
    assert.equal(on.json().tag.status, "active");
    assert.equal((await dashboardTag()).status, "active");
    const { tag } = (await scan()).json();
    assert.equal(tag.status, "active");
    assert.equal(tag.claimable, false);
  });
});

describe("the scan page", () => {
  const load = wholeFunction(appJs, "async function loadScannerView(");

  test("the activation wizard opens on the server's claimable flag, not on the status", () => {
    assert.match(load, /const registrationState = tag\.claimable === true;/);
    assert.doesNotMatch(appJs, /\["unclaimed", "inactive"\]\.includes\(tag\.status\)/);
    const summary = wholeFunction(appJs, "function setSummaryForTag(");
    assert.match(summary, /tag\.claimable === true/);
  });

  test("a switched-off tag shows the inactive card and stops there", () => {
    assert.match(load, /const switchedOff = !registrationState && tag\.status !== "active";/);
    const branch = load.slice(load.indexOf("if (switchedOff)"));
    assert.match(branch, /^if \(switchedOff\) \{[\s\S]*?showOnly\("tag-off-card"\);\s*return;/);
    // Decided before the contact card is ever shown.
    assert.ok(load.indexOf("if (switchedOff)") < load.indexOf('showOnly("scanner-action-shell")'));
    const showOnly = wholeFunction(appJs, "function showOnly(");
    assert.match(showOnly, /"tag-off-card"/);
  });

  test("there is no reactivation wording left", () => {
    assert.doesNotMatch(appJs, /reactivate the tag/i);
    assert.doesNotMatch(appJs, /Reactivate it/);
  });

  const card = html.slice(html.indexOf('id="tag-off-card"'), html.indexOf("</article>", html.indexOf('id="tag-off-card"')));

  test("the card is polite, links to /get, and asks for nothing", () => {
    assert.ok(card.length > 0, "tag-off-card must exist");
    assert.match(html, /<article class="pt-card pt-tag-off-card" id="tag-off-card" hidden>/);
    assert.match(card, /This tag is inactive/);
    assert.match(card, /The owner has turned this ParkTag off/);
    assert.match(card, /href="\/get"/);
    assert.match(card, /href="\/owner"/);
    assert.doesNotMatch(card, /<input|<form|<button/);
  });
});
