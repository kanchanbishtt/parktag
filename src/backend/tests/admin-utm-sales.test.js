// GET /api/admin/utm-sales: admin-only, and it reads real orders (not tests or giveaways) from the ledger.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "utm-sales-admin@parktag.test";
const PASSWORD = "test-password-123";
// Unique per run so a shared test database never mixes our rows with anyone else's.
const SOURCE = `utmtest${Date.now()}`;

let app;
let collections;
let adminCookie;

const order = (overrides) => ({
  orderNumber: `UTM-${SOURCE}-${Math.random().toString(36).slice(2, 8)}`,
  status: "paid",
  amount: 39900,
  internal: false,
  channel: "direct",
  deletedAt: null,
  promoCode: "DOORHANGER100",
  promoDiscountPaise: 10000,
  attribution: { source: SOURCE, medium: "print", campaign: "flat100" },
  createdAt: new Date().toISOString(),
  ...overrides
});

const get = (headers = {}) =>
  app.inject({ method: "GET", url: "/api/admin/utm-sales?days=7", remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN, ...headers } });

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.admins.insertOne({
    email: ADMIN_EMAIL, role: "admin", passwordHash: await createPasswordHash(PASSWORD), createdAt: new Date().toISOString()
  });
  const login = await app.inject({
    method: "POST", url: "/api/auth/admin/login", remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN }, payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200, "admin fixture must be able to sign in");
  adminCookie = login.headers["set-cookie"];

  await collections.shopOrders.insertMany([
    order({}),
    order({ status: "cod", amount: 44800 }),
    order({ status: "created" }),
    order({ internal: true }), // our own test order
    order({ channel: "giveaway" }),
    order({ deletedAt: new Date().toISOString() }),
    order({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }) // outside the 7 day window
  ]);
});

after(async () => {
  await collections.shopOrders.deleteMany({ "attribution.source": SOURCE });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("the report is admin-only", async () => {
  assert.equal((await get()).statusCode, 401);
});

test("counts real orders in the window under their campaign", async () => {
  const response = await get({ cookie: adminCookie });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.days, 7);

  const row = body.groups.find((g) => g.source === SOURCE);
  assert.ok(row, "our campaign appears");
  assert.equal(row.checkoutsStarted, 3, "paid + cod + created; test, giveaway, deleted and old rows are out");
  assert.equal(row.orders, 2);
  assert.equal(row.revenue, 847);
  assert.equal(row.discountGiven, 200);
  assert.deepEqual(row.promoCodes, ["DOORHANGER100"]);
});
