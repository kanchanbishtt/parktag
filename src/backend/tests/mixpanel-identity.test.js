import assert from "node:assert/strict";
import test from "node:test";

import {
  anonymousDistinctId,
  attributionProps,
  isMixpanelConfigured,
  orderDistinctId,
  sendMixpanelEvent,
  utmProps
} from "../lib/integrations/mixpanel.js";

const env = { analyticsHashSalt: "salt" };
const req = (ip, ua = "ua", extra = {}) => ({ ip, headers: { "user-agent": ua }, ...extra });

test("anonymous id is stable per visitor, differs between visitors, and carries no address", () => {
  const a = anonymousDistinctId(env, req("203.0.113.9"));
  assert.equal(a, anonymousDistinctId(env, req("203.0.113.9")));
  assert.notEqual(a, anonymousDistinctId(env, req("203.0.113.10")));
  assert.match(a, /^anon:[0-9a-f]{32}$/);
  assert.ok(!a.includes("203"));
});

test("a guest order is its own identity, a signed-in one is the owner", () => {
  assert.equal(orderDistinctId({ ownerId: null, orderNumber: "PT-7" }), "guest-order:PT-7");
  assert.equal(orderDistinctId({ ownerId: "abc", orderNumber: "PT-7" }), "abc");
});

test("utm props: this URL wins over the cookie, junk is dropped, nothing yields {}", () => {
  assert.deepEqual(
    attributionProps({ query: { utm_source: "meta", utm_campaign: "Summer" }, cookies: {} }),
    { utm_source: "meta", utm_campaign: "summer" }
  );
  const cookie = JSON.stringify({ source: "whatsapp", medium: "group" });
  assert.deepEqual(attributionProps({ query: {}, cookies: { pt_attr: cookie } }), {
    utm_source: "whatsapp",
    utm_medium: "group"
  });
  assert.deepEqual(attributionProps({ query: { utm_source: "<script>" }, cookies: {} }), {});
  assert.deepEqual(utmProps(null), {});
});

test("a test run never sends, even with a real token in the environment", async () => {
  const live = { mixpanelToken: "x".repeat(32), mongoCollectionPrefix: "" };
  assert.equal(isMixpanelConfigured(live), true);
  for (const prefix of ["test_", "ci_"]) {
    const env = { ...live, mongoCollectionPrefix: prefix };
    assert.equal(isMixpanelConfigured(env), false);
    assert.deepEqual(await sendMixpanelEvent(env, { eventName: "e", distinctId: "d" }), {
      ok: false,
      skipped: "not-configured"
    });
  }
});
