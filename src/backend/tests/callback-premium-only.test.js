// Calling a scanner back is a premium feature.
//
// The rule that needed deciding: premium is a property of the TAG, never of the
// account. Every other paid behaviour in the app — contactAvailable,
// unlimitedContact, the free-contact gate — is decided by `tag.premium` for the
// specific tag that was scanned, and there is no owner-level premium flag
// anywhere. So an owner holding one premium sticker and two E-Tags can call
// back the people who scanned the premium one, and nobody else. One purchase
// must not quietly unlock the feature for every other tag on the account.
//
// The most interesting case in here is the last one: a premium contact stays
// callable even when a NEWER contact arrived on an E-Tag. The "newest only"
// rule exists so nobody rings a stale reporter while a live caller waits — but
// an E-Tag caller cannot be rung at all, so there is no live conversation being
// jumped, and blocking the premium callback too would punish the person who
// actually paid.
import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { startTestApp, stopTestApp, createTestOwner } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";

let app;
let env;
let collections;

const ORIGIN = "http://localhost:3000";
const OWNER_MOBILE = "+919000006610";
const SCANNER_A = "+919000006611";
const SCANNER_B = "+919000006612";

const PREMIUM_TOKEN = "prem-tok";
const ETAG_TOKEN = "etag-tok";

let owner;
let cookie;

function minutesAgo(m) {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

async function seedTag({ token, premium, deletedAt = null }) {
  const doc = {
    _id: new ObjectId(),
    token,
    ownerId: owner._id,
    status: "active",
    premium,
    plateNumber: "DL9CP4455",
    createdAt: new Date().toISOString()
  };
  if (deletedAt) doc.deletedAt = deletedAt;
  await collections.tags.insertOne(doc);
  return doc;
}

async function seedContact({ token, phone, createdAt }) {
  const doc = {
    _id: new ObjectId(),
    tagId: new ObjectId(),
    token,
    ownerId: owner._id,
    phone,
    action: "call",
    status: "connecting",
    createdAt
  };
  await collections.contactRequests.insertOne(doc);
  return doc;
}

function callBack(body) {
  return app.inject({
    method: "POST",
    url: "/api/owner/callback/register-call",
    headers: {
      origin: ORIGIN,
      cookie: `wavetag_session=${cookie}`,
      "content-type": "application/json"
    },
    payload: body
  });
}

test.before(async () => {
  ({ app, env, collections } = await startTestApp());
  await collections.owners.deleteMany({});
  await collections.tags.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});

  owner = await createTestOwner(collections, {
    email: "cb-premium@example.invalid",
    displayName: "Premium Owner"
  });
  await collections.owners.updateOne(
    { _id: owner._id },
    { $set: { mobile: OWNER_MOBILE, phone: OWNER_MOBILE, mobileVerified: true } }
  );

  cookie = await createSession(app, {
    id: String(owner._id), role: "owner", email: "cb-premium@example.invalid"
  });
});

test.beforeEach(async () => {
  await collections.tags.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});
  // 5 callbacks per 5 minutes, counted in Mongo, so without this the later
  // tests read the earlier tests' 429s instead of the answers they assert.
  await collections.rateLimits.deleteMany({});
});

test.after(async () => {
  await collections.owners.deleteMany({});
  await collections.tags.deleteMany({});
  await collections.contactRequests.deleteMany({});
  await collections.pendingCalls.deleteMany({});
  await stopTestApp(app);
});

test("a contact on an E-Tag cannot be called back", async () => {
  await seedTag({ token: PREMIUM_TOKEN, premium: true });
  await seedTag({ token: ETAG_TOKEN, premium: false });
  const contact = await seedContact({ token: ETAG_TOKEN, phone: SCANNER_A, createdAt: minutesAgo(1) });

  const response = await callBack({ requestId: String(contact._id) });

  assert.equal(response.statusCode, 402);
  assert.equal(response.json().code, "PREMIUM_REQUIRED");
  assert.equal(await collections.pendingCalls.countDocuments({}), 0,
    "and nothing may be routed to that scanner");
});

test("owning a premium tag elsewhere does not unlock the E-Tag", async () => {
  // The whole point of scoping to the tag. This owner has paid for one sticker
  // and holds two more that they have not — the purchase must not follow them
  // around the account.
  await seedTag({ token: PREMIUM_TOKEN, premium: true });
  await seedTag({ token: ETAG_TOKEN, premium: false });
  await seedContact({ token: PREMIUM_TOKEN, phone: SCANNER_A, createdAt: minutesAgo(6) });
  const onEtag = await seedContact({ token: ETAG_TOKEN, phone: SCANNER_B, createdAt: minutesAgo(1) });

  const response = await callBack({ requestId: String(onEtag._id) });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().code, "PREMIUM_REQUIRED");
});

