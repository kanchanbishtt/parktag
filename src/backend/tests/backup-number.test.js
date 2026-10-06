// The owner's backup number (owner's rule, 5 Oct 2026): one per owner, saved
// without a code, used by the calling flow only. When a masked call to the
// owner goes unanswered, Exotel rings the backup next — Dial Whom hands the
// Connect applet "owner,backup". The Emergency call is unchanged.
//
// These tests drive the owner endpoint, the real register-call route, Dial
// Whom and the status callback, so they pin what the number actually does.
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

// register-call refuses with 503 without a virtual number; nothing dials.
process.env.EXOTEL_CALLER_ID = "08000000000";

const PLATE = "DL09QA6160";
const RIGHT = "6160";
const OWNER_MOBILE = "+919000006160";
const BACKUP = "+919000006161";
const EMERGENCY_NUMBER = "+919000006162";

let app;
let collections;
let owner;
let cookie;
let token;
let counter = 0;

function nextScannerPhone() {
  counter += 1;
  return `9160${String(counter).padStart(6, "0")}`;
}

function ownerRequest(method, url, payload) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    cookies: { wavetag_session: cookie },
    headers: { origin: TEST_ORIGIN },
    ...(payload === undefined ? {} : { payload })
  });
}

const setBackup = (mobile) => ownerRequest("POST", "/api/owner/backup-mobile", { mobile });
const clearBackup = () => ownerRequest("DELETE", "/api/owner/backup-mobile");
const dashboardOwner = () => ownerRequest("GET", "/api/owner/dashboard?qr=0").then((r) => r.json().owner);
const storedOwner = () => collections.owners.findOne({ _id: owner._id }, { projection: { backupMobile: 1, mobile: 1 } });

async function grantFor(address) {
  const res = await app.inject({
    method: "POST",
    url: `/api/tags/${token}/verify`,
    remoteAddress: address,
    payload: { lastFour: RIGHT }
  });
  assert.equal(res.statusCode, 200, "fixture verify should succeed");
  return res.json().grant;
}

async function registerCall(phone) {
  const address = uniqueAddress();
  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/register-call`,
    remoteAddress: address,
    payload: { phone, grant: await grantFor(address) }
  });
}

async function registerEmergencyCall(phone) {
  const address = uniqueAddress();
  return app.inject({
    method: "POST",
    url: `/api/tags/${token}/register-emergency-call`,
    remoteAddress: address,
    payload: { phone, grant: await grantFor(address) }
  });
}

function dial(callerPhone, callSid = "qa-backup-sid") {
  return app.inject({
    method: "GET",
    url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(callerPhone)}&CallSid=${encodeURIComponent(callSid)}`
  });
}

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.tags.deleteMany({ token }).catch(() => {});
  await collections.contactRequests.deleteMany({ token }).catch(() => {});
  await collections.pendingCalls.deleteMany({ token }).catch(() => {});
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  counter += 1;
  await purgeLoginCollections(collections);
  if (token) {
    await collections.tags.deleteMany({ token });
    await collections.contactRequests.deleteMany({ token });
    await collections.pendingCalls.deleteMany({ token });
  }
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE });

  owner = await createTestOwner(collections, {
    email: "qa-backup-number@parktag-test.invalid",
    mobile: OWNER_MOBILE
  });
  cookie = await createSession(app, {
    id: String(owner._id),
    role: "owner",
    email: owner.email,
    displayName: owner.displayName
  });

  token = `qabackup${String(counter).padStart(3, "0")}${"d1e2f3a4".repeat(6)}`;
  await collections.tags.insertOne({
    ownerId: owner._id,
    token,
    plateNumber: PLATE,
    vehicleLabel: "QA Backup Car",
    vehicleType: "car",
    status: "active",
    premium: true,
    emergencyContact: EMERGENCY_NUMBER,
    createdAt: new Date().toISOString()
  });
});

