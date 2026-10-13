// An E-Tag's free call belongs to the car, not to the tag record.
//
// Deleting a vehicle only soft-deletes its tag. Adding the same plate back went
// through createEtagForVehicle, whose reuse lookup skips deleted tags, so it
// minted a new tag with freeContactUsed: false — a fresh free call for a car
// that had already spent one. Delete and re-add, as often as you like.
//
// The new tag now starts from the most-spent free-call state of any earlier
// non-premium tag the owner had for the same plate, spaces and dashes ignored.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";

const PLATE = "DL01QA4321";

let app;
let collections;
let owner;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.tags.deleteMany({ plateNumber: { $regex: "QA" } }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  await collections.tags.deleteMany({ plateNumber: { $regex: "QA" } });
  await purgeLoginCollections(collections);
  owner = await createTestOwner(collections, { email: "qa-etag-carryover@parktag-test.invalid" });
  cookie = await createSession(app, { id: String(owner._id), role: "owner", email: owner.email });
});

const send = (method, url, payload, sessionCookie = cookie) => app.inject({
  method,
  url,
  remoteAddress: uniqueAddress(),
  cookies: { wavetag_session: sessionCookie },
  headers: { origin: TEST_ORIGIN },
  ...(payload ? { payload } : {})
});

async function addVehicle(number, sessionCookie = cookie) {
  const res = await send("POST", "/api/owner/local-vehicle", { type: "car", number }, sessionCookie);
  assert.equal(res.statusCode, 200, res.body);
  return collections.tags.findOne({ token: res.json().token });
}

async function deleteVehicle(tag, sessionCookie = cookie) {
  const res = await send("DELETE", `/api/owner/tags/${tag._id}`, null, sessionCookie);
  assert.equal(res.statusCode, 200, res.body);
}

// What a connected call leaves on an E-Tag (spendFreeContactPipeline, then the
// trial-ended notice claim).
async function spendFreeCall(tag) {
  const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await collections.tags.updateOne(
    { _id: tag._id },
    { $set: { freeContactsSpent: 1, freeContactUsed: true, freeContactUsedAt: at, trialEndedNotice: { at, whatsapp: "sent" } } }
  );
  return at;
}

describe("re-adding a deleted vehicle does not hand back a spent free call", () => {
  test("delete a car whose call is spent, add the plate back: still spent", async () => {
    const first = await addVehicle(PLATE);
    assert.equal(first.freeContactUsed, false, "a brand-new car gets its free call");
    const spentAt = await spendFreeCall(first);
    await deleteVehicle(first);

    const again = await addVehicle(PLATE);
    assert.notEqual(String(again._id), String(first._id), "a deleted tag is never revived, a new one is minted");
    assert.equal(again.freeContactUsed, true, "the free call came back after delete + re-add");
    assert.equal(again.freeContactsSpent, 1);
    assert.equal(again.freeContactUsedAt, spentAt, "the spend keeps its original time");
    assert.deepEqual(again.trialEndedNotice, { at: spentAt, whatsapp: "sent" }, "the owner must not be told twice");
  });

  test("the same plate typed with spaces or dashes is the same car", async () => {
    const first = await addVehicle(PLATE);
    await spendFreeCall(first);
    await deleteVehicle(first);

    for (const variant of ["DL 01 QA 4321", "dl-01-qa-4321"]) {
      const again = await addVehicle(variant);
      assert.equal(again.freeContactUsed, true, `"${variant}" was treated as a different car`);
      await deleteVehicle(again);
    }
  });

  test("a live tag for the same car, typed differently, also passes on the spend", async () => {
    const first = await addVehicle(PLATE);
    await spendFreeCall(first);

    const duplicate = await addVehicle("DL 01 QA 4321");
    assert.equal(duplicate.freeContactUsed, true);
  });

  test("a partly used door-hanger allowance carries over as it stood", async () => {
    const first = await addVehicle(PLATE);
    await collections.tags.updateOne({ _id: first._id }, { $set: { freeContactAllowance: 2, freeContactsSpent: 1 } });
    await deleteVehicle(first);

    const again = await addVehicle(PLATE);
    assert.equal(again.freeContactUsed, false, "one of the two calls is still left");
    assert.equal(again.freeContactAllowance, 2);
    assert.equal(again.freeContactsSpent, 1);
    assert.equal(again.trialEndedNotice, undefined);
  });
});

