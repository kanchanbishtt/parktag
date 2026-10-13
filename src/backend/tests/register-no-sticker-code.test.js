// Add Your Vehicles (/register-owner) no longer has a "sticker code" box.
//
//   THE BOX COULD NEVER MATCH. It took exactly 12 characters, upper-cased them
//   and sent the owner to /vehicle/<CODE>. That was the QR token format until
//   26 Jun 2026; every sticker since carries a 64-character lowercase token
//   (createSecureToken), and the printed serial (PT-01-004242) is not a token
//   at all. Every attempt ended on "Tag not found".
//
//   AND A FAILED ATTEMPT MINTED AN E-TAG. The vehicle typed above the box was
//   parked in localStorage before the redirect, and the dashboard's sync then
//   created a free E-Tag for it, the opposite of what the owner was doing.
//
//   A sticker is linked by scanning its QR, which opens the activation wizard.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
const html = await read("pages/owner/register.html");
const js = await read("scripts/owner/register.js");
const scannerJs = await read("scripts/scanner/app.js");
const scannerHtml = await read("pages/scanner/index.html");

test("the add-vehicle page has no sticker code box", () => {
  assert.doesNotMatch(html, /id="token-input"/);
  assert.doesNotMatch(html, /LINK STICKER CODE/i);
  assert.doesNotMatch(js, /token-input/);
  assert.doesNotMatch(js, /12 characters/);
});

test("submit never sends the owner to a sticker page", () => {
  // The redirect was the only route from this form to /vehicle/, and the
  // pending-vehicle write before it is what turned a failed link into an E-Tag.
  assert.doesNotMatch(js, /location\.href\s*=\s*`\/vehicle\//);
  assert.doesNotMatch(js, /location\.href\s*=\s*`\/tag\//);
});

test("the page tells a sticker owner to scan the QR instead", () => {
  assert.match(html, /class="av-sticker-hint"[^>]*>[^<]*Scan the QR on it/);
});

test("a missing tag explains itself instead of repeating the heading", () => {
  // The card used to read "Tag not found / Tag not found": the script copied
  // the server's error text over the sentence in the markup.
  const sentence = "This QR code could not be linked to an active vehicle. Please check and try again.";
  assert.ok(scannerHtml.includes(sentence), "the markup sentence is the one the script must keep");
  assert.ok(scannerJs.includes(`: "${sentence}"`), "the not-found branch sets the same sentence");
  assert.doesNotMatch(scannerJs, /error instanceof Error \? error\.message : "Failed to load the tag"/);
});