test("an owner with no premium tag at all is refused", async () => {
  await seedTag({ token: ETAG_TOKEN, premium: false });
  const contact = await seedContact({ token: ETAG_TOKEN, phone: SCANNER_A, createdAt: minutesAgo(1) });

  // Also covers the id-less form the banner button sends.
  for (const body of [{ requestId: String(contact._id) }, {}]) {
    const response = await callBack(body);
    assert.equal(response.statusCode, 402, `refused for ${JSON.stringify(body)}`);
    assert.equal(response.json().code, "PREMIUM_REQUIRED");
  }
  assert.equal(await collections.pendingCalls.countDocuments({}), 0);
});

test("a premium contact is still callable", async (t) => {
  if (!env.exotelCallerId) {
    t.skip("EXOTEL_CALLER_ID not configured in this environment");
    return;
  }
  await seedTag({ token: PREMIUM_TOKEN, premium: true });
  const contact = await seedContact({ token: PREMIUM_TOKEN, phone: SCANNER_A, createdAt: minutesAgo(2) });

  const response = await callBack({ requestId: String(contact._id) });
  assert.equal(response.statusCode, 200);

  const routed = await collections.pendingCalls.findOne({ requestId: contact._id });
  assert.ok(routed, "the masked route must still be registered");
  assert.equal(routed.targetPhone, SCANNER_A);
});

test("a deleted premium tag does not count", async () => {
  // The dashboard builds its tag list excluding deleted tags, so the route has
  // to agree — a button the page never draws must not be one the route honours,
  // and the reverse is worse.
  await seedTag({ token: PREMIUM_TOKEN, premium: true, deletedAt: new Date().toISOString() });
  const contact = await seedContact({ token: PREMIUM_TOKEN, phone: SCANNER_A, createdAt: minutesAgo(1) });

  const response = await callBack({ requestId: String(contact._id) });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().code, "PREMIUM_REQUIRED");
});

test("a premium contact stays callable behind a newer E-Tag contact", async (t) => {
  if (!env.exotelCallerId) {
    t.skip("EXOTEL_CALLER_ID not configured in this environment");
    return;
  }

  // The deliberate part of the design. "Newest only" exists so nobody rings a
  // reporter who has moved on while a live caller waits. The newer caller here
  // arrived on an E-Tag and cannot be rung at all, so there is no live
  // conversation to protect — and refusing the premium one too would mean
  // paying for the feature and then losing it to a free tag on another vehicle.
  await seedTag({ token: PREMIUM_TOKEN, premium: true });
  await seedTag({ token: ETAG_TOKEN, premium: false });
  const premiumContact = await seedContact({ token: PREMIUM_TOKEN, phone: SCANNER_A, createdAt: minutesAgo(5) });
  await seedContact({ token: ETAG_TOKEN, phone: SCANNER_B, createdAt: minutesAgo(1) });

  const response = await callBack({ requestId: String(premiumContact._id) });
  assert.equal(response.statusCode, 200, "the paid-for contact must survive a free one arriving after it");

  const routed = await collections.pendingCalls.findOne({});
  assert.equal(routed.targetPhone, SCANNER_A, "and it must dial the premium scanner, not the newer one");
});

test("the id-less form also picks the newest PREMIUM contact", async (t) => {
  if (!env.exotelCallerId) {
    t.skip("EXOTEL_CALLER_ID not configured in this environment");
    return;
  }
  await seedTag({ token: PREMIUM_TOKEN, premium: true });
  await seedTag({ token: ETAG_TOKEN, premium: false });
  await seedContact({ token: ETAG_TOKEN, phone: SCANNER_B, createdAt: minutesAgo(1) });
  const premiumContact = await seedContact({ token: PREMIUM_TOKEN, phone: SCANNER_A, createdAt: minutesAgo(4) });

  const response = await callBack({});
  assert.equal(response.statusCode, 200);
  const routed = await collections.pendingCalls.findOne({});
  assert.equal(String(routed.requestId), String(premiumContact._id));
});

test("the page draws the button only for premium contacts", async () => {
  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });
  assert.equal(js.statusCode, 200);

  assert.match(js.body, /const arrivedOnPremiumTag = \(r\) => \{/,
    "the page must decide from the tag the contact arrived on");
  assert.match(js.body, /arrivedOnPremiumTag\(r\) &&/,
    "and that must be part of whether a row is returnable");
});

test("an owner is told why, not left with a blank space", async () => {
  // A row that silently loses its button teaches nobody that the feature
  // exists, which defeats the reason for charging for it.
  const js = await app.inject({ method: "GET", url: "/scripts/owner/welcome.js" });

  assert.match(js.body, /const blockedOnlyByPremium = \(r\) =>/,
    "the near-miss case has to be recognised before it can be explained");
  assert.match(js.body, /switchTab\('shop'\)/,
    "and the nudge should lead somewhere it can be fixed");
  assert.match(js.body, /PREMIUM_REQUIRED/,
    "the server's refusal needs handling too, for a tab left open");
});

test("the upsell nudge is styled and reachable", async () => {
  const page = await app.inject({ method: "GET", url: "/owner-welcome", headers: { cookie: `wavetag_session=${cookie}` } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /\.pt-act-upsell \{/, "a bare <button> would not inherit the nudge styling");
  assert.match(page.body, /\.pt-act-upsell:focus-visible/, "and it must be keyboard-reachable");
});
