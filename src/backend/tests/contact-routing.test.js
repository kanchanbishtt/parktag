// Tests for the two contact-path findings on the scan page.
//
// #2 — a masked call is routed on the caller's number alone, and that number is
// taken on trust at registration. A stranger who knew someone's mobile number
// could register it against a tag of their own and take that person's next
// call. Registration now refuses a number another client is already holding,
// and the webhook refuses to guess between conflicting routes.
//
// #3 — POST /api/contact-requests accepted action:"call", contacted nobody
// (only the message branch ever dispatches), and still spent the tag's one free
// contact on the way out.
//
// The two are in one file because they are one flow: which endpoint may set up
// a call, and who is allowed to point it at whom.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";
import { isSupportedContactReason } from "../lib/core/contact-actions.js";

const PLATE = "DL09QA7731";
const RIGHT = "7731";

// Mirrors MAX_EMERGENCY_CALLS_PER_DAY in routes/public/index.js, recomputed so
// that changing the ceiling without revisiting this fails here.
const MAX_EMERGENCY_CALLS_PER_DAY = 5;

const OWNER_PHONE = "+919000000021";
const SECOND_OWNER_PHONE = "+919000000022";

let app;
let collections;

let fixtureCounter = 0;
const tokens = [];
const ownerIds = [];
const phones = [];

// A caller number per test. Routes are keyed by number and live for ten
// minutes, so a number shared between tests would let one test's registration
// contest the next one.
function nextPhone() {
  fixtureCounter += 1;
  const phone = `9000${String(fixtureCounter).padStart(6, "0")}`;
  phones.push(`+91${phone}`);
  return phone;
}

async function createTag({ premium = false, withOwner = true, ownerPhone = OWNER_PHONE } = {}) {
  fixtureCounter += 1;
  const token = `qaroute${String(fixtureCounter).padStart(3, "0")}${"b7c8d9e0".repeat(6)}`;

  let ownerId = null;
  if (withOwner) {
    const { insertedId } = await collections.owners.insertOne({
      displayName: "QA Route Fixture",
      mobile: ownerPhone,
      phone: ownerPhone,
      role: "owner",
      createdAt: new Date().toISOString()
    });
    ownerId = insertedId;
    ownerIds.push(insertedId);
  }

  await collections.tags.insertOne({
    token,
    ownerId,
    status: "active",
    premium,
    plateNumber: PLATE,
    vehicleLabel: "QA Fixture Car",
    vehicleType: "car",
    createdAt: new Date().toISOString()
  });
  tokens.push(token);
  return token;
}

async function grantFor(token, address) {
  const res = await app.inject({
    method: "POST",
    url: `/api/tags/${token}/verify`,
    remoteAddress: address,
    payload: { lastFour: RIGHT }
  });
  assert.equal(res.statusCode, 200, "fixture verify should succeed");
  return res.json().grant;
}

function post(url, payload, address) {
  return app.inject({ method: "POST", url, remoteAddress: address, payload });
}

async function registerCall(token, phone, address) {
  return post(
    `/api/tags/${token}/register-call`,
    { phone, grant: await grantFor(token, address) },
    address
  );
}

function liveRoutesFor(callerPhone) {
  return collections.pendingCalls
    .find({ callerPhone, consumed: false, expiresAt: { $gt: new Date() } })
    .toArray();
}

