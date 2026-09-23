import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orderMayReceiveMarketing } from "../lib/core/messaging-consent.js";

const SHOP = readFileSync(new URL("../routes/shop/index.js", import.meta.url), "utf8");
const SHEET = readFileSync(new URL("../../frontend/scripts/owner/address-step.js", import.meta.url), "utf8");
const GET = readFileSync(new URL("../../frontend/scripts/get.js", import.meta.url), "utf8");

test("the box is never ticked for the buyer", () => {
  const box = SHEET.match(/<input type="checkbox" id="pt-addr-optin"[^>]*>/);
  assert.ok(box, "the opt-in checkbox is in the sheet");
  assert.ok(!/checked/.test(box[0]), "a pre-ticked box is not consent");
});

test("the client sends a flag and the server records a time", () => {
  assert.match(GET, /marketingOptIn/, "the flag travels with the order");
  assert.match(SHOP, /marketingOptInAt = rawMarketingOptIn === true \? new Date\(\)\.toISOString\(\) : null/);
  assert.ok(!/marketingOptInAt: rawMarketingOptIn/.test(SHOP), "a client boolean is never stored as the stamp");
  assert.equal((SHOP.match(/^\s*marketingOptInAt,$/gm) || []).length, 2, "both guest orders (COD and online) carry it");
});

test("only a stamped order may be sent the marketing reminder", () => {
  assert.equal(orderMayReceiveMarketing({ marketingOptInAt: new Date().toISOString() }, null), true);
  assert.equal(orderMayReceiveMarketing({ marketingOptInAt: null }, null), false);
  assert.equal(orderMayReceiveMarketing({}, null), false);
  assert.equal(
    orderMayReceiveMarketing({ marketingOptInAt: new Date().toISOString() }, { marketingOptOut: true }),
    false,
    "a later opt-out beats an earlier tick"
  );
});
