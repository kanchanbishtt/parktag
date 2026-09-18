import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dashboardTags } from "../../frontend/scripts/owner/dashboard-tags.js";

test("distinct stickers survive shared plates, tiers and missing plates", () => {
  const tags = [
    { id: "old", plateNumber: "UP16BM8251", premium: true },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `new-${i}`, plateNumber: "UP16BM8251", premium: true })),
    { id: "free", plateNumber: "UP16BM8251", premium: false },
    { id: "different", plateNumber: "DL01AB1234", premium: true },
    { id: "missing-plate", plateNumber: null }
  ];
  assert.deepEqual(dashboardTags(tags), tags);
  assert.deepEqual(dashboardTags([...tags, tags[0]]), tags);
});

test("legacy placeholders reconcile without hiding real stickers", () => {
  const tags = [{ id: "a", plateNumber: "UP16BM8251" }, { id: "b", plateNumber: "UP16BM8251" }];
  const unsynced = { number: "DL01AB1234" };
  assert.deepEqual(dashboardTags(tags, [
    { number: "up16bm8251" }, { _id: "a", number: "old spelling" }, unsynced
  ]), [unsynced, ...tags]);
  assert.deepEqual(dashboardTags([{ token: "a" }, { token: "b" }, { token: "a" }]), [{ token: "a" }, { token: "b" }]);
});

test("initial load and migration refresh both use sticker identity", async () => {
  const source = await readFile(new URL("../../frontend/scripts/owner/welcome.js", import.meta.url), "utf8");
  assert.match(source, /allTags\s*= dashboardTags\(apiTags, saved\)/);
  assert.match(source, /allTags\s*= dashboardTags\(data.tags \|\| \[\]\)/);
  assert.doesNotMatch(source, /seenPlates|dedupedApi/);
});
