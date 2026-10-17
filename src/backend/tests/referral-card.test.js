import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The dashboard's "Refer a friend" card. Its figures belong to the server
// (routes/owner/dashboard.js sends them as data.referral), so the card must be
// drawn from that payload and never carry its own copy of "₹50" or "1 month".

const js = await readFile(new URL("../../frontend/scripts/owner/welcome.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../frontend/pages/owner/welcome.html", import.meta.url), "utf8");

function between(from, to) {
  const start = js.indexOf(from);
  const end = js.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `could not find ${from} … ${to} in welcome.js`);
  return js.slice(start, end);
}

function card() {
  const els = {};
  for (const id of ["referralCard", "refTitle", "refSub", "refLink", "refEarned"]) els[id] = { hidden: true, textContent: "" };
  const context = vm.createContext({
    location: { origin: "https://app.parktag.me" },
    document: { getElementById: (id) => els[id] || null }
  });
  vm.runInContext(between("function rupees(", "// A contact that no longer maps"), context);
  vm.runInContext(between("let _referral = null;", "function announceReferral("), context);
  return { els, context };
}

test("the card is drawn from data.referral, amounts included", () => {
  const { els, context } = card();
  context.renderReferral({ code: "X237XC", discountPaise: 7500, rewardMonths: 2, prepaidOnly: true });
  assert.equal(els.referralCard.hidden, false);
  assert.equal(els.refTitle.textContent, "Give ₹75, get 2 free months");
  assert.match(els.refSub.textContent, /₹75 off when they pay online/);
  assert.match(els.refSub.textContent, /2 months of Premium for each friend who buys/);
  assert.equal(els.refLink.textContent, "app.parktag.me/get?ref=X237XC");
  const message = vm.runInContext("referralMessage()", context);
  assert.match(message, /Get ₹75 off with my link: https:\/\/app\.parktag\.me\/get\?ref=X237XC$/);
});

test("the card stays hidden without a referral code", () => {
  for (const ref of [undefined, null, { code: null, discountPaise: 5000, rewardMonths: 1 }]) {
    const { els, context } = card();
    els.referralCard.hidden = false;
    context.renderReferral(ref);
    assert.equal(els.referralCard.hidden, true, `shown for ${JSON.stringify(ref)}`);
  }
});

test("no referral amount is hard-coded in the card's script or markup", () => {
  const script = between("let _referral = null;", "window.shareReferral = shareReferral;");
  assert.doesNotMatch(script, /₹\s*\d|\b5000\b|free month.*\b1\b/);
  const markup = html.slice(html.indexOf('id="referralCard"'), html.indexOf("</section>", html.indexOf('id="referralCard"')));
  assert.match(html, /<section class="pt-ref" id="referralCard"[^>]*\bhidden>/, "the card must ship hidden");
  assert.doesNotMatch(markup, /₹|\bmonth\b/);
  assert.match(js, /renderReferral\(data\.referral\)/);
});

test("copy and share report through the allow-listed share event", async () => {
  const script = between("async function copyReferral(", "window.shareReferral = shareReferral;");
  for (const method of ["copy", "native", "whatsapp"]) {
    assert.match(script, new RegExp(`ptTrack\\("share", \\{ method: "${method}", content_type: "referral" \\}\\)`));
  }
  const analytics = await readFile(new URL("../assets/analytics.js", import.meta.url), "utf8");
  assert.match(analytics, /share:\s+\{ ga: "share"/);
  const allowList = analytics.slice(analytics.indexOf("var ALLOWED"), analytics.indexOf("function sanitize"));
  assert.match(allowList, /\bcontent_type: 1\b/);
});

// The card used to make the offer and never report on it. These figures come
// off the same payload, counted by the server from paid orders.
const OFFER = { code: "X237XC", discountPaise: 5000, rewardMonths: 1, prepaidOnly: true };

test("nothing is said about earnings until a friend has bought", () => {
  for (const stats of [{}, { friends: 0, monthsEarned: 0, monthsWaiting: 0 }, { friends: "x", monthsEarned: null }]) {
    const { els, context } = card();
    els.refEarned.hidden = false;
    context.renderReferral({ ...OFFER, ...stats });
    assert.equal(els.refEarned.hidden, true, `shown for ${JSON.stringify(stats)}`);
    assert.equal(els.refEarned.textContent, "");
  }
});

test("the card says how many friends bought and what that earned", () => {
  const { els, context } = card();
  context.renderReferral({ ...OFFER, friends: 1, monthsEarned: 1, monthsWaiting: 0 });
  assert.equal(els.refEarned.hidden, false);
  assert.equal(els.refEarned.textContent, "1 friend has bought with your link. You have earned 1 month of Premium.");

  context.renderReferral({ ...OFFER, friends: 3, monthsEarned: 3, monthsWaiting: 0 });
  assert.equal(els.refEarned.textContent, "3 friends have bought with your link. You have earned 3 months of Premium.");
});

test("months waiting for a Premium tag are named as waiting, not as lost", () => {
  const { els, context } = card();
  context.renderReferral({ ...OFFER, friends: 2, monthsEarned: 2, monthsWaiting: 2 });
  assert.equal(
    els.refEarned.textContent,
    "2 friends have bought with your link. You have earned 2 months of Premium. 2 months are waiting, and will be added as soon as you have a Premium tag."
  );

  context.renderReferral({ ...OFFER, friends: 0, monthsEarned: 1, monthsWaiting: 1 });
  assert.equal(
    els.refEarned.textContent,
    "You have earned 1 month of Premium. 1 month is waiting, and will be added as soon as you have a Premium tag."
  );
});

test("the earnings line has a place in the card, hidden until it has something to say", () => {
  const markup = html.slice(html.indexOf('id="referralCard"'), html.indexOf("</section>", html.indexOf('id="referralCard"')));
  assert.match(markup, /<p class="pt-ref-earned" id="refEarned"[^>]*\bhidden><\/p>/);
});

test("the Refer & Earn banner links to the card, on phone and desktop alike", () => {
  const slide = html.slice(html.indexOf("<!-- Slide 2"), html.indexOf("<!-- Slide 3"));
  assert.match(slide, /<a class="pt-slide-link" href="#referralCard" onclick="return goToReferral\(event\)">/);
  // Both cuts of the artwork sit inside the one link.
  assert.match(slide, /<source media="\(min-width: 600px\)" srcset="\/images\/banner-2-desktop\.webp"/);
  assert.match(slide, /<img class="pt-slide-photo" src="\/images\/banner-2\.webp"/);
  assert.match(slide, /<\/picture>\s*<\/a>/);
  assert.match(js, /window\.goToReferral = goToReferral;/);
});

test("the banner link scrolls to the card, and does nothing while the card is hidden", () => {
  const calls = [];
  const card = {
    hidden: true,
    offsetWidth: 1,
    classList: { add: (c) => calls.push("add:" + c), remove: (c) => calls.push("remove:" + c) },
    scrollIntoView: (o) => calls.push("scroll:" + o.block)
  };
  const context = vm.createContext({ document: { getElementById: (id) => (id === "referralCard" ? card : null) } });
  vm.runInContext(between("function goToReferral(", "window.goToReferral = goToReferral;"), context);
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };

  assert.equal(context.goToReferral(event), false);
  assert.equal(prevented, 1, "the bare #referralCard jump is suppressed even when there is nothing to show");
  assert.deepEqual(calls, []);

  card.hidden = false;
  assert.equal(context.goToReferral(event), false);
  assert.deepEqual(calls, ["scroll:center", "remove:pt-ref-flash", "add:pt-ref-flash"]);
});