describe("what still gets a fresh free call", () => {
  test("an unused deleted tag leaves nothing to carry", async () => {
    const first = await addVehicle(PLATE);
    await deleteVehicle(first);

    const again = await addVehicle(PLATE);
    assert.equal(again.freeContactUsed, false);
    assert.equal(again.freeContactsSpent, undefined, "nothing was copied from an untouched tag");
  });

  test("a different car", async () => {
    const first = await addVehicle(PLATE);
    await spendFreeCall(first);

    const other = await addVehicle("DL01QA9999");
    assert.equal(other.freeContactUsed, false, "a free call is per car, not per owner");
  });

  test("a premium tag's freeContactUsed stamp is not a spent trial", async () => {
    const first = await addVehicle(PLATE);
    // register-call stamps freeContactUsed on premium tags too.
    await collections.tags.updateOne(
      { _id: first._id },
      { $set: { premium: true, freeContactUsed: true, freeContactsSpent: 1, freeContactUsedAt: new Date().toISOString() } }
    );
    await deleteVehicle(first);

    const again = await addVehicle(PLATE);
    assert.equal(again.freeContactUsed, false);
  });

  test("another account adding the same plate (a sold car)", async () => {
    const first = await addVehicle(PLATE);
    await spendFreeCall(first);
    await deleteVehicle(first);

    const buyer = await createTestOwner(collections, { email: "qa-etag-carryover-buyer@parktag-test.invalid" });
    const buyerCookie = await createSession(app, { id: String(buyer._id), role: "owner", email: buyer.email });
    const theirs = await addVehicle(PLATE, buyerCookie);
    assert.equal(theirs.freeContactUsed, false);
  });
});

describe("deleting the whole account", () => {
  const PASSWORD = "carryover-QA-Password-1";
  const MOBILE = "+919812388001";

  async function accountWithSpentCar({ email, mobile }) {
    const holder = await createTestOwner(collections, { email, ...(mobile ? { mobile, phone: mobile } : {}), password: PASSWORD });
    const holderCookie = await createSession(app, { id: String(holder._id), role: "owner", email: holder.email });
    const tag = await addVehicle(PLATE, holderCookie);
    const spentAt = await spendFreeCall(tag);
    const res = await send("DELETE", "/api/owner/account", { password: PASSWORD }, holderCookie);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await collections.tags.countDocuments({ ownerId: holder._id }), 0, "the account's tags were not removed");
    return spentAt;
  }

  async function newAccount(fields) {
    const fresh = await createTestOwner(collections, fields);
    return createSession(app, { id: String(fresh._id), role: "owner", email: fresh.email });
  }

  beforeEach(async () => {
    await collections.spentFreeCalls.deleteMany({});
  });

  after(async () => {
    await collections.spentFreeCalls.deleteMany({}).catch(() => {});
  });

  test("a new account on the same mobile does not get the spent call back", async () => {
    const spentAt = await accountWithSpentCar({ email: "qa-carryover-gone@parktag-test.invalid", mobile: MOBILE });

    const again = await addVehicle("DL 01 QA 4321", await newAccount({ email: "qa-carryover-new@parktag-test.invalid", mobile: MOBILE, phone: MOBILE }));
    assert.equal(again.freeContactUsed, true);
    assert.equal(again.freeContactUsedAt, spentAt);
  });

  test("a new account on the same e-mail does not either", async () => {
    await accountWithSpentCar({ email: "qa-carryover-same@parktag-test.invalid" });

    const again = await addVehicle(PLATE, await newAccount({ email: "QA-Carryover-Same@parktag-test.invalid" }));
    assert.equal(again.freeContactUsed, true);
  });

  test("only keyed hashes are kept: no plate, number or e-mail", async () => {
    await accountWithSpentCar({ email: "qa-carryover-hash@parktag-test.invalid", mobile: MOBILE });

    const rows = await collections.spentFreeCalls.find({}).toArray();
    assert.equal(rows.length, 2, "one row per sign-in identity");
    const stored = JSON.stringify(rows);
    for (const secret of ["DL01QA4321", "QA4321", "9812388001", "carryover-hash"]) {
      assert.ok(!stored.includes(secret), `"${secret}" survives the deletion`);
    }
    assert.ok(rows.every((r) => r.expiresAt instanceof Date && r.expiresAt > new Date()), "rows must expire");
  });

  test("someone else's account and a different car still start fresh", async () => {
    await accountWithSpentCar({ email: "qa-carryover-other@parktag-test.invalid", mobile: MOBILE });

    const stranger = await newAccount({ email: "qa-carryover-stranger@parktag-test.invalid", mobile: "+919812388002", phone: "+919812388002" });
    assert.equal((await addVehicle(PLATE, stranger)).freeContactUsed, false);

    const sameOwnerOtherCar = await newAccount({ email: "qa-carryover-car@parktag-test.invalid", mobile: MOBILE, phone: MOBILE });
    assert.equal((await addVehicle("DL01QA9999", sameOwnerOtherCar)).freeContactUsed, false);
  });
});
