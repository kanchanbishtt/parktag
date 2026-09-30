// The scan page at a tag whose free contacts are spent.
//
// Two rules, both the owner's (30 Sep 2026):
//
//   SAY ONLY WHAT IS TRUE EVERY TIME. The panel states that the owner has used
//   this tag's free limit, and nothing else. It does not say the owner has been
//   told, alerted or notified. A message does go to the owner, but it is capped
//   at one a day and can fail to deliver, and a scanner deciding whether to
//   wait by a car must not be promised an alert that did not go.
//
//   LOCKED MEANS LOCKED. No call, no message, and no Emergency call through a
//   locked E-Tag. The Emergency button leads to the public helplines instead.

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

// The locked panel: from its opening tag to the comment that introduces the next one.
const panel = slice(html, '<div id="purchase-cta"', "<!-- Shown instead of the panel above");
// Words only: what a person at the car actually reads.
const panelText = panel.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("the panel says the owner has used the tag's free limit, and that contact is off", () => {
  assert.match(panel, /<h3>This tag's free limit is used up<\/h3>/);
  assert.match(panelText, /free trial ParkTag/);
  assert.match(panelText, /its owner has used the full limit/);
  assert.match(panelText, /Calls and messages through it are switched off/);
});

// The claim this page must never make. Each of these would sometimes be false.
test("the panel never claims the owner has been told, alerted or reached", () => {
  assert.doesNotMatch(panelText, /\b(told|notified|notify|alerted|alert|informed|let the owner know|knows|has been sent|we have)\b/i, panelText);
  assert.doesNotMatch(panelText, /\bEmergency\b/i, "and it does not promise the Emergency call either");
});

test("there is nothing to tap that would message the owner", () => {
  assert.doesNotMatch(panel, /<button/);
  assert.doesNotMatch(panel, /locked-notify|role="status"/);
  // The one control is the link it always had.
  assert.match(panel, /<a id="purchase-cta-btn" href="https:\/\/parktag\.me"[^>]*class="pt-btn pt-btn-primary pt-btn-full"/);
  assert.match(panelText, /Purchase Official ParkTag QR Sticker$/);
});

test("the scan page has no code that reports on the owner being told", () => {
  assert.doesNotMatch(appJs, /notify-locked|handleLockedNotify|LOCKED_PANEL|lockedNotify/);
  assert.doesNotMatch(appJs, /The owner has been told|The owner already knows|We could not reach the owner/);
});

// Door hanger stock has two free contacts. The page said "one".
test("nothing claims the tag had one free contact", () => {
  assert.doesNotMatch(panelText, /\bone free contact\b/i);
  assert.doesNotMatch(appJs, /This E-Tag's free contact has been used\./);
});

// setContactAvailability, run for real against a stub page.
function availability({ blockedCode = null, emergency = true } = {}) {
  const hidden = {};
  const context = vm.createContext({
    contactAvailable: true,
    contactBlockedCode: blockedCode,
    emergencyAvailable: emergency,
    setHidden: (id, value) => { hidden[id] = value; },
    closeDialModal() {}, closeReasonStep() {}
  });
  vm.runInContext(slice(appJs, "function setContactAvailability(available) {", "\n}\n") + "\n}", context);
  return { hidden, context, emergency: () => vm.runInContext("emergencyAvailable", context) };
}

test("a locked E-Tag switches the Emergency call off as well", () => {
  for (const blockedCode of ["FREE_USED", null]) {
    const page = availability({ blockedCode });
    page.context.setContactAvailability(false);

    assert.equal(page.emergency(), false, `code ${blockedCode}`);
    assert.equal(page.hidden["purchase-cta"], false, "the free-limit panel is shown");
    // The button stays, and now leads to the public helplines: 112 is not ours
    // to withhold.
    assert.equal(page.hidden["pt-sos-block"], false);
  }
});

test("a premium tag whose year has lapsed keeps its Emergency call", () => {
  const page = availability({ blockedCode: "CALL_SUBSCRIPTION_REQUIRED" });
  page.context.setContactAvailability(false);

  assert.equal(page.emergency(), true);
  assert.equal(page.hidden["contact-unavailable-cta"], false);
  assert.equal(page.hidden["purchase-cta"], true);
});

test("a tag that can be contacted is left exactly as it was", () => {
  const page = availability();
  page.context.setContactAvailability(true);
  assert.equal(page.emergency(), true);
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

  assert.equal(note({ missedContacts: 1 }), "1 person tried to reach you and could not. Buy a Premium tag to be reachable again.");
  assert.equal(note({ missedContacts: 4 }), "4 people tried to reach you and could not. Buy a Premium tag to be reachable again.");
  // Nobody has tried yet: the limit, in the right number.
  assert.equal(note({ missedContacts: 0, freeContactAllowance: 1 }), "Your free contact has been used. Buy a premium tag to keep being reachable.");
  assert.equal(note({ freeContactAllowance: 2 }), "Your free contacts have been used. Buy a premium tag to keep being reachable.");
  assert.equal(note({ missedContacts: "junk" }), "Your free contact has been used. Buy a premium tag to keep being reachable.");
  // It goes into innerHTML, so it is escaped where it is used.
  assert.match(welcomeJs, /<p class="pt-vlc-trial">\$\{esc\(lockedTagNote\(tag\)\)\}<\/p>/);
});
