import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { attributionFromQuery, readAttribution, rememberAttribution, ATTRIBUTION_COOKIE } from "../lib/core/attribution.js";

test("utm on the landing URL becomes a cookie the order can read", async () => {
  const app = Fastify();
  await app.register(fastifyCookie);
  app.addHook("onRequest", async (request, reply) => { rememberAttribution(request, reply); });
  app.get("/get", async () => "page");
  app.get("/api/x", async () => "api");

  const landed = await app.inject({ url: "/get?utm_source=whatsapp&utm_medium=group&utm_campaign=GEMS_business" });
  const cookie = landed.cookies.find((c) => c.name === ATTRIBUTION_COOKIE);
  assert.ok(cookie, "cookie set on a tagged page view");
  assert.equal(cookie.httpOnly, true);

  const back = readAttribution({ cookies: { [ATTRIBUTION_COOKIE]: cookie.value } });
  assert.equal(back.source, "whatsapp");
  assert.equal(back.campaign, "gems_business");
  assert.ok(back.landedAt);

  const untagged = await app.inject({ url: "/get" });
  assert.equal(untagged.cookies.length, 0, "no utm, no cookie");
  const api = await app.inject({ url: "/api/x?utm_source=x" });
  assert.equal(api.cookies.length, 0, "API calls never set it");
});

test("junk and tampered values are dropped, not stored", () => {
  assert.equal(attributionFromQuery({ utm_medium: "group" }), null);
  assert.equal(attributionFromQuery({ utm_source: "<script>" }), null);
  assert.equal(readAttribution({ cookies: { [ATTRIBUTION_COOKIE]: "{not json" } }), null);
  const r = readAttribution({ cookies: { [ATTRIBUTION_COOKIE]: JSON.stringify({ source: "google", campaign: "a\"b", landedAt: "nope" }) } });
  assert.deepEqual(r, { source: "google" });
});
