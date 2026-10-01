// A reload must not cost a buyer the step they were on.
//
// The delivery address step is one sheet (scripts/owner/address-step.js) opened
// by four pages: /get, /shop, /direct and the shop inside the owner dashboard.
// Only /get used to bring it back after a reload. On the other three the sheet
// closed and everything typed into it was gone, on the screen where a buyer has
// just done the most typing of the whole purchase.
//
// These run the REAL pages and the REAL sheet in jsdom. A "reload" is a fresh
// window on the same URL that starts with the old window's sessionStorage,
// which is exactly what a browser tab keeps across one.

import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const read = (path) => fs.readFileSync(new URL(`../../frontend/${path}`, import.meta.url), "utf8");
// The pages import these as modules. Here the imports are stripped and each
// name is put on the window instead: stand-ins for the ones that only decorate
// or measure, and the real source for the one under test.
const stripImports = (source) => source.replace(/^import .*$/gm, "");
const sheetSrc = read("scripts/owner/address-step.js");
const cartSrc = read("scripts/checkout-cart.js").replace(/^export /gm, "");
const captchaSrc = read("scripts/fresh-captcha.js").replace(/^export /gm, "");

const PRODUCTS = {
  "pt-car-1": { name: "ParkTag Car Tag (Pack of 1)", amountPaise: 29900 },
  "pt-car-2": { name: "ParkTag Car Tag (Pack of 2)", amountPaise: 49900 },
  "pt-combo": { name: "ParkTag Combo", amountPaise: 69900 },
  "pt-bike-1": { name: "ParkTag Bike Tag", amountPaise: 49900 }
};
const CATALOGUE = {
  ok: true,
  products: PRODUCTS,
  addOns: [{ id: "dashboard-plate", name: "Clear Dashboard Plate", description: "A plate", image: "/x.png", amountPaise: 9900, productIds: ["pt-car-2"] }],
  codSurchargePaise: 4900,
  codProductIds: ["pt-car-1", "pt-car-2"],
  maxQuantity: 20
};

const ADDRESS = { fullName: "Asha Verma", phone: "9812345678", pincode: "110052", line1: "12B, MG Road", line2: "Near the park", city: "New Delhi", state: "Delhi" };

const open = [];
after(() => open.forEach((w) => w.close()));

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

// What a tab keeps across a reload.
function storageOf(w) {
  const out = {};
  for (let i = 0; i < w.sessionStorage.length; i += 1) {
    const key = w.sessionStorage.key(i);
    out[key] = w.sessionStorage.getItem(key);
  }
  return out;
}

function makeWindow(html, url, storage = {}) {
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ""), { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  open.push(w);
  for (const [key, value] of Object.entries(storage)) w.sessionStorage.setItem(key, value);
  w.Element.prototype.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // jsdom has no media playback; /get's proof clip only needs these to exist.
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.tracked = [];
  w.ptTrack = (name) => w.tracked.push(name);
  // Nothing on the network. The catalogue is answered; everything else (the
  // pincode lookup, street suggestions, the referral check) says "no".
  w.ownerAddress = null;
  w.fetch = async (input, opts) => {
    const u = String(input);
    const json = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });
    if (u.includes("public-catalogue")) return json(CATALOGUE);
    if (u.includes("promo/check")) {
      const asked = JSON.parse(opts.body);
      return asked.code === "GEM99"
        ? json({ ok: true, code: "GEM99", catalogPaise: 49900 * asked.quantity, payablePaise: 49900 * asked.quantity - 9900 })
        : json({ ok: false, reason: "unknown" });
    }
    if (u.includes("/api/owner/address") && (!opts || !opts.method || opts.method === "GET")) return json({ ok: true, address: w.ownerAddress });
    if (u.includes("/api/owner/address")) { w.ownerAddress = JSON.parse(opts.body); return json({ ok: true }); }
    if (u.includes("/api/owner/dashboard")) return json({ ok: true, owner: { displayName: "" } });
    return json({ ok: false }, false);
  };
  return w;
}

// The address sheet on its own, on a blank page.
function sheetWindow(storage) {
  const w = makeWindow("<!doctype html><html><body></body></html>", "https://x.test/any", storage);
  w.eval(sheetSrc);
  return w;
}

