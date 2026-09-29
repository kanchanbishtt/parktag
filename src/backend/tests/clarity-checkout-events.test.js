import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const addressStep = await fs.readFile(
  path.join(currentDir, "../../frontend/scripts/owner/address-step.js"),
  "utf8"
);

test("guest checkout reports address entry and dismissal to Clarity", () => {
  assert.match(addressStep, /window\.clarity\("event", "address_started"\);/);
  assert.match(addressStep, /window\.clarity\("event", "checkout_dismissed"\);/);
  assert.match(addressStep, /guestMode && !saved/);
});
