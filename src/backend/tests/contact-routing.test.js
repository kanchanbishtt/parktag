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

// Both register-call routes refuse with 503 when no virtual number is
// configured, and a CI runner has no telephony credentials. The suite supplies
// its own rather than inheriting whichever .env happens to be on the machine:
// that difference is exactly what let these tests pass here and fail on the
// runner. getEnv() reads process.env afresh inside buildApp(), so setting it
// before the app is built is enough, and nothing dials either way — these
// routes only record where a call should be routed and hand the number back.
process.env.EXOTEL_CALLER_ID = "08000000000";

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
    // `owners.mobile` carries a partial unique index (mobile_unique, added with
    // one-number-one-account), and this fixture hands every tag the same
    // constant number — so the second call in the file collided on it and took
    // eleven tests down with it. The collision was invisible for a while
    // because the index itself was failing to build on the shared test cluster,
    // which meant the fixture was only ever exercised without the constraint it
    // now has to satisfy.
    //
    // Cleared rather than reused: each tag still gets its own owner document,
    // which is what the routing tests assume. Safe because no single test asks
    // for two tags on the SAME number — the two that build a second tag pass
    // SECOND_OWNER_PHONE for it.
    await collections.owners.deleteMany({ mobile: ownerPhone });

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

  test("an E-Tag's spent call trial does not block the WhatsApp alert", async () => {
    // The bug #3 above used to cause from the other side: this endpoint spent
    // the allowance it should never have touched. Now that it does not, an
    // E-Tag with NO free calls left must still be able to reach this route —
    // masked calling is off, but the owner alert never cost a masked call.
    const token = await createTag();
    await collections.tags.updateOne(
      { token },
      { $set: { freeContactUsed: true, freeContactUsedAt: new Date().toISOString() } }
    );
    // sendOwnerAlertEmail no-ops in dev/test without real SMTP creds, so an
    // owner email is what lets this assert success end to end rather than
    // just "not 402" — see contact-actions.js.
    const owner = await collections.owners.findOne({ mobile: OWNER_PHONE });
    await collections.owners.updateOne({ _id: owner._id }, { $set: { email: "route-qa@example.invalid" } });

    const address = uniqueAddress();
    const grant = await grantFor(token, address);
    const res = await post(
      "/api/contact-requests",
      { token, grant, action: "message", messageChannel: "whatsapp" },
      address
    );

    assert.equal(res.statusCode, 200, "an exhausted call trial must not block the message channel");
  });

  test("a lapsed premium tag still blocks the WhatsApp alert too", async () => {
    // The one tier that DOES still lose the message channel: a lapsed
    // subscription means the tag itself has stopped being reachable, not
    // merely out of free calls — see call-access.js's tier table.
    const token = await createTag({ premium: true });
    await collections.tags.updateOne(
      { token },
      { $set: { premiumSince: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString() } }
    );

    const address = uniqueAddress();
    const grant = await grantFor(token, address);
    const res = await post(
      "/api/contact-requests",
      { token, grant, action: "message", messageChannel: "whatsapp" },
      address
    );

    assert.equal(res.statusCode, 402);
    assert.equal(res.json().code, "CALL_SUBSCRIPTION_REQUIRED");
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

  // On a PREMIUM tag. On an E-Tag the owner call spends the free contact, the
  // tag locks, and a locked E-Tag places no Emergency call (the test below).
  test("the same handset may escalate from the owner call to Emergency", async () => {
    const token = await createTag({ premium: true });
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

  // Owner's decision, 30 Sep 2026: once an E-Tag's free contacts are spent it
  // places no masked call of any kind. And, 1 Oct 2026: a call only spends one
  // once the two have actually been connected. So on a one-contact E-Tag it is
  // the scanner's own CONVERSATION that locks it, and only after that can they
  // not escalate to Emergency on the same visit.
  test("on an E-Tag, the call that connects spends the free contact and closes Emergency too", async () => {
    const token = await createTag();
    const phone = nextPhone();
    const address = uniqueAddress();
    const grant = await grantFor(token, address);
    const auth = `token=${encodeURIComponent(process.env.EXOTEL_WEBHOOK_SECRET || "")}`;
    const callSid = `qa-connect-${phone}`;

    await collections.tags.updateOne({ token }, { $set: { emergencyContact: SECOND_OWNER_PHONE } });

    assert.equal((await post(`/api/tags/${token}/register-call`, { phone, grant }, address)).statusCode, 200);
    // Exotel routes the call, and reports that they spoke.
    await app.inject({ method: "GET", url: `/api/exotel/dial-whom?${auth}&CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${callSid}` });
    await post(`/api/provider/exotel/webhook?${auth}`, { CallSid: callSid, CallStatus: "completed", ConversationDuration: "30" }, uniqueAddress());
    assert.equal((await collections.tags.findOne({ token })).freeContactUsed, true);

    const sos = await post(`/api/tags/${token}/register-emergency-call`, { phone, grant }, address);
    assert.equal(sos.statusCode, 402);
    assert.equal(sos.json().code, "EMERGENCY_LOCKED");
  });

  // The other half, and the one that matters at a real accident: the owner did
  // not pick up. Nothing was spent, so Emergency is still there.
  test("on an E-Tag, a call the owner never answered leaves Emergency open", async () => {
    const token = await createTag();
    const phone = nextPhone();
    const address = uniqueAddress();
    const grant = await grantFor(token, address);

    await collections.tags.updateOne({ token }, { $set: { emergencyContact: SECOND_OWNER_PHONE } });

    assert.equal((await post(`/api/tags/${token}/register-call`, { phone, grant }, address)).statusCode, 200);
    assert.notEqual((await collections.tags.findOne({ token })).freeContactUsed, true, "registering spends nothing");

    const sos = await post(`/api/tags/${token}/register-emergency-call`, { phone, grant }, address);
    assert.equal(sos.statusCode, 200);

    const routes = await liveRoutesFor(`+91${phone}`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].type, "scanner_to_emergency");
  });

  test("escalating to Emergency survives the handset changing address", async () => {
    // A phone on mobile data can come back from a different address between two
    // taps (carrier NAT, IPv4 vs IPv6). The owner route it registered a moment
    // ago is for this same vehicle and is retired by this registration anyway,
    // so it must not be read as another client holding the number.
    const token = await createTag({ premium: true });
    const phone = nextPhone();
    const firstAddress = uniqueAddress();
    const grant = await grantFor(token, firstAddress);

    await collections.tags.updateOne(
      { token },
      { $set: { emergencyContact: SECOND_OWNER_PHONE } }
    );

    const call = await post(`/api/tags/${token}/register-call`, { phone, grant }, firstAddress);
    assert.equal(call.statusCode, 200);

    const sos = await post(
      `/api/tags/${token}/register-emergency-call`,
      { phone, grant },
      uniqueAddress()
    );
    assert.equal(sos.statusCode, 200, `escalation refused: ${sos.body}`);

    const dialed = await dial(`+91${phone}`);
    assert.equal(dialed.body, SECOND_OWNER_PHONE);
  });

  test("a changed address still cannot take over another vehicle's route", async () => {
    // The same-vehicle allowance above must not widen into the hijack the claim
    // check exists to stop: a different client, a different tag, same number.
    const victimTag = await createTag();
    const attackerTag = await createTag({ ownerPhone: SECOND_OWNER_PHONE });
    await collections.tags.updateOne(
      { token: attackerTag },
      { $set: { emergencyContact: "+919000000023" } }
    );
    const phone = nextPhone();

    assert.equal((await registerCall(victimTag, phone, uniqueAddress())).statusCode, 200);

    const attackerAddress = uniqueAddress();
    const attacker = await post(
      `/api/tags/${attackerTag}/register-emergency-call`,
      { phone, grant: await grantFor(attackerTag, attackerAddress) },
      attackerAddress
    );
    assert.equal(attacker.statusCode, 409);
    assert.equal(attacker.json().code, "CALLER_IN_USE");

    const dialed = await dial(`+91${phone}`);
    assert.equal(dialed.body, OWNER_PHONE);
  });
});

describe("the caller's number as typed", () => {
  // Exotel reports an Indian caller as 0XXXXXXXXXX, and Dial Whom normalises
  // that to +91XXXXXXXXXX. Registration has to land on the same key whichever
  // way the scanner wrote their own number, or the call rings out busy.
  async function sosTag() {
    const token = await createTag();
    await collections.tags.updateOne({ token }, { $set: { emergencyContact: SECOND_OWNER_PHONE } });
    return token;
  }

  test("a number typed with the trunk zero reaches the owner", async () => {
    const token = await createTag();
    const phone = nextPhone();
    const address = uniqueAddress();

    const res = await registerCall(token, `0${phone}`, address);
    assert.equal(res.statusCode, 200, res.body);

    const routes = await liveRoutesFor(`+91${phone}`);
    assert.equal(routes.length, 1, "the route was not stored under the canonical number");

    const dialed = await dial(`0${phone}`);
    assert.equal(dialed.body, OWNER_PHONE);
  });

  test("a number typed with the trunk zero reaches the emergency contact", async () => {
    const token = await sosTag();
    const phone = nextPhone();
    const address = uniqueAddress();

    const res = await post(
      `/api/tags/${token}/register-emergency-call`,
      { phone: `0${phone}`, grant: await grantFor(token, address) },
      address
    );
    assert.equal(res.statusCode, 200, res.body);

    const dialed = await dial(`0${phone}`);
    assert.equal(dialed.body, SECOND_OWNER_PHONE);
  });

  test("every common spelling of one number lands on one route", async () => {
    const phone = nextPhone();
    for (const typed of [phone, `0${phone}`, `91${phone}`, `+91${phone}`, `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`]) {
      const token = await createTag();
      const address = uniqueAddress();
      const res = await registerCall(token, typed, address);
      assert.equal(res.statusCode, 200, `${typed}: ${res.body}`);
      const [route] = await collections.pendingCalls.find({ token }).toArray();
      assert.equal(route.callerPhone, `+91${phone}`, `${typed} was stored as ${route.callerPhone}`);
      await collections.pendingCalls.deleteMany({ token });
    }
  });

  test("a number that cannot be read is refused before the grant is spent", async () => {
    const token = await sosTag();
    const address = uniqueAddress();
    const grant = await grantFor(token, address);

    // Shapes isMobileIdentifier lets through but nothing can dial: too short
    // for a mobile, and ten digits outside the 6-9 mobile range.
    for (const phone of ["1234567", "123456789", "1234567890"]) {
      for (const route of ["register-call", "register-emergency-call"]) {
        const res = await post(`/api/tags/${token}/${route}`, { phone, grant }, address);
        assert.equal(res.statusCode, 400, `${route} accepted ${phone}: ${res.body}`);
      }
    }

    const session = await collections.verificationSessions.findOne({ token, grantId: grant });
    assert.equal((session.grantPhones || []).length, 0, "a refused number used up a grant slot");
    assert.equal(await collections.pendingCalls.countDocuments({ token }), 0);
    const tag = await collections.tags.findOne({ token });
    assert.notEqual(tag.freeContactUsed, true);
  });

  test("a stored emergency contact that cannot be dialled reads as none", async () => {
    const token = await createTag();
    await collections.tags.updateOne({ token }, { $set: { emergencyContact: "12345" } });
    const address = uniqueAddress();

    const res = await post(
      `/api/tags/${token}/register-emergency-call`,
      { phone: nextPhone(), grant: await grantFor(token, address) },
      address
    );

    // NO_EMERGENCY_CONTACT is what sends the page to the public helplines.
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().code, "NO_EMERGENCY_CONTACT");
    assert.equal(await collections.pendingCalls.countDocuments({ token }), 0);
  });

  test("an owner with no phone is a named refusal, and costs the tag nothing", async () => {
    const token = await createTag();
    const tag = await collections.tags.findOne({ token });
    await collections.owners.updateOne({ _id: tag.ownerId }, { $unset: { mobile: "", phone: "" } });

    const res = await registerCall(token, nextPhone(), uniqueAddress());

    assert.equal(res.statusCode, 422);
    assert.equal(res.json().code, "OWNER_NO_PHONE");
    const after = await collections.tags.findOne({ token });
    assert.notEqual(after.freeContactUsed, true);
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
