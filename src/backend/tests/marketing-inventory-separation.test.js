// Field-demo stock must not behave like inventory.
//
// A demo sticker at rest sits in status "unclaimed" — the SAME state the print
// queue and the bulk deletes select on — so before this separation existed the
// salesperson's stickers were, to every other admin surface, indistinguishable
// from stock that still needed printing or clearing.
//
// The claims pinned here:
//
//   1. A demo sticker never appears in the print queue, however many times it
//      has been deactivated back to "available".
//   2. It is not counted as something pending print on the overview.
//   3. An ACTIVATED demo sticker stays out of the E-Tags list. It has a real
//      ownerId at that point, so the claim filter alone would let it through
//      and show a customer who may never have bought anything.
//   4. A batch delete skips it. This one matters physically: the sticker is in
//      a bag, and deleting the record does not recall it — it just makes the QR
//      resolve to nothing in front of a customer.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { stickerSerialFor } from "../lib/core/tag-issuance.js";

const ADMIN_EMAIL = "marketing-separation-admin@parktag.test";
const PASSWORD = "test-password-123";
const ORIGIN = "http://localhost:3000";

// Own batch number so the delete test cannot touch another suite's fixtures on
// a shared cluster.
const BATCH = "separation-test-batch";

let app;
let collections;
let adminCookie;

const tokens = [];
let nextSerial = 970001;

function makeToken(label) {
  const token = `sep${label}${String(tokens.length + 1).padStart(4, "0")}${"0".repeat(12)}`;
  tokens.push(token);
  return token;
}

async function insertTag(overrides = {}) {
  const doc = {
    token: makeToken("tag"),
    serialNumber: nextSerial++,
    ownerId: null,
    status: "unclaimed",
    printStatus: "pending",
    batchNumber: BATCH,
    premium: true,
    createdAt: new Date().toISOString(),
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

function insertDemoSticker(overrides = {}) {
  return insertTag({ marketingStock: true, copiesPrinted: 24, demoCount: 0, ...overrides });
}

function authed(method, url) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: ORIGIN, cookie: adminCookie }
  });
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);

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
    headers: { origin: ORIGIN },
    payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200, "admin fixture must be able to sign in");
  adminCookie = login.headers["set-cookie"];
});

after(async () => {
  await collections.tags.deleteMany({ token: { $in: tokens } });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("the print queue lists ordinary unprinted stock but not field-demo stickers", async () => {
  const ordinary = await insertTag();
  const demo = await insertDemoSticker();

  const response = await authed("GET", "/api/admin/print-queue");
  assert.equal(response.statusCode, 200);

  const body = response.json();
  const queued = (body.tags || body.items || []).map((t) => t.token);

  assert.ok(
    queued.includes(ordinary.token),
    "an ordinary unprinted tag must still reach the print queue"
  );
  assert.ok(
    !queued.includes(demo.token),
    "a field-demo sticker is already printed and in a bag — it must never be queued for printing"
  );
});

test("the overview does not count field-demo stock as pending print", async () => {
  const before = (await authed("GET", "/api/admin/overview")).json().counts.pendingPrint;

  await insertDemoSticker();
  const afterDemo = (await authed("GET", "/api/admin/overview")).json().counts.pendingPrint;
  assert.equal(afterDemo, before, "adding demo stock must not move the pending-print count");

  await insertTag();
  const afterOrdinary = (await authed("GET", "/api/admin/overview")).json().counts.pendingPrint;
  assert.equal(afterOrdinary, before + 1, "an ordinary unprinted tag must still be counted");
});

test("an activated demo sticker stays out of the E-Tags list", async () => {
  // Mid-demo: the customer ran the real wizard, so the tag carries a genuine
  // ownerId. That is exactly the shape the default "claimed" filter selects,
  // which is why marketingStock has to be excluded explicitly.
  const ownerId = (
    await collections.owners.insertOne({
      email: `separation-demo-owner-${Date.now()}@parktag.test`,
      displayName: "Walked Away",
      demoCreatedOwner: true,
      createdAt: new Date().toISOString()
    })
  ).insertedId;

  const activatedDemo = await insertDemoSticker({
    ownerId,
    demoOwnerId: ownerId,
    status: "active",
    plateNumber: "DL01ZZ9999"
  });
  // Positive control, same owner and status. Without it this test passes just
  // as well when the response shape changes and the lookup reads undefined.
  const realTag = await insertTag({
    ownerId,
    status: "active",
    plateNumber: "DL01YY8888"
  });

  try {
    const response = await authed("GET", "/api/admin/etags?claim=all");
    assert.equal(response.statusCode, 200);

    const listed = (response.json().etags || []).map((t) => t.token);
    assert.ok(
      listed.includes(realTag.token),
      "an ordinary claimed tag must still be listed — otherwise this test proves nothing"
    );
    assert.ok(
      !listed.includes(activatedDemo.token),
      "a demo sticker someone activated is not a customer tag and must not be listed as one"
    );
  } finally {
    await collections.owners.deleteOne({ _id: ownerId });
  }
});

test("the activations list shows real premium tags but not demo stock", async () => {
  // Demo stickers are premium, and this page selects on `premium: true` alone,
  // so it was the last surface still counting the shelf as inventory.
  const realPremium = await insertTag({ premium: true, status: "active" });
  const demo = await insertDemoSticker({ premium: true });

  const response = await authed("GET", "/api/admin/activations");
  assert.equal(response.statusCode, 200);

  // This route identifies rows by serial and etagId, not by token — matching on
  // `token` silently matches nothing and passes whatever the filter does.
  const serials = JSON.stringify(response.json());
  assert.ok(
    serials.includes(stickerSerialFor(realPremium)),
    "an ordinary premium tag must still be listed — otherwise this test proves nothing"
  );
  assert.ok(
    !serials.includes(stickerSerialFor(demo)),
    "a demo sticker is not a premium activation and must not be listed as one"
  );
});

test("a batch delete clears ordinary stock and leaves field-demo stickers alone", async () => {
  const ordinary = await insertTag();
  const demo = await insertDemoSticker();

  const response = await authed(
    "DELETE",
    `/api/admin/tags/batch/${encodeURIComponent(BATCH)}?confirm=1`
  );
  assert.equal(response.statusCode, 200);

  assert.equal(
    await collections.tags.countDocuments({ token: ordinary.token }),
    0,
    "ordinary unclaimed stock in the batch must still be deleted"
  );
  assert.equal(
    await collections.tags.countDocuments({ token: demo.token }),
    1,
    "deleting the record would not recall the physical sticker — the QR would just stop resolving"
  );
});
