// Tracing an issued batch from print to activation.
//
//   GET /api/admin/tag-batches                   one row per batch
//   GET /api/admin/tag-batches/:key/export.csv   every tag in a batch
//   GET /api/admin/etag-activations              activated premium-off stickers
//   GET /api/admin/etags?batch=<key>             the E-Tags list, one batch
//
// All admin-only. The CSV leaves the panel, so it must never carry a QR token
// (the sticker's key), must mask mobiles, and must not let a plate or name typed
// by a stranger run as a spreadsheet formula.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN, createTestOwner } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { csvCell, maskMobile, parseBatchKey } from "../lib/core/tag-batches.js";

const ADMIN_EMAIL = "tag-batches-admin@parktag.test";
const OWNER_EMAIL = "tag-batches-owner@parktag.test";
const PASSWORD = "test-password-123";

// Batch keys no other suite uses, so rows left behind elsewhere never mix in.
const A = "91";
const B = "92";

let app;
let collections;
let adminCookie;
let ownerCookie;
let owner;
const tokens = [];

function token() {
  const t = `batchtag${String(tokens.length + 1).padStart(4, "0")}${"0".repeat(12)}`;
  tokens.push(t);
  return t;
}

async function insertTag(overrides = {}) {
  const doc = {
    token: token(),
    batchNumber: A,
    batchLabel: "Door campaign",
    serialNumber: tokens.length,
    ownerId: null,
    status: "unclaimed",
    printStatus: "pending_print",
    premium: false,
    mountType: "windscreen_interior",
    issuedAt: "2026-09-01T10:00:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
    deletedAt: null,
    ...overrides
  };
  const { insertedId } = await collections.tags.insertOne(doc);
  return { ...doc, _id: insertedId };
}

const get = (url, cookie = adminCookie) =>
  app.inject({ method: "GET", url, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) } });

async function login(url, email) {
  const res = await app.inject({
    method: "POST", url, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN },
    payload: { email, password: PASSWORD }
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"];
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({ batchNumber: { $in: [A, B] } });

  await collections.admins.insertOne({
    email: ADMIN_EMAIL, role: "admin",
    passwordHash: await createPasswordHash(PASSWORD), createdAt: new Date().toISOString()
  });
  adminCookie = await login("/api/auth/admin/login", ADMIN_EMAIL);
  owner = await createTestOwner(collections, { email: OWNER_EMAIL, password: PASSWORD, mobile: "9876543210", displayName: "=cmd|' /C calc'!A0" });
  ownerCookie = await login("/api/auth/login", OWNER_EMAIL);

  // Batch A: 4 E-Tags. Two activated (one with a formula-looking plate), one
  // printed, one soft-deleted (not counted), plus a demo-shelf sticker (not
  // counted) and a premium tag that IS counted but never listed as an E-Tag.
  await insertTag({ serialNumber: 3, ownerId: owner._id, status: "active", plateNumber: "=HYPERLINK(\"x\")", activatedAt: "2026-09-10T10:00:00.000Z" });
  await insertTag({ serialNumber: 1, ownerId: owner._id, status: "active", plateNumber: "DL01AB1234", activatedAt: "2026-09-12T10:00:00.000Z", freeContactUsed: true });
  await insertTag({ serialNumber: 2, printStatus: "printed" });
  await insertTag({ serialNumber: 4 });
  await insertTag({ serialNumber: 5, deletedAt: "2026-09-02T00:00:00.000Z" });
  await insertTag({ serialNumber: 6, marketingStock: true, premium: true });
  await insertTag({ serialNumber: 7, premium: true, ownerId: owner._id, status: "active", activatedAt: "2026-09-11T10:00:00.000Z" });

  // Batch B: stored raw as "92" (key 92); nothing activated.
  await insertTag({ batchNumber: B, batchLabel: "Second run", serialNumber: 1 });

  // An owner-made E-Tag: no batch, so it is not issued stock.
  await insertTag({ batchNumber: null, serialNumber: null, ownerId: owner._id, status: "active", activatedAt: "2026-09-13T10:00:00.000Z" });
});

