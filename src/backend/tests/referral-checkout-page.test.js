// What a friend sees on /get after following a referral link.
//
// The money was always decided correctly on the server. The page around it was
// the problem: it announced the discount for any well-formed code, quoted the
// full price in the checkout sheet anyway, and forgot the code the moment an
// order was created, so closing the payment window and trying again cost the
// friend their discount.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { ALPHABET } from "../lib/core/referrals.js";

// CRLF folded to LF: a Windows checkout (core.autocrlf) has CRLF line endings,
// and the slices below look for "\n}\n".
const read = async (path) =>
  (await readFile(new URL(`../../frontend/scripts/${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const getJs = await read("get.js");
const shopJs = await read("shop.js");
const directJs = await read("direct.js");
const sheetJs = await read("owner/address-step.js");
const linkJs = await read("referral-link.js");

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `could not find ${from} … ${to}`);
  return source.slice(start, end);
}

// The referral part of get.js, run for real against a stub page.
function page({ parked = "X237XC", answer, status = 200, offline = false } = {}) {
  const note = { hidden: true, textContent: "" };
  const calls = [];
  const state = { parked };
  const context = vm.createContext({
    byId: (id) => (id === "gtRef" ? note : null),
    rupees: (paise) => `₹${Math.round(paise / 100)}`,
    referralCode: () => state.parked,
    clearReferralCode: () => { state.parked = null; },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (offline) throw new Error("offline");
      return { ok: status === 200, status, json: async () => answer };
    }
  });
  vm.runInContext(slice(getJs, "let _referralOff = 0;", "function say(message) {"), context);
  return { note, calls, state, context, off: () => vm.runInContext("_referralOff", context) };
}

test("a confirmed link is announced with the server's amount, and priced into the sheet", async () => {
  const p = page({ answer: { ok: true, discountPaise: 5000 } });
  await p.context.checkReferral();

  assert.deepEqual(p.calls, [{ url: "/api/shop/referral/check", body: { code: "X237XC" } }]);
  assert.equal(p.off(), 5000);
  assert.equal(p.note.hidden, false);
  assert.equal(p.note.textContent, "🎁 Friend's link applied: an extra ₹50 off when you pay online.");
  assert.equal(p.state.parked, "X237XC", "kept for checkout");
});

test("a code nobody holds is forgotten, and nothing is promised", async () => {
  const p = page({ answer: { ok: false } });
  await p.context.checkReferral();

  assert.equal(p.off(), 0);
  assert.equal(p.note.hidden, true);
  assert.equal(p.state.parked, null);
});

test("when the server cannot be asked, nothing is promised but the code is kept", async () => {
  for (const options of [{ offline: true }, { status: 429, answer: { error: "slow down" } }, { status: 500, answer: {} }]) {
    const p = page(options);
    await p.context.checkReferral();

    assert.equal(p.off(), 0, JSON.stringify(options));
    assert.equal(p.note.hidden, true);
    assert.equal(p.state.parked, "X237XC", "the server still decides at checkout");
  }
});

test("no link, no request", async () => {
  const p = page({ parked: null });
  await p.context.checkReferral();
  assert.equal(p.calls.length, 0);
});

test("a refused link is dropped from the page as well as from storage", () => {
  const p = page();
  vm.runInContext("_referralOff = 5000", p.context);
  p.note.hidden = false;
  p.note.textContent = "something";

  p.context.dropReferral();

  assert.equal(p.off(), 0);
  assert.equal(p.state.parked, null);
  assert.deepEqual(p.note, { hidden: true, textContent: "" });
});

test("the sheet is given the online price with the link off, and Cash on Delivery without it", () => {
  const buy = slice(getJs, "async function buy(sku) {", "_busy = true;");

  assert.match(buy, /const refOff = referralCode\(\) \? _referralOff : 0;/);
  // The server's floor, mirrored: see expectedOrderPaise.
  assert.match(buy, /const onlinePaise = refOff \? Math\.max\(totalPaise - refOff, 100\) : totalPaise;/);
  assert.match(buy, /amountPaise: onlinePaise,/);
  assert.match(buy, /referralLabel: refOff \? `Friend's link: \$\{rupees\(totalPaise - onlinePaise\)\} off` : null,/);
  // COD is priced from the undiscounted total: the server never applies it there.
  assert.match(buy, /cod: cod\s*\? \{ amountPaise: pricedTotalPaise\(sku, product, quantity, null\) \+ cod\.surchargePaise,/);
  // The plate is added by the sheet when it is ticked, never twice.
});

test("a price the sheet quoted is never silently replaced by a higher one at payment", () => {
  const afterOrder = slice(getJs, 'fetch("/api/shop/guest/create-order"', "remember(order.orderNumber, address);");

  // Stops before the payment window, drops the code, and tells the buyer why.
  assert.match(afterOrder, /if \(!payCod && refOff > 0 && !\(Number\(order\.referralDiscountPaise\) > 0\)\) \{\s*dropReferral\(\);/);
  assert.match(afterOrder, /order\.referralRefused === "self"/);
  assert.match(afterOrder, /throw new Error\(/);
});

// The bug: clearReferralCode() ran as soon as an order was CREATED. Closing the
// payment window and tapping again then sent no code, and the server, rightly,
// charged the full price.
for (const [name, source] of [["get.js", getJs], ["shop.js", shopJs], ["direct.js", directJs]]) {
  test(`${name} keeps the friend's link until the order is actually placed`, () => {
    const untilDone = slice(source, 'fetch("/api/shop/guest/create-order"', "function showDone(done) {");
    assert.doesNotMatch(untilDone, /clearReferralCode\(\)/, "cleared between creating the order and completing it");

    const done = slice(source, "function showDone(done) {", "\n}\n");
    assert.match(done, /clearReferralCode\(\);/, "a finished purchase spends the link");
  });
}

test("the sheet shows the link as a badge, and hides it beside Cash on Delivery", () => {
  assert.match(sheetJs, /\[summary\.offerLabel, summary\.referralLabel\]\.forEach\(/);
  // Every badge, not just the first: there can be two now.
  const setPay = slice(sheetJs, "function setPayChoice(choice) {", "function saveLabel()");
  assert.match(setPay, /querySelectorAll\("\.pt-addr-summary-offer"\)\.forEach\(function \(el\) \{ el\.classList\.toggle\("pt-hide", cod\); \}\);/);
  assert.doesNotMatch(sheetJs, /querySelector\("\.pt-addr-summary-offer"\)/);
});

test("the page accepts exactly the codes the server mints", () => {
  const pattern = linkJs.match(/const CODE = (\/.+\/);/);
  assert.ok(pattern, "referral-link.js declares its CODE pattern");
  const CODE = vm.runInNewContext(pattern[1]);

  for (const char of ALPHABET) assert.ok(CODE.test(char.repeat(6)), `server mints "${char}", page refuses it`);
  for (const char of "0O1ILU") assert.ok(!CODE.test(char.repeat(6)), `page accepts "${char}", server never mints it`);
  assert.ok(!CODE.test("ABCDE") && !CODE.test("ABCDEFG"), "six characters, no more and no fewer");
});
