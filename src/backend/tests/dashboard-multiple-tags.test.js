import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dashboardTags } from "../../frontend/scripts/owner/dashboard-tags.js";

for (const count of [2, 11]) {
  for (const pending of [false, true]) {
    test(`dashboard load keeps ${count} premium cards visible (pending vehicle: ${pending})`, async () => {
      const source = await readFile(new URL("../../frontend/scripts/owner/welcome.js", import.meta.url), "utf8");
      const tags = Array.from({ length: count }, (_, i) => ({
        id: `tag-${i}`, plateNumber: `DL01AB${1000 + i}`, premium: true,
        serial: `Batch-002-${i}`, status: "active"
      }));
      const placeholder = { number: "DL02CD1234" };
      const errors = [];
      const synced = [];
      const element = () => ({ textContent: "", innerHTML: "", classList: { add() {}, remove() {} } });
      const grid = element();
      const countEl = element();
      const context = vm.createContext({
        URLSearchParams, dashboardTags, grid, searchInp: { value: "" },
        _nbFilter: null, allTags: [], allRequests: [],
        greetName: element(), greetId: element(),
        fetch: async () => ({ ok: true, status: 200, json: async () => ({
          owner: { mobile: "+919812345678", greetingName: "Test" }, tags, requests: []
        }) }),
        localStorage: { getItem: () => null }, sessionStorage: { setItem() {} },
        document: { getElementById: id => id === "tagsCount" ? countEl : null },
        window: { location: {} }, console: { error: (...args) => errors.push(args) },
        renderGreetingAffordance() {}, mergePendingVehicles() {},
        readSavedVehicles: () => pending ? [{ number: tags[0].plateNumber }, placeholder] : [],
        renderNoticeboard() {}, renderActivity() {}, renderReferral() {}, renderProfileView() {},
        // The backup-number row in the menu, refreshed when the owner loads.
        renderBackupRow() {},
        syncLocalVehicles: (vehicles, userId) => synced.push({ vehicles, userId })
      });
      // Execute the real card renderer and entire load try/catch, including migration.
      vm.runInContext(source.slice(source.indexOf("const UI ="), source.indexOf("function renderNoticeboard(")), context);
      vm.runInContext(source.slice(source.indexOf("async function load()"), source.indexOf("// Show skeleton immediately")), context);
      await vm.runInContext("load()", context);
      assert.deepEqual(errors, [], "a successful response must not fall into the load-error handler");
      assert.equal((grid.innerHTML.match(/Download Premium Tag/g) || []).length, count);
      for (const tag of tags) assert.ok(grid.innerHTML.includes(tag.plateNumber));
      assert.doesNotMatch(grid.innerHTML, /Couldn't load/);
      assert.equal(countEl.textContent, `(${count + Number(pending)})`);
      assert.equal(synced.length, Number(pending));
      if (pending) {
        assert.equal(synced[0].vehicles.length, 1);
        assert.equal(synced[0].vehicles[0], placeholder);
        assert.equal(synced[0].userId, "+919812345678");
      }
    });
  }
}

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
