// The scan page at a tag whose free contacts are spent.
//
// Two rules, both the owner's (30 Sep 2026):
//
//   WHATSAPP STAYS LIVE. The free trial is a masked-CALL allowance, not a
//   shared "contact" budget: Private Call disables in place with a note
//   pointing at WhatsApp, which keeps working. There is no more full-panel
//   takeover and no purchase CTA on the scan page — a scanner standing at
//   someone else's car has no reason to be sold the owner's upgrade.
//
//   THE MASKED CALL AND EMERGENCY STAY LOCKED. No call and no Emergency call
//   through a locked E-Tag. The Emergency button leads to the public
//   helplines instead.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
const appJs = await read("scripts/scanner/app.js");
const html = await read("pages/scanner/index.html");
const welcomeJs = await read("scripts/owner/welcome.js");

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `could not find ${from} … ${to}`);
  return source.slice(start, end);
}

// A whole function declaration, found by matching braces rather than by a
// second marker string, so the body's own `{`/`}` cannot throw off the end.
function wholeFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `could not find ${signature}`);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${signature}`);
}

test("there is no purchase panel on the scan page any more", () => {
  assert.doesNotMatch(html, /purchase-cta/);
  assert.doesNotMatch(html, /Purchase Official ParkTag QR Sticker/);
  assert.doesNotMatch(html, /This tag's free limit is used up/);
});

// The note shown beside the disabled Call tile.
const note = slice(html, 'id="call-tile-exhausted-note"', "</p>");

test("the Call tile's note says Call is off and points at WhatsApp, nothing more", () => {
  assert.match(note, /already used their free masked-call trial/);
  assert.match(note, /Private Call is off/);
  assert.match(note, /still notify them over WhatsApp/i);
  // Unlike the old panel, this note tells the scanner what THEY can still do
  // (notify over WhatsApp) — it never claims the owner already has been.
  assert.doesNotMatch(note, /\b(told|notified|alerted|informed|has been sent|we have)\b/i, note);
});

test("the scan page has no code that reports on the owner being told", () => {
  assert.doesNotMatch(appJs, /notify-locked|handleLockedNotify|LOCKED_PANEL|lockedNotify/);
  assert.doesNotMatch(appJs, /The owner has been told|The owner already knows|We could not reach the owner/);
});

// Door hanger stock has two free contacts. Old copy said "one".
test("nothing claims the tag had one free contact", () => {
  assert.doesNotMatch(note, /\bone free contact\b/i);
  assert.doesNotMatch(appJs, /This E-Tag's free contact has been used\./);
});

// setContactAvailability, run for real against a stub page.
function availability({ blockedCode = null, emergency = true } = {}) {
  const hidden = {};
  const disabled = {};
  const context = vm.createContext({
    contactAvailable: true,
    contactBlockedCode: blockedCode,
    emergencyAvailable: emergency,
    setHidden: (id, value) => { hidden[id] = value; },
    setDisabled: (id, value) => { disabled[id] = value; },
    closeDialModal() {}, closeReasonStep() {}
  });
  vm.runInContext(
    wholeFunction(appJs, "function setContactAvailability(available) {") +
      "\n" +
      wholeFunction(appJs, "function applyCallBlocked(blocked) {"),
    context
  );
  return { hidden, disabled, context, emergency: () => vm.runInContext("emergencyAvailable", context) };
}

test("a used-up free contact keeps the tiles up and disables only Call", () => {
  const page = availability({ blockedCode: "FREE_USED" });
  page.context.setContactAvailability(false);

  assert.equal(page.hidden["scanner-contact-actions"], false, "the tile group, including WhatsApp, stays visible");
  assert.equal(page.hidden["scanner-why-title"], false);
  assert.equal(page.disabled["call-owner-button"], true, "only Call disables");
  assert.equal(page.hidden["call-tile-exhausted-note"], false);
  assert.equal(page.hidden["contact-unavailable-cta"], true, "the lapsed-only panel stays hidden");
});

test("a locked E-Tag switches the Emergency call off as well", () => {
  const page = availability({ blockedCode: "FREE_USED" });
  page.context.setContactAvailability(false);

  assert.equal(page.emergency(), false);
  // The button stays, and now leads to the public helplines: 112 is not ours
  // to withhold.
  assert.equal(page.hidden["pt-sos-block"], false);
});

test("a premium tag whose year has lapsed takes the tiles down and keeps its Emergency call", () => {
  const page = availability({ blockedCode: "CALL_SUBSCRIPTION_REQUIRED" });
  page.context.setContactAvailability(false);

  assert.equal(page.emergency(), true);
  assert.equal(page.hidden["contact-unavailable-cta"], false);
  assert.equal(page.hidden["scanner-contact-actions"], true, "a lapsed subscription takes the whole group down");
});

test("a tag that can be contacted is left exactly as it was", () => {
  const page = availability();
  page.context.setContactAvailability(true);
  assert.equal(page.emergency(), true);
  assert.equal(page.disabled["call-owner-button"], false);
});

test("an Emergency tap on a locked tag goes to the helplines, without saying why", () => {
  // Refused by the server mid-call.
  const sos = slice(appJs, "/register-emergency-call`", "openSosHelplines(");
  assert.match(sos, /data\.code === "NO_EMERGENCY_CONTACT" \|\| data\.code === "EMERGENCY_LOCKED"/);
  assert.match(appJs, /openSosHelplines\(data\.code === "NO_EMERGENCY_CONTACT" \? HELPLINE_NOTE_NO_CONTACT : undefined\);/);

  // Verified for an SOS and found locked: helplines, not a dead end.
  assert.match(appJs, /if \(data\.contactAvailable === false && \(pendingVerifiedAction !== "sos" \|\| !emergencyAvailable\)\) \{/);
  assert.match(appJs, /if \(wantedSos\) openSosHelplines\(\);/);
});

