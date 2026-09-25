// Print Queue → "Door hanger PDF".
//
// The endpoint turns ticked queue tags into the hanger print sheet and gives
// them the hanger's two free contacts. What must hold:
//
//   1. Admin only, for the sheet and for the artwork it references.
//   2. Only unclaimed, unprinted, non-demo tags go on a hanger; anything else in
//      the selection is skipped, never printed.
//   3. Bike (exterior) stock is refused outright: hangers are for car cards.
//   4. Every printed tag is stamped with DOORHANGER_FREE_CONTACTS.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { DOORHANGER_FREE_CONTACTS } from "../lib/core/call-access.js";

const ADMIN_EMAIL = "doorhanger-admin@parktag.test";
const PASSWORD = "test-password-123";

let app;
let collections;
let adminCookie;
const tagIds = [];
let serial = 970001;

async function insertTag(overrides = {}) {
  const doc = {
    token: `hanger${String(serial).padStart(8, "0")}${"a".repeat(14)}`,
    serialNumber: serial++,
    batchNumber: "93",
    ownerId: null,
    status: "unclaimed",
    printStatus: "pending_print",
    mountType: "windscreen_interior",
    premium: false,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  tagIds.push(insertedId);
  return { ...doc, _id: insertedId };
}

function post(payload, cookie = adminCookie) {
  return app.inject({
    method: "POST",
    url: "/api/admin/print-queue/doorhangers",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    payload
  });
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await collections.admins.insertOne({
    email: ADMIN_EMAIL,
    role: "admin",
    passwordHash: await createPasswordHash(PASSWORD),
    createdAt: new Date().toISOString()
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/admin/login",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN },
    payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200, "fixture admin login should succeed");
  adminCookie = [login.headers["set-cookie"]].flat().map((c) => c.split(";")[0]).join("; ");
});

after(async () => {
  await collections.tags.deleteMany({ _id: { $in: tagIds } });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

describe("door hanger print sheet", () => {
  test("needs an admin session, for the sheet and for its artwork", async () => {
    const tag = await insertTag();
    const res = await post({ ids: [String(tag._id)] }, null);
    assert.equal(res.statusCode, 401);

    const art = await app.inject({ method: "GET", url: "/admin/doorhanger-art/front.png", remoteAddress: uniqueAddress() });
    assert.notEqual(art.statusCode, 200);
    const artAdmin = await app.inject({ method: "GET", url: "/admin/doorhanger-art/front.png", remoteAddress: uniqueAddress(), headers: { cookie: adminCookie } });
    assert.equal(artAdmin.statusCode, 200);
    assert.equal(artAdmin.headers["content-type"], "image/png");
  });

  test("prints unclaimed tags, skips the rest, and stamps two free contacts", async () => {
    const a = await insertTag();
    const b = await insertTag();
    const claimed = await insertTag({ status: "active", ownerId: a._id });
    const printed = await insertTag({ printStatus: "printed" });

    const res = await post({ ids: [a, b, claimed, printed].map((t) => String(t._id)) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, 2);
    assert.equal(body.skipped, 2);

    // Two hangers, two pages each, artwork by URL rather than inlined.
    assert.equal((body.html.match(/<section class="page">/g) || []).length, 4);
    assert.match(body.html, /src="\/admin\/doorhanger-art\/front\.png"/);
    assert.doesNotMatch(body.html, /data:image\/png;base64/);
    assert.match(body.html, new RegExp(`PT-0*93-${a.serialNumber}<`));

    for (const t of [a, b]) {
      const after = await collections.tags.findOne({ _id: t._id });
      assert.equal(after.freeContactAllowance, DOORHANGER_FREE_CONTACTS);
    }
    for (const t of [claimed, printed]) {
      const after = await collections.tags.findOne({ _id: t._id });
      assert.equal(after.freeContactAllowance, undefined);
    }
  });

  test("refuses bike stock", async () => {
    const bike = await insertTag({ mountType: "exterior_surface" });
    const res = await post({ ids: [String(bike._id)] });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /bike stock/);
    const after = await collections.tags.findOne({ _id: bike._id });
    assert.equal(after.freeContactAllowance, undefined);
  });

  test("an empty selection is an error, not an empty sheet", async () => {
    const res = await post({ ids: [] });
    assert.equal(res.statusCode, 400);
  });
});
