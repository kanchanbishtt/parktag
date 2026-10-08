// The checkout sheet's order and its price breakdown (Stitch "Complete your
// order", Oct 2026): mobile number, then payment, then address, then what the
// total is made of, then one button that carries the amount.
//
// The real sheet in jsdom, no database. What is pinned is the structure the
// rest of the page and its tests rely on staying put: every id the other
// checkout tests reach for still exists, the lines add up to the total on the
// button, and a sheet opened with no order (an owner saving an address) shows
// none of the order furniture.
import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const sheetSrc = fs.readFileSync(new URL("../../frontend/scripts/owner/address-step.js", import.meta.url), "utf8");

const SUMMARY = { name: "ParkTag Car Tag (Pack of 2)", amountPaise: 39900, mrpPaise: 49900, cod: { amountPaise: 44800, feePaise: 4900 } };

const open = [];
after(() => open.forEach((w) => w.close()));

function sheetWindow() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://x.test/get", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  open.push(w);
  w.Element.prototype.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.fetch = async () => ({ ok: false, status: 400, json: async () => ({ ok: false }) });
  w.eval(sheetSrc);
  return w;
}

const byId = (w, id) => w.document.getElementById(id);
const rows = (w) => [...w.document.querySelectorAll("#pt-addr-breakdown .pt-addr-bk-row")].map((r) => [r.querySelector("dt").textContent, r.querySelector("dd").textContent]);
const hidden = (w, id) => byId(w, id).classList.contains("pt-hide");
function chooseCod(w) {
  const cod = w.document.querySelector("input[name='pt-addr-pay'][value='cod']");
  cod.checked = true;
  cod.dispatchEvent(new w.Event("change", { bubbles: true }));
}
// a precedes b in the document
const before = (a, b) => Boolean(a.compareDocumentPosition(b) & a.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);

describe("the checkout sheet with an order", () => {
  test("asks for the mobile first, then payment, then the address", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    assert.ok(before(byId(w, "pt-addr-phone"), byId(w, "pt-addr-paychoice")), "mobile before payment");
    assert.ok(before(byId(w, "pt-addr-paychoice"), byId(w, "pt-addr-fullName")), "payment before the address");
    assert.ok(before(byId(w, "pt-addr-state"), byId(w, "pt-addr-breakdown")), "the breakdown follows the address");
    assert.ok(before(byId(w, "pt-addr-breakdown"), byId(w, "pt-addr-save")), "and the button comes last");
    assert.equal(byId(w, "pt-addr-title").textContent, "Complete your order");
    assert.equal(w.document.querySelector("#pt-addr-eyebrow span").textContent, "Secure checkout");
  });

  test("online: list price, discount, free delivery and a total that is the button's amount", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    assert.deepEqual(rows(w), [
      [SUMMARY.name, "₹499"],
      ["Discount", "−₹100"],
      ["Delivery", "FREE"],
      ["Total to pay", "₹399"]
    ]);
    assert.match(byId(w, "pt-addr-save").textContent, /^Continue to pay · ₹399$/);
  });

  test("cash on delivery: the fee is a line, and the lines add up to the button's amount", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    chooseCod(w);
    assert.deepEqual(rows(w), [
      [SUMMARY.name, "₹499"],
      ["Discount", "−₹100"],
      ["Delivery", "FREE"],
      ["Cash on delivery fee", "+₹49"],
      ["To pay on delivery", "₹448"]
    ]);
    assert.match(byId(w, "pt-addr-save").textContent, /^Place order, pay on delivery · ₹448$/);
  });

  test("a pack with no list price above its price shows no discount line", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: { name: "ParkTag Car Tag (Pack of 1)", amountPaise: 29900 } });
    assert.deepEqual(rows(w), [["ParkTag Car Tag (Pack of 1)", "₹299"], ["Delivery", "FREE"], ["Total to pay", "₹299"]]);
  });

  test("the terms row promises delivery and replacement, not the Premium year", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    const terms = w.document.querySelector(".pt-addr-summary-terms").textContent;
    assert.match(terms, /Free delivery/);
    assert.match(terms, /7-day replacement/);
    assert.doesNotMatch(terms, /Premium/);
  });
});

describe("the order card", () => {
  test("shows the pack's picture when it is one of our own images, and never anything else", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: { ...SUMMARY, image: "/images/order-duo-thumb.webp" } });
    const img = byId(w, "pt-addr-summary-img"); // the sheet is built on first open
    assert.equal(img.getAttribute("src"), "/images/order-duo-thumb.webp");
    assert.ok(!img.classList.contains("pt-hide"));

    for (const bad of ["https://evil.test/x.png", "//evil.test/x.png", "/images/../secret", "javascript:alert(1)", undefined]) {
      w.ptCollectAddress({ guest: true, orderSummary: { ...SUMMARY, image: bad } });
      assert.ok(img.classList.contains("pt-hide"), `${bad} is not drawn`);
    }
  });

  test("an applied code is drawn as a coupon: the code, a note, and the saving", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: { ...SUMMARY, offerLabel: "LAUNCH auto-applied" } });
    const coupon = w.document.querySelector(".pt-addr-summary-offer");
    assert.equal(coupon.querySelector(".pt-offer-code").textContent, "LAUNCH");
    assert.equal(coupon.querySelector(".pt-offer-note").textContent, "Applied automatically");
    assert.equal(coupon.querySelector(".pt-offer-save").textContent, "You save ₹100");
  });

  test("a label that is not 'CODE applied' is shown whole, and the saving appears once", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: { ...SUMMARY, offerLabel: "SAVE10 applied", referralLabel: "Friend's link: ₹50 off" } });
    const coupons = [...w.document.querySelectorAll(".pt-addr-summary-offer")];
    assert.equal(coupons.length, 2);
    assert.equal(coupons[0].querySelector(".pt-offer-code").textContent, "SAVE10");
    assert.equal(coupons[1].querySelector(".pt-offer-code").textContent, "Friend's link: ₹50 off");
    assert.equal(w.document.querySelectorAll(".pt-offer-save").length, 1);
  });
});

