import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ensureCommerceDefaults } from "../lib/core/commerce-defaults.js";

describe("commerce defaults", () => {
  test("creates the launch offer without overwriting an admin-owned row", async () => {
    const calls = [];
    const collections = {
      promoCodes: {
        async updateOne(filter, update, options) { calls.push({ filter, update, options }); }
      }
    };

    await ensureCommerceDefaults(collections);
    const call = calls[0];

    assert.deepEqual(call.filter, { code: "LAUNCH100" });
    assert.equal(call.options.upsert, true);
    assert.equal(call.update.$set, undefined, "a deploy would overwrite an admin revocation");
    assert.equal(call.update.$setOnInsert.discountPaise, 10000);
    assert.deepEqual(call.update.$setOnInsert.productIds, ["pt-car-2"]);
    assert.equal(call.update.$setOnInsert.active, true);
    assert.equal(call.update.$setOnInsert.autoApply, true, "a fresh LAUNCH100 is not a website offer");

    // A row from before the switch existed gets it once; a row where an admin
    // has set it either way is left alone.
    assert.deepEqual(calls[1].filter, { code: "LAUNCH100", autoApply: { $exists: false } });
    assert.deepEqual(calls[1].update, { $set: { autoApply: true } });
  });
});
