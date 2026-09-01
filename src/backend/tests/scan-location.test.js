// Where a scanner contacted from, and who is allowed to be told.
//
// Unit tests over the resolver alone. The gate it applies is the same
// `callEntitlement().masking` the contact routes use, so these pin that the
// capture decision cannot drift away from the contact decision — and, more
// importantly, that nothing is looked up or returned for a tag which is not
// entitled. The emergency route is the reason that matters: it writes a contact
// row without a masking check, so it is the one caller that can reach this
// function with a lapsed tag.

import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  resolveScannerLocation,
  captureScannerLocation,
  settleScannerLocations,
  formatScannerLocation
} from "../lib/core/scan-location.js";
import { resetGeoipCache } from "../lib/integrations/geoip.js";
// The lapsed fixture below is dated from this rather than from a literal, so
// widening the complimentary window cannot quietly turn "lapsed" into "still
// on trial" and leave these tests asserting the opposite of their names.
import { PREMIUM_TRIAL_DAYS } from "../lib/core/vault.js";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const ETAG_FRESH = { premium: false };
const ETAG_SPENT = { premium: false, freeContactUsed: true };
const PREMIUM_TRIAL = { premium: true, premiumSince: daysAgo(1) };
const PREMIUM_LAPSED = { premium: true, premiumSince: daysAgo(PREMIUM_TRIAL_DAYS + 15) };
const PREMIUM_SUBBED = {
  premium: true,
  premiumSince: daysAgo(200),
  callSubscription: { status: "active", currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString() }
};

// A public address, so the private-IP short circuit does not fire and we are
// genuinely exercising the provider path.
const PUBLIC_IP = "49.36.183.22";

// Stands in for the geo provider. Records whether it was called at all, which
// is the assertion that matters for the unentitled tiers: "returned null" is
// not the same promise as "did not look".
function stubProvider(payload) {
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => payload
    };
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

const OK_PAYLOAD = {
  success: true,
  country: "India",
  country_code: "IN",
  region: "Maharashtra",
  city: "Andheri East"
};

describe("who gets a location captured", () => {
  beforeEach(() => {
    // The resolver caches by IP for 12 hours. Without this, the first test to
    // run would answer for every later one.
    resetGeoipCache();
  });

  test("an E-Tag with its free contact unspent is captured", async () => {
    const provider = stubProvider(OK_PAYLOAD);
    try {
      const loc = await resolveScannerLocation({}, ETAG_FRESH, PUBLIC_IP);
      assert.equal(loc.city, "Andheri East");
      assert.equal(loc.country, "India");
      assert.equal(provider.calls.length, 1);
    } finally {
      provider.restore();
    }
  });

  test("a spent E-Tag is not looked up at all", async () => {
    const provider = stubProvider(OK_PAYLOAD);
    try {
      assert.equal(await resolveScannerLocation({}, ETAG_SPENT, PUBLIC_IP), null);
      // Not merely null — no request was made. Gating capture means collecting
      // nothing, not collecting and discarding.
      assert.equal(provider.calls.length, 0);
    } finally {
      provider.restore();
    }
  });

  test("a premium tag inside its 90 days is captured", async () => {
    const provider = stubProvider(OK_PAYLOAD);
    try {
      const loc = await resolveScannerLocation({}, PREMIUM_TRIAL, PUBLIC_IP);
      assert.equal(loc.region, "Maharashtra");
      assert.equal(provider.calls.length, 1);
    } finally {
      provider.restore();
    }
  });

  test("a lapsed premium tag is not looked up at all", async () => {
    // The emergency route reaches here with exactly this tag: the SOS still
    // connects, it simply carries no location.
    const provider = stubProvider(OK_PAYLOAD);
    try {
      assert.equal(await resolveScannerLocation({}, PREMIUM_LAPSED, PUBLIC_IP), null);
      assert.equal(provider.calls.length, 0);
    } finally {
      provider.restore();
    }
  });

  test("a premium tag on a live subscription is captured", async () => {
    const provider = stubProvider(OK_PAYLOAD);
    try {
      const loc = await resolveScannerLocation({}, PREMIUM_SUBBED, PUBLIC_IP);
      assert.equal(loc.countryCode, "IN");
      assert.equal(provider.calls.length, 1);
    } finally {
      provider.restore();
    }
  });

  test("the capture gate is the contact gate, on every tier", async () => {
    // If these two ever disagree, a contact happens with no location or a
    // location is taken for a contact that was refused. Asserted across the
    // whole ladder rather than trusting the two call sites to stay in step.
    const { callEntitlement } = await import("../lib/core/call-access.js");
    const tags = [ETAG_FRESH, ETAG_SPENT, PREMIUM_TRIAL, PREMIUM_LAPSED, PREMIUM_SUBBED, {}, null];

    for (const tag of tags) {
      const provider = stubProvider(OK_PAYLOAD);
      try {
        resetGeoipCache();
        const captured = (await resolveScannerLocation({}, tag, PUBLIC_IP)) !== null;
        if (!callEntitlement(tag).masking) {
          assert.equal(captured, false);
          assert.equal(provider.calls.length, 0);
        }
      } finally {
        provider.restore();
      }
    }
  });
});