// Exotel sends the caller number as CallFrom and nothing else useful, so this
// drives the webhook exactly as Exotel would.
function dial(callerPhone) {
  return app.inject({
    method: "GET",
    url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(callerPhone)}&CallSid=qa-test-sid`
  });
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await collections.rateLimits.deleteMany({}).catch(() => {});
});

after(async () => {
  for (const token of tokens) {
    await collections.tags.deleteMany({ token });
    await collections.verificationSessions.deleteMany({ token });
    await collections.contactRequests.deleteMany({ token });
    await collections.pendingCalls.deleteMany({ token });
  }
  for (const callerPhone of phones) {
    await collections.pendingCalls.deleteMany({ callerPhone });
  }
  for (const _id of ownerIds) {
    await collections.owners.deleteOne({ _id });
  }
  await collections.rateLimits.deleteMany({}).catch(() => {});
  await stopTestApp(app);
});

describe("contact-requests is the message endpoint only", () => {
  test("action:call is refused and costs the tag nothing", async () => {
    const token = await createTag();
    const phone = nextPhone();
    const address = uniqueAddress();
    const grant = await grantFor(token, address);

    const res = await post("/api/contact-requests", { token, grant, action: "call", phone }, address);

    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /register-call/);

    // The whole point of the finding: a request that contacted nobody must not
    // have spent the one free contact this E-Tag has.
    const tag = await collections.tags.findOne({ token });
    assert.notEqual(tag.freeContactUsed, true);
    assert.equal(await collections.contactRequests.countDocuments({ token }), 0);
    assert.equal((await liveRoutesFor(`+91${phone}`)).length, 0);
  });

  test("a missing action is refused rather than assumed", async () => {
    const token = await createTag();
    const address = uniqueAddress();
    const grant = await grantFor(token, address);

    const res = await post("/api/contact-requests", { token, grant }, address);

    assert.equal(res.statusCode, 400);

    const tag = await collections.tags.findOne({ token });
    assert.notEqual(tag.freeContactUsed, true);
  });

  test("a grant does not outlive the tag being deactivated", async () => {
    const token = await createTag();
    const address = uniqueAddress();
    const grant = await grantFor(token, address);

    // The owner marks the tag inactive after the scanner verified it — sold the
    // vehicle, lost the sticker. The grant is still inside its fifteen minutes.
    await collections.tags.updateOne({ token }, { $set: { status: "inactive" } });

    const res = await post(
      "/api/contact-requests",
      { token, grant, action: "message", messageChannel: "whatsapp" },
      address
    );

    assert.equal(res.statusCode, 404);
    assert.equal(await collections.contactRequests.countDocuments({ token }), 0);
  });
});

describe("caller number claims", () => {
  test("a malformed number is refused before anything is written", async () => {
    const token = await createTag();
    const address = uniqueAddress();
    const grant = await grantFor(token, address);

    for (const phone of ["abc", "+", "12"]) {
      const res = await post(`/api/tags/${token}/register-call`, { phone, grant }, address);
      assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(phone)}`);
    }

    const tag = await collections.tags.findOne({ token });
    assert.notEqual(tag.freeContactUsed, true);
    assert.equal(await collections.pendingCalls.countDocuments({ token }), 0);
  });

  test("one handset may hold routes for two vehicles at once", async () => {
    const first = await createTag();
    const second = await createTag({ ownerPhone: SECOND_OWNER_PHONE });
    const phone = nextPhone();
    const address = uniqueAddress();

    assert.equal((await registerCall(first, phone, address)).statusCode, 200);

    // Same handset, second vehicle. This is the flow the newest-wins sort in the
    // webhook exists for, so it must survive the contest check.
    assert.equal((await registerCall(second, phone, address)).statusCode, 200);

    const routes = await liveRoutesFor(`+91${phone}`);
    assert.equal(routes.length, 2);
    assert.equal(new Set(routes.map((r) => r.registrantIpHash)).size, 1);

    // Newest wins, unchanged: the vehicle they scanned most recently.
    const dialed = await dial(`+91${phone}`);
    assert.equal(dialed.body, SECOND_OWNER_PHONE);
  });

  test("a second client cannot re-point a number that is already held", async () => {
    const victimTag = await createTag();
    const attackerTag = await createTag({ ownerPhone: SECOND_OWNER_PHONE });

    const phone = nextPhone();
    const victimAddress = uniqueAddress();
    const attackerAddress = uniqueAddress();

    assert.equal((await registerCall(victimTag, phone, victimAddress)).statusCode, 200);

    // Someone else, who knows that number, tries to make it ring their own tag
    // instead — the hijack this control exists to stop.
    const attacker = await registerCall(attackerTag, phone, attackerAddress);

    assert.equal(attacker.statusCode, 409);
    assert.equal(attacker.json().code, "CALLER_IN_USE");

    // First writer keeps the route. Retiring it instead would strand the
    // scanner, whose free contact is already spent, on 402 for good.
    const routes = await liveRoutesFor(`+91${phone}`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].targetPhone, OWNER_PHONE);

    // Refusing cost the attacker's own tag nothing: no audit row, no burn.
    const attackerTagDoc = await collections.tags.findOne({ token: attackerTag });
    assert.notEqual(attackerTagDoc.freeContactUsed, true);
    assert.equal(await collections.contactRequests.countDocuments({ token: attackerTag }), 0);

    // And the call the scanner actually placed still reaches the right person.
    const dialed = await dial(`+91${phone}`);
    assert.equal(dialed.body, OWNER_PHONE);
  });

  test("the same handset may escalate from the owner call to Emergency", async () => {
    const token = await createTag();
    const phone = nextPhone();
    const address = uniqueAddress();

    await collections.tags.updateOne(
      { token },
      { $set: { emergencyContact: SECOND_OWNER_PHONE } }
    );

    assert.equal((await registerCall(token, phone, address)).statusCode, 200);

    const sos = await post(
      `/api/tags/${token}/register-emergency-call`,
      { phone, grant: await grantFor(token, address) },
      address
    );
    assert.equal(sos.statusCode, 200);

    // supersedePendingCalls retires the owner route for this tag, so the SOS
    // route is the one left standing — the accident case must not reach the
    // owner's unanswered phone.
    const routes = await liveRoutesFor(`+91${phone}`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].type, "scanner_to_emergency");
  });
});

