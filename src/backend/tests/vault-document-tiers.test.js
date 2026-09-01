// How much of the document vault each tag is entitled to.
//
// Document storage used to be flat: any vehicle, six documents. It is now the
// first of the paid add-ons — an E-Tag keeps one document, a premium tag keeps
// three, and a premium tag with a live subscription keeps more. The subscription
// itself is not on sale yet; what is built is the entitlement it will read.
//
// Two things make this worth its own file rather than a couple of assertions
// bolted onto the upload tests.
//
// The first is that the allowance is the thing being sold, so it has to hold on
// the SERVER. The page draws what the server tells it, and a page can be
// skipped; every test here goes through the real upload route.
//
// The second is that the limit is per TAG. An owner with a premium sticker on
// the car and an E-Tag on the scooter has two different allowances at once, and
// the failure that would matter most — the paid tag quietly enlarging the free
// one, or the free one shrinking the paid one — is invisible unless somebody
// holds both.
//
// Deliberately also covered: owners who ALREADY hold more than their new
// allowance. The tiers arrived after the documents did, and an owner who
// uploaded six under the old flat cap must lose none of them.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { createSession } from "../lib/auth/session.js";
import { getVaultBucket } from "../lib/db/repositories.js";
import { fulfilPaidOrder } from "../lib/core/order-fulfilment.js";
import {
  DOCS_PER_ETAG,
  DOCS_PER_PREMIUM_TAG,
  DOCS_PER_SUBSCRIBED_TAG,
  PREMIUM_TRIAL_DAYS,
  TIER_ETAG,
  TIER_PREMIUM,
  TIER_SUBSCRIBED,
  TIER_TRIAL,
  documentEntitlement,
  hasActiveDocumentSubscription,
  isInPremiumTrial
} from "../lib/core/vault.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  assertUndeliverableIdentifier,
  TEST_ORIGIN
} from "./helpers.js";

const OWNER_EMAIL = assertUndeliverableIdentifier("qa-vault-tiers@parktag-test.invalid");
const VAULT_PIN = "7261";
const ORIGIN = TEST_ORIGIN;
const BOUNDARY = "----vaultTiersBoundary";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478" +
    "9c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);

const DAY = 24 * 60 * 60 * 1000;

let app;
let env;
let collections;
let bucket;
let owner;
let cookie;
let plateCounter = 0;

// ── Plumbing ────────────────────────────────────────────────────────────────

