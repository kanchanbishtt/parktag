// On /get, only the Order button starts a purchase.
//
// Reported 2026-10-03: a tap anywhere on the ₹299 or ₹399 pack card (the
// price, the name, the photo) opened the delivery address sheet. That was a
// deliberate change in #300 ("the whole card buys"), and it reads as the page
// acting on its own: people tap a card to look at it. The delivery sheet is
// the first step of handing over an address, and it must follow the one
// control that says Order.
//
// The REAL page and the REAL sheet in jsdom, the way checkout-survives-reload
// runs them. No database.
import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const read = (path) => fs.readFileSync(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
const stripImports = (source) => source.replace(/^import .*$/gm, "");
const sheetSrc = read("scripts/owner/address-step.js");
const cartSrc = read("scripts/checkout-cart.js").replace(/^export /gm, "");
const captchaSrc = read("scripts/fresh-captcha.js").replace(/^export /gm, "");

const CATALOGUE = {
  ok: true,
  products: {
    "pt-car-1": { name: "ParkTag Car Tag (Pack of 1)", amountPaise: 29900 },
    "pt-car-2": { name: "ParkTag Car Tag (Pack of 2)", amountPaise: 49900 },
    "pt-combo": { name: "ParkTag Combo", amountPaise: 69900, soldOut: true },
    "pt-bike-1": { name: "ParkTag Bike Tag", amountPaise: 49900, soldOut: true }
  },
  addOns: [],
  codSurchargePaise: 4900,
  codProductIds: ["pt-car-1", "pt-car-2"],
  maxQuantity: 20
};

const open = [];
after(() => open.forEach((w) => w.close()));
const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPage() {
  const dom = new JSDOM(read("pages/get.html").replace(/<script[\s\S]*?<\/script>/g, ""), { url: "https://x.test/get", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  open.push(w);
  w.Element.prototype.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.tracked = [];
  w.ptTrack = (name, props) => w.tracked.push({ name, props });
  w.fetch = async (input) => {
    const u = String(input);
    const json = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });
    if (u.includes("public-catalogue")) return json(CATALOGUE);
    return json({ ok: false }, false);
  };
  w.getCaptchaToken = async () => "";
  w.burstConfetti = () => {};
  w.clearConfetti = () => {};
  w.referralCode = () => null;
  w.clearReferralCode = () => {};
  w.ptLoadRazorpay = async () => false;
  w.eval(cartSrc);
  w.eval(captchaSrc);
  w.eval(sheetSrc);
  w.eval(`(async () => { ${stripImports(read("scripts/get.js")).replace(/^load\(\);$/m, "await load();")} })()`);
  await tick();
  return w;
}

const sheetUp = (w) => Boolean(w.document.getElementById("pt-addr-ov")?.classList.contains("pt-open"));
const card = (w, sku) => [...w.document.querySelectorAll("#gtPacks .gt-pack")].find((li) => li.querySelector(`a[data-sku="${sku}"]`));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));

describe("tapping a pack card on /get", () => {
  for (const [sku, label] of [["pt-car-1", "₹299"], ["pt-car-2", "₹399 (launch offer)"]]) {
    test(`${label}: the price, the name and the photo open nothing`, async () => {
      const w = await getPage();
      const li = card(w, sku);
      assert.ok(li, "the pack is on the page");
      for (const part of [".gt-pack-price", ".gt-pack-n", ".gt-pack-d", "img"]) {
        const el = li.querySelector(part);
        if (!el) continue;
        click(el);
        await tick(20);
        assert.equal(sheetUp(w), false, `a tap on ${part} opened the delivery sheet`);
      }
      click(li);
      await tick(20);
      assert.equal(sheetUp(w), false, "a tap on the card itself opened the delivery sheet");
      assert.deepEqual(w.tracked.filter((t) => t.name === "begin_checkout" || t.name === "select_item"), []);
    });

    test(`${label}: the Order button does`, async () => {
      const w = await getPage();
      const button = card(w, sku).querySelector("a[data-sku]");
      assert.equal(button.textContent, "Order");
      click(button);
      await tick(20);
      assert.equal(sheetUp(w), true);
      assert.equal(w.tracked.filter((t) => t.name === "begin_checkout").length, 1);
    });
  }

  test("no card carries a data-sku of its own, and no card is styled as a button", () => {
    const get = read("scripts/get.js");
    assert.doesNotMatch(get, /li\.dataset\.sku/);
    assert.doesNotMatch(get, /\.gt-pack\[data-sku\]/);
    assert.doesNotMatch(read("styles/get.css"), /\.gt-pack\[data-sku\]/);
  });
});
