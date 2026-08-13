// Regression guard for the 2026-08-13 QA hardening pass.
//
// Each assertion here FAILS on the code as it stood before that pass. Run with:
//   npm run verify:qa-hardening
//
// Deliberately needs no running server and no live database: it builds the app
// in-process and drives it through `inject`, so it is safe to run anywhere,
// including CI, without touching Atlas.

import { BoundedTtlMap } from "../lib/bounded-map.js";
import { normalizeIdentifier } from "../lib/auth/otp.js";
import { buildApp } from "../app.js";

let pass = 0;
const failures = [];
const ok = (name, cond, detail = "") => {
  if (cond) pass++;
  else failures.push(`${name}${detail ? " — " + detail : ""}`);
};

// ── 1. Caches must stay bounded ────────────────────────────────────────────
// Regression: app.oauthStates and app.sessions were plain Maps whose entries
// were only removed on a path the caller might never take, so they grew without
// limit until the container was OOM-killed.
{
  const m = new BoundedTtlMap({ ttlMs: 1000, cap: 3, name: "t" });
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3);
  m.set("d", 4);
  ok("cap is enforced", m.size <= 3, `size=${m.size}`);
  ok("least-recently-written evicted first", m.get("a") === undefined);
  ok("newest entry retained", m.get("d") === 4);

  const t0 = 1_000_000;
  const e = new BoundedTtlMap({ ttlMs: 500, cap: 10, name: "e" });
  e.set("k", "v", t0);
  ok("live entry is readable", e.get("k", t0 + 100) === "v");
  ok("expired entry is not served", e.get("k", t0 + 501) === undefined);
  ok("expired entry is dropped", e.size === 0, `size=${e.size}`);

  const leak = new BoundedTtlMap({ ttlMs: 600000, cap: 5000, name: "l" });
  for (let i = 0; i < 100000; i++) leak.set(`state${i}`, { ts: i, role: "owner" });
  ok("writes that are never deleted stay capped", leak.size <= 5000, `size=${leak.size}`);
  ok("overflow eviction is counted", leak.evictedOverflow > 0);
}

// ── 2. Identifier handling must not assume a string ────────────────────────
// Regression: `identifier.trim()` threw on any non-string body value, turning a
// malformed request into a 500 on the OTP login path.
{
  for (const [label, value] of [
    ["array", ["a@b.com"]],
    ["object", { $ne: null }],
    ["number", 9876543210],
    ["null", null],
    ["undefined", undefined],
    ["boolean", true]
  ]) {
    let threw = null;
    try {
      normalizeIdentifier(value);
    } catch (error) {
      threw = error;
    }
    ok(`normalizeIdentifier tolerates ${label}`, threw === null, threw && threw.message);
  }
  ok("email still normalises", normalizeIdentifier("  A@B.CoM ") === "a@b.com");
  ok("mobile still normalises", normalizeIdentifier("9876543210") === "+919876543210");
}

// ── 3. The app wires the bounded caches, and OTP routes answer 4xx ─────────
{
  const app = await buildApp();

  ok("oauthStates is bounded", typeof app.oauthStates.sweep === "function");
  ok("sessions is bounded", typeof app.sessions.sweep === "function");

  for (let i = 0; i < 20000; i++) app.oauthStates.set(`s${i}`, { ts: Date.now(), role: "owner" });
  ok("oauthStates cannot grow without bound", app.oauthStates.size <= 5000, `size=${app.oauthStates.size}`);
  app.oauthStates.clear();

  const malformed = [
    ["array identifier", { identifier: ["x@y.com"], code: ["123456"] }],
    ["operator identifier", { identifier: { $ne: null }, code: { $ne: null } }],
    ["numeric identifier", { identifier: 9876543210, code: 123456 }]
  ];
  for (const [label, payload] of malformed) {
    const res = await app.inject({ method: "POST", url: "/api/auth/verify-otp", payload });
    ok(`verify-otp answers 4xx for ${label}`, res.statusCode < 500, `got ${res.statusCode}`);
  }
  for (const [label, payload] of [
    ["array identifier", { identifier: ["x@y.com"] }],
    ["operator identifier", { identifier: { $ne: null } }]
  ]) {
    const res = await app.inject({ method: "POST", url: "/api/auth/send-otp", payload });
    ok(`send-otp answers 4xx for ${label}`, res.statusCode < 500, `got ${res.statusCode}`);
  }

  await app.close();
}

console.log(`verify:qa-hardening — PASS ${pass} / ${pass + failures.length}`);
if (failures.length) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log("  x " + f));
  process.exit(1);
}
process.exit(0);