function multipart(fields, file) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    );
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`
    )
  );
  parts.push(file.body);
  parts.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

function call(method, url, { payload } = {}) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: ORIGIN },
    ...(payload === undefined ? {} : { payload })
  });
}

function upload(tagId, label = "RC") {
  return app.inject({
    method: "POST",
    url: "/api/owner/vault/documents",
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: ORIGIN, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart(
      { tagId, docType: "other", label },
      { filename: "doc.png", contentType: "image/png", body: PNG }
    )
  });
}

// Upload `count` documents one after another and report each status code, so a
// test can say "the first three landed and the fourth did not" in one line.
async function uploadSeries(tagId, count) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const r = await upload(tagId, `Doc ${i + 1}`);
    codes.push(r.statusCode);
  }
  return codes;
}

// `extra` is spread last so a test can override the tier fields.
async function makeTag(extra = {}) {
  plateCounter += 1;
  const inserted = await collections.tags.insertOne({
    ownerId: owner._id,
    plateNumber: `QA01TR${String(plateCounter).padStart(4, "0")}`,
    vehicleType: "car",
    vehicleLabel: "Car",
    status: "active",
    token: `qa-vault-tiers-${plateCounter}`,
    createdAt: new Date().toISOString(),
    ...extra
  });
  return String(inserted.insertedId);
}

// Bought long enough ago that the complimentary period is over. This is the
// steady state a premium tag spends nearly all its life in, so it is what
// "a premium tag" means everywhere below unless a test says otherwise.
const LONG_AGO = () => new Date(Date.now() - (PREMIUM_TRIAL_DAYS + 15) * DAY).toISOString();

const etag = () => makeTag({ premium: false });
const premiumTag = () => makeTag({ premium: true, plan: "premium", premiumSince: LONG_AGO() });
const trialTag = (boughtDaysAgo = 0) =>
  makeTag({
    premium: true,
    plan: "premium",
    premiumSince: new Date(Date.now() - boughtDaysAgo * DAY).toISOString()
  });
// Deliberately also past the free period, so what this tag proves is that the
// SUBSCRIPTION grants the top tier — not that the trial happens to be running.
const subscribedTag = (endsInMs = 30 * DAY) =>
  makeTag({
    premium: true,
    plan: "premium",
    premiumSince: LONG_AGO(),
    documentSubscription: {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + endsInMs).toISOString()
    }
  });

async function docCount(tagId) {
  return collections.vaultDocuments.countDocuments({ ownerId: owner._id, tagId });
}

async function wipe() {
  await purgeLoginCollections(collections);
  await collections.tags.deleteMany({}).catch(() => {});
  await collections.vaultDocuments.deleteMany({}).catch(() => {});
  await collections.vaultGrants.deleteMany({}).catch(() => {});
  await collections.vaultUsage.deleteMany({}).catch(() => {});
  await collections.shopOrders.deleteMany({}).catch(() => {});
  const files = await bucket.find({}).toArray();
  for (const f of files) await bucket.delete(f._id).catch(() => {});
}

before(async () => {
  ({ app, env, collections } = await startTestApp());
  bucket = await getVaultBucket(env);
});

after(async () => {
  await wipe();
  await stopTestApp(app);
});

beforeEach(async () => {
  await wipe();
  owner = await createTestOwner(collections, { email: OWNER_EMAIL });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });
  const pin = await call("POST", "/api/owner/vault/pin", { payload: { pin: VAULT_PIN } });
  assert.equal(pin.statusCode, 200, `precondition: PIN not set — ${pin.body}`);
});

// ── The rule itself ─────────────────────────────────────────────────────────
//
// No database. documentEntitlement is the single place the tiers are decided,
// and everything below this block only checks that the routes actually consult
// it — so the awkward inputs belong here, where they are cheap.

describe("documentEntitlement", () => {
  test("the three tiers are distinct and increase", () => {
    assert.ok(DOCS_PER_ETAG < DOCS_PER_PREMIUM_TAG, "a premium tag must be worth more than a free one");
    assert.ok(DOCS_PER_PREMIUM_TAG < DOCS_PER_SUBSCRIBED_TAG, "the subscription must be worth something");
    assert.equal(new Set([TIER_ETAG, TIER_PREMIUM, TIER_SUBSCRIBED]).size, 3);
  });

  test("a tag with no premium flag at all is an E-Tag", () => {
    // Tags issued before the flag existed have no field, not `premium: false`.
    // Reading a missing field as premium would hand every legacy tag the paid
    // allowance.
    assert.equal(documentEntitlement({}).tier, TIER_ETAG);
    assert.equal(documentEntitlement({ premium: false }).tier, TIER_ETAG);
    assert.equal(documentEntitlement(null).tier, TIER_ETAG);
    assert.equal(documentEntitlement(undefined).maxDocs, DOCS_PER_ETAG);
  });

  test("premium without a subscription is the middle tier", () => {
    const e = documentEntitlement({ premium: true });
    assert.equal(e.tier, TIER_PREMIUM);
    assert.equal(e.maxDocs, DOCS_PER_PREMIUM_TAG);
    assert.equal(e.subscribed, false);
  });

  test("a live subscription lifts a premium tag and nothing else", () => {
    const live = { status: "active", currentPeriodEnd: new Date(Date.now() + DAY).toISOString() };
    assert.equal(documentEntitlement({ premium: true, documentSubscription: live }).maxDocs, DOCS_PER_SUBSCRIBED_TAG);
    // A subscription stamped on an E-Tag cannot conjure premium out of nothing.
    // The tiers are a ladder, not a set of independent switches.
    assert.equal(documentEntitlement({ premium: false, documentSubscription: live }).maxDocs, DOCS_PER_ETAG);
  });

  test("an expired subscription falls back rather than lingering", () => {
    // The clock decides, not a downgrade job. A renewal that fails overnight
    // must not leave the larger allowance open until somebody notices.
    const dead = { status: "active", currentPeriodEnd: new Date(Date.now() - 1000).toISOString() };
    const e = documentEntitlement({ premium: true, documentSubscription: dead });
    assert.equal(e.tier, TIER_PREMIUM);
    assert.equal(e.maxDocs, DOCS_PER_PREMIUM_TAG);
  });

  test("anything other than a live subscription reads as not subscribed", () => {
    const cases = [
      undefined,
      null,
      {},
      { status: "cancelled", currentPeriodEnd: new Date(Date.now() + DAY).toISOString() },
      { status: "past_due", currentPeriodEnd: new Date(Date.now() + DAY).toISOString() },
      // Junk in the date must read as expired, never as unlimited — a corrupt
      // field is not a reason to give storage away.
      { status: "active", currentPeriodEnd: "whenever" },
      { status: "active", currentPeriodEnd: "" }
    ];
    for (const documentSubscription of cases) {
      assert.equal(
        hasActiveDocumentSubscription({ premium: true, documentSubscription }),
        false,
        `treated as subscribed: ${JSON.stringify(documentSubscription)}`
      );
    }
  });

  test("a subscription with no end date is open-ended", () => {
    // What a comped tag looks like. Distinct from a missing subscription.
    assert.equal(hasActiveDocumentSubscription({ documentSubscription: { status: "active" } }), true);
  });
});

// ── The allowance on the upload route ───────────────────────────────────────

describe("what each tier can actually store", () => {
  test(`an E-Tag stores ${DOCS_PER_ETAG} document and refuses the next`, async () => {
    const tagId = await etag();
    const codes = await uploadSeries(tagId, DOCS_PER_ETAG + 1);

    assert.deepEqual(
      codes,
      [...Array(DOCS_PER_ETAG).fill(200), 409],
      `an E-Tag did not stop at ${DOCS_PER_ETAG}: ${codes.join(", ")}`
    );
    assert.equal(await docCount(tagId), DOCS_PER_ETAG);
  });

  test(`a premium tag stores ${DOCS_PER_PREMIUM_TAG} and refuses the next`, async () => {
    const tagId = await premiumTag();
    const codes = await uploadSeries(tagId, DOCS_PER_PREMIUM_TAG + 1);

    assert.deepEqual(codes, [...Array(DOCS_PER_PREMIUM_TAG).fill(200), 409], codes.join(", "));
    assert.equal(await docCount(tagId), DOCS_PER_PREMIUM_TAG);
  });

  test("a subscription stores more than a premium tag alone", async () => {
    const tagId = await subscribedTag();
    const codes = await uploadSeries(tagId, DOCS_PER_PREMIUM_TAG + 1);

    assert.ok(
      codes.every((c) => c === 200),
      `the subscription bought nothing — the ${DOCS_PER_PREMIUM_TAG + 1}th upload returned ${codes[DOCS_PER_PREMIUM_TAG]}`
    );
    assert.equal(await docCount(tagId), DOCS_PER_PREMIUM_TAG + 1);
  });

  test(`a subscribed tag still stops at ${DOCS_PER_SUBSCRIBED_TAG}`, async () => {
    // "More" is not "unlimited". The bytes still live in the same Atlas
    // cluster, so the top tier is a bigger number and not the absence of one.
    const tagId = await subscribedTag();
    const codes = await uploadSeries(tagId, DOCS_PER_SUBSCRIBED_TAG + 1);

    assert.equal(codes[DOCS_PER_SUBSCRIBED_TAG], 409, "the top tier had no ceiling at all");
    assert.equal(await docCount(tagId), DOCS_PER_SUBSCRIBED_TAG);
  });

  test("an expired subscription is held to the premium allowance", async () => {
    const tagId = await subscribedTag(-DAY);
    const codes = await uploadSeries(tagId, DOCS_PER_PREMIUM_TAG + 1);

    assert.equal(codes[DOCS_PER_PREMIUM_TAG], 409, "a lapsed subscription still bought extra slots");
    assert.equal(await docCount(tagId), DOCS_PER_PREMIUM_TAG);
  });
});

describe(`the ${PREMIUM_TRIAL_DAYS}-day free period that comes with a premium tag`, () => {
  test("a tag bought today gets the whole allowance", async () => {
    const tagId = await trialTag(0);
    const codes = await uploadSeries(tagId, DOCS_PER_SUBSCRIBED_TAG);

    assert.deepEqual(codes, Array(DOCS_PER_SUBSCRIBED_TAG).fill(200),
      `a brand-new premium tag did not get the free tier: ${codes.join(", ")}`);
  });

  test("it is still running on the last day and over on the first day after", () => {
    // The boundary itself, checked against the clock rather than by uploading:
    // a job that runs late must not extend anybody's free period.
    const bought = (daysAgo) => ({ premium: true, premiumSince: new Date(Date.now() - daysAgo * DAY).toISOString() });

    assert.equal(isInPremiumTrial(bought(PREMIUM_TRIAL_DAYS - 1)), true, "expired a day early");
    assert.equal(isInPremiumTrial(bought(PREMIUM_TRIAL_DAYS + 1)), false, "outlasted its period");
    assert.equal(documentEntitlement(bought(1)).maxDocs, DOCS_PER_SUBSCRIBED_TAG);
    assert.equal(documentEntitlement(bought(PREMIUM_TRIAL_DAYS + 1)).maxDocs, DOCS_PER_PREMIUM_TAG);
  });

  test("a tag past its free period is back to the premium allowance", async () => {
    const tagId = await trialTag(PREMIUM_TRIAL_DAYS + 5);
    const codes = await uploadSeries(tagId, DOCS_PER_PREMIUM_TAG + 1);

    assert.equal(codes[DOCS_PER_PREMIUM_TAG], 409, "the free period never ended");
  });

  test("an E-Tag gets no free period at all", () => {
    // The trial rides on the premium purchase. A free tag has bought nothing.
    assert.equal(isInPremiumTrial({ premium: false, premiumSince: new Date().toISOString() }), false);
    assert.equal(documentEntitlement({ premium: false, createdAt: new Date().toISOString() }).maxDocs, DOCS_PER_ETAG);
  });

  test("a tag with no usable date gets no free period rather than an endless one", () => {
    // Fails towards expiry. A malformed tag must not be able to mint storage.
    assert.equal(isInPremiumTrial({ premium: true }), false);
    assert.equal(isInPremiumTrial({ premium: true, premiumSince: "sometime" }), false);
    assert.equal(documentEntitlement({ premium: true, premiumSince: null }).tier, TIER_PREMIUM);
  });

  test("an admin-issued tag dates its period from when it was created", () => {
    // Batch-issued premium tags carry no premiumSince, so createdAt stands in.
    const fresh = { premium: true, createdAt: new Date().toISOString() };
    const stale = { premium: true, createdAt: new Date(Date.now() - 200 * DAY).toISOString() };
    assert.equal(documentEntitlement(fresh).tier, TIER_TRIAL);
    assert.equal(documentEntitlement(stale).tier, TIER_PREMIUM);
  });

  test("the page is told when the period ends, not merely that it is on", async () => {
    // An owner can fill all ten slots during the trial and be over the
    // allowance on day 91. They keep everything, but they must be able to see
    // that coming while they still have room to plan around it.
    const tagId = await trialTag(5);
    const body = JSON.parse((await call("GET", `/api/owner/vault/documents?tagId=${tagId}`)).body);

    assert.equal(body.entitlement.tier, TIER_TRIAL);
    assert.equal(body.entitlement.subscribed, false, "a trial is not a subscription");
    assert.ok(body.entitlement.trialEndsAt, "the page cannot count down what it is not told");

    const daysLeft = (new Date(body.entitlement.trialEndsAt).getTime() - Date.now()) / DAY;
    assert.ok(daysLeft > PREMIUM_TRIAL_DAYS - 6 && daysLeft < PREMIUM_TRIAL_DAYS - 4,
      `expected about ${PREMIUM_TRIAL_DAYS - 5} days left, got ${daysLeft.toFixed(1)}`);
  });

  test("paying during the free period reads as subscribed, not as a trial", async () => {
    // Same allowance either way. But telling somebody who has just paid that
    // their access expires in three months would be alarming and wrong.
    const tagId = await makeTag({
      premium: true,
      premiumSince: new Date().toISOString(),
      documentSubscription: { status: "active", currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString() }
    });
    const body = JSON.parse((await call("GET", `/api/owner/vault/documents?tagId=${tagId}`)).body);

    assert.equal(body.entitlement.tier, TIER_SUBSCRIBED);
    assert.equal(body.entitlement.subscribed, true);
    assert.equal(body.entitlement.trialEndsAt, undefined, "a subscriber must not be shown a countdown");
  });

  test("documents saved during the free period survive it", async () => {
    // The promise the copy makes. Nothing is deleted when the period lapses —
    // the owner simply cannot add an eleventh.
    const tagId = await trialTag(0);
    await uploadSeries(tagId, DOCS_PER_SUBSCRIBED_TAG);
    assert.equal(await docCount(tagId), DOCS_PER_SUBSCRIBED_TAG);

    // Age the tag past its period, exactly as the calendar would.
    await collections.tags.updateOne(
      { _id: new ObjectId(tagId) },
      { $set: { premiumSince: LONG_AGO() } }
    );

    const listing = JSON.parse((await call("GET", `/api/owner/vault/documents?tagId=${tagId}`)).body);
    assert.equal(listing.documents.length, DOCS_PER_SUBSCRIBED_TAG, "documents were lost when the period ended");
    assert.equal(listing.entitlement.maxDocs, DOCS_PER_PREMIUM_TAG, "the allowance did not drop");
    assert.equal((await upload(tagId)).statusCode, 409, "an eleventh was accepted after the period ended");
  });
});

describe("the allowance belongs to the tag, not the account", () => {
  test("a premium tag on one vehicle does not enlarge the E-Tag on another", async () => {
    // The failure that would quietly give the product away: one purchase
    // unlocking every vehicle on the account.
    const paid = await premiumTag();
    const free = await etag();

    assert.deepEqual(await uploadSeries(paid, DOCS_PER_PREMIUM_TAG), Array(DOCS_PER_PREMIUM_TAG).fill(200));

    const codes = await uploadSeries(free, DOCS_PER_ETAG + 1);
    assert.equal(codes[DOCS_PER_ETAG], 409, "the E-Tag inherited the premium tag's allowance");
    assert.equal(await docCount(free), DOCS_PER_ETAG);
  });

  test("a full E-Tag does not shrink the premium tag beside it", async () => {
    // And the mirror image, which would be the worse bug of the two: somebody
    // who paid getting less because of a vehicle they did not pay for.
    const free = await etag();
    const paid = await premiumTag();

    await uploadSeries(free, DOCS_PER_ETAG + 1);
    assert.deepEqual(
      await uploadSeries(paid, DOCS_PER_PREMIUM_TAG),
      Array(DOCS_PER_PREMIUM_TAG).fill(200),
      "a full free vehicle ate into the paid one"
    );
  });

  test("the per-owner byte cap is still shared across vehicles", async () => {
    // The tiers changed the document COUNT. They did not change what the byte
    // cap is for — it exists to stop the cluster filling up, and that reason
    // does not vary with what somebody paid.
    const status = await call("GET", "/api/owner/vault/status");
    const { limits } = JSON.parse(status.body);
    assert.ok(limits.maxBytesPerOwner > 0, "the owner-wide byte allowance disappeared");
    assert.equal(limits.tiers.etag, DOCS_PER_ETAG);
    assert.equal(limits.tiers.premium, DOCS_PER_PREMIUM_TAG);
    assert.equal(limits.tiers.subscribed, DOCS_PER_SUBSCRIBED_TAG);
  });
});

describe("the cap holds when uploads arrive at once", () => {
  test(`${DOCS_PER_ETAG + 4} simultaneous uploads to an E-Tag store exactly ${DOCS_PER_ETAG}`, async () => {
    // The tier bound is inside the atomic reservation, not only in the cheap
    // pre-check — otherwise every concurrent request reads the same empty
    // vault and they all believe they have room. This is the same shape that
    // stored 12 documents against a cap of 6 before the reservation existed.
    const tagId = await etag();
    const attempts = DOCS_PER_ETAG + 4;
    const responses = await Promise.all(Array.from({ length: attempts }, () => upload(tagId)));

    const accepted = responses.filter((r) => r.statusCode === 200).length;
    assert.equal(accepted, DOCS_PER_ETAG, `${accepted} uploads were accepted against a cap of ${DOCS_PER_ETAG}`);
    assert.equal(await docCount(tagId), DOCS_PER_ETAG);
    assert.equal(
      (await bucket.find({}).toArray()).length,
      DOCS_PER_ETAG,
      "the refused uploads left their bytes behind in GridFS"
    );
  });

  test(`${DOCS_PER_PREMIUM_TAG + 4} simultaneous uploads to a premium tag store exactly ${DOCS_PER_PREMIUM_TAG}`, async () => {
    const tagId = await premiumTag();
    const responses = await Promise.all(
      Array.from({ length: DOCS_PER_PREMIUM_TAG + 4 }, () => upload(tagId))
    );

    assert.equal(responses.filter((r) => r.statusCode === 200).length, DOCS_PER_PREMIUM_TAG);
    assert.equal(await docCount(tagId), DOCS_PER_PREMIUM_TAG);
  });
});

describe("what the owner is told, and what the page is given", () => {
  test("a refusal says which limit was hit, not just that something failed", async () => {
    const tagId = await etag();
    await upload(tagId);
    const refused = await upload(tagId);
    const body = JSON.parse(refused.body);

    assert.equal(refused.statusCode, 409);
    assert.equal(body.code, "DOCUMENT_LIMIT_REACHED", "storage-full and vehicle-full must be distinguishable");
    assert.equal(body.entitlement.tier, TIER_ETAG);
    assert.equal(body.entitlement.maxDocs, DOCS_PER_ETAG);
  });

  test("an E-Tag owner is told what the upgrade buys them", async () => {
    // A bare "you have reached your limit" reads as a fault. This is a tier,
    // so the message has to name the way out of it.
    const tagId = await etag();
    await upload(tagId);
    const { error } = JSON.parse((await upload(tagId)).body);

    assert.match(error, /premium/i, "the refusal does not mention the upgrade");
    assert.match(error, new RegExp(String(DOCS_PER_PREMIUM_TAG)), "it does not say what the upgrade is worth");
  });

  test("a premium owner is not sold something that is not for sale", async () => {
    // The subscription has no checkout yet. Advertising it in an error message
    // would be worse than saying nothing.
    const tagId = await premiumTag();
    await uploadSeries(tagId, DOCS_PER_PREMIUM_TAG);
    const { error } = JSON.parse((await upload(tagId)).body);

    assert.match(error, /delete one/i, "it should say how to make room");
    assert.doesNotMatch(error, /subscri/i);
  });

  test("the status route answers for the vehicle it was asked about", async () => {
    const free = await etag();
    const paid = await subscribedTag();

    const a = JSON.parse((await call("GET", `/api/owner/vault/status?tagId=${free}`)).body);
    const b = JSON.parse((await call("GET", `/api/owner/vault/status?tagId=${paid}`)).body);

    assert.equal(a.entitlement.maxDocs, DOCS_PER_ETAG);
    assert.equal(b.entitlement.maxDocs, DOCS_PER_SUBSCRIBED_TAG);
  });

  test("with no vehicle named it reports no allowance rather than guessing one", async () => {
    // A number the upload route would then contradict is worse than none.
    const r = JSON.parse((await call("GET", "/api/owner/vault/status")).body);
    assert.equal(r.entitlement, null);
  });

  test("another owner's tag yields no allowance", async () => {
    const stranger = await createTestOwner(collections, {
      email: assertUndeliverableIdentifier("qa-vault-tiers-other@parktag-test.invalid")
    });
    const theirs = await collections.tags.insertOne({
      ownerId: stranger._id,
      plateNumber: "QA01TRXX99",
      status: "active",
      premium: true,
      token: "qa-vault-tiers-stranger",
      createdAt: new Date().toISOString()
    });

    const r = JSON.parse((await call("GET", `/api/owner/vault/status?tagId=${String(theirs.insertedId)}`)).body);
    assert.equal(r.entitlement, null, "a tag belonging to somebody else answered for its allowance");
  });

  test("the listing carries the allowance and the count the page draws", async () => {
    const tagId = await premiumTag();
    await upload(tagId);

    const body = JSON.parse((await call("GET", `/api/owner/vault/documents?tagId=${tagId}`)).body);
    assert.equal(body.entitlement.tier, TIER_PREMIUM);
    assert.equal(body.entitlement.maxDocs, DOCS_PER_PREMIUM_TAG);
    assert.equal(body.documentCount, 1);
  });
});

describe("the page reads the allowance rather than working it out", () => {
  // The server refuses what it should regardless — everything above proves
  // that. What these lock in is that the PAGE cannot drift into a second,
  // disagreeing copy of the rule, which is the failure that shows an owner a
  // form the upload then rejects, or hides one they were entitled to.
  async function documentsScript() {
    const r = await app.inject({ method: "GET", url: "/scripts/owner/documents.js" });
    assert.equal(r.statusCode, 200, "the documents page script must be served");
    return r.body;
  }

  test("the allowance comes from the server's answer", async () => {
    const js = await documentsScript();
    assert.match(js, /r\.data\.entitlement/, "the page must take the tier from the API");
    assert.doesNotMatch(
      js,
      /maxDocsPerVehicle/,
      "the flat per-vehicle cap is gone — a page still reading it would draw a limit nobody enforces"
    );
  });

  test("it asks about the vehicle it is showing", async () => {
    // The allowance is per tag, so a status call with no tagId comes back with
    // none — and the page would then show a vehicle with no room at all.
    const js = await documentsScript();
    assert.match(js, /\/status\?tagId=/, "the status call must name the vehicle");
  });

  test("the upgrade CTA opens the shop on this vehicle's replacement", async () => {
    const js = await documentsScript();
    assert.match(js, /\/owner-welcome\?shop=1&replace=/,
      "the upsell must carry the tag, or it lands on a generic shop page");
  });

  test("every upload goes through the compression pass", async () => {
    // A 4.79MB photo of an RC is stored as an 89KB WebP. That is what makes the
    // allowances above affordable at all, so an upload path that quietly stopped
    // compressing would not fail anything — it would just cost 50x the storage.
    const js = await documentsScript();
    assert.match(js, /from "\.\/document-compress\.js"/, "the page must import the compression module");
    assert.match(js, /await prepareDocument\(/, "and actually run it on the picked file");
    assert.doesNotMatch(js, /function makeThumbnail/,
      "the old second decode is gone — one decode now feeds both the document and its thumbnail");
  });

  test("the compression module is served where the page imports it from", async () => {
    // A bare module specifier is resolved by the browser without the page's
    // version stamp, so this file is fetched by its own path and must exist there.
    const r = await app.inject({ method: "GET", url: "/scripts/owner/document-compress.js" });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers["content-type"] || "", /javascript/);
    assert.match(r.body, /export async function prepareDocument/);
  });

  test("the size limit is applied to what is stored, not to what was picked", async () => {
    // A 6MB photo compresses to well under the cap. Checking the picked file
    // would refuse a document we can comfortably store.
    const js = await documentsScript();
    assert.match(js, /if \(file\.size > maxFileBytes\)/,
      "the cap must be measured against the compressed file");
    assert.doesNotMatch(js, /picked\.size > maxFileBytes/,
      "the picked file's size is not what gets stored");
  });
});

describe("owners who already hold more than their new allowance", () => {
  test("nothing they uploaded under the old flat cap is taken away", async () => {
    // The tiers arrived after the documents did. An E-Tag owner with six
    // documents keeps six: a limit refuses the NEXT upload, it does not reach
    // backwards and delete.
    const tagId = await etag();
    const existing = 6;
    for (let i = 0; i < existing; i += 1) {
      await collections.vaultDocuments.insertOne({
        docId: `legacy-tier-${i}`.padEnd(32, "0"),
        ownerId: owner._id,
        tagId,
        docType: "other",
        label: `Legacy ${i}`,
        mimeType: "image/png",
        size: 100,
        thumb: null,
        fileId: null,
        createdAt: new Date().toISOString()
      });
    }

    const listing = JSON.parse((await call("GET", `/api/owner/vault/documents?tagId=${tagId}`)).body);
    assert.equal(listing.documents.length, existing, "an over-allowance owner lost documents");
    assert.equal(listing.documentCount, existing);
    assert.equal(listing.entitlement.maxDocs, DOCS_PER_ETAG);
  });

  test("they can still read and delete, they simply cannot add", async () => {
    const tagId = await etag();
    const first = await upload(tagId);
    assert.equal(first.statusCode, 200, first.body);
    const docId = JSON.parse(first.body).document.id;

    // Over the allowance now — planted directly, as a pre-tier owner's would be.
    await collections.vaultDocuments.insertOne({
      docId: "legacy-tier-extra".padEnd(32, "0"),
      ownerId: owner._id,
      tagId,
      docType: "other",
      label: "Legacy extra",
      mimeType: "image/png",
      size: 100,
      thumb: null,
      fileId: null,
      createdAt: new Date().toISOString()
    });

    const file = await call("GET", `/api/owner/vault/documents/${docId}/file`);
    assert.equal(file.statusCode, 200, "an over-allowance owner could not read their own document");

    assert.equal((await upload(tagId)).statusCode, 409, "they were allowed to add another");

    const del = await call("DELETE", `/api/owner/vault/documents/${docId}`);
    assert.equal(del.statusCode, 200, "an over-allowance owner could not delete their way back down");
  });

  test("deleting down to the allowance frees the slot again", async () => {
    const tagId = await etag();
    const first = await upload(tagId);
    const docId = JSON.parse(first.body).document.id;

    assert.equal((await upload(tagId)).statusCode, 409, "precondition: the E-Tag was not full");
    await call("DELETE", `/api/owner/vault/documents/${docId}`);

    assert.equal((await upload(tagId)).statusCode, 200, "a freed slot could not be reused");
  });
});

describe("buying a premium tag enlarges the vehicle it replaces", () => {
  test("the upgrade lifts the allowance and keeps the document that moved", async () => {
    // The M18 replacement path: the E-Tag is soft-deleted, a premium tag is
    // minted for the same car, and reassignVaultDocuments moves the paperwork
    // across. The point of the purchase, from this page's side, is that the
    // vehicle can now hold more than one document.
    const oldTagId = await etag();
    assert.equal((await upload(oldTagId, "RC")).statusCode, 200);
    assert.equal((await upload(oldTagId, "Insurance")).statusCode, 409, "precondition: the E-Tag was not capped");

    const order = {
      orderId: "order_tier_upgrade",
      ownerId: owner._id,
      status: "created",
      replaceTagId: oldTagId,
      productId: "premium-tag",
      amount: 49900
    };
    await collections.shopOrders.insertOne({ ...order });
    const outcome = await fulfilPaidOrder(env, collections, {
      order,
      paymentId: "pay_tier_upgrade",
      log: { info() {}, warn() {}, error() {} }
    });

    const listing = JSON.parse(
      (await call("GET", `/api/owner/vault/documents?tagId=${outcome.newTagId}`)).body
    );
    assert.equal(listing.documents.length, 1, "the document did not follow the vehicle");
    // The purchase mints the tag, which starts its free period — so the vehicle
    // lands on the top tier rather than on the bare premium allowance.
    assert.equal(listing.entitlement.tier, TIER_TRIAL);
    assert.equal(listing.entitlement.maxDocs, DOCS_PER_SUBSCRIBED_TAG);
    assert.ok(listing.entitlement.trialEndsAt, "the new tag's free period has no end date");

    // And the extra slots are real, not just reported.
    const codes = await uploadSeries(outcome.newTagId, DOCS_PER_SUBSCRIBED_TAG - 1);
    assert.deepEqual(codes, Array(DOCS_PER_SUBSCRIBED_TAG - 1).fill(200), codes.join(", "));
    assert.equal(await docCount(outcome.newTagId), DOCS_PER_SUBSCRIBED_TAG);
  });

  test("once the free period lapses the upgraded vehicle settles at the premium allowance", async () => {
    const oldTagId = await etag();
    const order = {
      orderId: "order_tier_upgrade_lapse",
      ownerId: owner._id,
      status: "created",
      replaceTagId: oldTagId,
      productId: "premium-tag",
      amount: 49900
    };
    await collections.shopOrders.insertOne({ ...order });
    const outcome = await fulfilPaidOrder(env, collections, {
      order,
      paymentId: "pay_tier_upgrade_lapse",
      log: { info() {}, warn() {}, error() {} }
    });

    await collections.tags.updateOne(
      { _id: new ObjectId(outcome.newTagId) },
      { $set: { premiumSince: LONG_AGO() } }
    );

    const codes = await uploadSeries(outcome.newTagId, DOCS_PER_PREMIUM_TAG + 1);
    assert.equal(codes[DOCS_PER_PREMIUM_TAG], 409, "the free period outlived the purchase");
  });
});
