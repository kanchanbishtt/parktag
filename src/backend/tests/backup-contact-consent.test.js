// The backup number's person is told, once, and can say no.
//
// Saving a backup number writes a notice and sends one WhatsApp message to that
// number (parktag_backup_contact_v1) with a "Remove my number" button. The
// button's page removes the number from the owner and stops the owner adding it
// again; the dashboard then says so. What the number does on a call is in
// backup-number.test.js.
import test, { before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { createSession } from "../lib/auth/session.js";
import { getEnv } from "../lib/env.js";
import { settleAfterReply } from "../lib/core/after-reply.js";
import { notifyBackupContact, hashBackupToken, BACKUP_NOTICES_PER_DAY } from "../lib/core/backup-contact.js";
import { BACKUP_CONTACT_BODY, buildBackupContactTemplatePayload } from "../scripts/create-backup-contact-template.js";
import { startTestApp, stopTestApp, createTestOwner, purgeLoginCollections, uniqueAddress, TEST_ORIGIN } from "./helpers.js";

const OWNER_MOBILE = "+919000006270";
const BACKUP = "+919000006271";
const OTHER = "+919000006272";

let app;
let collections;
let owner;
let cookie;

// A configured env with a stand-in sender, so the send path runs without
// reaching Meta.
const configured = { ...getEnv(), metaWhatsappPhoneNumberId: "test-phone-id", metaWhatsappAccessToken: "test-token" };
function recorder() {
  const sent = [];
  return { sent, send: async (_env, message) => { sent.push(message); } };
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

function decline(token) {
  return app.inject({
    method: "POST",
    url: "/api/backup-contact/decline",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN },
    payload: { token }
  });
}

const setBackup = (mobile) => ownerRequest("POST", "/api/owner/backup-mobile", { mobile });
const dashboardOwner = () => ownerRequest("GET", "/api/owner/dashboard?qr=0").then((r) => r.json().owner);
const stored = () => collections.owners.findOne({ _id: owner._id });

// The backup set straight in the database, so a test can run the notice itself
// with a stand-in sender instead of the one the route starts.
const putBackup = (mobile) => collections.owners.updateOne({ _id: owner._id }, { $set: { backupMobile: mobile } });

before(async () => {
  ({ app, collections } = await startTestApp());
});

after(async () => {
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE }).catch(() => {});
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

beforeEach(async () => {
  await purgeLoginCollections(collections);
  await collections.owners.deleteMany({ mobile: OWNER_MOBILE });
  owner = await createTestOwner(collections, {
    email: "qa-backup-consent@parktag-test.invalid",
    mobile: OWNER_MOBILE,
    displayName: "Kanchan Bisht"
  });
  cookie = await createSession(app, { id: String(owner._id), role: "owner", email: owner.email, displayName: owner.displayName });
});

describe("the notice", () => {
  test("saving a backup number writes one notice for that number", async () => {
    const res = await setBackup(BACKUP);
    assert.equal(res.statusCode, 200, res.body);
    await settleAfterReply();

    const { backupNotice } = await stored();
    assert.equal(backupNotice.mobile, BACKUP);
    assert.match(backupNotice.tokenHash, /^[a-f0-9]{64}$/, "only a hash of the token is kept");
    // A test run never reaches Meta, so it records that nothing went.
    assert.equal(backupNotice.whatsapp, "not-sent");
  });

  test("the message names the owner by first name and carries the token for the button", async () => {
    await putBackup(BACKUP);
    const { sent, send } = recorder();
    const result = await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile: BACKUP, send });

    assert.equal(result.status, "sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, BACKUP);
    assert.equal(sent[0].ownerName, "Kanchan");
    assert.equal(sent[0].token, result.token);
    assert.equal((await stored()).backupNotice.tokenHash, hashBackupToken(result.token));
  });

  test("an owner with no usable name is not left as a blank", async () => {
    await collections.owners.updateOne({ _id: owner._id }, { $set: { displayName: OWNER_MOBILE } });
    await putBackup(BACKUP);
    const { sent, send } = recorder();
    await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile: BACKUP, send });
    assert.equal(sent[0].ownerName, "a ParkTag user");
  });

  test("the same number is told once; a different number is told again", async () => {
    await putBackup(BACKUP);
    const { sent, send } = recorder();
    await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile: BACKUP, send });
    const again = await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile: BACKUP, send });
    assert.equal(again.status, "already-told");

    await putBackup(OTHER);
    const other = await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile: OTHER, send });
    assert.equal(other.status, "sent");
    assert.deepEqual(sent.map((m) => m.to), [BACKUP, OTHER]);
  });

  test("a number the owner has already moved off is not told", async () => {
    await putBackup(OTHER);
    const { sent, send } = recorder();
    const result = await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile: BACKUP, send });
    assert.equal(result.status, "stale");
    assert.equal(sent.length, 0);
  });

  test(`no more than ${BACKUP_NOTICES_PER_DAY} notices a day from one owner`, async () => {
    const { sent, send } = recorder();
    for (let i = 0; i <= BACKUP_NOTICES_PER_DAY; i += 1) {
      const mobile = `+9190000063${String(i).padStart(2, "0")}`;
      await putBackup(mobile);
      await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile, send });
    }
    assert.equal(sent.length, BACKUP_NOTICES_PER_DAY, "the one past the cap is not sent");

    const tomorrow = Date.now() + 25 * 60 * 60 * 1000;
    await putBackup(BACKUP);
    const later = await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile: BACKUP, send, now: tomorrow });
    assert.equal(later.status, "sent", "the cap is per day");
  });
});