describe("dial-whom routing", () => {
  test("conflicting routes from different clients get no answer", async () => {
    const token = await createTag();
    const phone = nextPhone();
    const callerPhone = `+91${phone}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Two live routes for one number, pointing at different people, registered
    // by different clients. Registration will not create this any more, so it is
    // built directly: rows written before that check existed look like this, and
    // so would two registrations that raced each other past it.
    await collections.pendingCalls.insertMany([
      {
        callerPhone,
        registrantIpHash: "client-one",
        targetPhone: OWNER_PHONE,
        token,
        type: "scanner_to_owner",
        consumed: false,
        createdAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt
      },
      {
        callerPhone,
        registrantIpHash: "client-two",
        targetPhone: SECOND_OWNER_PHONE,
        token,
        type: "scanner_to_owner",
        consumed: false,
        createdAt: new Date().toISOString(),
        expiresAt
      }
    ]);

    const dialed = await dial(callerPhone);

    // Empty body = Exotel plays a busy tone. Better than connecting the caller
    // to whichever row happened to be newest.
    assert.equal(dialed.body, "");

    // Neither row was consumed by the refusal.
    assert.equal((await liveRoutesFor(callerPhone)).length, 2);
  });

  test("an unknown caller is still a silent no-match", async () => {
    const dialed = await dial("+919000999999");
    assert.equal(dialed.body, "");
  });
});

describe("contact reasons", () => {
  // The map is a plain object literal, so a bare `REASON_LABELS[reason]` read
  // answers for every key on Object.prototype too — and the value it hands back
  // is a function, which the alert template stringifies into the owner's
  // message.
  test("prototype keys are not reasons", () => {
    for (const reason of ["lights", "towing", "parking", "window", "suspicious"]) {
      assert.equal(isSupportedContactReason(reason), true, `${reason} should be supported`);
    }

    for (const reason of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "isPrototypeOf",
      "propertyIsEnumerable"
    ]) {
      assert.equal(isSupportedContactReason(reason), false, `${reason} must not be a reason`);
    }
  });

  test("non-strings are not reasons", () => {
    for (const reason of [{}, [], 7, true, null, undefined, { $ne: null }]) {
      assert.equal(isSupportedContactReason(reason), false);
    }
  });

  test("an unrecognised reason is refused and nothing is stored", async () => {
    const token = await createTag();
    const address = uniqueAddress();
    const grant = await grantFor(token, address);

    const res = await post(
      "/api/contact-requests",
      { token, grant, action: "message", messageChannel: "whatsapp", reason: "constructor" },
      address
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /reason/);
    assert.equal(await collections.contactRequests.countDocuments({ token }), 0);
  });

  test("a supported reason gets past validation", async () => {
    // Deliberately an ownerless tag: it stops inside createContactAction at
    // "Tag has no owner", which is past the reason check and short of anything
    // that would message a real handset.
    const token = await createTag({ withOwner: false });
    const address = uniqueAddress();
    const grant = await grantFor(token, address);

    const res = await post(
      "/api/contact-requests",
      { token, grant, action: "message", messageChannel: "whatsapp", reason: "towing" },
      address
    );

    assert.equal(res.statusCode, 400);
    // The generic downstream failure, not the reason rejection above.
    assert.doesNotMatch(res.json().error, /reason/);
  });
});

describe("emergency call ceiling", () => {
  async function sosTag() {
    const token = await createTag();
    await collections.tags.updateOne(
      { token },
      { $set: { emergencyContact: SECOND_OWNER_PHONE } }
    );
    return token;
  }

  function registerSos(token, phone, address) {
    return grantFor(token, address).then((grant) =>
      post(`/api/tags/${token}/register-emergency-call`, { phone, grant }, address)
    );
  }

  test("a parallel burst cannot exceed the daily ceiling", async () => {
    const token = await sosTag();

    // Five different finders at the same vehicle, all at once — every one a
    // distinct address and number, so neither the per-address rate limit nor
    // the caller-number claim absorbs any of them. The tag ceiling is the only
    // thing counting, and before the fix they all read zero and all passed.
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => registerSos(token, nextPhone(), uniqueAddress()))
    );

    const allowed = responses.filter((r) => r.statusCode === 200).length;
    const refused = responses.filter((r) => r.statusCode === 429);

    assert.equal(allowed, MAX_EMERGENCY_CALLS_PER_DAY);
    assert.equal(refused.length, 8 - MAX_EMERGENCY_CALLS_PER_DAY);
    assert.equal(refused[0].json().code, "EMERGENCY_LIMIT");

    // Exactly one SOS route per allowed call, and no more.
    assert.equal(
      await collections.contactRequests.countDocuments({ token, action: "emergency_call" }),
      MAX_EMERGENCY_CALLS_PER_DAY
    );
  });

  test("the ceiling reopens when the day rolls over", async () => {
    const token = await sosTag();

    for (let i = 0; i < MAX_EMERGENCY_CALLS_PER_DAY; i += 1) {
      const res = await registerSos(token, nextPhone(), uniqueAddress());
      assert.equal(res.statusCode, 200, `call ${i + 1} should be allowed`);
    }

    assert.equal((await registerSos(token, nextPhone(), uniqueAddress())).statusCode, 429);

    // Fast-forward the window rather than waiting a day for it.
    await collections.tags.updateOne(
      { token },
      { $set: { emergencyWindowStart: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() } }
    );

    const reopened = await registerSos(token, nextPhone(), uniqueAddress());
    assert.equal(reopened.statusCode, 200);

    const tag = await collections.tags.findOne({ token });
    assert.equal(tag.emergencyWindowCount, 1);
  });

  test("a refusal at a spent ceiling writes nothing", async () => {
    const token = await sosTag();

    await collections.tags.updateOne(
      { token },
      {
        $set: {
          emergencyWindowStart: new Date().toISOString(),
          emergencyWindowCount: MAX_EMERGENCY_CALLS_PER_DAY
        }
      }
    );

    const res = await registerSos(token, nextPhone(), uniqueAddress());
    assert.equal(res.statusCode, 429);

    // The fast path refuses out of the value already on the tag, so a caller
    // arriving at a closed ceiling does not push it any higher.
    const tag = await collections.tags.findOne({ token });
    assert.equal(tag.emergencyWindowCount, MAX_EMERGENCY_CALLS_PER_DAY);
    assert.equal(await collections.contactRequests.countDocuments({ token }), 0);
  });
});