describe("the owner endpoint", () => {
  test("saves a backup number as E.164 and the dashboard reports it", async () => {
    const res = await setBackup("98765 43210");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().backupMobile, "+919876543210");
    assert.equal((await storedOwner()).backupMobile, "+919876543210");
    assert.equal((await dashboardOwner()).backupMobile, "+919876543210");
  });

  test("no code is asked for: one request is the whole flow", async () => {
    const res = await setBackup(BACKUP);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().needsOtp, undefined);
    assert.equal((await storedOwner()).backupMobile, BACKUP);
  });

  test("refuses anything that is not an Indian mobile", async () => {
    for (const bad of ["", "12345", "abc", "011-2345-6789", "+14155550123", "5000000000"]) {
      const res = await setBackup(bad);
      assert.equal(res.statusCode, 400, `expected ${JSON.stringify(bad)} to be refused`);
    }
    assert.equal((await storedOwner()).backupMobile, undefined);
  });

  test("refuses the owner's own number", async () => {
    const res = await setBackup(OWNER_MOBILE.replace("+91", "0"));
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /main number/);
    assert.equal((await storedOwner()).backupMobile, undefined);
  });

  test("removing clears it and the dashboard shows none", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const res = await clearBackup();
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().backupMobile, null);
    assert.equal((await storedOwner()).backupMobile, undefined);
    assert.equal((await dashboardOwner()).backupMobile, null);
  });

  test("an owner without one reads as null, never as a stale value", async () => {
    assert.equal((await dashboardOwner()).backupMobile, null);
  });

  test("needs an owner session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/owner/backup-mobile",
      headers: { origin: TEST_ORIGIN },
      payload: { mobile: BACKUP }
    });
    assert.equal(res.statusCode, 401);
  });
});

