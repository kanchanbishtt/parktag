import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ensureCommerceDefaults } from "../lib/core/commerce-defaults.js";

describe("commerce defaults", () => {
  test("creates the launch offer without overwriting an admin-owned row", async () => {
    let call = null;
    const collections = {
      promoCodes: {
        async updateOne(filter, update, options) { call = { filter, update, options }; }
      }
    };

    await ensureCommerceDefaults(collections);

    assert.deepEqual(call.filter, { code: "LAUNCH100" });
    assert.equal(call.options.upsert, true);
    assert.equal(call.update.$set, undefined, "a deploy would overwrite an admin revocation");
    assert.equal(call.update.$setOnInsert.discountPaise, 10000);
    assert.deepEqual(call.update.$setOnInsert.productIds, ["pt-car-2"]);
    assert.equal(call.update.$setOnInsert.active, true);
  });
});