// A storefront page with its real script, the real sheet and the real cart.
async function bootPage(page, script, url, storage) {
  const w = makeWindow(read(`pages/${page}`), url, storage);
  w.getCaptchaToken = async () => "";
  w.burstConfetti = () => {};
  w.clearConfetti = () => {};
  w.referralCode = () => null;
  w.clearReferralCode = () => {};
  w.ptLoadRazorpay = async () => false;
  w.eval(cartSrc);
  w.eval(captchaSrc);
  w.eval(sheetSrc);
  w.eval(`(async () => { ${stripImports(read(`scripts/${script}`)).replace(/^load\(\);$/m, "await load();")} })()`);
  await tick(60);
  return w;
}

const byId = (w, id) => w.document.getElementById(id);
const field = (w, key) => byId(w, `pt-addr-${key}`);
const sheetUp = (w) => Boolean(byId(w, "pt-addr-ov")?.classList.contains("pt-open") && !byId(w, "pt-addr-ov").classList.contains("pt-closing"));
const formUp = (w) => sheetUp(w) && !byId(w, "pt-addr-form").classList.contains("pt-hide");
const confirmUp = (w) => sheetUp(w) && !byId(w, "pt-addr-confirm").classList.contains("pt-hide");

function type(w, key, value) {
  const input = field(w, key);
  input.value = value;
  input.dispatchEvent(new w.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
const typeAddress = (w, address = ADDRESS) => Object.entries(address).forEach(([key, value]) => type(w, key, value));
const typed = (w) => Object.fromEntries(Object.keys(ADDRESS).map((key) => [key, field(w, key).value]));

const SUMMARY = { name: "ParkTag Car Tag (Pack of 2)", amountPaise: 49900, cod: { amountPaise: 54800, feePaise: 4900 } };

describe("the address sheet keeps what was typed", () => {
  test("a guest's address, the unticked WhatsApp box and Cash on Delivery all come back", async () => {
    const before = sheetWindow();
    before.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    typeAddress(before);
    const box = byId(before, "pt-addr-optin");
    box.checked = false;
    box.dispatchEvent(new before.Event("change", { bubbles: true }));
    const cod = before.document.querySelector("input[name='pt-addr-pay'][value='cod']");
    cod.checked = true;
    cod.dispatchEvent(new before.Event("change", { bubbles: true }));

    const reloaded = sheetWindow(storageOf(before));
    reloaded.ptCollectAddress({ guest: true, orderSummary: SUMMARY });

    assert.ok(formUp(reloaded));
    assert.deepEqual(typed(reloaded), ADDRESS);
    assert.equal(byId(reloaded, "pt-addr-optin").checked, false, "a box the buyer unticked stays unticked");
    assert.equal(reloaded.document.querySelector("input[name='pt-addr-pay']:checked").value, "cod");
    assert.match(byId(reloaded, "pt-addr-save").textContent, /pay on delivery/i, "and the button is re-labelled for it");
  });

  test("a box that was left ticked is not un-ticked, and one never touched stays as shipped", async () => {
    const before = sheetWindow();
    before.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    typeAddress(before);

    const reloaded = sheetWindow(storageOf(before));
    reloaded.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    assert.equal(byId(reloaded, "pt-addr-optin").checked, true);
    assert.equal(reloaded.document.querySelector("input[name='pt-addr-pay']:checked").value, "online");
  });

  test("Cash on Delivery is not brought back onto an open that does not offer it", async () => {
    const before = sheetWindow();
    before.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    typeAddress(before);
    const cod = before.document.querySelector("input[name='pt-addr-pay'][value='cod']");
    cod.checked = true;
    cod.dispatchEvent(new before.Event("change", { bubbles: true }));

    const reloaded = sheetWindow(storageOf(before));
    reloaded.ptCollectAddress({ guest: true, orderSummary: { name: "Pack", amountPaise: 49900 } });

    assert.ok(byId(reloaded, "pt-addr-paychoice").classList.contains("pt-hide"));
    assert.match(byId(reloaded, "pt-addr-save").textContent, /Continue to pay/);
    assert.equal(typed(reloaded).line1, ADDRESS.line1, "the address still comes back");
  });

  test("a guest who backs out keeps what they typed; a finished order forgets it", async () => {
    const w = sheetWindow();
    const first = w.ptCollectAddress({ guest: true });
    typeAddress(w);
    byId(w, "pt-addr-cancel").click();
    assert.equal(await first, false);
    await tick();

    const second = w.ptCollectAddress({ guest: true });
    assert.deepEqual(typed(w), ADDRESS, "picking another pack must not mean typing it all again");
    byId(w, "pt-addr-cancel").click();
    await second;
    await tick();

    w.ptCollectAddress.clearDraft();
    w.ptCollectAddress({ guest: true });
    assert.equal(typed(w).fullName, "");
    assert.equal(typed(w).line1, "");
  });

  test("nothing is written back after the sheet has gone", async () => {
    const w = sheetWindow();
    const opened = w.ptCollectAddress({ guest: true });
    typeAddress(w);
    byId(w, "pt-addr-cancel").click();
    await opened;
    w.ptCollectAddress.clearDraft();

    // A box changing while no sheet is up (a late lookup answering) is ignored.
    type(w, "city", "Mumbai");
    assert.equal(w.sessionStorage.getItem("pt_addr_draft"), null);
  });

  test("an owner with no saved address gets their half-typed form back, and saving forgets it", async () => {
    const before = sheetWindow();
    before.ptCollectAddress();
    await tick();
    assert.ok(formUp(before));
    typeAddress(before);

    const reloaded = sheetWindow(storageOf(before));
    const saving = reloaded.ptCollectAddress();
    await tick();
    assert.ok(formUp(reloaded));
    assert.deepEqual(typed(reloaded), ADDRESS);

    byId(reloaded, "pt-addr-save").click();
    assert.equal(await saving, true);
    assert.equal(reloaded.sessionStorage.getItem("pt_addr_draft"), null, "it is on the profile now");
  });

  test("an owner reloaded mid-edit returns to the edit form, not the confirm card", async () => {
    const saved = { ...ADDRESS, line1: "Old house, Old Road" };
    const before = sheetWindow();
    before.ownerAddress = saved;
    before.ptCollectAddress();
    await tick();
    assert.ok(confirmUp(before), "a saved address opens on the confirm card");

    byId(before, "pt-addr-edit").click();
    type(before, "line1", "New flat, New Road");

    const reloaded = sheetWindow(storageOf(before));
    reloaded.ownerAddress = saved;
    reloaded.ptCollectAddress();
    await tick();

    assert.ok(formUp(reloaded));
    assert.equal(field(reloaded, "line1").value, "New flat, New Road");
    assert.equal(field(reloaded, "city").value, saved.city, "what they did not change is still the saved value");
  });

  test("an owner who backs out of an edit has abandoned it: the saved address stands", async () => {
    const saved = { ...ADDRESS };
    const w = sheetWindow();
    w.ownerAddress = saved;
    const first = w.ptCollectAddress();
    await tick();
    byId(w, "pt-addr-edit").click();
    type(w, "line1", "A half-made edit");
    byId(w, "pt-addr-cancel").click();
    assert.equal(await first, false);
    // Closing takes the sheet's history entry away, which lands a moment later.
    await tick();

    w.ptCollectAddress();
    await tick();
    assert.ok(confirmUp(w), "the next open shows the saved address, not the abandoned edit");
  });

  test("a guest's draft is never poured into a signed-in owner's form, nor the other way", async () => {
    const guest = sheetWindow();
    guest.ptCollectAddress({ guest: true });
    typeAddress(guest);

    const owner = sheetWindow(storageOf(guest));
    owner.ptCollectAddress();
    await tick();
    assert.ok(formUp(owner));
    assert.equal(typed(owner).line1, "");

    typeAddress(owner, { ...ADDRESS, line1: "Owner's own line" });
    const guestAgain = sheetWindow(storageOf(owner));
    guestAgain.ptCollectAddress({ guest: true });
    assert.equal(typed(guestAgain).line1, "");
  });

  test("after a reload the sheet adopts its history entry and does not add a second", () => {
    const fresh = sheetWindow();
    const start = fresh.history.length;
    fresh.ptCollectAddress({ guest: true });
    assert.equal(fresh.history.length, start + 1, "a first open adds one entry, so Back closes the sheet");

    const reloaded = sheetWindow();
    reloaded.history.replaceState({ ptAddressSheet: true }, "");
    const length = reloaded.history.length;
    reloaded.ptCollectAddress({ guest: true });
    assert.equal(reloaded.history.length, length, "Back must not need two presses after a reload");
  });

  test("with storage switched off the sheet still opens, and still hands back the address", async () => {
    const w = sheetWindow();
    w.Storage.prototype.setItem = () => { throw new Error("QuotaExceededError"); };
    w.Storage.prototype.getItem = () => { throw new Error("SecurityError"); };

    const opened = w.ptCollectAddress({ guest: true });
    assert.ok(formUp(w));
    typeAddress(w);
    byId(w, "pt-addr-save").click();
    const picked = await opened;
    assert.equal(picked.line1, ADDRESS.line1);
  });
});

describe("the cart every storefront page shares", () => {
  test("saves in patches, reads them back, and survives a corrupt value", () => {
    const w = sheetWindow();
    w.eval(cartSrc);
    const cart = w.checkoutCart("pt_test_cart");

    cart.save({ checkout: "pt-car-2" });
    cart.save({ addOn: true });
    assert.deepEqual({ ...cart.read() }, { checkout: "pt-car-2", addOn: true });

    w.sessionStorage.setItem("pt_test_cart", "{not json");
    assert.deepEqual({ ...cart.read() }, {});
    w.sessionStorage.setItem("pt_test_cart", "[1,2]");
    assert.deepEqual({ ...cart.read() }, {});
  });

  test("clearing it after an order also forgets the typed address", () => {
    const w = sheetWindow();
    w.eval(cartSrc);
    const cart = w.checkoutCart("pt_test_cart");
    w.ptCollectAddress({ guest: true });
    typeAddress(w);
    cart.save({ checkout: "pt-car-2" });
    assert.ok(w.sessionStorage.getItem("pt_addr_draft"));

    cart.clear();
    assert.equal(w.sessionStorage.getItem("pt_test_cart"), null);
    assert.equal(w.sessionStorage.getItem("pt_addr_draft"), null);
  });
});

// The Order control for a pack, whichever page it is on.
const orderLink = (w, sku) => w.document.querySelector(`a[data-sku="${sku}"]`);
const summaryName = (w) => byId(w, "pt-addr-summary-name").textContent;

describe("/shop", () => {
  test("reloading on the delivery step brings it back, on the same pack, with the address", async () => {
    const before = await bootPage("shop.html", "shop.js", "https://x.test/shop");
    assert.equal(sheetUp(before), false, "nothing opens by itself on a first visit");

    orderLink(before, "pt-car-1").click();
    await tick();
    assert.ok(formUp(before));
    typeAddress(before);

    const reloaded = await bootPage("shop.html", "shop.js", "https://x.test/shop", storageOf(before));
    assert.ok(formUp(reloaded), "the delivery step is open again without a tap");
    assert.match(summaryName(reloaded), /Pack of 1/);
    assert.deepEqual(typed(reloaded), ADDRESS);
    // A continuation, not a second checkout: the Order tap is what is counted.
    assert.equal(reloaded.tracked.filter((name) => name === "begin_checkout").length, 0);
  });

  test("the add-on tick is kept, and rides into the reopened checkout", async () => {
    const before = await bootPage("shop.html", "shop.js", "https://x.test/shop");
    const box = byId(before, "shAddonCheck");
    box.checked = true;
    box.dispatchEvent(new before.Event("change", { bubbles: true }));
    orderLink(before, "pt-car-2").click();
    await tick();

    const reloaded = await bootPage("shop.html", "shop.js", "https://x.test/shop", storageOf(before));
    assert.equal(byId(reloaded, "shAddonCheck").checked, true);
    assert.match(summaryName(reloaded), /Pack of 2.*Clear Dashboard Plate/);
    assert.equal(reloaded.tracked.filter((name) => name === "add_on_selected").length, 0, "restoring a tick is not ticking it again");
  });

  test("backing out is a decision: a reload does not reopen it, but the address is kept", async () => {
    const before = await bootPage("shop.html", "shop.js", "https://x.test/shop");
    orderLink(before, "pt-car-2").click();
    await tick();
    typeAddress(before);
    byId(before, "pt-addr-cancel").click();
    await tick();

    const reloaded = await bootPage("shop.html", "shop.js", "https://x.test/shop", storageOf(before));
    assert.equal(sheetUp(reloaded), false);

    orderLink(reloaded, "pt-car-2").click();
    await tick();
    assert.deepEqual(typed(reloaded), ADDRESS);
  });

  test("a saved pack that is sold out, or not a pack at all, is not reopened", async () => {
    for (const checkout of ["pt-bike-1", "not-a-pack", { $ne: null }, 7]) {
      const w = await bootPage("shop.html", "shop.js", "https://x.test/shop", { pt_shop_cart: JSON.stringify({ checkout }) });
      assert.equal(sheetUp(w), false, `saved checkout ${JSON.stringify(checkout)}`);
    }
  });
});

describe("/direct", () => {
  test("reloading on the delivery step brings back the pack, the count, the code and the address", async () => {
    const before = await bootPage("direct.html", "direct.js", "https://x.test/direct");
    before.document.querySelector('button[data-qty-dir="inc"][data-sku="pt-car-2"]').click();
    const code = byId(before, "drCode");
    code.value = "GEM99";
    byId(before, "drCodeApply").click();
    await tick();
    orderLink(before, "pt-car-2").click();
    await tick(80);
    assert.ok(formUp(before));
    assert.equal(before.tracked.filter((name) => name === "begin_checkout").length, 1);
    typeAddress(before);

    const reloaded = await bootPage("direct.html", "direct.js", "https://x.test/direct", storageOf(before));
    await tick(80);
    assert.ok(formUp(reloaded));
    assert.equal(byId(reloaded, "drCode").value, "GEM99");
    assert.match(summaryName(reloaded), /^2 × .*Pack of 2/);
    assert.deepEqual(typed(reloaded), ADDRESS);
    assert.equal(reloaded.tracked.filter((name) => name === "begin_checkout").length, 0, "the same checkout is not begun twice");
  });

  test("a code the buyer removed stays removed, though the link still names one", async () => {
    const url = "https://x.test/direct?promo=GEM99&sku=pt-car-2";
    const before = await bootPage("direct.html", "direct.js", url);
    assert.equal(byId(before, "drCode").value, "GEM99", "the link's code is applied on arrival");

    byId(before, "drCodeRemove").click();
    await tick();
    assert.equal(byId(before, "drCode").value, "");

    const reloaded = await bootPage("direct.html", "direct.js", url, storageOf(before));
    assert.equal(byId(reloaded, "drCode").value, "");
  });

  test("backing out is not reopened by a reload", async () => {
    const before = await bootPage("direct.html", "direct.js", "https://x.test/direct");
    orderLink(before, "pt-car-2").click();
    await tick(80);
    byId(before, "pt-addr-cancel").click();
    await tick();

    const reloaded = await bootPage("direct.html", "direct.js", "https://x.test/direct", storageOf(before));
    await tick(80);
    assert.equal(sheetUp(reloaded), false);
  });
});

describe("/get", () => {
  // It already did this. The address used to be kept by /get reading the
  // sheet's boxes from outside; the sheet keeps it now, and this is the check
  // that moving it lost nothing.
  test("still reopens the delivery step with the address after a reload", async () => {
    const before = await bootPage("get.html", "get.js", "https://x.test/get");
    orderLink(before, "pt-car-2").click();
    await tick(80);
    assert.ok(formUp(before));
    typeAddress(before);

    const reloaded = await bootPage("get.html", "get.js", "https://x.test/get", storageOf(before));
    await tick(120);
    assert.ok(formUp(reloaded));
    assert.match(summaryName(reloaded), /Pack of 2/);
    assert.deepEqual(typed(reloaded), ADDRESS);
  });
});

describe("the shop inside the owner dashboard", () => {
  // Three overlays there, one after another: the product sheet, the delivery
  // address step, then the pack step. A reload has to return to whichever was
  // open. welcome-shop.js is a classic script, so it is run as one.
  const shopSrc = read("scripts/owner/welcome-shop.js");

  async function bootDashboard(storage, { url = "https://x.test/owner#shop", address = null } = {}) {
    const w = makeWindow(read("pages/owner/welcome.html"), url, storage);
    w.scrollTo = () => {};
    w.ownerAddress = address;
    w.eval(sheetSrc);
    w.eval(shopSrc);
    await tick(80);
    return w;
  }

  const productUp = (w) => byId(w, "ptSheet").classList.contains("open");
  const packUp = (w) => byId(w, "ptPackSheet").classList.contains("open");
  const kept = (w) => JSON.parse(w.sessionStorage.getItem("pt_dash_checkout") || "null");

  test("a first visit opens nothing", async () => {
    const w = await bootDashboard();
    assert.equal(productUp(w) || packUp(w) || sheetUp(w), false);
  });

  test("reloading on a product brings that product back", async () => {
    const before = await bootDashboard();
    before.eval("openProduct(1)");
    assert.ok(productUp(before));
    const sku = kept(before).sku;

    const reloaded = await bootDashboard(storageOf(before));
    assert.ok(productUp(reloaded));
    assert.equal(kept(reloaded).sku, sku);
    assert.equal(sheetUp(reloaded), false, "only the product: BUY NOW had not been tapped");
  });

  test("reloading on the delivery step brings it back with what was typed", async () => {
    const before = await bootDashboard();
    before.eval("openProduct(0)");
    before.eval("handleBuyNow()");
    await tick(60);
    assert.ok(formUp(before), "no saved address, so the form");
    typeAddress(before);

    const reloaded = await bootDashboard(storageOf(before));
    await tick(60);
    assert.ok(formUp(reloaded));
    assert.deepEqual(typed(reloaded), ADDRESS);
    assert.equal(packUp(reloaded), false, "the address is not skipped on the way back");
  });

  test("reloading on the pack step brings it back with the same selection", async () => {
    const before = await bootDashboard(undefined, { address: ADDRESS });
    before.eval("openProduct(0)");
    before.eval("handleBuyNow()");
    await tick(60);
    assert.ok(confirmUp(before), "a saved address is only confirmed");
    byId(before, "pt-addr-deliver").click();
    await tick(60);
    assert.ok(packUp(before));
    before.eval("selectPackTier('pt-car-4')");
    before.eval("togglePackBike()");
    const chosen = before.eval("resolvePackSku()");

    const reloaded = await bootDashboard(storageOf(before), { address: ADDRESS });
    assert.ok(packUp(reloaded));
    assert.equal(productUp(reloaded), false);
    assert.equal(sheetUp(reloaded), false, "the address was already given; it is not asked for again");
    assert.equal(reloaded.eval("resolvePackSku()"), chosen);
  });

  test("backing out of the delivery step returns a reload to the product, not to the address", async () => {
    const before = await bootDashboard();
    before.eval("openProduct(0)");
    before.eval("handleBuyNow()");
    await tick(60);
    byId(before, "pt-addr-cancel").click();
    await tick(60);
    assert.equal(kept(before).step, "product");

    const reloaded = await bootDashboard(storageOf(before));
    await tick(60);
    assert.ok(productUp(reloaded));
    assert.equal(sheetUp(reloaded), false);
  });

  test("a sheet the buyer closed stays closed after a reload", async () => {
    const before = await bootDashboard(undefined, { address: ADDRESS });
    before.eval("openProduct(0)");
    before.eval("closeProduct()");
    assert.equal(kept(before), null);

    before.eval("openPackSheet('pt-car-2', 'Car')");
    assert.equal(kept(before).step, "pack");
    before.eval("closePackSheet()");
    assert.equal(kept(before), null, "dismissed, or the order placed: both end here");

    const reloaded = await bootDashboard(storageOf(before), { address: ADDRESS });
    assert.equal(productUp(reloaded) || packUp(reloaded) || sheetUp(reloaded), false);
  });

  test("a buy link still in the address bar does not start a second checkout over the restored one", async () => {
    const storage = { pt_dash_checkout: JSON.stringify({ sku: "pt-car-2", step: "pack", packVariant: "Car", tier: "pt-car-2", bike: false }) };
    const w = await bootDashboard(storage, { url: "https://x.test/owner?shop=1&sku=pt-car-1#shop", address: ADDRESS });
    assert.ok(packUp(w));

    // What welcome.js does with ?shop=1&sku= on every load.
    assert.equal(w.ptStartBuy("pt-car-1"), true);
    await tick(60);
    assert.ok(packUp(w), "the pack step is still the one on screen");
    assert.equal(productUp(w), false);
    assert.equal(sheetUp(w), false);
  });

  test("without anything saved, a buy link starts the checkout as it always did", async () => {
    const w = await bootDashboard(undefined, { url: "https://x.test/owner?shop=1&sku=pt-car-1#shop" });
    assert.equal(w.ptStartBuy("pt-car-1"), true);
    await tick(60);
    assert.ok(productUp(w));
    assert.ok(formUp(w));
    assert.equal(w.ptStartBuy("not-a-product"), false);
  });

  test("a saved value that is not one of this shop's is dropped, never opened", async () => {
    for (const junk of [
      { sku: "not-a-product", step: "product" },
      { sku: "pt-car-1", step: "somewhere-else" },
      { sku: "not-a-pack", step: "pack" },
      { sku: 7, step: "product" },
      "a string",
      [1, 2]
    ]) {
      const w = await bootDashboard({ pt_dash_checkout: JSON.stringify(junk) });
      assert.equal(productUp(w) || packUp(w) || sheetUp(w), false, JSON.stringify(junk));
    }
  });
});
