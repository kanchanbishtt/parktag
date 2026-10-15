// Mixpanel's contact_action and tag_activated fire on what happened.
//
// contact_action means "a scanner reached the owner" (AGENTS.md), but for a
// call it was sent when the page registered the call, which only hands the
// scanner a number to dial: anyone who then never dialled was counted. It is
// now sent by Exotel's dial-whom webhook when the call is actually placed, once
// per registration. And /claim (since removed, audit item 18) reported
// tag_activated for the team's own test numbers, which /activate skips.
//
// A test run never sends to Mixpanel (lib/core/external-guard.js), so the
// decision is checked as a function and the routes are checked for where they
// call it, the way analytics-asset.test.js reads its source.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { callContactEvent } from "../lib/core/contact-actions.js";

const OWNER = "65f0c0ffee0000000000abcd";
const route = (fields) => ({ ownerId: OWNER, type: "scanner_to_owner", dialRequests: 1, ...fields });

describe("which placed calls count as a contact", () => {
  test("a scanner's call to the owner, and an SOS call, on the first ask", () => {
    assert.deepEqual(callContactEvent(route()), {
      eventName: "contact_action", distinctId: OWNER, properties: { method: "call" }
    });
    assert.deepEqual(callContactEvent(route({ type: "scanner_to_emergency" })).properties, { method: "emergency_call" });
  });

  test("a later ask on the same route (redial, or the backup leg) is the same contact", () => {
    assert.equal(callContactEvent(route({ dialRequests: 2 })), null);
    assert.equal(callContactEvent(route({ dialRequests: 3 })), null);
  });

  test("the owner's callback, a route with no owner, and junk are not contacts", () => {
    assert.equal(callContactEvent(route({ type: "owner_to_scanner" })), null);
    assert.equal(callContactEvent(route({ ownerId: null })), null);
    for (const type of [undefined, "constructor", "__proto__", "toString"]) assert.equal(callContactEvent(route({ type })), null, String(type));
    assert.equal(callContactEvent(null), null);
  });
});

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// One handler's source, from its registration to the next route registration.
function handler(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start !== -1, `${signature} not found`);
  const next = source.slice(start + signature.length).search(/\n {2}app\.(get|post|patch|put|delete|route)\(/);
  return source.slice(start, next === -1 ? undefined : start + signature.length + next);
}

describe("where the routes report", () => {
  const publicRoutes = read("routes/public/index.js");
  const exotel = read("routes/webhooks/exotel.js");

  test("registering a call or an SOS call reports no contact", () => {
    assert.doesNotMatch(handler(publicRoutes, 'app.post("/api/tags/:token/register-call"'), /sendMixpanelEventBestEffort\(|eventName: "contact_action"/);
    assert.doesNotMatch(handler(publicRoutes, 'app.post("/api/tags/:token/register-emergency-call"'), /sendMixpanelEventBestEffort\(|eventName: "contact_action"/);
  });

  test("dial-whom reports the contact once a route has matched", () => {
    const dialWhom = handler(exotel, 'app.get("/api/exotel/dial-whom"');
    const matched = dialWhom.indexOf("if (!record)");
    const reported = dialWhom.indexOf("callContactEvent(record)");
    assert.ok(matched !== -1 && reported > matched, "contact_action must be decided after a route matched, from that route");
    assert.match(dialWhom, /if \(contactEvent\) sendMixpanelEventBestEffort\(request\.log, env, contactEvent\)/);
  });

  test("/activate skips tag_activated for the team's own tags and numbers", () => {
    const activate = handler(publicRoutes, 'app.post("/api/tags/:token/activate"');
    assert.match(activate, /if \(!isInternalTag\(tag\) && !isInternalPhone\(env, mobile\)\) sendMixpanelEventBestEffort\(app\.log, env, \{\s*eventName: "tag_activated"/);
  });
});
