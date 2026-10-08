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

// The Meta review (Oct 2026) found the first screen opened on a flat drawing
// and product jargon, and that two of the four packs were dead ends. These pin
// the first decision a cold visitor faces.
describe("the first decision on /get", () => {
  test("the hook is the line that names the habit it replaces, and the first photo is a real windscreen", () => {
    const html = read("pages/get.html");
    assert.match(html, /<h1 class="gt-title"[^>]*>Never write your <span class="gt-mark">phone number<\/span> on a car window again\.<\/h1>/);
    assert.match(html, /<div class="gt-show-main">\s*<img\s+src="\/images\/shop-gal-windscreen\.webp"/);
  });

  test("the price card names the pack and its saving from the catalogue, and shows delivery and the payment line", async () => {
    const w = await getPage();
    assert.equal(w.document.getElementById("gtBuyName").textContent, "ParkTag Car Tag (Pack of 2)");
    const price = w.document.querySelector(".gt-chip-price");
    assert.match(price.textContent, /₹499/); // the test catalogue has no launch offer
    assert.match(price.textContent, /Free delivery/);
    // CATALOGUE has no launch offer, so there is no saving to claim.
    assert.equal(w.document.getElementById("gtBuyOff").hidden, true);
    assert.equal(w.document.getElementById("gtChipCod").hidden, false);
    assert.equal(w.document.getElementById("gtChipOnline").hidden, true);
  });

  test("the paper-note comparison is on the page, with its three promises", () => {
    const html = read("pages/get.html");
    assert.match(html, /Paper note vs ParkTag/);
    for (const label of ["No number leakage", "WhatsApp and call", "Weatherproof laminate"]) assert.match(html, new RegExp(label));
  });

  test("Premium and lifetime-alert jargon is not among the hero chips", async () => {
    const w = await getPage();
    const chips = w.document.getElementById("gtChips").textContent;
    assert.doesNotMatch(chips, /Premium|Lifetime/);
  });

  test("the cash-on-delivery chip shows only when the catalogue says the hero pack takes it", async () => {
    const w = await getPage();
    assert.equal(w.document.getElementById("gtChipCod").hidden, false);
  });

  test("sold-out packs are out of the buy list but still one tap away, and still cannot be bought", async () => {
    const w = await getPage();
    const live = [...w.document.querySelectorAll("#gtPacks .gt-pack")];
    assert.equal(live.length, 2);
    assert.equal(live.filter((li) => li.classList.contains("gt-pack-out")).length, 0);

    assert.equal(w.document.getElementById("gtSoon").hidden, false);
    const soon = [...w.document.querySelectorAll("#gtPacksOut .gt-pack-out")];
    assert.equal(soon.length, 2);
    for (const li of soon) assert.equal(li.querySelector("[data-sku]"), null, "a sold-out card has no data-sku");
  });
});

// Clarity showed people tapping photos to see them larger and nothing happening
// (dead clicks). Every photo on the page opens in the one zoom dialog.
describe("tapping a photo on /get", () => {
  test("opens it larger: gallery, how-it-works, the plate and the packs, as well as the proof and chat shots", () => {
    const get = read("scripts/get.js");
    const selector = get.match(/const shot = event\.target\.closest\(\s*"([^"]+)"/)?.[1] || "";
    for (const part of ["img.gt-heard-shot", "img.gt-proof-media", ".gt-show img", ".gt-diff-b img", ".gt-how-media img", "#gtAddonImage", ".gt-pack img"]) {
      assert.ok(selector.includes(part), `${part} opens the zoom`);
    }
    assert.match(read("pages/get.html"), /<dialog class="gt-zoom" id="gtZoom"/);
  });

  test("the plate photo no longer toggles the box: a tap on a photo is a look, not a choice", () => {
    assert.doesNotMatch(read("scripts/get.js"), /byId\("gtAddonImage"\)\?\.addEventListener\("click"/);
  });
});

// Clarity showed dead clicks on /get: tiles and chips that look tappable and are
// not. Every one of them is a link to something that exists on the page.
describe("nothing on /get that looks tappable is dead", () => {
  const html = read("pages/get.html");
  const doc = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, "")).window.document;

  test("every tile and chip is a link to an element that exists", () => {
    for (const group of [".gt-perks li", ".gt-wg", ".gt-cases li", ".gt-diff-feats li"]) {
      const items = [...doc.querySelectorAll(group)];
      assert.ok(items.length > 0, `${group} is on the page`);
      for (const li of items) {
        const a = li.querySelector("a[href^='#']");
        assert.ok(a, `${group}: "${li.textContent.trim().slice(0, 30)}" has a link`);
        assert.ok(doc.querySelector(a.getAttribute("href")), `${a.getAttribute("href")} exists`);
      }
    }
  });

  test("every data-goto panel points at an element that exists", () => {
    const panels = [...doc.querySelectorAll("[data-goto]")];
    assert.ok(panels.length >= 4);
    for (const el of panels) assert.ok(doc.querySelector(el.dataset.goto), `${el.dataset.goto} exists`);
  });

  test("badges drawn over photos let the tap through to the photo", () => {
    const css = read("styles/get.css");
    assert.match(css, /\.gt-show-chip, \.gt-how-n, \.gt-how-pill, \.gt-buy-off \{ pointer-events: none; \}/);
  });
});