const ADDRESS = { fullName: "Asha Verma", phone: "9812345678", pincode: "110052", line1: "12B, MG Road", line2: "", city: "New Delhi", state: "Delhi" };
const PLATE = { id: "dashboard-plate", name: "Clear Dashboard Plate", description: "Stand it on your dashboard.", amountPaise: 4900, image: "/images/acrylic-dashboard-plate-real.jpg" };
function fill(w) {
  Object.entries(ADDRESS).forEach(([key, value]) => {
    const input = byId(w, `pt-addr-${key}`);
    input.value = value;
    input.dispatchEvent(new w.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
function tick(w, on) {
  const box = byId(w, "pt-addr-addon-check");
  box.checked = on;
  box.dispatchEvent(new w.Event("change", { bubbles: true }));
}

describe("an extra offered inside the sheet (the dashboard plate)", () => {
  test("is a card you tick: the total, the breakdown and the button follow it, and the caller is told", () => {
    const w = sheetWindow();
    const told = [];
    w.ptCollectAddress({ guest: true, orderSummary: { ...SUMMARY, addOn: { ...PLATE, checked: false, onChange: (on) => told.push(on) } } });
    assert.ok(!hidden(w, "pt-addr-addon"), "the card is shown");
    assert.equal(byId(w, "pt-addr-addon-t").textContent, "Clear Dashboard Plate (+₹49)");
    assert.match(byId(w, "pt-addr-save").textContent, /₹399$/);

    tick(w, true);
    assert.deepEqual(told, [true]);
    assert.deepEqual(rows(w), [
      [SUMMARY.name, "₹499"],
      ["Clear Dashboard Plate", "+₹49"],
      ["Discount", "−₹100"],
      ["Delivery", "FREE"],
      ["Total to pay", "₹448"]
    ]);
    assert.match(byId(w, "pt-addr-save").textContent, /₹448$/);

    tick(w, false);
    assert.deepEqual(told, [true, false]);
    assert.match(byId(w, "pt-addr-save").textContent, /₹399$/);
  });

  test("keeps the payment method, and cash on delivery carries the extra too", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true, orderSummary: { ...SUMMARY, addOn: { ...PLATE, checked: true } } });
    chooseCod(w);
    tick(w, false);
    assert.equal(w.document.querySelector("input[name='pt-addr-pay']:checked").value, "cod", "still cash on delivery");
    assert.match(byId(w, "pt-addr-save").textContent, /pay on delivery · ₹448$/);
    tick(w, true);
    assert.match(byId(w, "pt-addr-save").textContent, /pay on delivery · ₹497$/);
  });

  test("the answer comes back with the address", async () => {
    const w = sheetWindow();
    const done = w.ptCollectAddress({ guest: true, orderSummary: { ...SUMMARY, addOn: { ...PLATE, checked: false } } });
    fill(w);
    tick(w, true);
    byId(w, "pt-addr-save").click();
    const picked = await done;
    assert.equal(picked.addOn, true);
    assert.equal(picked.paymentMethod, "online");
    assert.equal(picked.phone, "9812345678");
  });

  test("when nothing is offered there is no card and no addOn in the answer", async () => {
    const w = sheetWindow();
    const done = w.ptCollectAddress({ guest: true, orderSummary: SUMMARY });
    assert.ok(hidden(w, "pt-addr-addon"));
    fill(w);
    byId(w, "pt-addr-save").click();
    assert.equal("addOn" in (await done), false);
  });
});

describe("the checkout sheet with no order (an owner saving an address)", () => {
  test("shows none of the order furniture", () => {
    const w = sheetWindow();
    w.ptCollectAddress();
    assert.ok(hidden(w, "pt-addr-summary"));
    assert.ok(hidden(w, "pt-addr-checkout"), "no breakdown, no WhatsApp tick");
    assert.ok(hidden(w, "pt-addr-paychoice"));
    assert.equal(rows(w).length, 0);
    assert.equal(byId(w, "pt-addr-title").textContent, "Delivery address");
    assert.equal(w.document.querySelector("#pt-addr-eyebrow span").textContent, "Delivery");
    assert.match(byId(w, "pt-addr-save").textContent, /Save & continue to pay/);
  });
});