describe("the calling flow", () => {
  test("with a backup set, Dial Whom hands Exotel the owner then the backup", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const phone = nextScannerPhone();
    const reg = await registerCall(phone);
    assert.equal(reg.statusCode, 200, reg.body);

    const route = await collections.pendingCalls.findOne({ callerPhone: `+91${phone}`, consumed: false });
    assert.equal(route.targetPhone, OWNER_MOBILE);
    assert.equal(route.backupPhone, BACKUP, "the backup is snapshotted onto the route");

    const dialed = await dial(`+91${phone}`);
    assert.equal(dialed.statusCode, 200);
    assert.equal(dialed.body, `${OWNER_MOBILE},${BACKUP}`);
  });

  test("without a backup, Dial Whom hands Exotel the owner alone", async () => {
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    const dialed = await dial(`+91${phone}`);
    assert.equal(dialed.body, OWNER_MOBILE);
  });

  test("the route keeps the backup it was registered with, whatever happens to the number after", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    assert.equal((await clearBackup()).statusCode, 200);
    const dialed = await dial(`+91${phone}`);
    assert.equal(dialed.body, `${OWNER_MOBILE},${BACKUP}`);
  });

  // The Connect applet, with "Fetch Numbers after every call attempt" on, asks
  // again after each attempt with the previous leg's result. Nothing may ring
  // twice, and nothing may ring once somebody has answered.
  test("when Exotel asks again after the owner did not answer, only the backup is offered", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    const sid = `qa-refetch-${counter}`;
    assert.equal((await dial(`+91${phone}`, sid)).body, `${OWNER_MOBILE},${BACKUP}`);

    const again = await app.inject({
      method: "GET",
      url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${sid}&DialCallStatus=no-answer&DialWhomNumber=${encodeURIComponent(OWNER_MOBILE.replace("+91", "0"))}`
    });
    assert.equal(again.body, BACKUP);

    const third = await app.inject({
      method: "GET",
      url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${sid}&DialCallStatus=no-answer&DialWhomNumber=${encodeURIComponent(BACKUP.replace("+91", "0"))}`
    });
    assert.equal(third.body, "", "the backup has been tried; nothing is left to ring");
  });

  test("when Exotel asks again after the owner answered, nothing more is offered", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    const sid = `qa-refetch-done-${counter}`;
    await dial(`+91${phone}`, sid);
    const again = await app.inject({
      method: "GET",
      url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${sid}&DialCallStatus=completed&DialWhomNumber=${encodeURIComponent(OWNER_MOBILE)}`
    });
    assert.equal(again.body, "");
  });

  test("an ask that names no previous leg still falls through to the backup once", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    const sid = `qa-refetch-bare-${counter}`;
    await dial(`+91${phone}`, sid);
    const second = await app.inject({ method: "GET", url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${sid}&DialCallStatus=busy` });
    assert.equal(second.body, BACKUP);
    const third = await app.inject({ method: "GET", url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${sid}&DialCallStatus=no-answer` });
    assert.equal(third.body, "");
  });

  test("without a backup, a repeated ask behaves exactly as before: the owner again", async () => {
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    const sid = `qa-refetch-nobackup-${counter}`;
    assert.equal((await dial(`+91${phone}`, sid)).body, OWNER_MOBILE);
    const again = await app.inject({ method: "GET", url: `/api/exotel/dial-whom?CallFrom=${encodeURIComponent(`+91${phone}`)}&CallSid=${sid}&DialCallStatus=no-answer` });
    assert.equal(again.body, OWNER_MOBILE);
  });

  test("the Emergency call is unaffected: it rings the next of kin only", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const phone = nextScannerPhone();
    const reg = await registerEmergencyCall(phone);
    assert.equal(reg.statusCode, 200, reg.body);
    const route = await collections.pendingCalls.findOne({ callerPhone: `+91${phone}`, consumed: false });
    assert.equal(route.backupPhone, undefined);
    const dialed = await dial(`+91${phone}`);
    assert.equal(dialed.body, EMERGENCY_NUMBER);
  });

  test("when the backup picks up, the owner's activity says so", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    const callSid = `qa-backup-answered-${counter}`;
    assert.equal((await dial(`+91${phone}`, callSid)).body, `${OWNER_MOBILE},${BACKUP}`);

    const hook = await app.inject({
      method: "POST",
      url: "/api/provider/exotel/webhook",
      headers: { "content-type": "application/json" },
      payload: { CallSid: callSid, CallStatus: "completed", ConversationDuration: "42", DialWhomNumber: "09000006161" }
    });
    assert.equal(hook.statusCode, 200);

    const row = await collections.contactRequests.findOne({ token, action: "call" });
    assert.equal(row.callOutcome, "answered");
    assert.equal(row.answeredOn, "backup");

    const payload = await ownerRequest("GET", "/api/owner/dashboard?qr=0").then((r) => r.json());
    const shown = payload.requests.find((r) => r.id === String(row._id));
    assert.equal(shown.answeredOn, "backup");
  });

  test("when the owner's own phone picks up, it says primary", async () => {
    assert.equal((await setBackup(BACKUP)).statusCode, 200);
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    const callSid = `qa-primary-answered-${counter}`;
    await dial(`+91${phone}`, callSid);
    await app.inject({
      method: "POST",
      url: "/api/provider/exotel/webhook",
      headers: { "content-type": "application/json" },
      payload: { CallSid: callSid, CallStatus: "completed", ConversationDuration: "42", DialWhomNumber: OWNER_MOBILE }
    });
    const row = await collections.contactRequests.findOne({ token, action: "call" });
    assert.equal(row.answeredOn, "primary");
  });

  test("a call with no backup on the route records no leg at all", async () => {
    const phone = nextScannerPhone();
    assert.equal((await registerCall(phone)).statusCode, 200);
    const callSid = `qa-no-backup-${counter}`;
    await dial(`+91${phone}`, callSid);
    await app.inject({
      method: "POST",
      url: "/api/provider/exotel/webhook",
      headers: { "content-type": "application/json" },
      payload: { CallSid: callSid, CallStatus: "completed", ConversationDuration: "42", DialWhomNumber: OWNER_MOBILE }
    });
    const row = await collections.contactRequests.findOne({ token, action: "call" });
    assert.equal(row.callOutcome, "answered");
    assert.equal(row.answeredOn, undefined);
  });
});
