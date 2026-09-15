import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import { ensureCoreIndexes } from "../lib/db/repositories.js";
import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

let app, collections, cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
  // The duplicate-code test below relies on the unique index on `code` (see
  // repositories.js, promo_code_unique) actually existing — it is not created
  // at boot, only where a suite asks for it, same as promo-codes.test.js.
  await ensureCoreIndexes(collections, null);
  await collections.admins.insertOne({
    email: "qa-promo-admin@parktag-test.invalid", role: "admin",
    displayName: "QA Admin", createdAt: new Date().toISOString()
  });
  const admin = await collections.admins.findOne({ email: "qa-promo-admin@parktag-test.invalid" });
  cookie = await createSession(app, { id: String(admin._id), role: "admin", email: admin.email, displayName: admin.displayName });
});
after(async () => {
  await collections.admins.deleteMany({ email: /parktag-test\.invalid$/ });
  await collections.promoCodes.deleteMany({ code: /^QA/ });
  await stopTestApp(app);
});
beforeEach(async () => { await collections.promoCodes.deleteMany({ code: /^QA/ }); });

function post(url, payload) {
  return app.inject({ method: "POST", url, remoteAddress: uniqueAddress(), cookies: { wavetag_session: cookie }, payload });
}

describe("creating a promo code validates its mode/value pairing", () => {
  test("flat mode requires a positive discountPaise", async () => {
    const res = await post("/api/admin/promo-codes", { code: "QAFLAT01", discountMode: "flat", discountPaise: 0 });
    assert.equal(res.statusCode, 400, res.body);
  });
  test("percent mode requires discountPercent in (0, 100]", async () => {
    const tooHigh = await post("/api/admin/promo-codes", { code: "QAPCT101", discountMode: "percent", discountPercent: 150 });
    assert.equal(tooHigh.statusCode, 400, tooHigh.body);
    const zero = await post("/api/admin/promo-codes", { code: "QAPCT102", discountMode: "percent", discountPercent: 0 });
    assert.equal(zero.statusCode, 400, zero.body);
  });
  test("a well-formed flat code is created and reads back with discountMode explicitly set", async () => {
    const res = await post("/api/admin/promo-codes", { code: "QAGOOD01", discountMode: "flat", discountPaise: 9900 });
    assert.equal(res.statusCode, 200, res.body);
    const doc = await collections.promoCodes.findOne({ code: "QAGOOD01" });
    assert.equal(doc.discountMode, "flat");
    assert.equal(doc.discountPaise, 9900);
  });
  test("the existing unique index on code is still respected — a duplicate code is refused", async () => {
    await post("/api/admin/promo-codes", { code: "QADUP001", discountMode: "flat", discountPaise: 100 });
    const again = await post("/api/admin/promo-codes", { code: "QADUP001", discountMode: "flat", discountPaise: 200 });
    assert.notEqual(again.statusCode, 200, again.body);
  });
});
