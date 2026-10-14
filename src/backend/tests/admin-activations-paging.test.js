// The activation queue answers ?page=, and the MCP tool's `page` reaches it.
//
// parktag_activations offered a `page` argument and GET /api/admin/activations
// ignored it: every page was the whole queue, cut at the MCP reply limit, so
// the buyers past the cut could never be read. The route now pages when asked
// (25 rows, waiting longest first) and still returns the whole queue to the
// Activations page, which does not ask.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";

const ADMIN_EMAIL = "admin-activations-paging@parktag.test";
const PASSWORD = "test-password-123";
const MARK = `actpg${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 25;

let app;
let collections;
let adminCookie;

const asAdmin = (url) => app.inject({ method: "GET", url, remoteAddress: uniqueAddress(), headers: { origin: TEST_ORIGIN, cookie: adminCookie } });
const ids = (rows) => rows.map((row) => row.id);

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

  // More than one page of buyers waiting to activate, whatever else the
  // database already holds.
  await collections.shopOrders.insertMany(Array.from({ length: PAGE_SIZE + 6 }, (_, i) => ({
    orderNumber: `${MARK}-${String(i).padStart(3, "0")}`,
    status: "paid",
    paymentMethod: "online",
    productId: "pt-car-1",
    productName: "ParkTag Car Tag (Pack of 1)",
    shippingAddress: { fullName: `Paging Buyer ${i}`, phone: `97${String(i).padStart(8, "0")}` },
    testMarker: MARK,
    createdAt: new Date(Date.now() - (40 - i) * DAY).toISOString()
  })));
});

after(async () => {
  await collections.shopOrders.deleteMany({ testMarker: MARK });
  await collections.adminApiTokens.deleteMany({ adminEmail: ADMIN_EMAIL });
  await collections.mcpCalls.deleteMany({ email: ADMIN_EMAIL });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await collections.adminAudit.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

test("?page= pages the queue in order; without it the Activations page still gets all of it", async () => {
  const whole = (await asAdmin("/api/admin/activations")).json();
  assert.equal(whole.page, undefined, "the unpaged reply changed shape");
  const total = whole.unactivated.length;
  assert.ok(total > PAGE_SIZE, `fixture should fill more than a page (${total})`);
  const pages = Math.ceil(total / PAGE_SIZE);

  const seen = [];
  for (let page = 1; page <= pages; page += 1) {
    const body = (await asAdmin(`/api/admin/activations?page=${page}`)).json();
    assert.deepEqual([body.page, body.pages, body.pageSize, body.total], [page, pages, PAGE_SIZE, total]);
    assert.deepEqual(body.counts, whole.counts, "counts must cover the whole queue on every page");
    assert.equal(body.unactivated.length, page < pages ? PAGE_SIZE : total - PAGE_SIZE * (pages - 1));
    seen.push(...ids(body.unactivated));
  }
  assert.deepEqual(seen, ids(whole.unactivated), "the pages together are the queue, in the same order, with nothing skipped or repeated");

  // Past the end is the last page; junk is page 1, as on the other admin lists.
  assert.equal((await asAdmin("/api/admin/activations?page=999")).json().page, pages);
  assert.equal((await asAdmin("/api/admin/activations?page=abc")).json().page, 1);
});

test("the MCP tool's page reaches the route", async () => {
  const minted = await app.inject({
    method: "POST", url: "/api/admin/api-tokens", remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, cookie: adminCookie }, payload: { name: "activations paging", scope: "read", days: 1 }
  });
  assert.equal(minted.statusCode, 200, minted.body);
  const { token } = minted.json().data;

  let rpcId = 0;
  const callTool = async (args) => {
    const res = await app.inject({
      method: "POST", url: "/mcp", remoteAddress: uniqueAddress(),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      payload: { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "parktag_activations", arguments: args } }
    });
    const result = res.json().result;
    assert.notEqual(result.isError, true, result.content[0].text);
    // The reply is fenced as customer data: the JSON sits between the tags.
    return JSON.parse(result.content[0].text.split("\n").slice(3, -1).join("\n"));
  };

  const whole = ids((await asAdmin("/api/admin/activations")).json().unactivated);
  const second = await callTool({ page: 2 });
  assert.equal(second.page, 2, "the tool's page was ignored");
  assert.deepEqual(ids(second.unactivated), whole.slice(PAGE_SIZE, PAGE_SIZE * 2));

  const first = await callTool({});
  assert.equal(first.page, 1, "with no page the tool asks for the first, not the whole queue");
  assert.deepEqual(ids(first.unactivated), whole.slice(0, PAGE_SIZE));
});