// A locked tag may well have an emergency contact on file, so "no contact
// added" would be a false statement about somebody's account.
test("the helplines are introduced without a claim about the owner's account", () => {
  assert.match(appJs, /setText\("sos-helplines-note", note \|\| HELPLINE_NOTE_UNAVAILABLE\);/);
  assert.match(appJs, /const HELPLINE_NOTE_UNAVAILABLE =\s*"Emergency calling is not available on this tag\. Use the All India helplines below\.";/);
  assert.match(html, /id="sos-helplines-note">\s*Emergency calling is not available on this tag\. Use the All India helplines below\.\s*<\/p>/);
});

test("the owner's card says how many people were turned away", () => {
  const context = vm.createContext({});
  vm.runInContext(slice(welcomeJs, "function lockedTagNote(tag) {", "function vehicleCard(tag, idx) {"), context);
  const note = context.lockedTagNote;

  assert.equal(
    note({ missedContacts: 1 }),
    "1 person tried to call you and couldn't get through. Buy a Premium tag to bring Call back — WhatsApp still reaches you."
  );
  assert.equal(
    note({ missedContacts: 4 }),
    "4 people tried to call you and couldn't get through. Buy a Premium tag to bring Call back — WhatsApp still reaches you."
  );
  // Nobody has tried yet: the limit, in the right number.
  assert.equal(
    note({ missedContacts: 0, freeContactAllowance: 1 }),
    "Your free call has been used. Buy a premium tag to keep Call working — WhatsApp still reaches you."
  );
  assert.equal(
    note({ freeContactAllowance: 2 }),
    "Your free calls have been used. Buy a premium tag to keep Call working — WhatsApp still reaches you."
  );
  assert.equal(
    note({ missedContacts: "junk" }),
    "Your free call has been used. Buy a premium tag to keep Call working — WhatsApp still reaches you."
  );
  // It goes into innerHTML, so it is escaped where it is used.
  assert.match(welcomeJs, /<p class="pt-vlc-trial">\$\{esc\(lockedTagNote\(tag\)\)\}<\/p>/);
});
