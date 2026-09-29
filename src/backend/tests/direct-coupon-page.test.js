// /direct sells at the catalogue price (no launch offer), hides the single, and
// a code is what brings the price down and triggers the celebration.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../../frontend/pages/direct.html", import.meta.url), "utf8");
const src = fs.readFileSync(new URL("../../frontend/scripts/direct.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "");

const PRODUCTS = {
  "pt-car-1": { name: "ParkTag Car Tag (Pack of 1)", amountPaise: 29900 },
  "pt-car-2": { name: "ParkTag Car Tag (Pack of 2)", amountPaise: 49900 }
};

const open = [];
after(() => open.forEach((w) => w.close()));

async function boot(url) {
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ""), { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  open.push(w);
  const bursts = [];
  w.burstConfetti = (...a) => bursts.push(a);
  w.clearConfetti = () => {};
  w.Element.prototype.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.referralCode = () => null; w.clearReferralCode = () => {};
  w.fetch = async (u, opts) => {
    const json = (o) => ({ ok: true, json: async () => o });
    if (u.includes("public-catalogue")) {
      return json({ ok: true, products: PRODUCTS, launchOffer: { code: "LAUNCH100", productId: "pt-car-2", offerPaise: 39900, mrpPaise: 49900, discountPaise: 10000 }, addOns: [] });
    }
    if (u.includes("promo/check")) {
      const b = JSON.parse(opts.body);
      return b.code === "GEM99"
        ? json({ ok: true, code: "GEM99", catalogPaise: 49900 * b.quantity, payablePaise: 49900 * b.quantity - 9900 })
        : json({ ok: false, reason: "unknown" });
    }
    return json({ ok: false });
  };
  w.eval(`(async () => { ${src.replace(/^load\(\);$/m, "await load();")} })()`);
  await new Promise((r) => setTimeout(r, 50));
  return { w, bursts, d: w.document };
}

test("plain /direct: Duo Pack at 499 with 549 struck, no launch offer, no single", async () => {
  const { d, bursts } = await boot("https://x.test/direct");
  const cards = [...d.querySelectorAll(".gt-pack")].filter((c) => !c.classList.contains("gt-pack-out"));
  assert.equal(cards.length, 1);
  assert.match(cards[0].textContent, /Pack of 2/);
  assert.match(d.querySelector(".gt-pack-now").textContent, /499/);
  assert.match(d.querySelector(".gt-pack-was").textContent, /549/);
  assert.doesNotMatch(d.body.textContent, /launch offer|Pack of 1/);
  assert.equal(d.getElementById("drCode").value, "");
  assert.equal(bursts.length, 0);
});

test("?promo=GEM99 applies on load: 400, banner, one confetti burst", async () => {
  const { d, bursts } = await boot("https://x.test/direct?promo=GEM99&sku=pt-car-2");
  assert.match(d.querySelector(".gt-pack-now").dataset.paise, /^40000$/);
  assert.ok(d.getElementById("drCodeCard").classList.contains("gt-code-won"));
  assert.equal(d.getElementById("drCodeWin").hidden, false);
  assert.match(d.getElementById("drCodeWinT").textContent, /GEM99 applied/);
  assert.match(d.getElementById("drCodeWinS").textContent, /₹400 instead of ₹499/);
  assert.match(d.querySelector(".gt-pack-save").textContent, /GEM99/);
  assert.equal(bursts.length, 1);
});

test("a bad code shows the refusal, and Remove restores the plain price", async () => {
  const { w, d } = await boot("https://x.test/direct");
  const input = d.getElementById("drCode");
  input.value = "nope"; d.getElementById("drCodeApply").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(d.getElementById("drCodeNote").textContent, /do not recognise/);
  input.value = "gem99"; d.getElementById("drCodeApply").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(d.getElementById("drCodeCard").classList.contains("gt-code-won"));
  d.getElementById("drCodeRemove").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!d.getElementById("drCodeCard").classList.contains("gt-code-won"));
  assert.equal(d.querySelector(".gt-pack-now").dataset.paise, "49900");
  w.close();
});
