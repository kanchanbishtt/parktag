// "Place order, pay on delivery" on /shop and /get answers at the tap.
//
// It used to wait on three things in a row before the code screen appeared:
// Ola's address check, a bot-check token from Google, and the server sending
// the WhatsApp code. Two seconds and more, with the button reading "Checking
// address…" then "Sending code…". Now the code screen is shown at once and
// those run behind it: the send's answer updates the screen (or brings the form
// back with the reason), the address verdict lands as a note, and the token was
// minted when Cash on Delivery was chosen.
//
// The real sheet in jsdom, with fetch and the captcha under the test's control
// so each answer can be held back and released. No database.
import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const read = (path) => fs.readFileSync(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
const sheetSrc = read("scripts/owner/address-step.js");

const ADDRESS = { fullName: "Asha Verma", phone: "9812345678", pincode: "110052", line1: "12B, MG Road", line2: "", city: "New Delhi", state: "Delhi" };
const SUMMARY = { name: "ParkTag Car Tag (Pack of 2)", amountPaise: 49900, cod: { amountPaise: 54800, feePaise: 4900 } };

const open = [];
after(() => open.forEach((w) => w.close()));
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

// A promise the test resolves by hand.
function held() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function sheetWindow() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://x.test/shop", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  open.push(w);
  w.Element.prototype.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.calls = [];          // every request the sheet made, in order
  w.send = held();       // the code send's answer, released by the test
  w.check = held();      // the address check's answer, released by the test
  w.minted = 0;
  w.fetch = async (input, opts) => {
    const u = String(input);
    const json = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });
    w.calls.push({ url: u, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (u.includes("/cod-otp/send")) return json(...[await w.send.promise].flat());
    if (u.includes("/address-check")) return json(await w.check.promise);
    return json({ ok: false }, false);
  };
  w.eval(sheetSrc);
  return w;
}