after(async () => {
  await collections.tags.deleteMany({ token: { $in: tokens } });
  await collections.owners.deleteMany({ email: OWNER_EMAIL });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

describe("admin only", () => {
  for (const url of ["/api/admin/tag-batches", `/api/admin/tag-batches/${A}/export.csv`, "/api/admin/etag-activations", `/api/admin/etags?batch=${A}`]) {
    test(`${url} refuses no session and an owner session`, async () => {
      assert.equal((await get(url, null)).statusCode, 401);
      assert.equal((await get(url, ownerCookie)).statusCode, 403);
    });
  }
});

describe("batch summary", () => {
  test("counts issued, activated, printed and type per batch; demo and deleted stock left out", async () => {
    const res = await get("/api/admin/tag-batches");
    assert.equal(res.statusCode, 200, res.body);
    const a = res.json().batches.find((b) => b.key === A);
    assert.deepEqual(
      { total: a.total, activated: a.activated, unclaimed: a.unclaimed, printed: a.printed, premium: a.premium, etag: a.etag },
      { total: 5, activated: 3, unclaimed: 2, printed: 1, premium: 1, etag: 4 }
    );
    assert.deepEqual(a.labels, ["Door campaign"]);
    assert.equal(a.lastActivatedAt, "2026-09-12T10:00:00.000Z");

    const b = res.json().batches.find((row) => row.key === B);
    assert.equal(b.total, 1);
    assert.equal(b.activated, 0);
  });
});

describe("E-Tags list, one batch", () => {
  test("returns only that batch, in serial order", async () => {
    const res = await get(`/api/admin/etags?batch=${A}&claim=all`);
    assert.equal(res.statusCode, 200, res.body);
    const serials = res.json().etags.map((t) => t.serial);
    assert.deepEqual(serials, ["PT-91-000001", "PT-91-000002", "PT-91-000003", "PT-91-000004", "PT-91-000007"]);
  });

  test("an invalid or repeated batch is refused, not ignored", async () => {
    for (const q of ["batch=abc", "batch=1", `batch=${A}&batch=${B}`, "batch[$ne]=x"]) {
      const res = await get(`/api/admin/etags?${q}&claim=all`);
      if (q === "batch[$ne]=x") {
        // Parsed as a key literally named "batch[$ne]", which the route never
        // reads: no batch filter, and certainly no operator.
        assert.equal(res.statusCode, 200, res.body);
        continue;
      }
      assert.equal(res.statusCode, 400, `${q}: ${res.body}`);
    }
  });
});

describe("batch CSV", () => {
  test("every tag in serial order, no QR token, mobile masked, formulas neutralised", async () => {
    const res = await get(`/api/admin/tag-batches/${A}/export.csv`);
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.headers["content-type"], /^text\/csv/);
    assert.match(res.headers["content-disposition"], /attachment; filename="parktag-batch-91\.csv"/);
    assert.equal(res.headers["cache-control"], "no-store");

    const body = res.body;
    for (const t of tokens) assert.ok(!body.includes(t), "a QR token leaked into the CSV");
    assert.ok(!body.includes("9876543210"), "full mobile in the CSV");
    assert.ok(body.includes('"******3210"'));
    assert.ok(body.includes(`"'=HYPERLINK(""x"")"`), "formula plate not neutralised");
    assert.ok(body.includes(`"'=cmd|' /C calc'!A0"`), "formula name not neutralised");

    const lines = body.replace(/^﻿/, "").split("\r\n");
    assert.equal(lines.length, 1 + 5, "header + 5 non-deleted, non-demo tags");
    assert.deepEqual(lines.slice(1).map((l) => l.split(",")[0]), ['"PT-91-000001"', '"PT-91-000002"', '"PT-91-000003"', '"PT-91-000004"', '"PT-91-000007"']);
  });

  test("an unknown batch is 404 and a malformed key is 400", async () => {
    assert.equal((await get("/api/admin/tag-batches/99999/export.csv")).statusCode, 404);
    assert.equal((await get("/api/admin/tag-batches/ab/export.csv")).statusCode, 400);
  });
});

describe("E-Tag activations", () => {
  test("lists activated premium-off issued stickers only, newest first", async () => {
    const res = await get(`/api/admin/etag-activations?batch=${A}`);
    assert.equal(res.statusCode, 200, res.body);
    const rows = res.json().activated;
    assert.deepEqual(rows.map((r) => r.serial), ["PT-91-000001", "PT-91-000003"]);
    assert.equal(rows[0].freeContactUsed, true);
    assert.equal(rows[0].ownerMobile, "9876543210");
  });

  test("without a batch it still leaves out premium, demo and owner-made tags", async () => {
    const res = await get("/api/admin/etag-activations");
    assert.equal(res.statusCode, 200, res.body);
    const mine = res.json().activated.filter((r) => r.batch === A || r.batch === B || r.serial === "");
    assert.deepEqual(mine.map((r) => r.serial).sort(), ["PT-91-000001", "PT-91-000003"]);
  });

  test("a malformed batch is 400", async () => {
    assert.equal((await get("/api/admin/etag-activations?batch=x")).statusCode, 400);
  });
});

describe("helpers", () => {
  test("csvCell quotes, doubles quotes and defuses formulas", () => {
    assert.equal(csvCell('a "b"'), '"a ""b"""');
    for (const lead of ["=", "+", "-", "@", "\t", "\r", " =", "  +", "\n@"]) assert.equal(csvCell(`${lead}1`), `"'${lead}1"`);
    assert.equal(csvCell("DL01 AB=1"), '"DL01 AB=1"', "an = mid-text is not a formula");
    assert.equal(csvCell(null), '""');
  });

  test("maskMobile keeps the last four only", () => {
    assert.equal(maskMobile("+91 98765 43210"), "******3210");
    assert.equal(maskMobile(""), "");
  });

  test("parseBatchKey accepts batch digits only", () => {
    assert.equal(parseBatchKey("07"), "07");
    for (const bad of ["7", "a1", "", " ", "07;", null, undefined, ["07"], { $ne: 1 }]) assert.equal(parseBatchKey(bad), null);
  });
});
