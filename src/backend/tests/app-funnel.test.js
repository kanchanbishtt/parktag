// The shop funnel, measured by the server rather than by the browser.
//
// GA4 and the Meta Pixel run in the visitor's browser, so an ad blocker, a
// privacy setting or an in-app browser silently removes them. On 8 Sep 2026 a
// visit to /shop was missing from GA4 entirely while sitting plainly in the
// server log, which is what this feature exists to fix: the page cannot render
// without the server, so a view recorded here cannot be blocked.
//
// What is pinned below:
//
//   1. A page view is recorded when the shop is SERVED, with no client script
//      involved and nothing personal retained.
//   2. Crawlers do not count. Facebook's link preview fetches every ad
//      destination, and counting it would inflate exactly the number the ads
//      are judged on.
//   3. The funnel joins those views to the orders that already exist, so
//      "somebody reached the address form and stopped" is answerable without
//      any extra tracking at all.

import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import { istDayKey } from "../routes/system/analytics.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier
} from "./helpers.js";

const ADMIN_EMAIL = assertUndeliverableIdentifier("qa-funnel-admin@parktag-test.invalid");

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
// The exact agent Meta sends when it fetches an ad's destination for a preview.
const FACEBOOK_CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

let app;
let collections;
let adminCookie;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.landingVisits.deleteMany({ site: "app" }).catch(() => {});
  await collections.shopOrders.deleteMany({ productId: "qa-funnel" }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  // Only this file's rows. landing-traffic.test.js shares the collection,
  // and wiping all of it makes whichever file runs second fail.
  await collections.landingVisits.deleteMany({ site: "app" });
  await collections.shopOrders.deleteMany({ productId: "qa-funnel" });
  await purgeLoginCollections(collections);

  const admin = await createTestOwner(collections, { email: ADMIN_EMAIL });
  await collections.admins.insertOne({
    _id: admin._id,
    email: ADMIN_EMAIL,
    role: "admin",
    displayName: "QA Funnel Admin",
    createdAt: new Date().toISOString()
  });
  adminCookie = await createSession(app, {
    id: String(admin._id),
    role: "admin",
    email: ADMIN_EMAIL,
    displayName: "QA Funnel Admin"
  });
});

function visitShop(url = "/shop", userAgent = BROWSER_UA) {
  return app.inject({
    method: "GET",
    url,
    remoteAddress: uniqueAddress(),
    headers: { "user-agent": userAgent }
  });
}

function traffic(days = 7) {
  return app.inject({
    method: "GET",
    url: `/api/admin/traffic?days=${days}`,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: adminCookie }
  });
}

// The insert has to be settled before the assertion reads it, and the route
// deliberately does not await it so the page is never held up by a write.
async function settle() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await collections.landingVisits.countDocuments({ site: "app" })) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function seedOrder(status, phone, createdAt = new Date().toISOString()) {
  await collections.shopOrders.insertOne({
    orderNumber: `QA-${Math.random().toString(36).slice(2, 8)}`,
    productId: "qa-funnel",
    productName: "QA Funnel Pack",
    status,
    amount: 49900,
    guest: true,
    ownerId: null,
    shippingAddress: { fullName: "QA Buyer", phone, city: "Noida", pincode: "201301" },
    createdAt
  });
}

describe("a shop view is recorded by the server", () => {
  test("serving /shop writes a visit", async () => {
    const response = await visitShop();
    assert.equal(response.statusCode, 200);

    await settle();
    const [visit] = await collections.landingVisits.find({ site: "app" }).toArray();

    assert.ok(visit, "no visit was recorded for a served shop page");
    assert.equal(visit.path, "/shop");
    assert.equal(visit.day, istDayKey());
  });

  // The query string carries the ad's campaign tags and, on a deep link, a
  // pack id. None of it belongs in the stored path.
  test("the query string is not stored", async () => {
    await visitShop("/shop?sku=pt-car-2&utm_source=meta&utm_content=price_shop");
    await settle();

    const [visit] = await collections.landingVisits.find({ site: "app" }).toArray();
    assert.equal(visit.path, "/shop");
  });

  // Same guarantee the landing beacon gives. A stored address or agent would
  // turn this into a tracking log rather than a counter.
  test("no IP address and no raw User-Agent is kept", async () => {
    await visitShop();
    await settle();

    const [visit] = await collections.landingVisits.find({ site: "app" }).toArray();
    const serialized = JSON.stringify(visit);

    assert.doesNotMatch(serialized, /\d+\.\d+\.\d+\.\d+/, "an IP address was stored");
    assert.doesNotMatch(serialized, /Mozilla|AppleWebKit|Chrome/, "the raw User-Agent was stored");
    assert.equal(visit.device, "mobile");
  });

  test("Facebook's link crawler is not counted", async () => {
    await visitShop("/shop", FACEBOOK_CRAWLER_UA);
    // Give the write the same chance it would have had; expect none to arrive.
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.equal(
      await collections.landingVisits.countDocuments({ site: "app" }),
      0,
      "a crawler fetch was counted as a shop visit"
    );
  });

  test("/get is recorded under its own path", async () => {
    await visitShop("/get");
    await settle();

    const [visit] = await collections.landingVisits.find({ site: "app" }).toArray();
    assert.equal(visit.path, "/get");
  });

  // Landing-page counts must not move because the app started recording too,
  // or every historical comparison on the Traffic page silently breaks.
  test("app views are separable from landing views", async () => {
    await collections.landingVisits.insertOne({
      day: istDayKey(),
      createdAt: new Date(),
      path: "/",
      site: "landing",
      device: "mobile",
      visitorHash: "qa-landing-visitor"
    });
    await visitShop();
    await settle();

    // Matched on the row this test inserted, not on every landing row, so a
    // leftover from another file cannot turn this into a false failure.
    assert.equal(
      await collections.landingVisits.countDocuments({ visitorHash: "qa-landing-visitor" }),
      1,
      "the landing row was swallowed by the app recorder"
    );
    assert.equal(await collections.landingVisits.countDocuments({ site: "app" }), 1);
  });
});

describe("the funnel joins views to orders", () => {
  test("it counts views, checkouts started and orders paid", async () => {
    await visitShop();
    await visitShop();
    await settle();

    await seedOrder("created", "9876500001");
    await seedOrder("created", "9876500002");
    await seedOrder("paid", "9876500003");

    const body = (await traffic()).json();

    assert.equal(body.ok, true);
    assert.ok(body.funnel, "the traffic response carries no funnel");

    const today = body.funnel.days.at(-1);
    assert.equal(today.shopViews, 2);
    assert.equal(today.checkoutsStarted, 3, "a paid order also started as a checkout");
    assert.equal(today.paid, 1);
  });

  // The point of the whole exercise: a buyer who filled the address form and
  // stopped is reachable, by name and number, from the admin panel.
  test("abandoned checkouts are listed, paid ones are not", async () => {
    await seedOrder("created", "9876500004");
    await seedOrder("paid", "9876500005");

    const body = (await traffic()).json();
    const phones = body.abandoned.map((row) => row.phone);

    assert.ok(phones.includes("9876500004"), "the abandoned checkout is missing");
    assert.ok(!phones.includes("9876500005"), "a paid order was listed as abandoned");
  });

  test("the funnel is admin-only", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/traffic?days=7",
      remoteAddress: uniqueAddress()
    });

    assert.equal(response.statusCode, 401);
  });
});