const byId = (w, id) => w.document.getElementById(id);
// The two calls this change is about. The sheet's pincode lookup and its
// pincode-only warm-up fire as they always did and are not counted here.
const codCalls = (w) => w.calls.filter((c) => c.url.includes("/address-check") || c.url.includes("/cod-otp/"));
const up = (w, id) => !byId(w, id).classList.contains("pt-hide");
function type(w, key, value) {
  const input = byId(w, `pt-addr-${key}`);
  input.value = value;
  input.dispatchEvent(new w.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
function chooseCod(w) {
  const cod = w.document.querySelector("input[name='pt-addr-pay'][value='cod']");
  cod.checked = true;
  cod.dispatchEvent(new w.Event("change", { bubbles: true }));
}

// The sheet open for a COD-capable pack, the address typed, COD chosen.
function readyToTap(w) {
  w.ptCollectAddress({ guest: true, orderSummary: SUMMARY, captchaToken: async () => { w.minted += 1; return `tok-${w.minted}`; } });
  Object.entries(ADDRESS).forEach(([key, value]) => type(w, key, value));
  chooseCod(w);
}

describe("the Cash on Delivery tap", () => {
  test("shows the code screen at once, before the server has answered anything", async () => {
    const w = sheetWindow();
    readyToTap(w);
    byId(w, "pt-addr-save").click();
    await tick();

    assert.ok(up(w, "pt-addr-otp"), "the code screen is up");
    assert.ok(!up(w, "pt-addr-form"), "the form is gone");
    assert.match(byId(w, "pt-addr-sub").textContent, /^Sending a 6-digit code on WhatsApp to 9812345678/);
    assert.equal(byId(w, "pt-addr-resend").disabled, true);
    assert.equal(byId(w, "pt-addr-resend").textContent, "Sending code…");
    // Both asked at the tap, neither answered yet.
    assert.deepEqual(codCalls(w).map((c) => c.url).sort(), ["/api/shop/address-check", "/api/shop/guest/cod-otp/send"]);
  });

  test("once the code has gone, the screen says so and Resend opens on its timer", async () => {
    const w = sheetWindow();
    readyToTap(w);
    byId(w, "pt-addr-save").click();
    await tick();
    w.send.resolve({ ok: true, phoneHint: "••••5678" });
    await tick();

    assert.match(byId(w, "pt-addr-sub").textContent, /^We sent a 6-digit code on WhatsApp to 9812345678/);
    assert.match(byId(w, "pt-addr-resend").textContent, /^Resend code in \d+s$/);
    assert.ok(up(w, "pt-addr-otp"));
  });

  test("a send the server refuses brings the form back with its reason", async () => {
    const w = sheetWindow();
    readyToTap(w);
    byId(w, "pt-addr-save").click();
    await tick();
    w.send.resolve([{ ok: false, error: "Cash on Delivery is not available at this pincode. Please pay online." }, false]);
    await tick();

    assert.ok(up(w, "pt-addr-form"), "back on the form");
    assert.ok(!up(w, "pt-addr-otp"));
    assert.equal(byId(w, "pt-addr-err").textContent, "Cash on Delivery is not available at this pincode. Please pay online.");
    assert.equal(byId(w, "pt-addr-line1").value, ADDRESS.line1, "what was typed is still there");
  });

  test("an address Ola cannot match is a note on the code screen, not a wall", async () => {
    const w = sheetWindow();
    readyToTap(w);
    byId(w, "pt-addr-save").click();
    await tick();
    assert.ok(!byId(w, "pt-addr-otp-note").classList.contains("pt-show"), "nothing to say yet");

    w.check.resolve({ ok: true, validated: false });
    await tick();
    assert.ok(byId(w, "pt-addr-otp-note").classList.contains("pt-show"));
    assert.match(byId(w, "pt-addr-otp-note").textContent, /couldn't match this address to PIN 110052/);
    assert.ok(up(w, "pt-addr-otp"), "the code screen stays: the buyer may place it anyway");

    // A matched or unknown address shows nothing.
    const ok = sheetWindow();
    readyToTap(ok);
    byId(ok, "pt-addr-save").click();
    ok.check.resolve({ ok: true, validated: null });
    await tick();
    assert.ok(!byId(ok, "pt-addr-otp-note").classList.contains("pt-show"));
  });

  test("the bot-check token was minted when Cash on Delivery was chosen, and the send uses it", async () => {
    const w = sheetWindow();
    readyToTap(w);
    assert.equal(w.minted, 1, "minted at the choice, before the tap");
    byId(w, "pt-addr-save").click();
    await tick();
    const send = w.calls.find((c) => c.url.includes("/cod-otp/send"));
    assert.equal(send.body.recaptchaToken, "tok-1");
    assert.equal(w.minted, 1, "no second mint at the tap");
    assert.equal(send.body.phone, ADDRESS.phone);
    assert.equal(send.body.pincode, ADDRESS.pincode);
  });

  test("a token older than ninety seconds is replaced, not sent", async () => {
    const w = sheetWindow();
    let clock = 1_000_000;
    w.Date.now = () => clock;
    readyToTap(w);
    assert.equal(w.minted, 1);
    clock += 100_000; // the buyer re-read the form for a while
    byId(w, "pt-addr-save").click();
    await tick();
    assert.equal(w.minted, 2);
    assert.equal(w.calls.find((c) => c.url.includes("/cod-otp/send")).body.recaptchaToken, "tok-2");
  });

  test("going back before the answers land: the form is not disturbed by them", async () => {
    const w = sheetWindow();
    readyToTap(w);
    byId(w, "pt-addr-save").click();
    await tick();
    byId(w, "pt-addr-back").click();
    assert.ok(up(w, "pt-addr-form"));
    type(w, "line1", "14, MG Road"); // editing

    w.send.resolve([{ ok: false, error: "late failure" }, false]);
    w.check.resolve({ ok: true, validated: false });
    await tick();
    assert.ok(up(w, "pt-addr-form"));
    assert.equal(byId(w, "pt-addr-line1").value, "14, MG Road", "the late failure did not reset the form");
    assert.equal(byId(w, "pt-addr-err").textContent, "");
    assert.ok(!byId(w, "pt-addr-otp-note").classList.contains("pt-show"));
  });

  test("paying online never asks for an address check or a code", async () => {
    const w = sheetWindow();
    let picked = null;
    w.ptCollectAddress({ guest: true, orderSummary: SUMMARY, captchaToken: async () => "tok" }).then((v) => { picked = v; });
    Object.entries(ADDRESS).forEach(([key, value]) => type(w, key, value));
    byId(w, "pt-addr-save").click();
    await tick();
    assert.deepEqual(codCalls(w), []);
    assert.equal(picked && picked.paymentMethod, "online");
    assert.equal(w.minted, 0);
  });
});

describe("the server sends the code without queueing its checks", () => {
  const route = fs.readFileSync(new URL("../routes/shop/index.js", import.meta.url), "utf8");
  const send = route.slice(route.indexOf('"/api/shop/guest/cod-otp/send"'), route.indexOf('"/api/shop/guest/cod-otp/verify"'));

  test("the bot check, the open-order lookup and the courier are asked together", () => {
    assert.ok(send.indexOf("const captchaCheck = verifyRecaptcha(") < send.indexOf("const captcha = await captchaCheck;"));
    assert.ok(send.indexOf("const lookups = (async () => {") < send.indexOf("const captcha = await captchaCheck;"));
    assert.match(send, /Promise\.all\(\[\s*findOpenGuestCod\(collections, phone\),\s*pincode \? checkPincodeServiceability\(env, pincode\) : null\s*\]\)/);
    // Decided in the old order: bot check, address cap, open order, pincode, send.
    const order = ["const captcha = await captchaCheck;", "windowCountExceeded(", "if (open) {", "serviceability.cod === false", "await sendOtp("].map((s) => send.indexOf(s));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });
});
