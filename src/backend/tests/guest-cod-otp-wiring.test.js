// Guest Cash on Delivery needs the delivery mobile proven by a code, and the
// proof has to survive the trip from the address sheet to create-order. The
// sheet resolves { ...address, paymentMethod: "cod", codToken }; a storefront
// that spreads the rest into `address` and never sends codToken would turn every
// COD order into a 401. Read as text, so it needs no browser and no database.
// The server side is pinned in guest-cod.test.js.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, "..", "..", "frontend", "scripts");
const read = (file) => readFile(path.join(SCRIPTS, file), "utf8");

describe("guest COD phone check wiring", () => {
  test("the sheet verifies before it resolves COD, and only with a token", async () => {
    const sheet = await read("owner/address-step.js");
    assert.match(sheet, /\/api\/shop\/guest\/cod-otp\/send/);
    assert.match(sheet, /\/api\/shop\/guest\/cod-otp\/verify/);
    assert.match(sheet, /paymentMethod: "cod", codToken: data\.codToken/);
    // The only other guest resolve is the online one. The phone check gates
    // resolving COD; the address plausibility check runs beside the send and
    // only ever adds a note (see cod-address-tap.test.js).
    assert.match(sheet, /if \(payPrices && payChoice === "cod"\) \{\s*startCodCheck\(v\);\s*return;\s*\}/);
  });

  for (const file of ["shop.js", "get.js", "direct.js"]) {
    test(`${file} forwards codToken to create-order`, async () => {
      const src = await read(file);
      // Other checkout-only fields may sit between codToken and the rest; what
      // matters is that codToken is pulled OUT of the address, never posted inside it.
      assert.match(src, /const \{ paymentMethod = "online", codToken,[^}]*\.\.\.address \} = picked;/);
      // codToken stays the last field of the body; other checkout flags may
      // sit between it and paymentMethod.
      assert.match(src, /paymentMethod,[\s\S]{0,240}?codToken\s*\}\)/);
    });
  }
});