describe("Remove my number", () => {
  async function toldToken(mobile = BACKUP) {
    await putBackup(mobile);
    const { send } = recorder();
    return (await notifyBackupContact(configured, collections, { ownerId: owner._id, mobile, send })).token;
  }

  test("opening the link removes nothing; the button does", async () => {
    const token = await toldToken();

    const page = await app.inject({ method: "GET", url: `/backup/${token}`, remoteAddress: uniqueAddress() });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Remove my number/);
    assert.equal((await stored()).backupMobile, BACKUP, "a link preview must not remove anyone");

    const res = await decline(token);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().status, "removed");

    const after = await stored();
    assert.equal(after.backupMobile, undefined, "off the calling route");
    assert.deepEqual(after.backupDeclinedMobiles, [BACKUP]);
    assert.equal(after.backupNotice, undefined);
  });

  test("the owner sees why, cannot add it back, and can add a different number", async () => {
    await decline(await toldToken());

    const shown = await dashboardOwner();
    assert.equal(shown.backupMobile, null);
    assert.equal(shown.backupDeclined, BACKUP);

    const refused = await setBackup(BACKUP);
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().error, /asked not to be your backup/);

    const ok = await setBackup(OTHER);
    assert.equal(ok.statusCode, 200);
    await settleAfterReply();
    assert.equal((await dashboardOwner()).backupDeclined, null, "the notice goes once a new number is saved");
  });

  test("a used link does nothing the second time", async () => {
    const token = await toldToken();
    await decline(token);
    const again = await decline(token);
    assert.equal(again.statusCode, 404);
    assert.equal(again.json().status, "invalid");
  });

  test("if the owner has changed the number since, the new one stays", async () => {
    const token = await toldToken(BACKUP);
    await putBackup(OTHER);

    await decline(token);
    const after = await stored();
    assert.equal(after.backupMobile, OTHER);
    assert.deepEqual(after.backupDeclinedMobiles, [BACKUP], "the number that said no is still blocked");
  });

  test("tokens that are not ours are refused", async () => {
    for (const token of ["", "abc", "z".repeat(32), "0".repeat(32), { $ne: "" }]) {
      const res = await decline(token);
      assert.equal(res.statusCode, 404, `token ${JSON.stringify(token)}`);
    }
  });
});

test("the template copy keeps Meta's rules", () => {
  const payload = buildBackupContactTemplatePayload();
  const body = payload.components.find((c) => c.type === "BODY");
  assert.equal(body.text, BACKUP_CONTACT_BODY);
  assert.equal((body.text.match(/\{\{\d\}\}/g) || []).length, 1, "one body variable, as sendMetaWhatsappBackupContact fills");
  assert.doesNotMatch(body.text.trim(), /^\{\{|\}\}$/, "no placeholder at the start or end");
  assert.doesNotMatch(body.text, /—/, "no em-dashes");
  assert.equal(payload.category, "UTILITY");
  assert.equal(payload.language, "en");

  const button = payload.components.find((c) => c.type === "BUTTONS").buttons[0];
  assert.equal(button.url, "https://app.parktag.me/backup/{{1}}");
  assert.equal(button.text, "Remove my number");
});