describe("what a captured location contains", () => {
  beforeEach(() => resetGeoipCache());

  test("the raw IP is never part of the stored shape", async () => {
    // The whole privacy position of this feature. The address is on the contact
    // row for abuse handling; it must not travel inside the thing the owner is
    // shown.
    const provider = stubProvider(OK_PAYLOAD);
    try {
      const loc = await resolveScannerLocation({}, PREMIUM_TRIAL, PUBLIC_IP);
      assert.deepEqual(Object.keys(loc).sort(), ["city", "country", "countryCode", "region"]);
      assert.equal(JSON.stringify(loc).includes(PUBLIC_IP), false);
    } finally {
      provider.restore();
    }
  });

  test("a private address yields no location and no request", async () => {
    const provider = stubProvider(OK_PAYLOAD);
    try {
      assert.equal(await resolveScannerLocation({}, PREMIUM_TRIAL, "192.168.1.10"), null);
      assert.equal(await resolveScannerLocation({}, PREMIUM_TRIAL, "127.0.0.1"), null);
      assert.equal(provider.calls.length, 0);
    } finally {
      provider.restore();
    }
  });

  test("an all-unknown answer stores nothing rather than an empty object", async () => {
    // Otherwise every read site has to tell "we looked and found nothing" apart
    // from "we found somewhere", and the activity row would print a blank line.
    const provider = stubProvider({ success: true, country: "", region: null, city: "   " });
    try {
      assert.equal(await resolveScannerLocation({}, PREMIUM_TRIAL, PUBLIC_IP), null);
    } finally {
      provider.restore();
    }
  });

  test("a provider outage costs the contact nothing", async () => {
    // This runs on the path that places a call. It must never throw.
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    try {
      assert.equal(await resolveScannerLocation({}, PREMIUM_TRIAL, PUBLIC_IP), null);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("how a location reads", () => {
  test("most specific part first", () => {
    assert.equal(
      formatScannerLocation({ city: "Andheri East", region: "Maharashtra", country: "India" }),
      "Andheri East, Maharashtra, India"
    );
  });

  test("missing parts are skipped, not printed as gaps", () => {
    assert.equal(
      formatScannerLocation({ city: null, region: "Maharashtra", country: "India" }),
      "Maharashtra, India"
    );
    assert.equal(formatScannerLocation({ city: null, region: null, country: "India" }), "India");
  });

  test("a provider repeating itself is not echoed back", () => {
    // City-states and metros routinely come back as "Mumbai, Mumbai, India".
    assert.equal(
      formatScannerLocation({ city: "Mumbai", region: "mumbai", country: "India" }),
      "Mumbai, India"
    );
    assert.equal(
      formatScannerLocation({ city: "Singapore", region: "Singapore", country: "Singapore" }),
      "Singapore"
    );
  });

  test("nothing to print reads as null, so a caller can branch", () => {
    assert.equal(formatScannerLocation(null), null);
    assert.equal(formatScannerLocation(undefined), null);
    assert.equal(formatScannerLocation({}), null);
    assert.equal(formatScannerLocation({ city: "  ", region: null, country: "" }), null);
  });
});

// Records what the background capture tried to write, without a database.
function fakeCollections() {
  const writes = [];
  return {
    writes,
    contactRequests: {
      async updateOne(filter, update) {
        writes.push({ filter, update });
        return { modifiedCount: 1 };
      }
    }
  };
}

describe("the background capture stamps the row afterwards", () => {
  beforeEach(() => resetGeoipCache());

  test("an entitled tag gets its row updated", async () => {
    const provider = stubProvider(OK_PAYLOAD);
    const collections = fakeCollections();
    try {
      await captureScannerLocation({}, collections, "row-1", PREMIUM_TRIAL, PUBLIC_IP);
      assert.equal(collections.writes.length, 1);
      assert.deepEqual(collections.writes[0].filter, { _id: "row-1" });
      assert.equal(collections.writes[0].update.$set.scannerLocation.city, "Andheri East");
    } finally {
      provider.restore();
    }
  });

  test("an unentitled tag is neither looked up nor written", async () => {
    const provider = stubProvider(OK_PAYLOAD);
    const collections = fakeCollections();
    try {
      await captureScannerLocation({}, collections, "row-2", PREMIUM_LAPSED, PUBLIC_IP);
      assert.equal(provider.calls.length, 0);
      assert.equal(collections.writes.length, 0);
    } finally {
      provider.restore();
    }
  });

  test("an unresolvable address leaves the null already on the row", async () => {
    // Writing null over null would touch a document we have no news for.
    const provider = stubProvider({ success: true, country: "", region: null, city: "" });
    const collections = fakeCollections();
    try {
      await captureScannerLocation({}, collections, "row-3", PREMIUM_TRIAL, PUBLIC_IP);
      assert.equal(collections.writes.length, 0);
    } finally {
      provider.restore();
    }
  });

  test("a database failure cannot escape as an unhandled rejection", async () => {
    // This runs after the response has been decided, so there is nobody left to
    // tell. A throw here could only take the process down over a missing city.
    const provider = stubProvider(OK_PAYLOAD);
    const collections = {
      contactRequests: {
        async updateOne() {
          throw new Error("mongo is gone");
        }
      }
    };
    try {
      await captureScannerLocation({}, collections, "row-4", PREMIUM_TRIAL, PUBLIC_IP);
      // Reaching here at all is the assertion: it resolved rather than rejected.
      assert.ok(true);
    } finally {
      provider.restore();
    }
  });

  test("settleScannerLocations waits for work started but not awaited", async () => {
    // The seam the route tests rely on. Without it they would poll and hope.
    const provider = stubProvider(OK_PAYLOAD);
    const collections = fakeCollections();
    try {
      captureScannerLocation({}, collections, "row-5", PREMIUM_TRIAL, PUBLIC_IP);
      assert.equal(collections.writes.length, 0, "not written synchronously");
      await settleScannerLocations();
      assert.equal(collections.writes.length, 1, "written once settled");
    } finally {
      provider.restore();
    }
  });
});
