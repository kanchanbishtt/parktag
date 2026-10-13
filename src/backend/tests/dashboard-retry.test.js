// The dashboard's "Retry" button reloads the vehicles.
//
// When the dashboard request failed, the error card drew
// <button onclick="load()">. welcome.js is loaded as a module, so `load` is not
// a global: every tap threw "load is not defined" and nothing reloaded. A
// server error (5xx) did not reach that card at all; it drew only the "Add
// Vehicle" card, telling an owner with vehicles that they had none.
//
// The real load() runs here in jsdom with inline handlers enabled, wrapped in a
// function so that, as in the browser, none of its names are global.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { dashboardTags } from "../../frontend/scripts/owner/dashboard-tags.js";

const source = await readFile(new URL("../../frontend/scripts/owner/welcome.js", import.meta.url), "utf8");
const cardCode = source.slice(source.indexOf("const UI ="), source.indexOf("function renderNoticeboard("));
const loadCode = source.slice(source.indexOf("async function load()"), source.indexOf("// Show skeleton immediately"));

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const windows = [];
after(() => windows.forEach((w) => w.close()));

const TAG = { id: "tag-1", plateNumber: "DL01QA1234", premium: true, serial: "Batch-002-1", status: "active" };

// `responses` is the dashboard's answer to each request in turn: a status
// code, or "network" for a request that never reached the server.
async function openDashboard(responses) {
  const virtualConsole = new VirtualConsole();
  const pageErrors = [];
  virtualConsole.on("jsdomError", (error) => pageErrors.push(error.message));
  const dom = new JSDOM(`<!doctype html><body><div id="vehicleGrid"></div></body>`, {
    url: "https://x.test/owner-welcome", runScripts: "dangerously", virtualConsole
  });
  const w = dom.window;
  windows.push(w);
  w.dashboardTags = dashboardTags;
  w.requests = 0;
  w.fetch = async () => {
    const answer = responses[w.requests++] ?? 200;
    if (answer === "network") throw new TypeError("Failed to fetch");
    return {
      ok: answer >= 200 && answer < 300, status: answer,
      json: async () => ({ owner: { mobile: "+919812345678", greetingName: "Test" }, tags: [TAG], requests: [] })
    };
  };
  w.console.error = () => {};
  w.eval(`(() => {
    const grid = document.getElementById("vehicleGrid");
    const searchInp = { value: "" };
    const element = () => ({ textContent: "", classList: { add() {}, remove() {} } });
    const greetName = element(), greetId = element();
    let _nbFilter = null, allTags = [], allRequests = [];
    let _owner, _ownerMobile, _ownerBackup, _userId;
    let _callbackWindowMs, _callbackPassPaise, _callbackPassMaxAgeMs;
    const renderGreetingAffordance = () => {}, renderBackupRow = () => {};
    const mergePendingVehicles = () => {}, readSavedVehicles = () => [], syncLocalVehicles = () => {};
    const renderNoticeboard = () => {}, renderActivity = () => {}, renderReferral = () => {}, renderProfileView = () => {};
    ${cardCode}
    ${loadCode}
    window.startDashboard = () => load();
  })()`);
  await w.startDashboard();
  return { w, grid: w.document.getElementById("vehicleGrid"), pageErrors };
}

const retryButton = (grid) => [...grid.querySelectorAll("button")].find((b) => b.textContent.trim() === "Retry");
const tapRetry = async (grid) => {
  retryButton(grid).dispatchEvent(new grid.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));
  await tick();
};

test("a dropped connection shows Retry, and Retry loads the vehicles", async () => {
  const { w, grid, pageErrors } = await openDashboard(["network", 200]);
  assert.ok(grid.querySelector('[role="alert"]'), "no error shown for a failed load");
  assert.ok(retryButton(grid), "no Retry button");

  await tapRetry(grid);
  assert.deepEqual(pageErrors, [], "tapping Retry threw");
  assert.equal(w.requests, 2, "Retry did not ask the server again");
  assert.equal(grid.querySelector('[role="alert"]'), null);
  assert.ok(grid.innerHTML.includes(TAG.plateNumber), "the vehicle did not appear after Retry");
});

test("a server error is a failed load, not an empty account", async () => {
  const { w, grid, pageErrors } = await openDashboard([500, 503, 200]);
  assert.match(grid.textContent, /Couldn't load your vehicles\./, "a 500 was drawn as an account with no vehicles");
  assert.ok(retryButton(grid));

  await tapRetry(grid);
  assert.equal(w.requests, 2);
  assert.ok(retryButton(grid), "a second failure left no way to try again");

  await tapRetry(grid);
  assert.deepEqual(pageErrors, []);
  assert.equal(w.requests, 3);
  assert.ok(grid.innerHTML.includes(TAG.plateNumber));
  assert.equal(retryButton(grid), undefined);
});
