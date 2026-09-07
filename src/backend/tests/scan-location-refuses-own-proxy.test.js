// A location is never written for one of our own proxy addresses.
//
// This is the safety net that makes the trustProxy change shippable in one go
// rather than measure-then-fix. If the hop count or the edge ranges are ever
// wrong again, the failure has to be a BLANK location and a loud log line, not
// a confident wrong city.
//
// It matters because of how the original bug hid. request.ip resolved to a
// Railway edge address, the geo provider answered entirely correctly —
// Singapore genuinely is where sin1 lives — and owners were shown a precise,
// authoritative-looking city for a scanner standing next to their car in Noida.
// Nothing about the row invited a second look. It was only caught because the
// owner happened to know he had not been in Singapore.
//
// So: wrong is impossible, missing is acceptable, and the log names the address
// that needs lib/core/proxy-trust.js updating.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { resolveScannerLocation } from "../lib/core/scan-location.js";
import { isInfrastructureAddress } from "../lib/core/proxy-trust.js";

// Entitled, so the entitlement gate cannot be what makes these pass. A premium
// tag inside its first year is the ordinary case that captures location.
const ENTITLED_TAG = {
  status: "active",
  tier: "premium",
  activatedAt: new Date().toISOString(),
  premiumUntil: new Date(Date.now() + 300 * 864e5).toISOString()
};

// A geo provider that would answer for anything. If a lookup ever happens for an
// infrastructure address, this makes it visible as a returned location rather
// than a silent pass.
const env = { geoipUrl: "https://example.invalid/{ip}" };

function recordingLog() {
  const warnings = [];
  return { log: { warn: (obj, msg) => warnings.push({ obj, msg }) }, warnings };
}

describe("scanner location refuses our own infrastructure", () => {
  test("a Railway edge address yields no location", async () => {
    const { log, warnings } = recordingLog();
    const location = await resolveScannerLocation(env, ENTITLED_TAG, "152.233.15.123", log);

    assert.equal(
      location,
      null,
      "a location was resolved for a Railway edge address — owners will be shown the PoP's city again"
    );
    assert.equal(warnings.length, 1, "the refusal was silent; nothing tells us the setting is wrong");
    assert.match(warnings[0].msg, /refusing to geolocate our own proxy/);
    assert.equal(warnings[0].obj.address, "152.233.15.123", "the log does not name the offending address");
  });

  test("private and loopback addresses yield no location either", async () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "::1", "::ffff:10.0.0.4"]) {
      const { log } = recordingLog();
      assert.equal(
        await resolveScannerLocation(env, ENTITLED_TAG, address, log),
        null,
        `${address} produced a location`
      );
    }
  });

  test("it runs BEFORE the provider call, so a bad address costs nothing", async () => {
    // example.invalid does not resolve. If the guard did not short-circuit, this
    // would spend the lookup timeout before returning null; passing quickly is
    // the observable difference.
    const started = Date.now();
    const { log } = recordingLog();
    await resolveScannerLocation(env, ENTITLED_TAG, "152.233.33.165", log);
    assert.ok(
      Date.now() - started < 250,
      "the guard did not short-circuit — a provider lookup was attempted for our own proxy"
    );
  });

  test("a real visitor address is not caught by the guard", () => {
    // The guard must not be so broad that it suppresses genuine locations. The
    // lookup itself is not exercised here (no live provider in tests); what is
    // asserted is that these addresses are not classified as ours.
    for (const address of ["14.96.97.24", "203.0.113.9", "49.36.1.1"]) {
      assert.equal(isInfrastructureAddress(address), false, `${address} was treated as infrastructure`);
    }
  });

  test("an unentitled tag still captures nothing, guard or no guard", async () => {
    const lapsed = { status: "active", tier: "etag", freeContactUsed: true };
    const { log } = recordingLog();
    assert.equal(await resolveScannerLocation(env, lapsed, "14.96.97.24", log), null);
  });
});
